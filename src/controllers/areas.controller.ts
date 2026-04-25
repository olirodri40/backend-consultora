import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

export async function getAreas(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT * FROM areas ORDER BY id`
    );
    res.json({ ok: true, areas: resultado.rows });
  } catch (error) {
    console.error('Error al obtener areas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener areas' });
  }
}

export async function crearArea(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { nombre, emoji, color, descripcion } = req.body;

    if (!nombre) {
      res.status(400).json({ ok: false, mensaje: 'El nombre es obligatorio' });
      return;
    }

    const duplicado = await pool.query(
      'SELECT id FROM areas WHERE LOWER(nombre) = LOWER($1)',
      [nombre]
    );
    if (duplicado.rows.length > 0) {
      res.status(409).json({ ok: false, mensaje: `El area "${nombre}" ya existe` });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO areas (nombre, emoji, color, descripcion)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [nombre, emoji || '🏥', color || 'emerald', descripcion || null]
    );

    const nuevoId = resultado.rows[0].id;

    await registrarAudit({
      tabla: 'areas',
      registro_id: nuevoId,
      accion: 'crear',
      datos_despues: { nombre, emoji, color },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({
      ok: true,
      mensaje: 'Area creada correctamente',
      id: nuevoId
    });
  } catch (error) {
    console.error('Error al crear area:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear area' });
  }
}

export async function actualizarArea(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, emoji, color, descripcion, activo } = req.body;

    const resultado = await pool.query(
      `UPDATE areas SET
        nombre      = COALESCE($1, nombre),
        emoji       = COALESCE($2, emoji),
        color       = COALESCE($3, color),
        descripcion = COALESCE($4, descripcion),
        activo      = COALESCE($5, activo)
       WHERE id = $6
       RETURNING id`,
      [nombre, emoji, color, descripcion, activo, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Area no encontrada' });
      return;
    }

    await registrarAudit({
      tabla: 'areas',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Area actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar area:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar area' });
  }
}

export async function eliminarArea(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const enUso = await pool.query(
      'SELECT COUNT(*) as total FROM users WHERE area_id = $1',
      [id]
    );
    if (parseInt(enUso.rows[0].total) > 0) {
      res.status(409).json({
        ok: false,
        mensaje: 'No se puede eliminar el area porque tiene profesionales asignados'
      });
      return;
    }

    const resultado = await pool.query(
      'DELETE FROM areas WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Area no encontrada' });
      return;
    }

    await registrarAudit({
      tabla: 'areas',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Area eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar area:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar area' });
  }
}