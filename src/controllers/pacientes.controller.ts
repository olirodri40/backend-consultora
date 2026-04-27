import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

export async function getPacientes(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { buscar } = req.query;

    let query = `
      SELECT
        p.id,
        p.nombre,
        p.carnet,
        p.telefono,
        p.edad,
        p.created_at,
        COUNT(a.id) as total_citas,
        SUM(CASE WHEN a.estado = 'confirmada' THEN 1 ELSE 0 END) as citas_confirmadas,
        SUM(CASE WHEN a.estado = 'pendiente'  THEN 1 ELSE 0 END) as citas_pendientes,
        COALESCE(SUM(a.monto), 0) as total_pagado
      FROM patients p
      LEFT JOIN appointments a ON p.id = a.patient_id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 1;

    if (buscar) {
      query += ` AND (
        p.nombre   ILIKE $${paramCount} OR
        p.carnet   ILIKE $${paramCount} OR
        p.telefono ILIKE $${paramCount}
      )`;
      params.push(`%${buscar}%`);
      paramCount++;
    }

    query += ` GROUP BY p.id ORDER BY p.nombre`;

    const resultado = await pool.query(query, params);

    res.json({
      ok: true,
      pacientes: resultado.rows,
      total: resultado.rowCount,
    });
  } catch (error) {
    console.error('Error al obtener pacientes:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener pacientes' });
  }
}

export async function getPacientePorId(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const paciente = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );

    if (paciente.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Paciente no encontrado' });
      return;
    }

    const citas = await pool.query(
      `SELECT
        a.id, a.fecha, a.hora::text, a.sesion,
        a.estado, a.modalidad, a.monto,
        a.metodo_pago, a.estado_pago, a.asistio,
        a.servicio_nombre,
        u.nombre  as profesional_nombre,
        ar.nombre as area_nombre,
        ar.emoji  as area_emoji
       FROM appointments a
       JOIN users u  ON a.professional_id = u.id
       JOIN areas ar ON a.area_id         = ar.id
       WHERE a.patient_id = $1
       ORDER BY a.fecha DESC, a.hora DESC`,
      [id]
    );

    res.json({
      ok: true,
      paciente: paciente.rows[0],
      citas: citas.rows,
    });
  } catch (error) {
    console.error('Error al obtener paciente:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener paciente' });
  }
}

export async function actualizarPaciente(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, carnet, telefono, edad } = req.body;

    const resultado = await pool.query(
      `UPDATE patients SET
        nombre     = COALESCE($1, nombre),
        carnet     = COALESCE($2, carnet),
        telefono   = COALESCE($3, telefono),
        edad       = COALESCE($4, edad),
        updated_at = NOW(),
        updated_by = $5
       WHERE id = $6
       RETURNING id`,
      [nombre, carnet, telefono, edad, req.usuario!.id, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Paciente no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'patients',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Paciente actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar paciente:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar paciente' });
  }
}

export async function eliminarPaciente(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      'DELETE FROM patients WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Paciente no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'patients',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Paciente eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar paciente:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar paciente' });
  }
}
export async function crearPaciente(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { nombre, carnet, telefono, edad } = req.body;

    if (!nombre) {
      res.status(400).json({ ok: false, mensaje: 'El nombre es obligatorio' });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO patients (nombre, carnet, telefono, edad, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nombre, carnet || null, telefono || null, edad || null, req.usuario!.id]
    );

    const nuevoId = resultado.rows[0].id;

    await registrarAudit({
      tabla: 'patients',
      registro_id: nuevoId,
      accion: 'crear',
      datos_despues: { nombre, carnet, telefono, edad },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Paciente creado correctamente', id: nuevoId });
  } catch (error) {
    console.error('Error al crear paciente:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear paciente' });
  }
}