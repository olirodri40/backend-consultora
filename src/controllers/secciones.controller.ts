import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

const AREAS_CON_SECCIONES = ['psicologia', 'fisioterapia', 'medicina'];

async function areaPermiteSecciones(areaId: number): Promise<boolean> {
  const result = await pool.query('SELECT nombre FROM areas WHERE id = $1', [areaId]);
  if (result.rows.length === 0) return false;
  return AREAS_CON_SECCIONES.includes(result.rows[0].nombre.toLowerCase());
}

export async function getSecciones(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { areaId } = req.params;
    const resultado = await pool.query(
      'SELECT * FROM area_secciones WHERE area_id = $1 ORDER BY id',
      [areaId]
    );
    res.json({ ok: true, secciones: resultado.rows });
  } catch (error) {
    console.error('Error al obtener secciones:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener secciones' });
  }
}

export async function crearSeccion(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { areaId } = req.params;
    const { nombre, descripcion, activo } = req.body;

    if (!nombre) {
      res.status(400).json({ ok: false, mensaje: 'El nombre es obligatorio' });
      return;
    }

    const permitido = await areaPermiteSecciones(Number(areaId));
    if (!permitido) {
      res.status(403).json({ ok: false, mensaje: 'Esta área no admite secciones' });
      return;
    }

    const duplicado = await pool.query(
      'SELECT id FROM area_secciones WHERE area_id = $1 AND LOWER(nombre) = LOWER($2)',
      [areaId, nombre]
    );
    if (duplicado.rows.length > 0) {
      res.status(409).json({ ok: false, mensaje: `La sección "${nombre}" ya existe en esta área` });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO area_secciones (area_id, nombre, descripcion, activo)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [areaId, nombre, descripcion || null, activo !== undefined ? activo : true]
    );

    const nuevoId = resultado.rows[0].id;

    await registrarAudit({
      tabla: 'area_secciones',
      registro_id: nuevoId,
      accion: 'crear',
      datos_despues: { area_id: areaId, nombre, descripcion, activo },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Sección creada correctamente', id: nuevoId });
  } catch (error) {
    console.error('Error al crear sección:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear sección' });
  }
}

export async function actualizarSeccion(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, descripcion, activo, visible_publico } = req.body;

    const resultado = await pool.query(
      `UPDATE area_secciones SET
        nombre          = COALESCE($1, nombre),
        descripcion     = COALESCE($2, descripcion),
        activo          = COALESCE($3, activo),
        visible_publico = COALESCE($4, visible_publico)
       WHERE id = $5
       RETURNING id`,
      [nombre, descripcion, activo, visible_publico, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Sección no encontrada' });
      return;
    }

    await registrarAudit({
      tabla: 'area_secciones',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Sección actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar sección:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar sección' });
  }
}

export async function eliminarSeccion(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const enUso = await pool.query(
      'SELECT COUNT(*) as total FROM services WHERE seccion_id = $1',
      [id]
    );
    if (parseInt(enUso.rows[0].total) > 0) {
      res.status(409).json({
        ok: false,
        mensaje: 'No se puede eliminar la sección porque tiene servicios asignados'
      });
      return;
    }

    const resultado = await pool.query(
      'DELETE FROM area_secciones WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Sección no encontrada' });
      return;
    }

    await registrarAudit({
      tabla: 'area_secciones',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Sección eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar sección:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar sección' });
  }
}