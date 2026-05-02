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
        a.estado,
        a.servicio_nombre,
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
    const {
      paciente_nombre,
      paciente_telefono,
      paciente_carnet,
      paciente_edad,
      professional_id,
      area_id,
      fecha,
      hora,
      modalidad,
      sesion,
      total_sesiones,
      estado,
      servicio_nombre,
      monto_total,
      monto_pagado,
      metodo_pago,
      notas,
    } = req.body;

    if (!paciente_nombre || !professional_id || !area_id || !fecha || !hora) {
      res.status(400).json({
        ok: false,
        mensaje: 'Faltan datos obligatorios: nombre, profesional, area, fecha y hora',
      });
      return;
    }

    const conflicto = await pool.query(
      `SELECT id FROM appointments
       WHERE professional_id = $1
       AND fecha = $2
       AND hora = $3
       AND estado != 'cancelada'`,
      [professional_id, fecha, hora]
    );

    if (conflicto.rows.length > 0) {
      res.status(409).json({
        ok: false,
        mensaje: `El profesional ya tiene una cita a las ${hora} ese dia`,
      });
      return;
    }

    // Buscar o crear paciente
    let patient_id: number;
    if (paciente_telefono) {
      const pacienteExistente = await pool.query(
        `SELECT id FROM patients WHERE telefono = $1`,
        [paciente_telefono]
      );
      if (pacienteExistente.rows.length > 0) {
        patient_id = pacienteExistente.rows[0].id;
        await pool.query(
          `UPDATE patients SET nombre = $1, carnet = $2, edad = $3, updated_by = $4 WHERE id = $5`,
          [paciente_nombre, paciente_carnet || null, paciente_edad || null, req.usuario!.id, patient_id]
        );
      } else {
        const nuevoPaciente = await pool.query(
          `INSERT INTO patients (nombre, carnet, telefono, edad, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [paciente_nombre, paciente_carnet || null, paciente_telefono, paciente_edad || null, req.usuario!.id]
        );
        patient_id = nuevoPaciente.rows[0].id;
      }
    } else {
      const nuevoPaciente = await pool.query(
        `INSERT INTO patients (nombre, carnet, telefono, edad, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [paciente_nombre, paciente_carnet || null, null, paciente_edad || null, req.usuario!.id]
      );
      patient_id = nuevoPaciente.rows[0].id;
    }

    const montoTotalNum = monto_total ? Number(monto_total) : 0;
    const montoPagadoNum = monto_pagado ? Number(monto_pagado) : 0;
    const montoPendiente = montoTotalNum - montoPagadoNum;
    const estadoPago = estado === 'confirmada'
      ? (montoPendiente <= 0 ? 'pagado' : 'parcial')
      : null;

    const nuevaCita = await pool.query(
      `INSERT INTO appointments
        (patient_id, professional_id, area_id, fecha, hora, modalidad,
         sesion, total_sesiones, estado, servicio_nombre,
         monto, monto_total, monto_pagado,
         metodo_pago, estado_pago, fecha_pago, notas, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        patient_id,
        professional_id,
        area_id,
        fecha,
        hora,
        modalidad || 'presencial',
        sesion || 1,
        total_sesiones || 1,
        estado || 'pendiente',
        servicio_nombre || null,
        montoPagadoNum || null,
        montoTotalNum || null,
        montoPagadoNum || null,
        metodo_pago || null,
        estadoPago,
        estado === 'confirmada' ? new Date().toISOString().split('T')[0] : null,
        notas || null,
        req.usuario!.id,
      ]
    );

    const nuevaId = nuevaCita.rows[0].id;

    await registrarAudit({
      tabla: 'appointments',
      registro_id: nuevaId,
      accion: 'crear',
      datos_despues: { paciente_nombre, professional_id, area_id, fecha, hora, estado },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({
      ok: true,
      mensaje: 'Cita creada correctamente',
      id: nuevaId,
    });
  } catch (error) {
    console.error('Error al crear cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear cita' });
  }
}

export async function actualizarCita(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { estado, asistio, monto, monto_total, monto_pagado, metodo_pago, estado_pago, notas, total_sesiones, servicio_nombre, modalidad, fecha, hora } = req.body;

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
        estado, asistio,
        montoPagadoNum, montoTotalNum, montoPagadoNum,
        metodo_pago, nuevoEstadoPago, notas,
        total_sesiones, servicio_nombre, modalidad,
        req.usuario!.id, fecha, hora, id
      ]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    await registrarAudit({
      tabla: 'appointments',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
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

    // Obtener el patient_id antes de eliminar
    const citaData = await pool.query(
      'SELECT patient_id FROM appointments WHERE id = $1',
      [id]
    );

    if (citaData.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    const patient_id = citaData.rows[0].patient_id;

    // Eliminar la cita
    await pool.query('DELETE FROM appointments WHERE id = $1', [id]);

    // Verificar si el paciente tiene más citas
    const otrasCitas = await pool.query(
      'SELECT COUNT(*) as total FROM appointments WHERE patient_id = $1',
      [patient_id]
    );

    const total = parseInt(otrasCitas.rows[0].total);

    // Si no tiene más citas, eliminar el paciente
    if (total === 0) {
      await pool.query('DELETE FROM patients WHERE id = $1', [patient_id]);
    }

    await registrarAudit({
      tabla: 'appointments',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Cita eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar cita' });
  }
}
