import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

import { notificarNuevaCita, notificarReagendamiento } from '../services/notificaciones.services';
import { nombreDelDia } from '../utils/dias';

// Un curso/capacitación/seminario (bloqueos_agenda) deja al profesional
// completamente ocupado en ese rango — se valida en toda creación/reagenda
// de citas, igual que un choque con otra cita real.
async function tieneBloqueoAgenda(professionalId: number, fecha: string, hora: string): Promise<boolean> {
  const resultado = await pool.query(
    `SELECT id FROM bloqueos_agenda
     WHERE professional_id = $1 AND fecha = $2 AND hora_inicio <= $3::time AND hora_fin > $3::time`,
    [professionalId, fecha, hora]
  );
  if (resultado.rows.length > 0) return true;

  // Mientras el profesional está dando una sesión grupal recurrente (ej. "Sesión
  // Embarazadas" los martes 18:00-19:00), tampoco se le puede cargar una cita
  // individual normal encima de ese horario.
  const diaDeLaFecha = nombreDelDia(fecha);
  const sesionGrupal = await pool.query(
    `SELECT id FROM sesiones_grupales
     WHERE professional_id = $1 AND activo = true AND dia = $2
       AND hora_inicio <= $3::time AND hora_fin > $3::time AND fecha_inicio <= $4`,
    [professionalId, diaDeLaFecha, hora, fecha]
  );
  return sesionGrupal.rows.length > 0;
}

export async function getCitas(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { fecha, profesional_id, estado } = req.query;

    let query = `
      SELECT
        a.id,
        a.fecha,
        a.hora::text,
        a.modalidad,
        a.sesion,
        a.total_sesiones,
        a.ciclo,
        a.estado,
        a.servicio_nombre,
        a.duracion_min,
        a.monto,
        a.monto_total,
        a.monto_pagado,
        a.metodo_pago,
        a.estado_pago,
        a.fecha_pago,
        a.asistio,
        a.notas,
        a.created_by,
        a.grupo_id,
        (
          SELECT COALESCE(json_agg(json_build_object('patient_id', p2.id, 'nombre', p2.nombre)), '[]'::json)
          FROM appointments a2
          JOIN patients p2 ON a2.patient_id = p2.id
          WHERE a2.grupo_id = a.grupo_id AND a2.id != a.id AND a.grupo_id IS NOT NULL
        ) as companeros,
        p.id         as patient_id,
        p.nombre     as paciente_nombre,
        p.carnet     as paciente_carnet,
        p.telefono   as paciente_telefono,
        p.edad       as paciente_edad,
        p.contacto_relacion as paciente_contacto_relacion,
        p.contacto_nombre as paciente_contacto_nombre,
        p.contacto_telefono as paciente_contacto_telefono,
        u.id         as profesional_id,
        u.nombre     as profesional_nombre,
        ar.id        as area_id,
        ar.nombre    as area_nombre
      FROM appointments a
      JOIN patients p  ON a.patient_id      = p.id
      JOIN users u     ON a.professional_id = u.id
      JOIN areas ar    ON a.area_id         = ar.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 1;

    if (fecha) {
      query += ` AND a.fecha = $${paramCount}`;
      params.push(fecha);
      paramCount++;
    }

    if (profesional_id) {
      query += ` AND a.professional_id = $${paramCount}`;
      params.push(profesional_id);
      paramCount++;
    }

    if (estado) {
      query += ` AND a.estado = $${paramCount}`;
      params.push(estado);
      paramCount++;
    }

    if (req.usuario?.rol === 'profesional') {
      query += ` AND a.professional_id = $${paramCount}`;
      params.push(req.usuario.id);
      paramCount++;
    }

    query += ` ORDER BY a.fecha, a.hora`;

    const resultado = await pool.query(query, params);

    res.json({
      ok: true,
      citas: resultado.rows,
      total: resultado.rowCount,
    });
  } catch (error) {
    console.error('Error al obtener citas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener citas' });
  }
}

export async function getCitaPorId(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `SELECT
        a.*,
        a.hora::text,
        p.nombre   as paciente_nombre,
        p.carnet   as paciente_carnet,
        p.telefono as paciente_telefono,
        p.edad     as paciente_edad,
        p.contacto_relacion as paciente_contacto_relacion,
        p.contacto_nombre as paciente_contacto_nombre,
        p.contacto_telefono as paciente_contacto_telefono,
        u.nombre   as profesional_nombre,
        ar.nombre  as area_nombre
       FROM appointments a
       JOIN patients p ON a.patient_id      = p.id
       JOIN users u    ON a.professional_id = u.id
       JOIN areas ar   ON a.area_id         = ar.id
       WHERE a.id = $1`,
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    res.json({ ok: true, cita: resultado.rows[0] });
  } catch (error) {
    console.error('Error al obtener cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener cita' });
  }
}

export async function crearCita(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      paciente_nombre, paciente_telefono, paciente_carnet, paciente_edad,
      paciente_contacto_relacion, paciente_contacto_nombre, paciente_contacto_telefono,
      professional_id, area_id, fecha, hora, modalidad, sesion, total_sesiones,
      estado, servicio_nombre, monto_total, monto_pagado, metodo_pago, notas,
      ciclo, patient_id: patient_id_externo,
      duracion_min,
    } = req.body;

    if (!paciente_nombre || !professional_id || !area_id || !fecha || !hora) {
      res.status(400).json({ ok: false, mensaje: 'Faltan datos obligatorios' });
      return;
    }

    const conflicto = await pool.query(
      `SELECT id FROM appointments WHERE professional_id=$1 AND fecha=$2 AND hora=$3 AND estado!='cancelada'`,
      [professional_id, fecha, hora]
    );
    if (conflicto.rows.length > 0) {
  res.status(409).json({ ok: false, mensaje: `El profesional ya tiene una cita el ${fecha} a las ${hora}` });
  return;
}

    if (await tieneBloqueoAgenda(professional_id, fecha, hora)) {
      res.status(409).json({ ok: false, mensaje: `El profesional tiene un curso/bloqueo el ${fecha} a las ${hora}` });
      return;
    }

    let patient_id: number;
    if (patient_id_externo) {
      patient_id = patient_id_externo;
      await pool.query(
        `UPDATE patients SET 
          nombre=$1, carnet=$2, edad=$3, 
          contacto_relacion=$4, contacto_nombre=$5, contacto_telefono=$6,
          updated_by=$7 WHERE id=$8`,
        [
          paciente_nombre, 
          paciente_carnet || null, 
          paciente_edad || null,
          paciente_contacto_relacion || null,
          paciente_contacto_nombre || null,
          paciente_contacto_telefono || null,
          req.usuario!.id, 
          patient_id
        ]
      );
    } else if (paciente_telefono) {
      const existe = await pool.query(`SELECT id FROM patients WHERE telefono=$1`, [paciente_telefono]);
      if (existe.rows.length > 0) {
        patient_id = existe.rows[0].id;
        await pool.query(
          `UPDATE patients SET 
            nombre=$1, carnet=$2, edad=$3, 
            contacto_relacion=$4, contacto_nombre=$5, contacto_telefono=$6,
            updated_by=$7 WHERE id=$8`,
          [
            paciente_nombre, 
            paciente_carnet || null, 
            paciente_edad || null,
            paciente_contacto_relacion || null,
            paciente_contacto_nombre || null,
            paciente_contacto_telefono || null,
            req.usuario!.id, 
            patient_id
          ]
        );
      } else {
        const nuevo = await pool.query(
          `INSERT INTO patients 
            (nombre, carnet, telefono, edad, 
             contacto_relacion, contacto_nombre, contacto_telefono, created_by) 
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            paciente_nombre, 
            paciente_carnet || null, 
            paciente_telefono, 
            paciente_edad || null,
            paciente_contacto_relacion || null,
            paciente_contacto_nombre || null,
            paciente_contacto_telefono || null,
            req.usuario!.id
          ]
        );
        patient_id = nuevo.rows[0].id;
      }
    } else {
      const nuevo = await pool.query(
        `INSERT INTO patients 
          (nombre, carnet, telefono, edad, 
           contacto_relacion, contacto_nombre, contacto_telefono, created_by) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          paciente_nombre, 
          paciente_carnet || null, 
          null, 
          paciente_edad || null,
          paciente_contacto_relacion || null,
          paciente_contacto_nombre || null,
          paciente_contacto_telefono || null,
          req.usuario!.id
        ]
      );
      patient_id = nuevo.rows[0].id;
    }

    const montoTotalNum = monto_total ? Number(monto_total) : 0;
    const montoPagadoNum = monto_pagado ? Number(monto_pagado) : 0;
    const estadoPago = estado === 'confirmada' ? ((montoTotalNum - montoPagadoNum) <= 0 ? 'pagado' : 'parcial') : null;

    let numeroCiclo = ciclo ? parseInt(ciclo) : null;
    if (!numeroCiclo) {
      const maxCiclo = await pool.query(
        `SELECT COALESCE(MAX(ciclo), 0) as max_ciclo FROM appointments WHERE patient_id=$1 AND area_id=$2`,
        [patient_id, area_id]
      );
      numeroCiclo = maxCiclo.rows[0].max_ciclo + 1;
    }

    const nuevaCita = await pool.query(
      `INSERT INTO appointments
        (patient_id, professional_id, area_id, fecha, hora, modalidad,
         sesion, total_sesiones, ciclo, estado, servicio_nombre,
         monto, monto_total, monto_pagado, metodo_pago, estado_pago,
         fecha_pago, notas, duracion_min, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        patient_id, professional_id, area_id, fecha, hora, modalidad || 'presencial',
        sesion || 1, total_sesiones || 1, numeroCiclo, estado || 'pendiente',
        servicio_nombre || null, montoPagadoNum || null, montoTotalNum || null,
        montoPagadoNum || null, metodo_pago || null, estadoPago,
        estado === 'confirmada' ? new Date().toISOString().split('T')[0] : null,
        notas || null, duracion_min || null,
        req.usuario!.id,
      ]
    );

        await registrarAudit({
      tabla: 'appointments', registro_id: nuevaCita.rows[0].id, accion: 'crear',
      datos_despues: { paciente_nombre, professional_id, area_id, fecha, hora, estado, ciclo: numeroCiclo },
      user_id: req.usuario!.id, user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
    });

        res.status(201).json({ ok: true, mensaje: 'Cita creada correctamente', id: nuevaCita.rows[0].id });
        notificarNuevaCita(area_id, paciente_nombre, fecha, hora, estado || 'pendiente', servicio_nombre, total_sesiones, professional_id);
      } catch (error) {
        console.error('Error al crear cita:', error);
        res.status(500).json({ ok: false, mensaje: 'Error al crear cita' });
      }
}

export async function crearMultiplesCitasController(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const sesiones: any[] = req.body;
    if (!Array.isArray(sesiones) || sesiones.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'No se enviaron sesiones' });
      return;
    }

    const primera = sesiones[0];

    // Resolver patient_id
    let patient_id: number;
    if (primera.patient_id) {
      patient_id = primera.patient_id;
      await pool.query(
        `UPDATE patients SET 
          nombre=$1, carnet=$2, edad=$3, 
          contacto_relacion=$4, contacto_nombre=$5, contacto_telefono=$6
         WHERE id=$7`,
        [
          primera.paciente_nombre, 
          primera.paciente_carnet || null, 
          primera.paciente_edad || null,
          primera.paciente_contacto_relacion || null,
          primera.paciente_contacto_nombre || null,
          primera.paciente_contacto_telefono || null,
          patient_id
        ]
      );
    } else if (primera.paciente_telefono) {
      const existe = await pool.query(`SELECT id FROM patients WHERE telefono=$1`, [primera.paciente_telefono]);
      if (existe.rows.length > 0) {
        patient_id = existe.rows[0].id;
        await pool.query(
          `UPDATE patients SET 
            nombre=$1, carnet=$2, edad=$3, 
            contacto_relacion=$4, contacto_nombre=$5, contacto_telefono=$6,
            updated_by=$7 WHERE id=$8`,
          [
            primera.paciente_nombre, 
            primera.paciente_carnet || null, 
            primera.paciente_edad || null,
            primera.paciente_contacto_relacion || null,
            primera.paciente_contacto_nombre || null,
            primera.paciente_contacto_telefono || null,
            req.usuario!.id, 
            patient_id
          ]
        );
      } else {
        const nuevo = await pool.query(
          `INSERT INTO patients 
            (nombre, carnet, telefono, edad, 
             contacto_relacion, contacto_nombre, contacto_telefono, created_by) 
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            primera.paciente_nombre, 
            primera.paciente_carnet || null, 
            primera.paciente_telefono, 
            primera.paciente_edad || null,
            primera.paciente_contacto_relacion || null,
            primera.paciente_contacto_nombre || null,
            primera.paciente_contacto_telefono || null,
            req.usuario!.id
          ]
        );
        patient_id = nuevo.rows[0].id;
      }
    } else {
      const nuevo = await pool.query(
        `INSERT INTO patients 
          (nombre, carnet, telefono, edad, 
           contacto_relacion, contacto_nombre, contacto_telefono, created_by) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          primera.paciente_nombre, 
          primera.paciente_carnet || null, 
          null, 
          primera.paciente_edad || null,
          primera.paciente_contacto_relacion || null,
          primera.paciente_contacto_nombre || null,
          primera.paciente_contacto_telefono || null,
          req.usuario!.id
        ]
      );
      patient_id = nuevo.rows[0].id;
    }

    // Calcular ciclo UNA sola vez para todas las sesiones
    const cicloExplicito = primera.ciclo ? parseInt(primera.ciclo) : null;
    let numeroCiclo: number;
    if (cicloExplicito) {
      numeroCiclo = cicloExplicito;
    } else {
      const maxCiclo = await pool.query(
        `SELECT COALESCE(MAX(ciclo), 0) as max_ciclo FROM appointments WHERE patient_id=$1 AND area_id=$2`,
        [patient_id, primera.area_id]
      );
      numeroCiclo = maxCiclo.rows[0].max_ciclo + 1;
    }

    // Verificar conflictos — pero si la sesión trae `vincular_a`, significa que el
    // frontend quiere UNIRSE a una cita que ya existe en ese horario (ej. agregar
    // un acompañante a una reserva ya hecha), así que esa cita puntual NO cuenta
    // como choque de horario.
    for (const s of sesiones) {
      let grupoAExcluir: number | null = null;
      if (s.vincular_a) {
        const anclaResult = await pool.query(
          `SELECT id, grupo_id FROM appointments WHERE id=$1`,
          [s.vincular_a]
        );
        if (anclaResult.rows.length === 0) {
          res.status(400).json({ ok: false, mensaje: 'La cita a la que intentas unirte ya no existe' });
          return;
        }
        grupoAExcluir = anclaResult.rows[0].grupo_id ?? anclaResult.rows[0].id;
      }

      const conflicto = await pool.query(
        `SELECT id FROM appointments
         WHERE professional_id=$1 AND fecha=$2 AND hora=$3 AND estado!='cancelada'
           AND ($4::int IS NULL OR grupo_id IS DISTINCT FROM $4)
           AND id != COALESCE($5::int, -1)`,
        [s.professional_id, s.fecha, s.hora, grupoAExcluir, s.vincular_a || null]
      );
      if (conflicto.rows.length > 0) {
        res.status(409).json({ ok: false, mensaje: `El profesional ya tiene una cita el ${s.fecha} a las ${s.hora} (sesión ${s.sesion || '?'})` });
        return;
      }

      if (await tieneBloqueoAgenda(s.professional_id, s.fecha, s.hora)) {
        res.status(409).json({ ok: false, mensaje: `El profesional tiene un curso/bloqueo el ${s.fecha} a las ${s.hora} (sesión ${s.sesion || '?'})` });
        return;
      }
    }

    // Insertar todas en secuencia con el mismo ciclo y patient_id
    const ids: number[] = [];
    for (const s of sesiones) {
      // Si esta fila se une a una cita existente, resolvemos (o creamos) el
      // grupo_id compartido de esa fecha/hora, para que quede agrupada
      // visualmente junto a los demás pacientes de esa misma cita.
      let grupoIdParaInsertar: number | null = null;
      if (s.vincular_a) {
        const anclaResult = await pool.query(`SELECT id, grupo_id FROM appointments WHERE id=$1`, [s.vincular_a]);
        if (anclaResult.rows.length > 0) {
          const ancla = anclaResult.rows[0];
          if (ancla.grupo_id) {
            grupoIdParaInsertar = ancla.grupo_id;
          } else {
            // Era una cita de un solo paciente: la convertimos en el "ancla" de
            // un nuevo grupo, apuntando su propio grupo_id a sí misma.
            await pool.query(`UPDATE appointments SET grupo_id=$1 WHERE id=$1`, [ancla.id]);
            grupoIdParaInsertar = ancla.id;
          }
        }
      }

      const montoTotal = s.monto_total ? Number(s.monto_total) : 0;
      const montoPagado = s.monto_pagado ? Number(s.monto_pagado) : 0;
      const estadoPago = s.estado === 'confirmada' ? ((montoTotal - montoPagado) <= 0 ? 'pagado' : 'parcial') : null;

      const nueva = await pool.query(
        `INSERT INTO appointments
          (patient_id, professional_id, area_id, fecha, hora, modalidad,
           sesion, total_sesiones, ciclo, estado, servicio_nombre,
           monto, monto_total, monto_pagado, metodo_pago, estado_pago,
           fecha_pago, notas, duracion_min, created_by, grupo_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING id`,
        [
          patient_id, s.professional_id, s.area_id, s.fecha, s.hora,
          s.modalidad || 'presencial', s.sesion || 1, s.total_sesiones || sesiones.length,
          numeroCiclo, s.estado || 'pendiente', s.servicio_nombre || null,
          montoPagado || null, montoTotal || null, montoPagado || null,
          s.metodo_pago || null, estadoPago,
          s.estado === 'confirmada' ? new Date().toISOString().split('T')[0] : null,
          s.notas || null, s.duracion_min || null,
          req.usuario!.id, grupoIdParaInsertar,
        ]
      );
      ids.push(nueva.rows[0].id);
    }

    await registrarAudit({
  tabla: 'appointments', registro_id: ids[0], accion: 'crear',
  datos_despues: { total_sesiones: sesiones.length, ciclo: numeroCiclo, patient_id },
  user_id: req.usuario!.id, user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
});

notificarNuevaCita(primera.area_id, primera.paciente_nombre, primera.fecha, primera.hora, primera.estado || 'pendiente', primera.servicio_nombre, sesiones.length, primera.professional_id);

    res.status(201).json({ ok: true, mensaje: 'Citas creadas correctamente', ids });
  } catch (error) {
    console.error('Error al crear múltiples citas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear citas' });
  }
}

export async function actualizarCita(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { 
      estado, asistio, monto, monto_total, monto_pagado, metodo_pago, 
      estado_pago, notas, total_sesiones, servicio_nombre, modalidad, 
      fecha, hora, 
      paciente_nombre, paciente_telefono, paciente_carnet, paciente_edad,
      paciente_contacto_relacion, paciente_contacto_nombre, paciente_contacto_telefono,duracion_min
    } = req.body;
    
const citaAnteriorResult = await pool.query(
      `SELECT a.fecha::text as fecha, a.hora::text as hora, a.area_id, a.professional_id, p.nombre as paciente_nombre
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE a.id = $1`,
      [id]
    );
    if (citaAnteriorResult.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }
    const citaAnterior = citaAnteriorResult.rows[0];

    // Si se está reagendando (cambia fecha y/o hora), la nueva fecha/hora no
    // puede caer dentro de un curso/bloqueo del profesional.
    const fechaNueva = fecha || citaAnterior.fecha;
    const horaNueva = hora || citaAnterior.hora;
    if ((fecha || hora) && (await tieneBloqueoAgenda(citaAnterior.professional_id, fechaNueva, horaNueva))) {
      res.status(409).json({ ok: false, mensaje: `El profesional tiene un curso/bloqueo el ${fechaNueva} a las ${horaNueva}` });
      return;
    }

    const montoTotalNum = monto_total != null ? Number(monto_total) : null;
    const montoPagadoNum = monto_pagado != null ? Number(monto_pagado) : null;

    let nuevoEstadoPago = estado_pago;
    if (montoTotalNum != null && montoPagadoNum != null) {
      const pendiente = montoTotalNum - montoPagadoNum;
      nuevoEstadoPago = pendiente <= 0 ? 'pagado' : 'parcial';
    }

    const resultado = await pool.query(
  `UPDATE appointments SET
     estado          = COALESCE($1, estado),
     asistio         = COALESCE($2, asistio),
     monto           = COALESCE($3, monto),
     monto_total     = COALESCE($4, monto_total),
     monto_pagado    = COALESCE($5, monto_pagado),
     metodo_pago     = COALESCE($6, metodo_pago),
     estado_pago     = COALESCE($7, estado_pago),
     notas           = COALESCE($8, notas),
     total_sesiones  = COALESCE($9, total_sesiones),
     servicio_nombre = COALESCE($10, servicio_nombre),
     modalidad       = COALESCE($11, modalidad),
     updated_by      = $12,
     fecha           = COALESCE($13, fecha),
     hora            = COALESCE($14, hora),
     duracion_min    = COALESCE($15, duracion_min), 
     fecha_pago      = CASE WHEN $1 = 'confirmada' AND fecha_pago IS NULL THEN CURRENT_DATE ELSE fecha_pago END,
     updated_at      = NOW()
   WHERE id = $16
   RETURNING id`,
  [
    estado, asistio, montoPagadoNum, montoTotalNum, montoPagadoNum,
    metodo_pago, nuevoEstadoPago, notas, total_sesiones, servicio_nombre, modalidad,
    req.usuario!.id, fecha, hora, duracion_min, id  // ← 16 parámetros para 16 placeholders
  ]
);

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }
 // 👇 NUEVO: si cambió fecha u hora, es una reagendación
    const seReagendo = (fecha && fecha !== citaAnterior.fecha) || (hora && hora !== citaAnterior.hora);
    if (seReagendo) {
      // Borramos los recordatorios ya enviados para esta cita, para que
      // los cron de 1h/24h puedan volver a dispararse con el nuevo horario
      await pool.query(`DELETE FROM notificaciones_enviadas WHERE appointment_id = $1`, [id]);

      notificarReagendamiento(
        citaAnterior.area_id,
        paciente_nombre || citaAnterior.paciente_nombre,
        citaAnterior.fecha,
        citaAnterior.hora,
        fecha || citaAnterior.fecha,
        hora || citaAnterior.hora,
        citaAnterior.professional_id
      );
    }
    if (paciente_nombre || paciente_telefono || paciente_carnet || paciente_edad || 
    paciente_contacto_relacion || paciente_contacto_nombre || paciente_contacto_telefono) {
  await pool.query(
    `UPDATE patients SET
      nombre=$1, 
      telefono=$2,
      carnet=$3, 
      edad=$4,
      contacto_relacion=$5,
      contacto_nombre=$6,
      contacto_telefono=$7,
      updated_at=NOW()
     WHERE id=(SELECT patient_id FROM appointments WHERE id=$8)`,
    [
      paciente_nombre || null, 
      paciente_telefono || null, 
      paciente_carnet || null, 
      paciente_edad || null,
      paciente_contacto_relacion || null,
      paciente_contacto_nombre || null,
      paciente_contacto_telefono || null,
      id
    ]
  );
}

    await registrarAudit({
      tabla: 'appointments', registro_id: parseInt(id as string), accion: 'editar',
      datos_despues: req.body, user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Cita actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar cita' });
  }
}

export async function eliminarCita(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const citaData = await pool.query('SELECT patient_id FROM appointments WHERE id=$1', [id]);
    if (citaData.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    const patient_id = citaData.rows[0].patient_id;
    await pool.query('DELETE FROM appointments WHERE id=$1', [id]);

    const otrasCitas = await pool.query('SELECT COUNT(*) as total FROM appointments WHERE patient_id=$1', [patient_id]);
    if (parseInt(otrasCitas.rows[0].total) === 0) {
      await pool.query('DELETE FROM patients WHERE id=$1', [patient_id]);
    }

    await registrarAudit({
      tabla: 'appointments', registro_id: parseInt(id as string), accion: 'eliminar',
      user_id: req.usuario!.id, user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Cita eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar cita' });
  }
}

// ── Crea una cita con 2 o más pacientes en el MISMO horario (ej. terapia de pareja) ──
export async function crearCitaGrupal(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      pacientes,   // array de datos de cada paciente
      sesiones,    // array: [{ fecha, hora, sesion }, ...] — todas las sesiones del ciclo
      professional_id, area_id, modalidad,
      servicio_nombre, duracion_min, estado,
      monto_total, monto_pagado, metodo_pago, notas,
      total_sesiones,
    } = req.body;

    if (!Array.isArray(pacientes) || pacientes.length < 2) {
      res.status(400).json({ ok: false, mensaje: 'Se requieren al menos 2 pacientes para una cita grupal' });
      return;
    }
    if (!Array.isArray(sesiones) || sesiones.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'No se enviaron sesiones' });
      return;
    }
    if (!professional_id || !area_id) {
      res.status(400).json({ ok: false, mensaje: 'Faltan datos obligatorios de la cita' });
      return;
    }

    // Chequeo de conflictos para TODAS las sesiones
    for (const s of sesiones) {
      const conflicto = await pool.query(
        `SELECT id FROM appointments WHERE professional_id=$1 AND fecha=$2 AND hora=$3 AND estado!='cancelada'`,
        [professional_id, s.fecha, s.hora]
      );
      if (conflicto.rows.length > 0) {
        res.status(409).json({ ok: false, mensaje: `El profesional ya tiene una cita a las ${s.hora} el ${s.fecha}` });
        return;
      }

      if (await tieneBloqueoAgenda(professional_id, s.fecha, s.hora)) {
        res.status(409).json({ ok: false, mensaje: `El profesional tiene un curso/bloqueo a las ${s.hora} el ${s.fecha}` });
        return;
      }
    }

    const montoTotalNum = monto_total ? Number(monto_total) : 0;
    const montoPagadoNum = monto_pagado ? Number(monto_pagado) : 0;
    const estadoPago = estado === 'confirmada' ? ((montoTotalNum - montoPagadoNum) <= 0 ? 'pagado' : 'parcial') : null;

    // Resolvemos patient_id y ciclo de cada paciente UNA sola vez (antes de crear las citas)
    const pacientesResueltos: { patient_id: number; ciclo: number }[] = [];

    for (const p of pacientes) {
      let patient_id: number;
      if (p.patient_id) {
        patient_id = p.patient_id;
        await pool.query(
          `UPDATE patients SET
            nombre=$1, carnet=$2, edad=$3,
            contacto_relacion=$4, contacto_nombre=$5, contacto_telefono=$6,
            updated_by=$7 WHERE id=$8`,
          [
            p.paciente_nombre, p.paciente_carnet || null, p.paciente_edad || null,
            p.paciente_contacto_relacion || null, p.paciente_contacto_nombre || null, p.paciente_contacto_telefono || null,
            req.usuario!.id, patient_id,
          ]
        );
      } else if (p.paciente_telefono) {
        const existe = await pool.query(`SELECT id FROM patients WHERE telefono=$1`, [p.paciente_telefono]);
        if (existe.rows.length > 0) {
          patient_id = existe.rows[0].id;
          await pool.query(
            `UPDATE patients SET
              nombre=$1, carnet=$2, edad=$3,
              contacto_relacion=$4, contacto_nombre=$5, contacto_telefono=$6,
              updated_by=$7 WHERE id=$8`,
            [
              p.paciente_nombre, p.paciente_carnet || null, p.paciente_edad || null,
              p.paciente_contacto_relacion || null, p.paciente_contacto_nombre || null, p.paciente_contacto_telefono || null,
              req.usuario!.id, patient_id,
            ]
          );
        } else {
          const nuevo = await pool.query(
            `INSERT INTO patients (nombre, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [
              p.paciente_nombre, p.paciente_carnet || null, p.paciente_telefono, p.paciente_edad || null,
              p.paciente_contacto_relacion || null, p.paciente_contacto_nombre || null, p.paciente_contacto_telefono || null,
              req.usuario!.id,
            ]
          );
          patient_id = nuevo.rows[0].id;
        }
      } else {
        const nuevo = await pool.query(
          `INSERT INTO patients (nombre, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            p.paciente_nombre, p.paciente_carnet || null, null, p.paciente_edad || null,
            p.paciente_contacto_relacion || null, p.paciente_contacto_nombre || null, p.paciente_contacto_telefono || null,
            req.usuario!.id,
          ]
        );
        patient_id = nuevo.rows[0].id;
      }

      const maxCiclo = await pool.query(
        `SELECT COALESCE(MAX(ciclo), 0) as max_ciclo FROM appointments WHERE patient_id=$1 AND area_id=$2`,
        [patient_id, area_id]
      );
      const numeroCiclo = maxCiclo.rows[0].max_ciclo + 1;

      pacientesResueltos.push({ patient_id, ciclo: numeroCiclo });
    }

    const idsCreados: number[] = [];
    let primerGrupoId: number | null = null;

    // Por cada sesión (fecha/hora), creamos una fila por paciente, todas
    // enlazadas con el mismo grupo_id (uno DISTINTO por cada sesión/fecha)
    for (const s of sesiones) {
      let grupoIdSesion: number | null = null;
      for (let i = 0; i < pacientes.length; i++) {
        const { patient_id, ciclo } = pacientesResueltos[i];
        const esPrimeraSesion = String(s.sesion) === '1';

        const nueva: any = await pool.query(
          `INSERT INTO appointments
            (patient_id, professional_id, area_id, fecha, hora, modalidad,
             sesion, total_sesiones, ciclo, estado, servicio_nombre,
             monto, monto_total, monto_pagado, metodo_pago, estado_pago,
             fecha_pago, notas, duracion_min, created_by, grupo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING id`,
          [
            patient_id, professional_id, area_id, s.fecha, s.hora, modalidad || 'presencial',
            s.sesion || 1, total_sesiones || sesiones.length, ciclo, estado || 'pendiente',
            servicio_nombre || null,
            esPrimeraSesion ? (montoPagadoNum || null) : null,
            esPrimeraSesion ? (montoTotalNum || null) : null,
            esPrimeraSesion ? (montoPagadoNum || null) : null,
            esPrimeraSesion ? (metodo_pago || null) : null,
            esPrimeraSesion ? estadoPago : null,
            esPrimeraSesion && estado === 'confirmada' ? new Date().toISOString().split('T')[0] : null,
            notas || null, duracion_min || null, req.usuario!.id,
            grupoIdSesion,
          ]
        );

          const nuevoId: number = nueva.rows[0].id;
        idsCreados.push(nuevoId);

        if (grupoIdSesion === null) {
          grupoIdSesion = nuevoId;
          await pool.query(`UPDATE appointments SET grupo_id=$1 WHERE id=$2`, [grupoIdSesion, grupoIdSesion]);
        } else {
          await pool.query(`UPDATE appointments SET grupo_id=$1 WHERE id=$2`, [grupoIdSesion, nuevoId]);
        }
      }
      if (primerGrupoId === null) primerGrupoId = grupoIdSesion;
    }

    await registrarAudit({
      tabla: 'appointments', registro_id: idsCreados[0], accion: 'crear',
      datos_despues: { tipo: 'grupal', pacientes: pacientes.length, sesiones: sesiones.length, professional_id, area_id },
      user_id: req.usuario!.id, user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
    });

    notificarNuevaCita(area_id, pacientes.map((p: any) => p.paciente_nombre).join(' y '), sesiones[0].fecha, sesiones[0].hora, estado || 'pendiente', servicio_nombre, total_sesiones || sesiones.length, professional_id);

    res.status(201).json({ ok: true, mensaje: 'Cita grupal creada correctamente', ids: idsCreados, grupo_id: primerGrupoId });
  } catch (error) {
    console.error('Error al crear cita grupal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear cita grupal' });
  }
}