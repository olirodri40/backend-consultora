import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';
import { nombreDelDia, mismoDia } from '../utils/dias';

const DIAS_VALIDOS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Miércoles', 'Jueves', 'Viernes', 'Sabado', 'Sábado'];

// GET /api/sesiones-grupales
export async function getSesionesGrupales(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT sg.id, sg.professional_id, sg.servicio_id, sg.servicio_individual_id, sg.area_id, sg.dia,
              sg.hora_inicio::text, sg.hora_fin::text, sg.fecha_inicio::text, sg.capacidad, sg.costo_grupal,
              sg.activo, sg.visible_publico,
              u.nombre as profesional_nombre, s.nombre as servicio_nombre, s.costo as costo_individual,
              si.nombre as servicio_individual_nombre, si.costo as costo_individual_alt,
              ar.nombre as area_nombre
       FROM sesiones_grupales sg
       JOIN users u ON u.id = sg.professional_id
       JOIN services s ON s.id = sg.servicio_id
       LEFT JOIN services si ON si.id = sg.servicio_individual_id
       JOIN areas ar ON ar.id = sg.area_id
       ORDER BY ar.nombre, sg.dia, sg.hora_inicio`
    );
    res.json({ ok: true, sesiones: resultado.rows });
  } catch (error) {
    console.error('Error al obtener sesiones grupales:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener las sesiones grupales' });
  }
}

// POST /api/sesiones-grupales
export async function crearSesionGrupal(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { professional_id, servicio_id, servicio_individual_id, area_id, dia, hora_inicio, hora_fin, fecha_inicio, capacidad, costo_grupal, visible_publico } = req.body;

    if (!professional_id || !servicio_id || !area_id || !dia || !hora_inicio || !hora_fin) {
      res.status(400).json({ ok: false, mensaje: 'Faltan datos obligatorios de la sesión grupal' });
      return;
    }
    if (!DIAS_VALIDOS.includes(dia)) {
      res.status(400).json({ ok: false, mensaje: 'Día inválido' });
      return;
    }
    if (hora_fin <= hora_inicio) {
      res.status(400).json({ ok: false, mensaje: 'La hora de fin debe ser posterior a la de inicio' });
      return;
    }

    // El horario elegido tiene que caer dentro del horario real que el
    // profesional tiene configurado ese día (evita crear una sesión grupal en
    // una hora en la que no trabaja).
    const horarioProf = await pool.query(
      `SELECT hora_inicio::text, hora_fin::text FROM availability
       WHERE user_id = $1 AND area_id = $2
         AND (dia = $3 OR dia = translate($3, 'áéíóú', 'aeiou') OR translate(dia, 'áéíóú', 'aeiou') = translate($3, 'áéíóú', 'aeiou'))
         AND hora_inicio <= $4::time AND hora_fin >= $5::time`,
      [professional_id, area_id, dia, hora_inicio, hora_fin]
    );
    if (horarioProf.rows.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'Ese horario está fuera de la jornada configurada del profesional ese día' });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO sesiones_grupales
        (professional_id, servicio_id, servicio_individual_id, area_id, dia, hora_inicio, hora_fin, fecha_inicio, capacidad, costo_grupal, visible_publico, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        professional_id, servicio_id, servicio_individual_id || null, area_id, dia, hora_inicio, hora_fin,
        fecha_inicio || new Date().toISOString().slice(0, 10),
        capacidad && capacidad > 0 ? capacidad : 5,
        costo_grupal ?? null,
        visible_publico !== false,
        req.usuario!.id,
      ]
    );

    await registrarAudit({
      tabla: 'sesiones_grupales',
      registro_id: resultado.rows[0].id,
      accion: 'crear',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Sesión grupal creada correctamente', id: resultado.rows[0].id });
  } catch (error) {
    console.error('Error al crear sesión grupal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear la sesión grupal' });
  }
}

// PUT /api/sesiones-grupales/:id
export async function actualizarSesionGrupal(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { dia, hora_inicio, hora_fin, fecha_inicio, capacidad, costo_grupal, servicio_individual_id, activo, visible_publico } = req.body;

    const resultado = await pool.query(
      `UPDATE sesiones_grupales SET
        dia                    = COALESCE($1, dia),
        hora_inicio            = COALESCE($2, hora_inicio),
        hora_fin               = COALESCE($3, hora_fin),
        fecha_inicio           = COALESCE($4, fecha_inicio),
        capacidad              = COALESCE($5, capacidad),
        costo_grupal           = $6,
        servicio_individual_id = $7,
        activo                 = COALESCE($8, activo),
        visible_publico        = COALESCE($9, visible_publico)
       WHERE id = $10 RETURNING id`,
      [dia, hora_inicio, hora_fin, fecha_inicio, capacidad, costo_grupal ?? null, servicio_individual_id ?? null, activo, visible_publico, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Sesión grupal no encontrada' });
      return;
    }

    res.json({ ok: true, mensaje: 'Sesión grupal actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar sesión grupal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar la sesión grupal' });
  }
}

// DELETE /api/sesiones-grupales/:id
export async function eliminarSesionGrupal(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const resultado = await pool.query('DELETE FROM sesiones_grupales WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Sesión grupal no encontrada' });
      return;
    }
    res.json({ ok: true, mensaje: 'Sesión grupal eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar sesión grupal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar la sesión grupal' });
  }
}

// GET /api/sesiones-grupales/:id/ocupacion?fecha=YYYY-MM-DD
// Lista quién ya está anotado ese día puntual en esa sesión grupal.
export async function getOcupacionSesionGrupal(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { fecha } = req.query;
    if (!fecha) {
      res.status(400).json({ ok: false, mensaje: 'La fecha es obligatoria' });
      return;
    }

    const plantillaRes = await pool.query(
      `SELECT sg.*, s.nombre as servicio_nombre, s.costo as costo_individual,
              si.nombre as servicio_individual_nombre, si.costo as costo_individual_alt
       FROM sesiones_grupales sg
       JOIN services s ON s.id = sg.servicio_id
       LEFT JOIN services si ON si.id = sg.servicio_individual_id
       WHERE sg.id = $1`,
      [id]
    );
    if (plantillaRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Sesión grupal no encontrada' });
      return;
    }
    const plantilla = plantillaRes.rows[0];

    const asistentesRes = await pool.query(
      `SELECT a.id, a.patient_id, a.monto, a.monto_pagado, a.estado_pago, a.estado, a.notas, a.servicio_nombre, p.nombre as paciente_nombre, p.telefono as paciente_telefono
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.professional_id = $1 AND a.fecha = $2 AND a.hora = $3 AND a.estado != 'cancelada'
       ORDER BY a.id`,
      [plantilla.professional_id, fecha, plantilla.hora_inicio]
    );

    res.json({
      ok: true,
      capacidad: plantilla.capacidad,
      ocupados: asistentesRes.rows.length,
      asistentes: asistentesRes.rows,
      servicio_nombre: plantilla.servicio_nombre,
      costo_grupal: plantilla.costo_grupal,
      // Costo/nombre que se usan cuando se marca "individual": si esta sesión
      // tiene un servicio individual distinto configurado, se usa ese; si no,
      // se cae al costo individual del mismo servicio grupal (comportamiento anterior).
      servicio_individual_nombre: plantilla.servicio_individual_nombre || plantilla.servicio_nombre,
      costo_individual: plantilla.servicio_individual_id ? plantilla.costo_individual_alt : plantilla.costo_individual,
    });
  } catch (error) {
    console.error('Error al obtener ocupación de sesión grupal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener la ocupación' });
  }
}

// POST /api/sesiones-grupales/:id/inscribir?fecha=YYYY-MM-DD
// Anota a un paciente en la sesión grupal de ese día puntual — puede ser
// desde Admin/Agenda (recepcionista atendiendo a alguien que llegó) o para
// confirmar una reserva hecha desde el sitio público. `individual: true`
// permite cobrar tarifa de sesión individual dentro del mismo horario grupal
// (ej. ese día vino una sola persona).
export async function inscribirEnSesionGrupal(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { fecha } = req.query;
    const {
      paciente_nombre, paciente_telefono, paciente_carnet, paciente_edad, patient_id: patientIdExterno,
      individual, notas, costo: costoOverride, monto_pagado: montoPagadoBody,
    } = req.body;

    if (!fecha) {
      res.status(400).json({ ok: false, mensaje: 'La fecha es obligatoria' });
      return;
    }
    if (!paciente_nombre) {
      res.status(400).json({ ok: false, mensaje: 'El nombre del paciente es obligatorio' });
      return;
    }

    const plantillaRes = await pool.query(
      `SELECT sg.*, s.nombre as servicio_nombre, s.costo as costo_individual,
              si.nombre as servicio_individual_nombre, si.costo as costo_individual_alt
       FROM sesiones_grupales sg
       JOIN services s ON s.id = sg.servicio_id
       LEFT JOIN services si ON si.id = sg.servicio_individual_id
       WHERE sg.id = $1`,
      [id]
    );
    if (plantillaRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Sesión grupal no encontrada' });
      return;
    }
    const plantilla = plantillaRes.rows[0];

    const diaDeLaFecha = nombreDelDia(fecha as string);
    if (!mismoDia(diaDeLaFecha, plantilla.dia)) {
      res.status(400).json({ ok: false, mensaje: `Esta sesión grupal es solo los ${plantilla.dia}` });
      return;
    }
    if (plantilla.fecha_inicio && String(fecha) < plantilla.fecha_inicio.toISOString().slice(0, 10)) {
      res.status(400).json({ ok: false, mensaje: `Esta sesión grupal recién empieza el ${plantilla.fecha_inicio.toISOString().slice(0, 10)}` });
      return;
    }

    const bloqueoRes = await pool.query(
      `SELECT id FROM bloqueos_agenda
       WHERE professional_id = $1 AND fecha = $2 AND hora_inicio <= $3::time AND hora_fin > $3::time`,
      [plantilla.professional_id, fecha, plantilla.hora_inicio]
    );
    if (bloqueoRes.rows.length > 0) {
      res.status(409).json({ ok: false, mensaje: 'El profesional tiene un curso/bloqueo ese día y horario' });
      return;
    }

    const ocupadosRes = await pool.query(
      `SELECT id FROM appointments
       WHERE professional_id = $1 AND fecha = $2 AND hora = $3 AND estado != 'cancelada'`,
      [plantilla.professional_id, fecha, plantilla.hora_inicio]
    );
    if (ocupadosRes.rows.length >= plantilla.capacidad) {
      res.status(409).json({ ok: false, mensaje: 'Esta sesión grupal ya está llena para esa fecha' });
      return;
    }

    // Cada asistente queda como una cita 100% independiente (su propio paciente,
    // su propio costo, su propio pago) — no comparten grupo_id entre sí, porque
    // a diferencia de un acompañante (ej. terapia de pareja) acá son personas
    // que no se conocen, solo coinciden en el mismo horario grupal.

    // Resolver paciente (buscar por id, por teléfono, o crear nuevo)
    let patient_id: number;
    if (patientIdExterno) {
      patient_id = patientIdExterno;
    } else if (paciente_telefono) {
      const existe = await pool.query(`SELECT id FROM patients WHERE telefono=$1`, [paciente_telefono]);
      if (existe.rows.length > 0) {
        patient_id = existe.rows[0].id;
      } else {
        const nuevo = await pool.query(
          `INSERT INTO patients (nombre, carnet, telefono, edad, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [paciente_nombre, paciente_carnet || null, paciente_telefono, paciente_edad || null, req.usuario!.id]
        );
        patient_id = nuevo.rows[0].id;
      }
    } else {
      const nuevo = await pool.query(
        `INSERT INTO patients (nombre, carnet, telefono, edad, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [paciente_nombre, paciente_carnet || null, null, paciente_edad || null, req.usuario!.id]
      );
      patient_id = nuevo.rows[0].id;
    }

    const maxCiclo = await pool.query(
      `SELECT COALESCE(MAX(ciclo), 0) as max_ciclo FROM appointments WHERE patient_id=$1 AND area_id=$2`,
      [patient_id, plantilla.area_id]
    );
    const numeroCiclo = maxCiclo.rows[0].max_ciclo + 1;

    const [h1, m1] = plantilla.hora_inicio.split(':').map(Number);
    const [h2, m2] = plantilla.hora_fin.split(':').map(Number);
    const duracionMin = (h2 * 60 + m2) - (h1 * 60 + m1);
    // Si es individual y esta sesión tiene un servicio distinto configurado para ese
    // caso, la cita queda cargada con ESE servicio (no con el grupal) — nombre y costo.
    const usaServicioIndividualAlterno = !!individual && !!plantilla.servicio_individual_id;
    const nombreServicioFinal = usaServicioIndividualAlterno
      ? plantilla.servicio_individual_nombre
      : plantilla.servicio_nombre;
    const costoIndividualFinal = usaServicioIndividualAlterno
      ? plantilla.costo_individual_alt
      : plantilla.costo_individual;
    const montoPorDefecto = individual ? costoIndividualFinal : (plantilla.costo_grupal ?? plantilla.costo_individual);
    const monto = costoOverride != null && costoOverride !== '' ? Number(costoOverride) : montoPorDefecto;
    // Si no mandan monto_pagado explícito, se asume que se cobró todo en el momento
    // (mismo comportamiento de antes); si lo mandan, se respeta tal cual (puede ser
    // parcial, o incluso 0 si todavía no pagó nada).
    const montoPagado = montoPagadoBody != null && montoPagadoBody !== '' ? Number(montoPagadoBody) : monto;
    const estadoPago = montoPagado >= monto ? 'pagado' : montoPagado > 0 ? 'parcial' : 'pendiente';

    const nuevaCita = await pool.query(
      `INSERT INTO appointments
        (patient_id, professional_id, area_id, fecha, hora, modalidad, sesion, total_sesiones,
         ciclo, estado, servicio_nombre, monto, monto_total, monto_pagado, metodo_pago, estado_pago,
         fecha_pago, notas, duracion_min, created_by)
       VALUES ($1,$2,$3,$4,$5,'presencial',1,1,$6,'confirmada',$7,$8,$8,$9,'efectivo',$10,CURRENT_DATE,$11,$12,$13)
       RETURNING id`,
      [
        patient_id, plantilla.professional_id, plantilla.area_id, fecha, plantilla.hora_inicio,
        numeroCiclo, nombreServicioFinal, monto, montoPagado, estadoPago,
        notas || null, duracionMin, req.usuario!.id,
      ]
    );

    await registrarAudit({
      tabla: 'appointments',
      registro_id: nuevaCita.rows[0].id,
      accion: 'crear',
      datos_despues: { paciente_nombre, sesion_grupal_id: id, fecha, individual: !!individual },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Inscripción registrada correctamente', id: nuevaCita.rows[0].id });
  } catch (error) {
    console.error('Error al inscribir en sesión grupal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar la inscripción' });
  }
}
