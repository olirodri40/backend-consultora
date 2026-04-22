import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

// ================================================
// GET /api/citas
// Trae todas las citas con datos del paciente,
// profesional y area
// ================================================
export async function getCitas(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { fecha, profesional_id, estado } = req.query;

    // Construir la consulta dinamicamente segun los filtros
    let query = `
      SELECT
        a.id,
        a.fecha,
        a.hora::text,
        a.modalidad,
        a.sesion,
        a.estado,
        a.servicio_nombre,
        a.monto,
        a.metodo_pago,
        a.estado_pago,
        a.fecha_pago,
        a.asistio,
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

    // Filtro por fecha
    if (fecha) {
      query += ` AND a.fecha = $${paramCount}`;
      params.push(fecha);
      paramCount++;
    }

    // Filtro por profesional
    if (profesional_id) {
      query += ` AND a.professional_id = $${paramCount}`;
      params.push(profesional_id);
      paramCount++;
    }

    // Filtro por estado
    if (estado) {
      query += ` AND a.estado = $${paramCount}`;
      params.push(estado);
      paramCount++;
    }

    // Si es profesional, solo ve sus propias citas
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

// ================================================
// GET /api/citas/:id
// Trae una cita especifica
// ================================================
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

// ================================================
// POST /api/citas
// Crear nueva cita
// ================================================
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
      estado,
      servicio_nombre,
      monto,
      metodo_pago,
      estado_pago,
    } = req.body;

    // Validaciones basicas
    if (!paciente_nombre || !professional_id || !area_id || !fecha || !hora) {
      res.status(400).json({
        ok: false,
        mensaje: 'Faltan datos obligatorios: nombre, profesional, area, fecha y hora',
      });
      return;
    }

    // Verificar que no haya conflicto de horario
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

    // Buscar o crear el paciente
    let patient_id: number;
    const pacienteExistente = await pool.query(
      `SELECT id FROM patients WHERE telefono = $1`,
      [paciente_telefono]
    );

    if (pacienteExistente.rows.length > 0) {
      patient_id = pacienteExistente.rows[0].id;
      // Actualizar datos si cambiaron
      await pool.query(
        `UPDATE patients SET nombre = $1, carnet = $2, edad = $3 WHERE id = $4`,
        [paciente_nombre, paciente_carnet, paciente_edad, patient_id]
      );
    } else {
      // Crear nuevo paciente
      const nuevoPaciente = await pool.query(
        `INSERT INTO patients (nombre, carnet, telefono, edad)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [paciente_nombre, paciente_carnet, paciente_telefono, paciente_edad]
      );
      patient_id = nuevoPaciente.rows[0].id;
    }

    // Crear la cita
    const nuevaCita = await pool.query(
      `INSERT INTO appointments
        (patient_id, professional_id, area_id, fecha, hora, modalidad,
         sesion, estado, servicio_nombre, monto, metodo_pago, estado_pago,
         fecha_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        patient_id,
        professional_id,
        area_id,
        fecha,
        hora,
        modalidad || 'presencial',
        sesion    || '1ra',
        estado    || 'pendiente',
        servicio_nombre || null,
        monto           || null,
        metodo_pago     || null,
        estado_pago     || null,
        estado === 'confirmada' ? new Date().toISOString().split('T')[0] : null,
      ]
    );

    res.status(201).json({
      ok: true,
      mensaje: 'Cita creada correctamente',
      id: nuevaCita.rows[0].id,
    });

  } catch (error) {
    console.error('Error al crear cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear cita' });
  }
}

// ================================================
// PUT /api/citas/:id
// Actualizar cita (estado, asistencia, datos)
// ================================================
export async function actualizarCita(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { estado, asistio, monto, metodo_pago, estado_pago } = req.body;

    const resultado = await pool.query(
      `UPDATE appointments
       SET
         estado      = COALESCE($1, estado),
         asistio     = COALESCE($2, asistio),
         monto       = COALESCE($3, monto),
         metodo_pago = COALESCE($4, metodo_pago),
         estado_pago = COALESCE($5, estado_pago)
       WHERE id = $6
       RETURNING id`,
      [estado, asistio, monto, metodo_pago, estado_pago, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    res.json({ ok: true, mensaje: 'Cita actualizada correctamente' });

  } catch (error) {
    console.error('Error al actualizar cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar cita' });
  }
}

// ================================================
// DELETE /api/citas/:id
// Eliminar cita
// ================================================
export async function eliminarCita(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `DELETE FROM appointments WHERE id = $1 RETURNING id`,
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
      return;
    }

    res.json({ ok: true, mensaje: 'Cita eliminada correctamente' });

  } catch (error) {
    console.error('Error al eliminar cita:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar cita' });
  }
}