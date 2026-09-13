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
        u.id, u.nombre, u.usuario, u.email, u.telefono, u.carnet,
        u.especialidad, u.tipo_horario, u.fecha_nac,
        u.sueldo, u.contrato, u.fecha_ingreso, u.activo, u.created_at,
        r.id as role_id, r.nombre as rol,
        a.id as area_id, a.nombre as area_nombre,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', ua.area_id, 'nombre', ua2.nombre))
          FILTER (WHERE ua.area_id IS NOT NULL), '[]'
        ) as areas,
                COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', uga.activity_id, 'nombre', ga.nombre, 'dia', ga.dia))
          FILTER (WHERE uga.activity_id IS NOT NULL), '[]'
        ) as actividades_geronto,
        COALESCE(
          JSON_AGG(DISTINCT us.servicio_id) FILTER (WHERE us.servicio_id IS NOT NULL), '[]'
        ) as servicios_ids
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN areas ua2 ON ua2.id = ua.area_id
       LEFT JOIN user_geronto_activities uga ON uga.user_id = u.id
       LEFT JOIN geronto_activities ga ON ga.id = uga.activity_id
       LEFT JOIN user_servicios us ON us.user_id = u.id
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
        u.id, u.nombre, u.usuario, u.email, u.telefono, u.carnet,
        u.especialidad, u.tipo_horario, u.fecha_nac,
        u.sueldo, u.contrato, u.fecha_ingreso, u.activo,
        r.id as role_id, r.nombre as rol,
        a.id as area_id, a.nombre as area_nombre,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', ua.area_id, 'nombre', ua2.nombre))
          FILTER (WHERE ua.area_id IS NOT NULL), '[]'
        ) as areas,
                COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', uga.activity_id, 'nombre', ga.nombre, 'dia', ga.dia))
          FILTER (WHERE uga.activity_id IS NOT NULL), '[]'
        ) as actividades_geronto,
        COALESCE(
          JSON_AGG(DISTINCT us.servicio_id) FILTER (WHERE us.servicio_id IS NOT NULL), '[]'
        ) as servicios_ids
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN areas ua2 ON ua2.id = ua.area_id
       LEFT JOIN user_geronto_activities uga ON uga.user_id = u.id
       LEFT JOIN geronto_activities ga ON ga.id = uga.activity_id
       LEFT JOIN user_servicios us ON us.user_id = u.id
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

// ✅ Función para eliminar horarios de áreas que el usuario ya no tiene

// ============================================
// FUNCIÓN AUXILIAR: Guardar horarios automáticos
// ============================================
async function guardarHorariosAutomaticos(
  userId: number,
  areasIds: number[],
  actividadesGerontoIds: number[]
): Promise<void> {
  const horariosAAgregar: any[] = [];

  // 1. Zumba
  const areaZumba = await pool.query(
    'SELECT id FROM areas WHERE LOWER(nombre) = LOWER($1)',
    ['Zumba']
  );
  
  if (areaZumba.rows.length > 0 && areasIds.includes(areaZumba.rows[0].id)) {
    const zumbaHorarios = await pool.query(
      `SELECT dia, hora_inicio, hora_fin, slot_minutos 
       FROM zumba_horarios 
       WHERE activo = true`
    );
    
    for (const h of zumbaHorarios.rows) {
      horariosAAgregar.push({
        dia: h.dia,
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin,
        slot_minutos: h.slot_minutos || 60,
        area_id: areaZumba.rows[0].id
      });
    }
  }

  // 2. Gerontología
  const areaGeronto = await pool.query(
    'SELECT id FROM areas WHERE LOWER(nombre) = LOWER($1)',
    ['Gerontologia']
  );

  if (areaGeronto.rows.length > 0 && areasIds.includes(areaGeronto.rows[0].id)) {
    if (actividadesGerontoIds && actividadesGerontoIds.length > 0) {
      const gerontoHorarios = await pool.query(
        `SELECT dia, hora_inicio, hora_fin
         FROM geronto_activities
         WHERE id = ANY($1::int[]) AND activo = true`,
        [actividadesGerontoIds]
      );

      for (const h of gerontoHorarios.rows) {
        horariosAAgregar.push({
          dia: h.dia,
          hora_inicio: h.hora_inicio,
          hora_fin: h.hora_fin,
          slot_minutos: 60,
          area_id: areaGeronto.rows[0].id
        });
      }
    }
  }

  // 3. Guardar horarios
  if (horariosAAgregar.length > 0) {
    // Eliminar horarios existentes para evitar duplicados
    await pool.query('DELETE FROM availability WHERE user_id = $1', [userId]);

    for (const h of horariosAAgregar) {
      await pool.query(
        `INSERT INTO availability (user_id, area_id, dia, hora_inicio, hora_fin, slot_minutos)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, h.area_id, h.dia, h.hora_inicio, h.hora_fin, h.slot_minutos]
      );
    }
  }
}
// ✅ Función para eliminar horarios de áreas que el usuario ya no tiene
async function eliminarHorariosDeAreasRemovidas(
  userId: number,
  areasIdsActuales: number[]
): Promise<void> {
  // Obtener todos los horarios del usuario
  const horariosExistentes = await pool.query(
    `SELECT id, area_id FROM availability WHERE user_id = $1`,
    [userId]
  );

  if (horariosExistentes.rows.length === 0) return;

  // Identificar horarios que pertenecen a áreas que ya no tiene
  const idsAEliminar = horariosExistentes.rows
    .filter(h => !areasIdsActuales.includes(h.area_id))
    .map(h => h.id);

  if (idsAEliminar.length === 0) return;

  // Eliminar horarios de áreas removidas
  await pool.query(
    `DELETE FROM availability WHERE id = ANY($1::int[])`,
    [idsAEliminar]
  );
}
export async function crearUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
        const {
      nombre, usuario, password, email, telefono, carnet,
      role_id, area_id, areas_ids, especialidad, tipo_horario,
      fecha_nac, sueldo, contrato, fecha_ingreso,
      actividades_geronto_ids, servicios_ids,
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
        (nombre, usuario, password, email, telefono, carnet, role_id, area_id,
         especialidad, tipo_horario, fecha_nac, sueldo, contrato, fecha_ingreso,
         created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        nombre, usuario.toLowerCase(), hash, email || null,
        telefono || null, carnet || null, role_id, areaIdPrincipal || null,
        especialidad || null, tipo_horario || 'diario',
        fecha_nac || null, sueldo || null,
        contrato || 'indefinido', fecha_ingreso || null,
        req.usuario!.id
      ]
    );

    const nuevoId = resultado.rows[0].id;

    // Guardar múltiples áreas
    const areasFinales: number[] = [];
    if (areas_ids && areas_ids.length > 0) {
      for (const aId of areas_ids) {
        await pool.query(
          `INSERT INTO user_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [nuevoId, aId]
        );
        areasFinales.push(aId);
      }
    } else if (areaIdPrincipal) {
      await pool.query(
        `INSERT INTO user_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [nuevoId, areaIdPrincipal]
      );
      areasFinales.push(areaIdPrincipal);
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

    // Guardar servicios que puede atender el profesional
    if (servicios_ids && servicios_ids.length > 0) {
      for (const sId of servicios_ids) {
        await pool.query(
          `INSERT INTO user_servicios (user_id, servicio_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [nuevoId, sId]
        );
      }
    }


    // ✅ NUEVO: Guardar horarios automáticos (Zumba/Gerontología)
    await guardarHorariosAutomaticos(
      nuevoId,
      areasFinales,
      actividades_geronto_ids || []
    );

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
      nombre, email, telefono, carnet, role_id, area_id, areas_ids,
      especialidad, tipo_horario, fecha_nac,
      sueldo, contrato, fecha_ingreso, activo, password,
      actividades_geronto_ids, servicios_ids,
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
        carnet        = COALESCE($4, carnet),
        role_id       = COALESCE($5, role_id),
        area_id       = COALESCE($6, area_id),
        especialidad  = COALESCE($7, especialidad),
        tipo_horario  = COALESCE($8, tipo_horario),
        fecha_nac     = COALESCE($9, fecha_nac),
        sueldo        = COALESCE($10, sueldo),
        contrato      = COALESCE($11, contrato),
        fecha_ingreso = COALESCE($12, fecha_ingreso),
        activo        = COALESCE($13, activo),
        password      = COALESCE($14, password),
        updated_at    = NOW(),
        updated_by    = $15
       WHERE id = $16
       RETURNING id`,
      [
        nombre, email, telefono, carnet, role_id, areaIdPrincipal,
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
    let areasFinales: number[] = [];
    if (areas_ids !== undefined) {
      await pool.query('DELETE FROM user_areas WHERE user_id = $1', [id]);
      for (const aId of areas_ids) {
        await pool.query(
          `INSERT INTO user_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, aId]
        );
      }
      areasFinales = areas_ids;
    } else {
      // Si no se enviaron areas_ids, obtener las actuales
      const areasActuales = await pool.query(
        `SELECT area_id FROM user_areas WHERE user_id = $1`,
        [id]
      );
      areasFinales = areasActuales.rows.map(r => r.area_id);
    }

    // Actualizar actividades geronto
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

    // Actualizar servicios que puede atender el profesional.
    // Se borran solo los que ya no están (para no perder el estado de visible_publico
    // de los que se mantienen) y se insertan los nuevos con visible_publico=true por defecto.
    if (servicios_ids !== undefined) {
      await pool.query(
        `DELETE FROM user_servicios WHERE user_id = $1 AND NOT (servicio_id = ANY($2::int[]))`,
        [id, servicios_ids.length > 0 ? servicios_ids : []]
      );
      for (const sId of servicios_ids) {
        await pool.query(
          `INSERT INTO user_servicios (user_id, servicio_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, sId]
        );
      }
    }

    // ✅ NUEVO: Eliminar horarios de áreas que el usuario ya no tiene
    await eliminarHorariosDeAreasRemovidas(Number(id), areasFinales);

    // ✅ NUEVO: Guardar horarios automáticos (Zumba/Gerontología)
    await guardarHorariosAutomaticos(
      Number(id),
      areasFinales,
      actividades_geronto_ids || []
    );

    await registrarAudit({
      tabla: 'users',
      registro_id: Number(id),
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

    const userId = parseInt(id as string);

    // Antes de borrar, nos fijamos si tiene algo vinculado que la base de
    // datos no dejaría eliminar de todas formas (citas, pacientes, notas,
    // etc.) — así devolvemos un mensaje claro en vez de un error genérico de
    // "constraint violation", y le decimos al admin que use "Desactivar" en
    // su lugar (que no pierde nada del historial).
    const vinculos: { etiqueta: string; sql: string }[] = [
      { etiqueta: 'citas', sql: 'SELECT 1 FROM appointments WHERE professional_id = $1 LIMIT 1' },
      { etiqueta: 'cursos/bloqueos de agenda', sql: 'SELECT 1 FROM bloqueos_agenda WHERE professional_id = $1 LIMIT 1' },
      { etiqueta: 'sesiones grupales', sql: 'SELECT 1 FROM sesiones_grupales WHERE professional_id = $1 LIMIT 1' },
      { etiqueta: 'reservas del sitio web', sql: 'SELECT 1 FROM reservas_publicas WHERE professional_id = $1 LIMIT 1' },
      { etiqueta: 'notas', sql: 'SELECT 1 FROM notas WHERE autor_id = $1 UNION ALL SELECT 1 FROM notas_destinatarios WHERE user_id = $1 LIMIT 1' },
      { etiqueta: 'pacientes registrados por este usuario', sql: 'SELECT 1 FROM patients WHERE created_by = $1 OR updated_by = $1 LIMIT 1' },
      { etiqueta: 'participantes de gerontología', sql: 'SELECT 1 FROM geronto_participants WHERE created_by = $1 OR updated_by = $1 LIMIT 1' },
      { etiqueta: 'participantes de zumba', sql: 'SELECT 1 FROM zumba_participants WHERE created_by = $1 OR updated_by = $1 LIMIT 1' },
    ];
    const encontrados: string[] = [];
    for (const v of vinculos) {
      const r = await pool.query(v.sql, [userId]);
      if (r.rows.length > 0) encontrados.push(v.etiqueta);
    }
    if (encontrados.length > 0) {
      res.status(409).json({
        ok: false,
        mensaje: `No se puede eliminar: este usuario tiene ${encontrados.join(', ')} vinculados. Usa "Desactivar" en su lugar — así se mantiene todo su historial pero deja de aparecer disponible.`,
      });
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
      `SELECT 
        id, 
        area_id,
        dia, 
        hora_inicio::text, 
        hora_fin::text, 
        COALESCE(slot_minutos, 60) as slot_minutos
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

    // ✅ VALIDAR area_id
    for (const h of horarios) {
      if (!h.area_id) {
        res.status(400).json({ 
          ok: false, 
          mensaje: 'Cada horario debe tener un área asociada' 
        });
        return;
      }
    }

    await pool.query('DELETE FROM availability WHERE user_id = $1', [id]);

    for (const h of horarios) {
      await pool.query(
        `INSERT INTO availability (user_id, area_id, dia, hora_inicio, hora_fin, slot_minutos)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, h.area_id, h.dia, h.hora_inicio, h.hora_fin, h.slot_minutos || 60]
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

// PUT /api/users/:userId/servicios/:servicioId/visibilidad
// Muestra u oculta a ESTE profesional puntual dentro de un servicio en el sitio público,
// sin afectar si puede seguir agendándose internamente desde Agenda (eso lo sigue
// controlando la asignación en user_servicios, no este flag).
export async function actualizarVisibilidadServicioProfesional(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { userId, servicioId } = req.params;
    const { visible_publico } = req.body;

    const resultado = await pool.query(
      `UPDATE user_servicios SET visible_publico = $1
       WHERE user_id = $2 AND servicio_id = $3
       RETURNING id`,
      [!!visible_publico, userId, servicioId]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Asignación de servicio no encontrada' });
      return;
    }

    await registrarAudit({
      tabla: 'user_servicios',
      registro_id: resultado.rows[0].id,
      accion: 'editar',
      datos_despues: { user_id: userId, servicio_id: servicioId, visible_publico: !!visible_publico },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Visibilidad actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar visibilidad de servicio del profesional:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar la visibilidad' });
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
        u.carnet,
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
        EXTRACT(YEAR FROM AGE(u.fecha_nac)) as edad,
        TO_CHAR(u.fecha_nac, 'DD/MM') as cumple_dia_mes,
                COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('id', ua.area_id, 'nombre', ua2.nombre))
          FILTER (WHERE ua.area_id IS NOT NULL), '[]'
        ) as areas,  -- ← ESTE ES EL ARRAY DE TODAS LAS ÁREAS
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object(
            'id', ga.id,
            'nombre', ga.nombre,
            'dia', ga.dia,
            'hora_inicio', ga.hora_inicio,
            'hora_fin', ga.hora_fin,
            'precio', ga.precio
          ))
          FILTER (WHERE ga.id IS NOT NULL), '[]'
        ) as actividades_geronto,
        COALESCE(
          JSON_AGG(DISTINCT us.servicio_id) FILTER (WHERE us.servicio_id IS NOT NULL), '[]'
        ) as servicios_ids,
        COALESCE(
          JSON_AGG(DISTINCT jsonb_build_object('servicio_id', us.servicio_id, 'visible_publico', us.visible_publico))
          FILTER (WHERE us.servicio_id IS NOT NULL), '[]'
        ) as servicios_publico
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       LEFT JOIN user_areas ua ON ua.user_id = u.id
       LEFT JOIN areas ua2 ON ua2.id = ua.area_id
       LEFT JOIN user_geronto_activities uga ON uga.user_id = u.id
       LEFT JOIN geronto_activities ga ON ga.id = uga.activity_id AND ga.activo = true
       LEFT JOIN user_servicios us ON us.user_id = u.id
       WHERE (
  r.nombre IN ('profesional', 'supervisor')
  OR (r.nombre = 'administrador' AND ua.area_id IS NOT NULL)
)
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
      // ✅ MODIFICADO: Incluir area_id
      `SELECT
        av.id, 
        av.area_id,                  -- ✅ NUEVO
        av.dia, 
        av.hora_inicio::text, 
        av.hora_fin::text,
        COALESCE(av.slot_minutos, 60) as slot_minutos,
        u.id as user_id, 
        u.nombre as profesional_nombre,
        a.nombre as area_nombre
       FROM availability av
       JOIN users u ON av.user_id = u.id
       LEFT JOIN areas a ON av.area_id = a.id  -- ✅ NUEVO: join con areas
       ORDER BY u.nombre, av.dia, av.hora_inicio`
    );
    res.json({ ok: true, horarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener todos los horarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener horarios' });
  }
}

// PUT /api/users/me/perfil — el propio usuario logueado actualiza sus datos
// personales (no rol, áreas ni servicios: eso lo sigue manejando solo el
// administrador desde /api/users/:id).
export async function actualizarMiPerfil(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const id = req.usuario!.id;
    const { nombre, email, telefono, carnet, especialidad, fecha_nac } = req.body;

    const resultado = await pool.query(
      `UPDATE users SET
        nombre       = COALESCE($1, nombre),
        email        = COALESCE($2, email),
        telefono     = COALESCE($3, telefono),
        carnet       = COALESCE($4, carnet),
        especialidad = COALESCE($5, especialidad),
        fecha_nac    = COALESCE($6, fecha_nac),
        updated_at   = NOW(),
        updated_by   = $7
       WHERE id = $7
       RETURNING id`,
      [nombre, email, telefono, carnet, especialidad, fecha_nac || null, id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'users',
      registro_id: id,
      accion: 'editar',
      datos_despues: { nombre, email, telefono, carnet, especialidad, fecha_nac },
      user_id: id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Perfil actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar perfil propio:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar el perfil' });
  }
}

// PUT /api/users/me/password — el propio usuario cambia su contraseña,
// verificando primero la contraseña actual.
export async function cambiarMiPassword(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const id = req.usuario!.id;
    const { password_actual, password_nueva } = req.body;

    if (!password_actual || !password_nueva) {
      res.status(400).json({ ok: false, mensaje: 'Debes indicar la contraseña actual y la nueva' });
      return;
    }
    if (password_nueva.length < 6) {
      res.status(400).json({ ok: false, mensaje: 'La nueva contraseña debe tener al menos 6 caracteres' });
      return;
    }

    const resultado = await pool.query('SELECT password FROM users WHERE id = $1', [id]);
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      return;
    }

    const passwordValida = await bcrypt.compare(password_actual, resultado.rows[0].password);
    if (!passwordValida) {
      res.status(401).json({ ok: false, mensaje: 'La contraseña actual es incorrecta' });
      return;
    }

    const hash = await bcrypt.hash(password_nueva, 10);
    await pool.query('UPDATE users SET password = $1, updated_at = NOW(), updated_by = $2 WHERE id = $2', [hash, id]);

    await registrarAudit({
      tabla: 'users',
      registro_id: id,
      accion: 'editar',
      datos_despues: { cambio: 'password' },
      user_id: id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error al cambiar la contraseña:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al cambiar la contraseña' });
  }
}

// GET /api/users/lista-basica — accesible a CUALQUIER usuario autenticado
// (no solo administrador/supervisor): solo id, nombre y rol, para poder
// elegir a quién dirigir una nota. No expone datos sensibles.
export async function getUsuariosListaBasica(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, r.nombre as rol
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.activo IS NOT FALSE AND u.id != $1
       ORDER BY r.nombre, u.nombre`,
      [req.usuario!.id]
    );
    res.json({ ok: true, usuarios: resultado.rows });
  } catch (error) {
    console.error('Error al obtener lista básica de usuarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener usuarios' });
  }
}