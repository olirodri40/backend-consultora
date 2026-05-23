import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

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
        p.id         as patient_id,
        p.nombre     as paciente_nombre,
        p.carnet     as paciente_carnet,
        p.telefono   as paciente_telefono,
        p.edad       as paciente_edad,
        u.id         as profesional_id,
        u.nombre     as profesional_nombre,
        ar.id        as area_id,
        ar.nombre    as area_nombre,
        ar.emoji     as area_emoji,
        ar.color     as area_color
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
        u.nombre   as profesional_nombre,
        ar.nombre  as area_nombre,
        ar.emoji   as area_emoji
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
    // En crearCita, agrega duracion_min al destructuring:
const {
  paciente_nombre, paciente_telefono, paciente_carnet, paciente_edad,
  professional_id, area_id, fecha, hora, modalidad, sesion, total_sesiones,
  estado, servicio_nombre, monto_total, monto_pagado, metodo_pago, notas,
  ciclo, patient_id: patient_id_externo,
  duracion_min, // ✅ AGREGAR ESTO
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
      res.status(409).json({ ok: false, mensaje: `El profesional ya tiene una cita a las ${hora} ese dia` });
      return;
    }

    let patient_id: number;
    if (patient_id_externo) {
      patient_id = patient_id_externo;
      await pool.query(
        `UPDATE patients SET nombre=$1, carnet=$2, edad=$3, updated_by=$4 WHERE id=$5`,
        [paciente_nombre, paciente_carnet || null, paciente_edad || null, req.usuario!.id, patient_id]
      );
    } else if (paciente_telefono) {
      const existe = await pool.query(`SELECT id FROM patients WHERE telefono=$1`, [paciente_telefono]);
      if (existe.rows.length > 0) {
        patient_id = existe.rows[0].id;
        await pool.query(
          `UPDATE patients SET nombre=$1, carnet=$2, edad=$3, updated_by=$4 WHERE id=$5`,
          [paciente_nombre, paciente_carnet || null, paciente_edad || null, req.usuario!.id, patient_id]
        );
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

    // Busca esta parte:
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
    notas || null, duracion_min || null, // ✅ AGREGAR
    req.usuario!.id,
  ]
);

    await registrarAudit({
      tabla: 'appointments', registro_id: nuevaCita.rows[0].id, accion: 'crear',
      datos_despues: { paciente_nombre, professional_id, area_id, fecha, hora, estado, ciclo: numeroCiclo },
      user_id: req.usuario!.id, user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Cita creada correctamente', id: nuevaCita.rows[0].id });
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
        `UPDATE patients SET nombre=$1, carnet=$2, edad=$3 WHERE id=$4`,
        [primera.paciente_nombre, primera.paciente_carnet || null, primera.paciente_edad || null, patient_id]
      );
    } else if (primera.paciente_telefono) {
      const existe = await pool.query(`SELECT id FROM patients WHERE telefono=$1`, [primera.paciente_telefono]);
      if (existe.rows.length > 0) {
        patient_id = existe.rows[0].id;
        await pool.query(
          `UPDATE patients SET nombre=$1, carnet=$2, edad=$3, updated_by=$4 WHERE id=$5`,
          [primera.paciente_nombre, primera.paciente_carnet || null, primera.paciente_edad || null, req.usuario!.id, patient_id]
        );
      } else {
        const nuevo = await pool.query(
          `INSERT INTO patients (nombre, carnet, telefono, edad, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [primera.paciente_nombre, primera.paciente_carnet || null, primera.paciente_telefono, primera.paciente_edad || null, req.usuario!.id]
        );
        patient_id = nuevo.rows[0].id;
      }
    } else {
      const nuevo = await pool.query(
        `INSERT INTO patients (nombre, carnet, telefono, edad, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [primera.paciente_nombre, primera.paciente_carnet || null, null, primera.paciente_edad || null, req.usuario!.id]
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

    // Verificar conflictos
    for (const s of sesiones) {
      const conflicto = await pool.query(
        `SELECT id FROM appointments WHERE professional_id=$1 AND fecha=$2 AND hora=$3 AND estado!='cancelada'`,
        [s.professional_id, s.fecha, s.hora]
      );
      if (conflicto.rows.length > 0) {
        res.status(409).json({ ok: false, mensaje: `El profesional ya tiene una cita a las ${s.hora} ese dia` });
        return;
      }
    }

    // Insertar todas en secuencia con el mismo ciclo y patient_id
    const ids: number[] = [];
    for (const s of sesiones) {
      const montoTotal = s.monto_total ? Number(s.monto_total) : 0;
      const montoPagado = s.monto_pagado ? Number(s.monto_pagado) : 0;
      const estadoPago = s.estado === 'confirmada' ? ((montoTotal - montoPagado) <= 0 ? 'pagado' : 'parcial') : null;

      const nueva = await pool.query(
  `INSERT INTO appointments
    (patient_id, professional_id, area_id, fecha, hora, modalidad,
     sesion, total_sesiones, ciclo, estado, servicio_nombre,
     monto, monto_total, monto_pagado, metodo_pago, estado_pago,
     fecha_pago, notas, duracion_min, created_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
   RETURNING id`,
  [
    patient_id, s.professional_id, s.area_id, s.fecha, s.hora,
    s.modalidad || 'presencial', s.sesion || 1, s.total_sesiones || sesiones.length,
    numeroCiclo, s.estado || 'pendiente', s.servicio_nombre || null,
    montoPagado || null, montoTotal || null, montoPagado || null,
    s.metodo_pago || null, estadoPago,
    s.estado === 'confirmada' ? new Date().toISOString().split('T')[0] : null,
    s.notas || null, s.duracion_min || null, // ✅ AGREGAR
    req.usuario!.id
  ]
);
      ids.push(nueva.rows[0].id);
    }

    await registrarAudit({
      tabla: 'appointments', registro_id: ids[0], accion: 'crear',
      datos_despues: { total_sesiones: sesiones.length, ciclo: numeroCiclo, patient_id },
      user_id: req.usuario!.id, user_nombre: req.usuario!.rol, user_rol: req.usuario!.rol, ip: req.ip,
    });

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
    const { estado, asistio, monto, monto_total, monto_pagado, metodo_pago, estado_pago, notas, total_sesiones, servicio_nombre, modalidad, fecha, hora, paciente_nombre, paciente_telefono, paciente_carnet, paciente_edad } = req.body;
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
         fecha           = COALESCE($13, fecha),
         hora            = COALESCE($14, hora),
         fecha_pago      = CASE WHEN $1 = 'confirmada' AND fecha_pago IS NULL THEN CURRENT_DATE ELSE fecha_pago END,
         updated_at      = NOW(),
         updated_by      = $12
       WHERE id = $15
       RETURNING id`,
      [
        estado, asistio, montoPagadoNum, montoTotalNum, montoPagadoNum,
        metodo_pago, nuevoEstadoPago, notas, total_sesiones, servicio_nombre, modalidad,
        req.usuario!.id, fecha, hora, id
      ]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    if (paciente_nombre || paciente_telefono || paciente_carnet || paciente_edad) {
      await pool.query(
        `UPDATE patients SET
          nombre=COALESCE($1,nombre), telefono=COALESCE($2,telefono),
          carnet=COALESCE($3,carnet), edad=COALESCE($4,edad), updated_at=NOW()
         WHERE id=(SELECT patient_id FROM appointments WHERE id=$5)`,
        [paciente_nombre || null, paciente_telefono || null, paciente_carnet || null, paciente_edad || null, id]
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