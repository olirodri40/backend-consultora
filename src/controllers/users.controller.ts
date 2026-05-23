import { Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

export async function getUsuarios(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT
        u.id, u.nombre, u.usuario, u.email, u.telefono,
        u.especialidad, u.tipo_horario, u.fecha_nac,
        u.sueldo, u.contrato, u.fecha_ingreso, u.activo, u.created_at,
        r.id as role_id, r.nombre as rol,
        a.id as area_id, a.nombre as area_nombre, a.emoji as area_emoji,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', ua.area_id, 'nombre', ua2.nombre, 'emoji', ua2.emoji))
          FILTER (WHERE ua.area_id IS NOT NULL), '[]'
        ) as areas,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', uga.activity_id, 'nombre', ga.nombre, 'emoji', ga.emoji, 'dia', ga.dia))
          FILTER (WHERE uga.activity_id IS NOT NULL), '[]'
        ) as actividades_geronto
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN areas ua2 ON ua2.id = ua.area_id
       LEFT JOIN user_geronto_activities uga ON uga.user_id = u.id
       LEFT JOIN geronto_activities ga ON ga.id = uga.activity_id
       GROUP BY u.id, r.id, a.id
       ORDER BY u.nombre`
    );
    res.json({ ok: true, usuarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener usuarios' });
  }
}

export async function getUsuarioPorId(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const resultado = await pool.query(
      `SELECT
        u.id, u.nombre, u.usuario, u.email, u.telefono,
        u.especialidad, u.tipo_horario, u.fecha_nac,
        u.sueldo, u.contrato, u.fecha_ingreso, u.activo,
        r.id as role_id, r.nombre as rol,
        a.id as area_id, a.nombre as area_nombre,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', ua.area_id, 'nombre', ua2.nombre, 'emoji', ua2.emoji))
          FILTER (WHERE ua.area_id IS NOT NULL), '[]'
        ) as areas,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', uga.activity_id, 'nombre', ga.nombre, 'emoji', ga.emoji, 'dia', ga.dia))
          FILTER (WHERE uga.activity_id IS NOT NULL), '[]'
        ) as actividades_geronto
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN areas ua2 ON ua2.id = ua.area_id
       LEFT JOIN user_geronto_activities uga ON uga.user_id = u.id
       LEFT JOIN geronto_activities ga ON ga.id = uga.activity_id
       WHERE u.id = $1
       GROUP BY u.id, r.id, a.id`,
      [id]
    );
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      return;
    }
    res.json({ ok: true, usuario: resultado.rows[0] });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener usuario' });
  }
}

export async function crearUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      nombre, usuario, password, email, telefono,
      role_id, area_id, areas_ids, especialidad, tipo_horario,
      fecha_nac, sueldo, contrato, fecha_ingreso,
      actividades_geronto_ids,
    } = req.body;

    if (!nombre || !usuario || !password || !role_id) {
      res.status(400).json({
        ok: false,
        mensaje: 'Nombre, usuario, password y rol son obligatorios'
      });
      return;
    }

    const duplicado = await pool.query(
      'SELECT id FROM users WHERE usuario = $1',
      [usuario.toLowerCase()]
    );
    if (duplicado.rows.length > 0) {
      res.status(409).json({ ok: false, mensaje: `El usuario "${usuario}" ya existe` });
      return;
    }

    const hash = await bcrypt.hash(password, 10);

    // area_id principal = primera área seleccionada
    const areaIdPrincipal = area_id || (areas_ids && areas_ids.length > 0 ? areas_ids[0] : null);

    const resultado = await pool.query(
      `INSERT INTO users
        (nombre, usuario, password, email, telefono, role_id, area_id,
         especialidad, tipo_horario, fecha_nac, sueldo, contrato, fecha_ingreso,
         created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        nombre, usuario.toLowerCase(), hash, email || null,
        telefono || null, role_id, areaIdPrincipal || null,
        especialidad || null, tipo_horario || 'diario',
        fecha_nac || null, sueldo || null,
        contrato || 'indefinido', fecha_ingreso || null,
        req.usuario!.id
      ]
    );

    const nuevoId = resultado.rows[0].id;

    // Guardar múltiples áreas
    if (areas_ids && areas_ids.length > 0) {
      for (const aId of areas_ids) {
        await pool.query(
          `INSERT INTO user_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [nuevoId, aId]
        );
      }
    } else if (areaIdPrincipal) {
      await pool.query(
        `INSERT INTO user_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [nuevoId, areaIdPrincipal]
      );
    }

    // Guardar actividades geronto
    if (actividades_geronto_ids && actividades_geronto_ids.length > 0) {
      for (const actId of actividades_geronto_ids) {
        await pool.query(
          `INSERT INTO user_geronto_activities (user_id, activity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [nuevoId, actId]
        );
      }
    }

    await registrarAudit({
      tabla: 'users',
      registro_id: nuevoId,
      accion: 'crear',
      datos_despues: { nombre, usuario, role_id, area_id: areaIdPrincipal, areas_ids },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({
      ok: true,
      mensaje: 'Usuario creado correctamente',
      id: nuevoId
    });
  } catch (error: any) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear usuario', detalle: error.message });
  }
}

export async function actualizarUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const {
      nombre, email, telefono, role_id, area_id, areas_ids,
      especialidad, tipo_horario, fecha_nac,
      sueldo, contrato, fecha_ingreso, activo, password,
      actividades_geronto_ids,
    } = req.body;

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // area_id principal
    const areaIdPrincipal = area_id || (areas_ids && areas_ids.length > 0 ? areas_ids[0] : null);

    const resultado = await pool.query(
      `UPDATE users SET
        nombre        = COALESCE($1, nombre),
        email         = COALESCE($2, email),
        telefono      = COALESCE($3, telefono),
        role_id       = COALESCE($4, role_id),
        area_id       = COALESCE($5, area_id),
        especialidad  = COALESCE($6, especialidad),
        tipo_horario  = COALESCE($7, tipo_horario),
        fecha_nac     = COALESCE($8, fecha_nac),
        sueldo        = COALESCE($9, sueldo),
        contrato      = COALESCE($10, contrato),
        fecha_ingreso = COALESCE($11, fecha_ingreso),
        activo        = COALESCE($12, activo),
        password      = COALESCE($13, password),
        updated_at    = NOW(),
        updated_by    = $14
       WHERE id = $15
       RETURNING id`,
      [
        nombre, email, telefono, role_id, areaIdPrincipal,
        especialidad, tipo_horario, fecha_nac,
        sueldo, contrato, fecha_ingreso, activo,
        passwordHash, req.usuario!.id, id
      ]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      return;
    }

    // Actualizar áreas
    if (areas_ids !== undefined) {
      await pool.query('DELETE FROM user_areas WHERE user_id = $1', [id]);
      for (const aId of areas_ids) {
        await pool.query(
          `INSERT INTO user_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, aId]
        );
      }
    }

    // Actualizar actividades geronto
    if (actividades_geronto_ids !== undefined) {
      await pool.query('DELETE FROM user_geronto_activities WHERE user_id = $1', [id]);
      for (const actId of actividades_geronto_ids) {
        await pool.query(
          `INSERT INTO user_geronto_activities (user_id, activity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, actId]
        );
      }
    }

    await registrarAudit({
      tabla: 'users',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: req.body,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Usuario actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar usuario' });
  }
}

export async function eliminarUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    if (parseInt(id as string) === req.usuario?.id) {
      res.status(400).json({ ok: false, mensaje: 'No puedes eliminar tu propio usuario' });
      return;
    }

    const resultado = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'users',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar usuario' });
  }
}

export async function getHorariosUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const resultado = await pool.query(
      `SELECT id, dia, hora_inicio::text, hora_fin::text, 
              COALESCE(slot_minutos, 60) as slot_minutos  -- ✅ NUEVO
       FROM availability
       WHERE user_id = $1
       ORDER BY
         CASE dia
           WHEN 'Lunes'     THEN 1
           WHEN 'Martes'    THEN 2
           WHEN 'Miercoles' THEN 3
           WHEN 'Jueves'    THEN 4
           WHEN 'Viernes'   THEN 5
           WHEN 'Sabado'    THEN 6
           WHEN 'Domingo'   THEN 7
         END`,
      [id]
    );
    res.json({ ok: true, horarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener horarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener horarios' });
  }
}

export async function guardarHorariosUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { horarios } = req.body;

    if (!horarios || !Array.isArray(horarios)) {
      res.status(400).json({ ok: false, mensaje: 'Horarios debe ser un array' });
      return;
    }

    await pool.query('DELETE FROM availability WHERE user_id = $1', [id]);

    for (const h of horarios) {
      await pool.query(
        `INSERT INTO availability (user_id, dia, hora_inicio, hora_fin, slot_minutos)
         VALUES ($1, $2, $3, $4, $5)`,  // ✅ NUEVO: slot_minutos
        [id, h.dia, h.hora_inicio, h.hora_fin, h.slot_minutos || 60]  // ✅ NUEVO
      );
    }

    await registrarAudit({
      tabla: 'availability',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: { horarios },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Horarios guardados correctamente' });
  } catch (error) {
    console.error('Error al guardar horarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar horarios' });
  }
}
export async function getAuditLog(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { tabla, user_id, limite } = req.query;

    let query = `
      SELECT
        a.id, a.tabla, a.registro_id, a.accion,
        a.datos_antes, a.datos_despues,
        a.user_nombre, a.user_rol, a.ip, a.created_at,
        u.nombre as usuario_nombre
       FROM audit_log a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE 1=1
    `;

    const params: any[] = [];
    let count = 1;

    if (tabla) {
      query += ` AND a.tabla = $${count}`;
      params.push(tabla);
      count++;
    }
    if (user_id) {
      query += ` AND a.user_id = $${count}`;
      params.push(user_id);
      count++;
    }

    query += ` ORDER BY a.created_at DESC LIMIT $${count}`;
    params.push(parseInt(limite as string) || 100);

    const resultado = await pool.query(query, params);
    res.json({ ok: true, logs: resultado.rows });
  } catch (error) {
    console.error('Error al obtener audit log:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener log' });
  }
}

export async function getProfesionales(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT
        u.id,
        u.area_id,
        u.nombre,
        u.email,
        u.telefono,
        u.especialidad,
        u.tipo_horario,
        u.fecha_nac,
        u.sueldo,
        u.contrato,
        u.fecha_ingreso,
        u.activo,
        u.created_at,
        r.nombre as rol,
        a.nombre as area_nombre,
        a.emoji  as area_emoji,
        a.color  as area_color,
        EXTRACT(YEAR FROM AGE(u.fecha_nac)) as edad,
        TO_CHAR(u.fecha_nac, 'DD/MM') as cumple_dia_mes,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', ua.area_id, 'nombre', ua2.nombre, 'emoji', ua2.emoji))
          FILTER (WHERE ua.area_id IS NOT NULL), '[]'
        ) as areas,
        -- ✅ NUEVO: Agregar actividades de gerontología
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object(
            'id', ga.id,
            'nombre', ga.nombre,
            'emoji', ga.emoji,
            'dia', ga.dia,
            'hora_inicio', ga.hora_inicio,
            'hora_fin', ga.hora_fin,
            'color', ga.color,
            'precio', ga.precio
          ))
          FILTER (WHERE ga.id IS NOT NULL), '[]'
        ) as actividades_geronto
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN areas ua2 ON ua2.id = ua.area_id
       -- ✅ NUEVO: JOIN para actividades de gerontología
       LEFT JOIN user_geronto_activities uga ON uga.user_id = u.id
       LEFT JOIN geronto_activities ga ON ga.id = uga.activity_id AND ga.activo = true
       WHERE r.nombre IN ('profesional', 'supervisor')
       AND u.activo = true
       GROUP BY u.id, r.id, a.id
       ORDER BY a.nombre, u.nombre`
    );

    res.json({ ok: true, profesionales: resultado.rows });
  } catch (error) {
    console.error('Error al obtener profesionales:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener profesionales' });
  }
}

export async function getTodosHorarios(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT
        av.id, av.dia, av.hora_inicio::text, av.hora_fin::text,
        COALESCE(av.slot_minutos, 60) as slot_minutos,  -- ✅ NUEVO
        u.id as user_id, u.nombre as profesional_nombre,
        a.nombre as area_nombre, a.emoji as area_emoji, a.color as area_color
       FROM availability av
       JOIN users u ON av.user_id = u.id
       LEFT JOIN areas a ON u.area_id = a.id
       WHERE u.activo = true
       ORDER BY u.nombre, av.dia, av.hora_inicio`
    );
    res.json({ ok: true, horarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener todos los horarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener horarios' });
  }
}