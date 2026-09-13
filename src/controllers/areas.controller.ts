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



export async function actualizarArea(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, descripcion, activo, visible_publico } = req.body;

    const resultado = await pool.query(
      `UPDATE areas SET
        nombre          = COALESCE($1, nombre),
        descripcion     = COALESCE($2, descripcion),
        activo          = COALESCE($3, activo),
        visible_publico = COALESCE($4, visible_publico)
       WHERE id = $5
       RETURNING id`,
      [nombre, descripcion, activo, visible_publico, id]
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

// GET /api/areas/public/visibilidad  (sin auth — sitio web público)
// Árbol Área → Sección → Servicio, filtrado a lo activo y visible al público.
export async function getVisibilidadPublica(
  _req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    // Zumba y Gerontología tienen su propio flujo (actividades/horarios) y no se ofrecen
    // en el selector Área → Servicio → Fecha → Hora del sitio público.
    const areasResult = await pool.query(
      `SELECT id, nombre, descripcion
       FROM areas
       WHERE activo = true AND visible_publico = true
         AND LOWER(nombre) NOT IN ('zumba', 'gerontologia')
       ORDER BY nombre`
    );

    const seccionesResult = await pool.query(
      `SELECT id, area_id, nombre, descripcion
       FROM area_secciones
       WHERE activo = true AND visible_publico = true
       ORDER BY nombre`
    );

    const serviciosResult = await pool.query(
      `SELECT id, area_id, seccion_id, nombre, descripcion, costo, costo_descuento, descripcion_descuento, duracion_min
       FROM services
       WHERE activo = true AND visible_publico = true
       ORDER BY nombre`
    );

    const areas = areasResult.rows.map((area) => ({
      ...area,
      secciones: seccionesResult.rows
        .filter((sec) => sec.area_id === area.id)
        .map((sec) => ({
          ...sec,
          servicios: serviciosResult.rows.filter((s) => s.seccion_id === sec.id),
        })),
      servicios_sin_seccion: serviciosResult.rows.filter(
        (s) => s.area_id === area.id && !s.seccion_id
      ),
    }));

    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, areas });
  } catch (error) {
    console.error('Error al obtener visibilidad publica:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener la visibilidad publica' });
  }
}

export async function eliminarArea(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const areaResult = await pool.query(
      'SELECT protegida FROM areas WHERE id = $1',
      [id]
    );
    if (areaResult.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Area no encontrada' });
      return;
    }
    if (areaResult.rows[0].protegida) {
      res.status(403).json({
        ok: false,
        mensaje: 'Esta área es fija del sistema y no se puede eliminar'
      });
      return;
    }

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