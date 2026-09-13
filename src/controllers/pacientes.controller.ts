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
        p.contacto_relacion,
        p.contacto_nombre,
        p.contacto_telefono,
        p.created_at,
        COUNT(a.id) as total_citas,
        SUM(CASE WHEN a.estado = 'confirmada' THEN 1 ELSE 0 END) as citas_confirmadas,
        SUM(CASE WHEN a.estado = 'pendiente'  THEN 1 ELSE 0 END) as citas_pendientes,
        COALESCE(MAX(a.total_sesiones), 0) as total_sesiones_pagadas,
        COALESCE(SUM(CASE WHEN a.sesion::text = '1' THEN a.monto_pagado ELSE 0 END), 0) as total_pagado
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
      `SELECT id, nombre, carnet, telefono, edad, 
              contacto_relacion, contacto_nombre, contacto_telefono,
              created_at 
       FROM patients 
       WHERE id = $1`,
      [id]
    );

    if (paciente.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Paciente no encontrado' });
      return;
    }

        const citas = await pool.query(
      `SELECT
        a.id, a.fecha, a.hora::text, a.sesion, a.total_sesiones,
        a.ciclo,
        a.estado, a.modalidad, a.monto, a.monto_total, a.monto_pagado,
        a.metodo_pago, a.estado_pago, a.asistio,
        a.servicio_nombre,
        a.notas,
        a.professional_id as profesional_id,
        a.area_id,
        a.grupo_id,
        (
          SELECT COALESCE(json_agg(json_build_object('patient_id', p2.id, 'nombre', p2.nombre)), '[]'::json)
          FROM appointments a2
          JOIN patients p2 ON a2.patient_id = p2.id
          WHERE a2.grupo_id = a.grupo_id AND a2.id != a.id AND a.grupo_id IS NOT NULL
        ) as companeros,
        u.nombre  as profesional_nombre,
        ar.nombre as area_nombre
       FROM appointments a
       JOIN users u  ON a.professional_id = u.id
       JOIN areas ar ON a.area_id         = ar.id
       WHERE a.patient_id = $1
       ORDER BY a.fecha ASC, a.hora ASC`,
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
    let { nombre, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono } = req.body;

    // ✅ Normaliza edad: cualquier valor vacío o inválido se guarda como null
    if (edad === '' || edad === undefined || edad === null) {
      edad = null;
    } else {
      const edadNum = Number(edad);
      edad = Number.isNaN(edadNum) ? null : edadNum;
    }

    // ✅ Normaliza los strings: '' se convierte en null
    carnet = carnet?.trim() ? carnet.trim() : null;
    telefono = telefono?.trim() ? telefono.trim() : null;
    contacto_relacion = contacto_relacion?.trim() ? contacto_relacion.trim() : null;
    contacto_nombre = contacto_nombre?.trim() ? contacto_nombre.trim() : null;
    contacto_telefono = contacto_telefono?.trim() ? contacto_telefono.trim() : null;

    const resultado = await pool.query(
      `UPDATE patients SET
        nombre     = COALESCE($1, nombre),
        carnet     = $2,
        telefono   = $3,
        edad       = $4,
        contacto_relacion = $5,
        contacto_nombre   = $6,
        contacto_telefono = $7,
        updated_at = NOW(),
        updated_by = $8
       WHERE id = $9
       RETURNING id`,
      [nombre || null, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono, req.usuario!.id, id]
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
    const { nombre, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono } = req.body;

    if (!nombre) {
      res.status(400).json({ ok: false, mensaje: 'El nombre es obligatorio' });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO patients (nombre, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [nombre, carnet || null, telefono || null, edad || null, contacto_relacion || null, contacto_nombre || null, contacto_telefono || null, req.usuario!.id]
    );

    const nuevoId = resultado.rows[0].id;

    await registrarAudit({
      tabla: 'patients',
      registro_id: nuevoId,
      accion: 'crear',
      datos_despues: { nombre, carnet, telefono, edad, contacto_relacion, contacto_nombre, contacto_telefono },
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