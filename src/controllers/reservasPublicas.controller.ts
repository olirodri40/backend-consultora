import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';
import { variantesDia } from '../utils/dias';
import { fechaHoy, horaAhora } from '../utils/tiempo';
import { notificarNuevaReservaWeb } from '../services/notificaciones.services';

type FilaDisponibilidad = {
  user_id: number;
  hora_inicio: string;
  hora_fin: string;
  slot_minutos: number;
};

async function getDisponibilidadServicio(
  servicioId: number,
  areaId: number,
  fecha: string
): Promise<FilaDisponibilidad[]> {
  const dias = variantesDia(fecha);
  const resultado = await pool.query(
    `SELECT DISTINCT av.user_id, av.hora_inicio::text, av.hora_fin::text,
            COALESCE(av.slot_minutos, 60) as slot_minutos
     FROM availability av
     JOIN user_servicios us ON us.user_id = av.user_id
       AND us.servicio_id = $1 AND us.visible_publico = true
     JOIN users u ON u.id = av.user_id AND u.activo IS NOT FALSE
     WHERE av.area_id = $2 AND av.dia = ANY($3::text[])`,
    [servicioId, areaId, dias]
  );
  return resultado.rows;
}

function aMinutos(horaTexto: string): number {
  const [h, m] = horaTexto.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function aHoraStr(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

// true si fecha+hora ya pasó respecto a ahora — evita reservar horarios de hoy
// que ya vencieron (ej. son las 12:00 y el visitante intenta las 08:00 de hoy).
// Se compara contra la hora de Bolivia, no la del servidor: Render corre en
// UTC (4 horas adelante), así que usar la hora del servidor daba por vencidos
// horarios que todavía faltaban.
function yaPaso(fecha: string, horaStr: string): boolean {
  const hoy = fechaHoy();
  if (fecha < hoy) return true;
  if (fecha > hoy) return false;
  return horaStr <= horaAhora();
}

type Bloqueo = { inicio: number; fin: number };

// Junta, por profesional, todo lo que ya le ocupa esa hora ese día: citas reales
// (appointments) Y actividades de Gerontología a las que está asignado como encargado
// (user_geronto_activities) — estas últimas se repiten cada semana en su mismo día/hora
// y no viven en la tabla appointments, así que si no se suman acá el sistema los seguía
// ofreciendo como libres aunque en la práctica estén dando esa clase.
async function getOcupadosPorProfesional(
  userIds: number[],
  fecha: string
): Promise<Map<number, Bloqueo[]>> {
  const ocupados = new Map<number, Bloqueo[]>();
  if (userIds.length === 0) return ocupados;

  function agregar(userId: number, inicio: number, fin: number) {
    const lista = ocupados.get(userId) || [];
    lista.push({ inicio, fin });
    ocupados.set(userId, lista);
  }

  const citasRes = await pool.query(
    `SELECT professional_id, hora::text, COALESCE(duracion_min, 60) as duracion_min
     FROM appointments
     WHERE professional_id = ANY($1::int[]) AND fecha = $2 AND estado != 'cancelada'`,
    [userIds, fecha]
  );
  for (const r of citasRes.rows) {
    const inicio = aMinutos(r.hora);
    agregar(r.professional_id, inicio, inicio + (r.duracion_min || 60));
  }

  const dias = variantesDia(fecha);
  const gerontoRes = await pool.query(
    `SELECT uga.user_id, ga.hora_inicio::text, ga.hora_fin::text
     FROM user_geronto_activities uga
     JOIN geronto_activities ga ON ga.id = uga.activity_id AND ga.activo = true
     WHERE uga.user_id = ANY($1::int[]) AND ga.dia = ANY($2::text[])`,
    [userIds, dias]
  );
  for (const r of gerontoRes.rows) {
    agregar(r.user_id, aMinutos(r.hora_inicio), aMinutos(r.hora_fin));
  }

  // Bloqueos de agenda (cursos, capacitaciones, seminarios) — el profesional
  // queda completamente ocupado esa fecha/rango, tanto para Admin/Agenda
  // como para el sitio público.
  const bloqueosRes = await pool.query(
    `SELECT professional_id, hora_inicio::text, hora_fin::text
     FROM bloqueos_agenda
     WHERE professional_id = ANY($1::int[]) AND fecha = $2`,
    [userIds, fecha]
  );
  for (const r of bloqueosRes.rows) {
    agregar(r.professional_id, aMinutos(r.hora_inicio), aMinutos(r.hora_fin));
  }

  // Sesiones grupales recurrentes (ej. "Sesión Embarazadas" los martes 18:00-19:00):
  // mientras el profesional la está dando, tampoco cuenta como libre para OTROS
  // servicios individuales a esa misma hora.
  const sesionesGrupalesRes = await pool.query(
    `SELECT professional_id, hora_inicio::text, hora_fin::text
     FROM sesiones_grupales
     WHERE professional_id = ANY($1::int[]) AND activo = true
       AND dia = ANY($2::text[]) AND fecha_inicio <= $3`,
    [userIds, dias, fecha]
  );
  for (const r of sesionesGrupalesRes.rows) {
    agregar(r.professional_id, aMinutos(r.hora_inicio), aMinutos(r.hora_fin));
  }

  return ocupados;
}

// Para cada profesional disponible ese día/área/servicio, genera sus posibles horarios
// de INICIO (hora_inicio → hora_fin, saltando de a slot_minutos — la grilla de CADA
// profesional, no una fija) y descarta los que no alcanzan a completar la duración
// del servicio dentro de su jornada, o que se solapan con una cita que ya tiene ese
// profesional (no solo un choque exacto de hora, sino cualquier cruce de horario:
// ej. un servicio de 120 min a las 13:00 choca con una cita de 30 min a las 14:00).
async function contarCuposPorHora(
  servicioId: number,
  areaId: number,
  fecha: string,
  duracionServicioMin: number
): Promise<Record<string, number>> {
  const duracion = duracionServicioMin > 0 ? duracionServicioMin : 60;
  const disponibilidad = await getDisponibilidadServicio(servicioId, areaId, fecha);
  if (disponibilidad.length === 0) return {};

  const userIds = disponibilidad.map((d) => d.user_id);
  const ocupadosPorProfesional = await getOcupadosPorProfesional(userIds, fecha);

  // Se cuenta CADA horario de inicio posible según la grilla de al menos un profesional,
  // así el horario sigue apareciendo aunque termine en 0 cupos, en vez de desaparecer.
  const contador: Record<string, number> = {};
  for (const p of disponibilidad) {
    const inicioJornada = aMinutos(p.hora_inicio);
    const finJornada = aMinutos(p.hora_fin);
    const paso = p.slot_minutos || 60;
    const ocupados = ocupadosPorProfesional.get(p.user_id) || [];

    let actual = inicioJornada;
    while (actual + duracion <= finJornada) {
      const horaStr = aHoraStr(actual);
      if (!(horaStr in contador)) contador[horaStr] = 0;

      const finServicio = actual + duracion;
      const solapa = ocupados.some((o) => actual < o.fin && finServicio > o.inicio);
      if (!solapa) contador[horaStr] += 1;

      actual += paso;
    }
  }
  return contador;
}

// Si el servicio tiene una sesión grupal configurada y visible al público,
// devuelve esa plantilla (profesional fijo, día de semana fijo, capacidad).
async function getSesionGrupalPublica(servicioId: number) {
  const resultado = await pool.query(
    `SELECT sg.id, sg.professional_id, sg.area_id, sg.dia, sg.hora_inicio::text, sg.hora_fin::text,
            sg.fecha_inicio::text, sg.capacidad, sg.costo_grupal
     FROM sesiones_grupales sg
     WHERE sg.servicio_id = $1 AND sg.activo = true AND sg.visible_publico = true
     LIMIT 1`,
    [servicioId]
  );
  return resultado.rows[0] || null;
}

// GET /api/reservas-publicas/cupos?servicio_id=&fecha=  (sin auth — sitio web público)
export async function getCuposPublicos(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { servicio_id, fecha } = req.query;
    if (!servicio_id || !fecha) {
      res.status(400).json({ ok: false, mensaje: 'servicio_id y fecha son obligatorios' });
      return;
    }

    const servicioRes = await pool.query(
      `SELECT id, area_id, duracion_min FROM services WHERE id = $1 AND activo = true AND visible_publico = true`,
      [servicio_id]
    );
    if (servicioRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Servicio no encontrado o no disponible' });
      return;
    }
    const areaId = servicioRes.rows[0].area_id;
    const duracionMin = servicioRes.rows[0].duracion_min || 60;

    // Sesión grupal: NO se ofrece toda la grilla de disponibilidad del profesional,
    // solo aparece el día de semana y el horario puntual configurado, sin mostrar
    // un número de cupos al visitante (solo si sigue habiendo lugar o no).
    const sesionGrupal = await getSesionGrupalPublica(Number(servicio_id));
    if (sesionGrupal) {
      const dias = variantesDia(String(fecha));
      if (!dias.includes(sesionGrupal.dia) || (sesionGrupal.fecha_inicio && String(fecha) < sesionGrupal.fecha_inicio)) {
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, horarios: [] });
        return;
      }
      const horaInicio = sesionGrupal.hora_inicio.slice(0, 5);
      const yaPasoGrupal = yaPaso(String(fecha), horaInicio);
      if (yaPasoGrupal) {
        // Se sigue mostrando (para que el visitante vea que ese día sí hay
        // sesión, a esa hora) pero sin poder reservarla.
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, horarios: [{ hora: horaInicio, cupos: 0, esGrupal: true, pasado: true }] });
        return;
      }
      const ocupadosRes = await pool.query(
        `SELECT COUNT(*) as total FROM appointments
         WHERE professional_id = $1 AND fecha = $2 AND hora = $3 AND estado != 'cancelada'`,
        [sesionGrupal.professional_id, fecha, sesionGrupal.hora_inicio]
      );
      const pendientesRes = await pool.query(
        `SELECT COUNT(*) as total FROM reservas_publicas
         WHERE servicio_id = $1 AND fecha = $2 AND hora = $3 AND estado = 'pendiente'`,
        [servicio_id, fecha, sesionGrupal.hora_inicio]
      );
      const ocupados = parseInt(ocupadosRes.rows[0].total, 10) + parseInt(pendientesRes.rows[0].total, 10);
      const cupos = Math.max(0, sesionGrupal.capacidad - ocupados);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, horarios: [{ hora: horaInicio, cupos, esGrupal: true, pasado: false }] });
      return;
    }

    const contador = await contarCuposPorHora(Number(servicio_id), areaId, String(fecha), duracionMin);

    const pendientesRes = await pool.query(
      `SELECT hora::text, COUNT(*) as total FROM reservas_publicas
       WHERE servicio_id = $1 AND fecha = $2 AND estado = 'pendiente'
       GROUP BY hora`,
      [servicio_id, fecha]
    );
    const pendientesPorHora: Record<string, number> = {};
    for (const r of pendientesRes.rows) pendientesPorHora[r.hora.slice(0, 5)] = parseInt(r.total, 10);

    // Se devuelve la jornada COMPLETA del día (todos los horarios de todos los
    // profesionales que dan el servicio), no solo los que se pueden reservar:
    // los ocupados van con 0 cupos y los que ya pasaron van marcados con
    // `pasado`. Así el visitante ve el horario real de atención en vez de una
    // lista recortada que parece que "casi no hay horarios".
    const horarios = Object.keys(contador)
      .sort()
      .map((hora) => {
        const pasado = yaPaso(String(fecha), hora);
        return {
          hora,
          cupos: pasado ? 0 : Math.max(0, contador[hora] - (pendientesPorHora[hora] || 0)),
          pasado,
        };
      });

    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, horarios });
  } catch (error) {
    console.error('Error al calcular cupos públicos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al calcular los cupos disponibles' });
  }
}

// POST /api/reservas-publicas  (sin auth — sitio web público)
export async function crearReservaPublica(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const {
      servicio_id, fecha, hora, paciente_nombre, paciente_telefono, paciente_email,
      paciente_carnet, paciente_edad, notas,
    } = req.body;

    if (!servicio_id || !fecha || !hora || !paciente_nombre || !paciente_telefono) {
      res.status(400).json({ ok: false, mensaje: 'Faltan datos obligatorios de la reserva' });
      return;
    }

    const servicioRes = await pool.query(
      `SELECT s.id, s.area_id, s.duracion_min, s.nombre, ar.nombre as area_nombre
       FROM services s
       JOIN areas ar ON ar.id = s.area_id
       WHERE s.id = $1 AND s.activo = true AND s.visible_publico = true`,
      [servicio_id]
    );
    if (servicioRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Servicio no encontrado o no disponible' });
      return;
    }
    const areaId = servicioRes.rows[0].area_id;
    const duracionMin = servicioRes.rows[0].duracion_min || 60;

    const horaNormalizada = String(hora).slice(0, 5);

    if (yaPaso(String(fecha), horaNormalizada)) {
      res.status(409).json({ ok: false, mensaje: 'Ese horario ya pasó, elige uno más adelante' });
      return;
    }

    const sesionGrupal = await getSesionGrupalPublica(Number(servicio_id));
    if (sesionGrupal) {
      const dias = variantesDia(String(fecha));
      if (
        !dias.includes(sesionGrupal.dia) ||
        horaNormalizada !== sesionGrupal.hora_inicio.slice(0, 5) ||
        (sesionGrupal.fecha_inicio && String(fecha) < sesionGrupal.fecha_inicio)
      ) {
        res.status(400).json({ ok: false, mensaje: `Esta sesión grupal es solo los ${sesionGrupal.dia} a las ${sesionGrupal.hora_inicio.slice(0, 5)}` });
        return;
      }
      const ocupadosRes = await pool.query(
        `SELECT COUNT(*) as total FROM appointments
         WHERE professional_id = $1 AND fecha = $2 AND hora = $3 AND estado != 'cancelada'`,
        [sesionGrupal.professional_id, fecha, sesionGrupal.hora_inicio]
      );
      const pendientesGrupalRes = await pool.query(
        `SELECT COUNT(*) as total FROM reservas_publicas
         WHERE servicio_id = $1 AND fecha = $2 AND hora = $3 AND estado = 'pendiente'`,
        [servicio_id, fecha, sesionGrupal.hora_inicio]
      );
      const ocupados = parseInt(ocupadosRes.rows[0].total, 10) + parseInt(pendientesGrupalRes.rows[0].total, 10);
      if (ocupados >= sesionGrupal.capacidad) {
        res.status(409).json({ ok: false, mensaje: 'Esta sesión grupal ya está llena para esa fecha' });
        return;
      }
    } else {
      const contador = await contarCuposPorHora(Number(servicio_id), areaId, String(fecha), duracionMin);
      const pendientesRes = await pool.query(
        `SELECT COUNT(*) as total FROM reservas_publicas
         WHERE servicio_id = $1 AND fecha = $2 AND hora = $3 AND estado = 'pendiente'`,
        [servicio_id, fecha, hora]
      );
      const cuposDisponibles = (contador[horaNormalizada] || 0) - parseInt(pendientesRes.rows[0].total, 10);

      if (cuposDisponibles <= 0) {
        res.status(409).json({ ok: false, mensaje: 'Ya no quedan cupos disponibles en ese horario' });
        return;
      }
    }

    // La edad llega como texto desde el formulario web; se guarda como número
    // (o null si vino vacía/inválida) porque la columna es INTEGER.
    const edadNumero = paciente_edad !== undefined && paciente_edad !== null && String(paciente_edad).trim() !== ''
      ? Number(paciente_edad)
      : null;

    const nueva = await pool.query(
      `INSERT INTO reservas_publicas
        (area_id, servicio_id, fecha, hora, paciente_nombre, paciente_telefono, paciente_email,
         paciente_carnet, paciente_edad, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        areaId, servicio_id, fecha, hora, paciente_nombre, paciente_telefono,
        paciente_email || null,
        paciente_carnet || null,
        Number.isFinite(edadNumero as number) ? edadNumero : null,
        notas || null,
      ]
    );

    // Aviso a recepción/administración de que hay una reserva esperando
    // confirmación. Si algo falla acá no se rompe la reserva del visitante:
    // la solicitud ya quedó guardada y visible en el panel igual.
    notificarNuevaReservaWeb(
      paciente_nombre,
      servicioRes.rows[0].area_nombre,
      servicioRes.rows[0].nombre,
      String(fecha),
      horaNormalizada
    ).catch((err) => console.error('Error al notificar reserva web:', err));

    res.status(201).json({
      ok: true,
      mensaje: 'Tu solicitud fue recibida. Un asesor la confirmará a la brevedad.',
      id: nueva.rows[0].id,
    });
  } catch (error) {
    console.error('Error al crear reserva pública:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar la reserva' });
  }
}

// GET /api/reservas-publicas/pendientes  (staff)
export async function getReservasPendientes(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT rp.id, rp.fecha, rp.hora::text, rp.paciente_nombre, rp.paciente_telefono,
              rp.paciente_email, rp.paciente_carnet, rp.paciente_edad, rp.notas,
              rp.estado, rp.created_at,
              s.id as servicio_id, s.nombre as servicio_nombre, s.costo,
              ar.id as area_id, ar.nombre as area_nombre
       FROM reservas_publicas rp
       JOIN services s ON s.id = rp.servicio_id
       JOIN areas ar ON ar.id = rp.area_id
       WHERE rp.estado = 'pendiente'
       ORDER BY rp.fecha, rp.hora`
    );
    res.json({ ok: true, reservas: resultado.rows });
  } catch (error) {
    console.error('Error al obtener reservas pendientes:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener reservas pendientes' });
  }
}

// GET /api/reservas-publicas/:id/candidatos  (staff) — profesionales libres para asignar
export async function getCandidatosReserva(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const reservaRes = await pool.query(
      `SELECT servicio_id, area_id, fecha::text, hora::text FROM reservas_publicas WHERE id = $1`,
      [id]
    );
    if (reservaRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Reserva no encontrada' });
      return;
    }
    const reserva = reservaRes.rows[0];
    const horaInicio = aMinutos(reserva.hora);

    // Sesión grupal: el profesional ya está fijo en la plantilla, no hay que
    // buscar candidatos por disponibilidad — solo confirmar que hay cupo.
    const sesionGrupal = await getSesionGrupalPublica(reserva.servicio_id);
    if (sesionGrupal) {
      const ocupadosRes = await pool.query(
        `SELECT COUNT(*) as total FROM appointments
         WHERE professional_id = $1 AND fecha = $2 AND hora = $3 AND estado != 'cancelada'`,
        [sesionGrupal.professional_id, reserva.fecha, sesionGrupal.hora_inicio]
      );
      const ocupados = parseInt(ocupadosRes.rows[0].total, 10);
      const nombreRes = await pool.query('SELECT nombre FROM users WHERE id = $1', [sesionGrupal.professional_id]);
      res.json({
        ok: true,
        candidatos: [
          {
            id: sesionGrupal.professional_id,
            nombre: nombreRes.rows[0]?.nombre || '—',
            disponible: ocupados < sesionGrupal.capacidad,
          },
        ],
        esGrupal: true,
      });
      return;
    }

    const servicioRes = await pool.query(`SELECT duracion_min FROM services WHERE id = $1`, [reserva.servicio_id]);
    const duracion = servicioRes.rows[0]?.duracion_min || 60;
    const horaFinReserva = horaInicio + duracion;

    const disponibilidad = await getDisponibilidadServicio(reserva.servicio_id, reserva.area_id, reserva.fecha);
    const candidatosIds = disponibilidad
      .filter((d) => {
        const inicioJornada = aMinutos(d.hora_inicio);
        const finJornada = aMinutos(d.hora_fin);
        const dentroDeJornada = horaInicio >= inicioJornada && horaFinReserva <= finJornada;
        // La hora de la reserva tiene que caer justo en uno de los slots del
        // profesional (cada 30, 60min, etc.) — si su horario es cada 60min y
        // la reserva es a las 09:30, ese profesional no puede atenderla.
        const paso = d.slot_minutos || 60;
        const encajaEnSuGrilla = (horaInicio - inicioJornada) % paso === 0;
        return dentroDeJornada && encajaEnSuGrilla;
      })
      .map((d) => d.user_id);

    if (candidatosIds.length === 0) {
      res.json({ ok: true, candidatos: [] });
      return;
    }

    const ocupadosPorProfesional = await getOcupadosPorProfesional(candidatosIds, reserva.fecha);

    const usuariosRes = await pool.query(`SELECT id, nombre FROM users WHERE id = ANY($1::int[]) ORDER BY nombre`, [
      candidatosIds,
    ]);
    const candidatos = usuariosRes.rows.map((u) => {
      const ocupados = ocupadosPorProfesional.get(u.id) || [];
      const disponible = !ocupados.some((o) => horaInicio < o.fin && horaFinReserva > o.inicio);
      return { id: u.id, nombre: u.nombre, disponible };
    });

    res.json({ ok: true, candidatos });
  } catch (error) {
    console.error('Error al obtener candidatos de la reserva:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener los profesionales disponibles' });
  }
}

// PUT /api/reservas-publicas/:id/confirmar  (staff) — body: { professional_id }
export async function confirmarReservaPublica(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { professional_id } = req.body;

    if (!professional_id) {
      res.status(400).json({ ok: false, mensaje: 'Debes seleccionar un profesional' });
      return;
    }

    const reservaRes = await pool.query(`SELECT * FROM reservas_publicas WHERE id = $1`, [id]);
    if (reservaRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Reserva no encontrada' });
      return;
    }
    const reserva = reservaRes.rows[0];
    if (reserva.estado !== 'pendiente') {
      res.status(409).json({ ok: false, mensaje: 'Esta reserva ya fue procesada' });
      return;
    }

    const servicioRes = await pool.query(`SELECT nombre, costo, duracion_min FROM services WHERE id = $1`, [
      reserva.servicio_id,
    ]);
    const servicio = servicioRes.rows[0];
    const duracion = servicio?.duracion_min || 60;
    const horaInicio = aMinutos(reserva.hora);
    const horaFin = horaInicio + duracion;

    const sesionGrupal = await getSesionGrupalPublica(reserva.servicio_id);

    if (sesionGrupal) {
      // Sesión grupal: varios pacientes distintos (que no se conocen entre sí)
      // comparten el mismo profesional/hora a propósito — no es un choque de
      // horario, se valida capacidad, y cada uno queda como cita independiente
      // (sin grupo_id compartido, cada quien con su propio costo y pago).
      const ocupadosRes = await pool.query(
        `SELECT id FROM appointments
         WHERE professional_id = $1 AND fecha = $2 AND hora = $3 AND estado != 'cancelada'`,
        [professional_id, reserva.fecha, reserva.hora]
      );
      if (ocupadosRes.rows.length >= sesionGrupal.capacidad) {
        res.status(409).json({ ok: false, mensaje: 'Esta sesión grupal ya está llena para esa fecha' });
        return;
      }
    } else {
      const ocupadosDelProfesional = (await getOcupadosPorProfesional([professional_id], reserva.fecha)).get(
        Number(professional_id)
      ) || [];
      const seSolapa = ocupadosDelProfesional.some((o) => horaInicio < o.fin && horaFin > o.inicio);
      if (seSolapa) {
        res.status(409).json({ ok: false, mensaje: 'Ese profesional ya tiene una cita que se cruza con este horario' });
        return;
      }
    }

    // El carnet y la edad que dejó el paciente en el sitio web van a SU FICHA
    // (patients.carnet / patients.edad), no a las notas de la cita.
    let patient_id: number;
    const existente = await pool.query(`SELECT id FROM patients WHERE telefono = $1`, [reserva.paciente_telefono]);
    if (existente.rows.length > 0) {
      patient_id = existente.rows[0].id;
      // Paciente que ya existía: completamos solo los datos que le faltaban,
      // sin pisar lo que recepción ya haya cargado a mano (COALESCE mantiene
      // el valor actual si no está vacío).
      await pool.query(
        `UPDATE patients SET
           carnet = COALESCE(NULLIF(carnet, ''), $1),
           edad   = COALESCE(edad, $2),
           updated_at = NOW(),
           updated_by = $3
         WHERE id = $4`,
        [reserva.paciente_carnet || null, reserva.paciente_edad ?? null, req.usuario!.id, patient_id]
      );
    } else {
      const nuevoPaciente = await pool.query(
        `INSERT INTO patients (nombre, telefono, carnet, edad, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          reserva.paciente_nombre,
          reserva.paciente_telefono,
          reserva.paciente_carnet || null,
          reserva.paciente_edad ?? null,
          req.usuario!.id,
        ]
      );
      patient_id = nuevoPaciente.rows[0].id;
    }

    const maxCiclo = await pool.query(
      `SELECT COALESCE(MAX(ciclo), 0) as max_ciclo FROM appointments WHERE patient_id=$1 AND area_id=$2`,
      [patient_id, reserva.area_id]
    );
    const numeroCiclo = maxCiclo.rows[0].max_ciclo + 1;

    const montoFinal = sesionGrupal ? (sesionGrupal.costo_grupal ?? servicio?.costo) : servicio?.costo;

    const nuevaCita = await pool.query(
      `INSERT INTO appointments
        (patient_id, professional_id, area_id, fecha, hora, modalidad, sesion, total_sesiones,
         ciclo, estado, servicio_nombre, monto, monto_total, notas, duracion_min, created_by)
       VALUES ($1,$2,$3,$4,$5,'presencial',1,1,$6,'pendiente',$7,$8,$8,$9,$10,$11)
       RETURNING id`,
      [
        patient_id,
        professional_id,
        reserva.area_id,
        reserva.fecha,
        reserva.hora,
        numeroCiclo,
        servicio?.nombre || null,
        montoFinal || null,
        // Solo lo que el paciente escribió en "Notas" del sitio web — el carnet
        // y la edad ya quedaron en su ficha, no se repiten acá.
        reserva.notas || null,
        servicio?.duracion_min || null,
        req.usuario!.id,
      ]
    );

    await pool.query(
      `UPDATE reservas_publicas SET
        estado = 'confirmada', professional_id = $1, appointment_id = $2,
        confirmado_por = $3, confirmado_at = NOW()
       WHERE id = $4`,
      [professional_id, nuevaCita.rows[0].id, req.usuario!.id, id]
    );

    await registrarAudit({
      tabla: 'reservas_publicas',
      registro_id: Number(id),
      accion: 'editar',
      datos_despues: { estado: 'confirmada', professional_id, appointment_id: nuevaCita.rows[0].id },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Reserva confirmada y agendada correctamente', appointment_id: nuevaCita.rows[0].id });
  } catch (error) {
    console.error('Error al confirmar reserva pública:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al confirmar la reserva' });
  }
}

// GET /api/reservas-publicas/historial — reservas ya resueltas (confirmadas o
// rechazadas). Estas nunca se borran solas al eliminar un paciente/cita: son
// el registro histórico de "alguien pidió esto desde el sitio web", separado
// de la cita real que se haya creado a partir de ellas.
export async function getReservasHistorial(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT rp.id, rp.fecha, rp.hora::text, rp.paciente_nombre, rp.paciente_telefono,
              rp.paciente_email, rp.paciente_carnet, rp.paciente_edad, rp.notas,
              rp.estado, rp.created_at, rp.confirmado_at,
              s.id as servicio_id, s.nombre as servicio_nombre, s.costo,
              ar.id as area_id, ar.nombre as area_nombre,
              u.id as professional_id, u.nombre as professional_nombre
       FROM reservas_publicas rp
       JOIN services s ON s.id = rp.servicio_id
       JOIN areas ar ON ar.id = rp.area_id
       LEFT JOIN users u ON u.id = rp.professional_id
       WHERE rp.estado != 'pendiente'
       ORDER BY rp.created_at DESC`
    );
    res.json({ ok: true, reservas: resultado.rows });
  } catch (error) {
    console.error('Error al obtener historial de reservas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener el historial de reservas' });
  }
}

// DELETE /api/reservas-publicas/:id — borra el registro histórico de una
// reserva ya resuelta (no toca la cita/appointment real que haya generado).
export async function eliminarReservaPublica(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const resultado = await pool.query(
      `DELETE FROM reservas_publicas WHERE id = $1 AND estado != 'pendiente' RETURNING id`,
      [id]
    );
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'No encontrada, o todavía está pendiente (recházala o confírmala primero)' });
      return;
    }
    res.json({ ok: true, mensaje: 'Reserva eliminada del historial' });
  } catch (error) {
    console.error('Error al eliminar reserva pública:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar la reserva' });
  }
}

// PUT /api/reservas-publicas/:id/rechazar  (staff)
export async function rechazarReservaPublica(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const resultado = await pool.query(
      `UPDATE reservas_publicas SET estado = 'rechazada' WHERE id = $1 AND estado = 'pendiente' RETURNING id`,
      [id]
    );
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Reserva no encontrada o ya procesada' });
      return;
    }
    res.json({ ok: true, mensaje: 'Reserva rechazada' });
  } catch (error) {
    console.error('Error al rechazar reserva pública:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al rechazar la reserva' });
  }
}
