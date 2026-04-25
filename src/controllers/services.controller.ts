import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

// ================================================
// SERVICIOS (Psicologia, Fisioterapia, etc.)
// ================================================

export async function getServicios(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { area_id } = req.query;

    let query = `
      SELECT
        s.id, s.nombre, s.descripcion, s.costo,
        s.duracion_min, s.activo, s.created_at,
        a.id as area_id, a.nombre as area_nombre, a.emoji as area_emoji
       FROM services s
       JOIN areas a ON s.area_id = a.id
       WHERE 1=1
    `;

    const params: any[] = [];
    if (area_id) {
      query += ` AND s.area_id = $1`;
      params.push(area_id);
    }

    query += ` ORDER BY a.nombre, s.nombre`;

    const resultado = await pool.query(query, params);
    res.json({ ok: true, servicios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener servicios' });
  }
}

export async function crearServicio(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { area_id, nombre, descripcion, costo, duracion_min } = req.body;

    if (!area_id || !nombre) {
      res.status(400).json({ ok: false, mensaje: 'Area y nombre son obligatorios' });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO services (area_id, nombre, descripcion, costo, duracion_min)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [area_id, nombre, descripcion || null, costo || null, duracion_min || null]
    );

    const nuevoId = resultado.rows[0].id;

    await registrarAudit({
      tabla: 'services',
      registro_id: nuevoId,
      accion: 'crear',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Servicio creado correctamente', id: nuevoId });
  } catch (error) {
    console.error('Error al crear servicio:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear servicio' });
  }
}

export async function actualizarServicio(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, descripcion, costo, duracion_min, activo } = req.body;

    const resultado = await pool.query(
      `UPDATE services SET
        nombre       = COALESCE($1, nombre),
        descripcion  = COALESCE($2, descripcion),
        costo        = COALESCE($3, costo),
        duracion_min = COALESCE($4, duracion_min),
        activo       = COALESCE($5, activo)
       WHERE id = $6 RETURNING id`,
      [nombre, descripcion, costo, duracion_min, activo, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Servicio no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'services',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Servicio actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar servicio:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar servicio' });
  }
}

export async function eliminarServicio(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      'DELETE FROM services WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Servicio no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'services',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Servicio eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar servicio' });
  }
}

// ================================================
// HORARIOS DE ZUMBA
// ================================================

export async function getHorariosZumba(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT id, dia, hora_inicio::text, hora_fin::text, activo
       FROM zumba_horarios
       ORDER BY
         CASE dia
           WHEN 'Lunes'     THEN 1
           WHEN 'Martes'    THEN 2
           WHEN 'Miercoles' THEN 3
           WHEN 'Jueves'    THEN 4
           WHEN 'Viernes'   THEN 5
           WHEN 'Sabado'    THEN 6
           WHEN 'Domingo'   THEN 7
         END, hora_inicio`
    );
    res.json({ ok: true, horarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener horarios zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener horarios' });
  }
}

export async function crearHorarioZumba(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { dia, hora_inicio, hora_fin } = req.body;

    if (!dia || !hora_inicio || !hora_fin) {
      res.status(400).json({ ok: false, mensaje: 'Dia, hora inicio y hora fin son obligatorios' });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO zumba_horarios (dia, hora_inicio, hora_fin)
       VALUES ($1, $2, $3) RETURNING id`,
      [dia, hora_inicio, hora_fin]
    );

    res.status(201).json({
      ok: true,
      mensaje: 'Horario creado correctamente',
      id: resultado.rows[0].id
    });
  } catch (error) {
    console.error('Error al crear horario zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear horario' });
  }
}

export async function actualizarHorarioZumba(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { dia, hora_inicio, hora_fin, activo } = req.body;

    const resultado = await pool.query(
      `UPDATE zumba_horarios SET
        dia         = COALESCE($1, dia),
        hora_inicio = COALESCE($2, hora_inicio),
        hora_fin    = COALESCE($3, hora_fin),
        activo      = COALESCE($4, activo)
       WHERE id = $5 RETURNING id`,
      [dia, hora_inicio, hora_fin, activo, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Horario no encontrado' });
      return;
    }

    res.json({ ok: true, mensaje: 'Horario actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar horario zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar horario' });
  }
}

export async function eliminarHorarioZumba(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      'DELETE FROM zumba_horarios WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Horario no encontrado' });
      return;
    }

    res.json({ ok: true, mensaje: 'Horario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar horario zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar horario' });
  }
}

// ================================================
// ACTIVIDADES DE GERONTOLOGIA (CRUD completo)
// ================================================

export async function getActividadesAdmin(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, emoji, dia,
        hora_inicio::text, hora_fin::text,
        color, precio, activo
       FROM geronto_activities
       ORDER BY
         CASE dia
           WHEN 'Lunes'     THEN 1
           WHEN 'Martes'    THEN 2
           WHEN 'Miercoles' THEN 3
           WHEN 'Jueves'    THEN 4
           WHEN 'Viernes'   THEN 5
           WHEN 'Sabado'    THEN 6
           WHEN 'Domingo'   THEN 7
         END, hora_inicio`
    );
    res.json({ ok: true, actividades: resultado.rows });
  } catch (error) {
    console.error('Error al obtener actividades geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener actividades' });
  }
}

export async function crearActividadGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { nombre, emoji, dia, hora_inicio, hora_fin, color, precio } = req.body;

    if (!nombre || !dia || !hora_inicio || !hora_fin) {
      res.status(400).json({
        ok: false,
        mensaje: 'Nombre, dia, hora inicio y hora fin son obligatorios'
      });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO geronto_activities
        (nombre, emoji, dia, hora_inicio, hora_fin, color, precio)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nombre, emoji || '🧓', dia, hora_inicio, hora_fin, color || 'emerald', precio || 75]
    );

    res.status(201).json({
      ok: true,
      mensaje: 'Actividad creada correctamente',
      id: resultado.rows[0].id
    });
  } catch (error) {
    console.error('Error al crear actividad geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear actividad' });
  }
}

export async function actualizarActividadGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, emoji, dia, hora_inicio, hora_fin, color, precio, activo } = req.body;

    const resultado = await pool.query(
      `UPDATE geronto_activities SET
        nombre      = COALESCE($1, nombre),
        emoji       = COALESCE($2, emoji),
        dia         = COALESCE($3, dia),
        hora_inicio = COALESCE($4, hora_inicio),
        hora_fin    = COALESCE($5, hora_fin),
        color       = COALESCE($6, color),
        precio      = COALESCE($7, precio),
        activo      = COALESCE($8, activo)
       WHERE id = $9 RETURNING id`,
      [nombre, emoji, dia, hora_inicio, hora_fin, color, precio, activo, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Actividad no encontrada' });
      return;
    }

    res.json({ ok: true, mensaje: 'Actividad actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar actividad geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar actividad' });
  }
}

export async function eliminarActividadGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      'DELETE FROM geronto_activities WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Actividad no encontrada' });
      return;
    }

    res.json({ ok: true, mensaje: 'Actividad eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar actividad geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar actividad' });
  }
}