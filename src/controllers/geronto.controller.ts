import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { HOY_SQL } from '../utils/tiempo';

export async function getActividades(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT * FROM geronto_activities WHERE activo = true ORDER BY dia, hora_inicio`
    );
    res.json({ ok: true, actividades: resultado.rows });
  } catch (error) {
    console.error('Error al obtener actividades:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener actividades' });
  }
}

export async function getParticipantesConFiltro(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { anio } = req.query;
    const anioParam = anio ? parseInt(anio as string) : null;
    
    // 👇 Obtener el usuario logueado
    const usuario = req.usuario;
    const esProfesional = usuario?.rol === 'profesional';
    const usuarioId = esProfesional ? usuario.id : null;

    const query = `
      SELECT
        p.id,
        p.nombre,
        p.carnet,
        p.telefono,
        p.fecha_nac,
        p.contacto_relacion,  
        p.contacto_nombre,   
        p.contacto_telefono,
        p.activo,
        c.id           as ciclo_id,
        c.numero_ciclo,
        c.fecha_inicio,
        c.monto,
        c.metodo_pago,
        COALESCE(c.monto_pagado, 0) as monto_pagado,
        c.estado_pago,
        (c.monto - COALESCE(c.monto_pagado, 0)) as deuda,
        c.estado       as ciclo_estado,
        ARRAY_AGG(DISTINCT ca.activity_id) FILTER (WHERE ca.activity_id IS NOT NULL) as actividades_ids,
        COUNT(DISTINCT ca.activity_id) FILTER (WHERE ca.activity_id IS NOT NULL) as total_actividades,
        (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'asistio')    as clases_asistidas,
        (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'falta')      as clases_falta,
        (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'permiso')    as clases_permiso,
        (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'suspendida') as clases_suspendida,
        COALESCE(
          (SELECT jsonb_object_agg(activity_id, total)
           FROM (
             SELECT ga.activity_id, COUNT(*) as total
             FROM geronto_attendance ga
             WHERE ga.participant_id = p.id
               AND ga.cycle_id = c.id
               AND ga.estado = 'asistio'
             GROUP BY ga.activity_id
           ) subq
          ), '{}'::jsonb
        ) as asistencia_por_actividad,
        COALESCE(
          (SELECT jsonb_object_agg(activity_id, true)
           FROM (
             SELECT DISTINCT ga.activity_id
             FROM geronto_attendance ga
             WHERE ga.participant_id = p.id
               AND ga.cycle_id = c.id
               AND ga.fecha = ${HOY_SQL}
           ) subq
          ), '{}'::jsonb
        ) as marcado_hoy_por_actividad
      FROM geronto_participants p
      LEFT JOIN LATERAL (
        SELECT * FROM geronto_cycles c2
        WHERE c2.participant_id = p.id
          AND ($1::integer IS NULL OR EXTRACT(YEAR FROM c2.fecha_inicio) = $1::integer)
        ORDER BY 
          CASE WHEN c2.estado = 'activo' THEN 0 ELSE 1 END,
          c2.fecha_inicio DESC,
          c2.numero_ciclo DESC
        LIMIT 1
      ) c ON true
      LEFT JOIN geronto_cycle_activities ca ON ca.cycle_id = c.id
      WHERE p.activo = true
        ${esProfesional ? `AND EXISTS (
          SELECT 1 FROM geronto_cycle_activities gca
          JOIN user_geronto_activities uga ON uga.activity_id = gca.activity_id
          WHERE gca.cycle_id = c.id
            AND uga.user_id = $2
        )` : ''}
            GROUP BY 
        p.id, p.nombre, p.carnet, p.telefono, p.fecha_nac,
        p.contacto_relacion, p.contacto_nombre, p.contacto_telefono, p.activo,
        c.id, c.numero_ciclo, c.fecha_inicio, c.monto, c.metodo_pago,
        c.monto_pagado, c.estado_pago, c.estado
      ORDER BY c.id DESC NULLS LAST, p.nombre
    `;

    // 👇 Construir los parámetros dinámicamente
    const queryParams: any[] = [anioParam];
    if (esProfesional) {
      queryParams.push(usuarioId);
    }

    const resultado = await pool.query(query, queryParams);

    const participantes = resultado.rows.map(row => ({
      ...row,
      asistencia_por_actividad: row.asistencia_por_actividad || {},
      marcado_hoy_por_actividad: row.marcado_hoy_por_actividad || {}
    }));

    const aniosResult = await pool.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM fecha_inicio) as anio 
       FROM geronto_cycles 
       ORDER BY anio DESC`
    );
    const aniosDisponibles = aniosResult.rows.map(r => parseInt(r.anio));

    res.json({ 
      ok: true, 
      participantes: participantes,
      anios_disponibles: aniosDisponibles
    });
  } catch (error) {
    console.error('Error al obtener participantes geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener participantes' });
  }
}

export async function crearParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      nombre, carnet, telefono, fecha_nac,
      fecha_inicio, actividades_ids, monto, metodo_pago,
      monto_pagado,  // ← AGREGAR ESTA LÍNEA (extraer del body)
      // ✅ NUEVOS CAMPOS
      contacto_relacion,
      contacto_nombre,
      contacto_telefono,
    } = req.body;

    if (!nombre || !fecha_inicio || !monto || !actividades_ids?.length) {
      res.status(400).json({
        ok: false,
        mensaje: 'Nombre, fecha inicio, monto y actividades son obligatorios'
      });
      return;
    }

    // ✅ Ahora monto_pagado existe
    const participante = await pool.query(
      `INSERT INTO geronto_participants 
        (nombre, carnet, telefono, fecha_nac, contacto_relacion, contacto_nombre, contacto_telefono)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nombre, carnet || null, telefono || null, fecha_nac || null, 
       contacto_relacion || null, contacto_nombre || null, contacto_telefono || null]
    );

    const pid = participante.rows[0].id;

    const montoPagado = monto_pagado !== undefined ? monto_pagado : monto;
    const estado_pago = montoPagado >= monto ? 'pagado' : (montoPagado > 0 ? 'parcial' : 'pendiente');

    const ciclo = await pool.query(
      `INSERT INTO geronto_cycles
        (participant_id, numero_ciclo, fecha_inicio, monto, monto_pagado, estado_pago, metodo_pago, estado)
       VALUES ($1, 1, $2, $3, $4, $5, $6, 'activo') RETURNING id`,
      [pid, fecha_inicio, monto, montoPagado, estado_pago, metodo_pago || 'efectivo']
    );

    const cid = ciclo.rows[0].id;

    for (const actId of actividades_ids) {
      await pool.query(
        `INSERT INTO geronto_cycle_activities (cycle_id, activity_id)
         VALUES ($1, $2)`,
        [cid, actId]
      );
    }

    res.status(201).json({
      ok: true,
      mensaje: 'Participante inscrito correctamente',
      id: pid
    });
  } catch (error) {
    console.error('Error al crear participante geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear participante' });
  }
}

export async function renovarCiclo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { fecha_inicio, monto, monto_pagado, metodo_pago, actividades_ids } = req.body;

    if (!fecha_inicio || !monto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Fecha de inicio y monto son obligatorios'
      });
      return;
    }

    // ✅ Obtener el año de la nueva fecha de inicio
    const nuevoAnio = new Date(fecha_inicio).getFullYear();

    // ✅ Buscar el último ciclo del participante en el MISMO año
    const ultimoCicloMismoAnio = await pool.query(
      `SELECT MAX(numero_ciclo) as ultimo
       FROM geronto_cycles 
       WHERE participant_id = $1 AND EXTRACT(YEAR FROM fecha_inicio) = $2`,
      [id, nuevoAnio]
    );

    // ✅ Si no hay ciclos en este año, empezar desde 1; si hay, sumar 1
    const nuevoCiclo = (ultimoCicloMismoAnio.rows[0].ultimo || 0) + 1;

    // Calcular estado_pago basado en monto_pagado
    const montoPagado = monto_pagado || 0;
    const estado_pago = montoPagado >= monto ? 'pagado' : (montoPagado > 0 ? 'parcial' : 'pendiente');

    // Cerrar el ciclo activo actual (si existe)
    await pool.query(
      `UPDATE geronto_cycles SET estado = 'completado'
       WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    const ciclo = await pool.query(
      `INSERT INTO geronto_cycles
        (participant_id, numero_ciclo, fecha_inicio, monto, monto_pagado, estado_pago, metodo_pago, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo') RETURNING id`,
      [id, nuevoCiclo, fecha_inicio, monto, montoPagado, estado_pago, metodo_pago || 'efectivo']
    );

    const cid = ciclo.rows[0].id;

    if (actividades_ids?.length) {
      for (const actId of actividades_ids) {
        await pool.query(
          `INSERT INTO geronto_cycle_activities (cycle_id, activity_id)
           VALUES ($1, $2)`,
          [cid, actId]
        );
      }
    }

    res.json({
      ok: true,
      mensaje: `Ciclo ${nuevoCiclo} iniciado correctamente`
    });
  } catch (error) {
    console.error('Error al renovar ciclo geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al renovar ciclo' });
  }
}

export async function marcarAsistencia(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { participant_id, cycle_id, activity_id, fecha, estado } = req.body;

    if (!participant_id || !cycle_id || !activity_id || !fecha || !estado) {
      res.status(400).json({
        ok: false,
        mensaje: 'Todos los campos son obligatorios'
      });
      return;
    }

    const estadosValidos = ['asistio', 'falta', 'permiso', 'suspendida'];
    if (!estadosValidos.includes(estado)) {
      res.status(400).json({
        ok: false,
        mensaje: `Estado invalido. Use: ${estadosValidos.join(', ')}`
      });
      return;
    }

    await pool.query(
      `INSERT INTO geronto_attendance
        (participant_id, cycle_id, activity_id, fecha, estado)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (participant_id, cycle_id, activity_id, fecha)
       DO UPDATE SET estado = $5`,
      [participant_id, cycle_id, activity_id, fecha, estado]
    );

    res.json({ ok: true, mensaje: 'Asistencia registrada correctamente' });
  } catch (error) {
    console.error('Error al marcar asistencia geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al marcar asistencia' });
  }
}

export async function getAsistencia(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { cycle_id } = req.params;

    const resultado = await pool.query(
      `SELECT
        a.id,
        a.fecha,
        a.estado,
        a.activity_id,
        act.nombre as actividad_nombre,
        act.emoji  as actividad_emoji,
        p.nombre   as participante_nombre,
        p.id       as participant_id
       FROM geronto_attendance a
       JOIN geronto_participants p  ON a.participant_id = p.id
       JOIN geronto_activities act  ON a.activity_id   = act.id
       WHERE a.cycle_id = $1
       ORDER BY a.fecha, act.nombre, p.nombre`,
      [cycle_id]
    );

    res.json({ ok: true, asistencia: resultado.rows });
  } catch (error) {
    console.error('Error al obtener asistencia geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener asistencia' });
  }
}

export async function eliminarParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    await pool.query(
      'UPDATE geronto_participants SET activo = false WHERE id = $1',
      [id]
    );

    res.json({ ok: true, mensaje: 'Participante desactivado correctamente' });
  } catch (error) {
    console.error('Error al eliminar participante geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar participante' });
  }
}
export async function editarParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { 
      nombre, carnet, telefono, fecha_nac, 
      actividades_ids, fecha_inicio, monto, metodo_pago,
      // ✅ NUEVOS CAMPOS
      contacto_relacion,
      contacto_nombre,
      contacto_telefono,
    } = req.body;

    // ✅ Incluir los nuevos campos en el UPDATE
    await pool.query(
      `UPDATE geronto_participants SET
        nombre    = COALESCE($1, nombre),
        carnet    = COALESCE($2, carnet),
        telefono  = COALESCE($3, telefono),
        fecha_nac = COALESCE($4, fecha_nac),
        contacto_relacion = COALESCE($5, contacto_relacion),
        contacto_nombre   = COALESCE($6, contacto_nombre),
        contacto_telefono = COALESCE($7, contacto_telefono)
       WHERE id = $8`,
      [nombre, carnet || null, telefono || null, fecha_nac || null,
       contacto_relacion || null, contacto_nombre || null, contacto_telefono || null, id]
    );

    const cicloActivo = await pool.query(
      `SELECT id FROM geronto_cycles WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    if (cicloActivo.rows.length > 0) {
      const cid = cicloActivo.rows[0].id;

      if (fecha_inicio || monto || metodo_pago) {
        await pool.query(
          `UPDATE geronto_cycles SET
            fecha_inicio = COALESCE($1, fecha_inicio),
            monto        = COALESCE($2, monto),
            metodo_pago  = COALESCE($3, metodo_pago)
           WHERE id = $4`,
          [fecha_inicio || null, monto || null, metodo_pago || null, cid]
        );
      }

      if (actividades_ids?.length) {
        await pool.query(
          `DELETE FROM geronto_cycle_activities WHERE cycle_id = $1`,
          [cid]
        );
        for (const actId of actividades_ids) {
          await pool.query(
            `INSERT INTO geronto_cycle_activities (cycle_id, activity_id) VALUES ($1, $2)`,
            [cid, actId]
          );
        }
      }
    }

    res.json({ ok: true, mensaje: 'Participante actualizado correctamente' });
  } catch (error) {
    console.error('Error al editar participante geronto:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al editar participante' });
  }
}
export async function getHistorialCiclosGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { anio } = req.query;

    const participanteResult = await pool.query(
      `SELECT id, nombre, carnet, telefono, fecha_nac
       FROM geronto_participants
       WHERE id = $1 AND activo = true`,
      [id]
    );

    if (participanteResult.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Participante no encontrado' });
      return;
    }

    const participante = participanteResult.rows[0];

    let query = `
      SELECT 
        c.id,
        c.numero_ciclo,
        c.fecha_inicio,
        c.monto,
        COALESCE(c.monto_pagado, 0) as monto_pagado,
        c.metodo_pago,
        c.estado_pago,
        c.estado as ciclo_estado,
        (c.monto - COALESCE(c.monto_pagado, 0)) as deuda,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = $1 AND ga.cycle_id = c.id AND ga.estado = 'asistio') as clases_asistidas,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = $1 AND ga.cycle_id = c.id AND ga.estado = 'falta') as clases_falta,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = $1 AND ga.cycle_id = c.id AND ga.estado = 'permiso') as clases_permiso,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = $1 AND ga.cycle_id = c.id AND ga.estado = 'suspendida') as clases_suspendida,
        ARRAY_AGG(DISTINCT ca.activity_id) FILTER (WHERE ca.activity_id IS NOT NULL) as actividades_ids
      FROM geronto_cycles c
      LEFT JOIN geronto_cycle_activities ca ON ca.cycle_id = c.id
      WHERE c.participant_id = $1
    `;

    const queryParams: any[] = [id];

    if (anio) {
      query += ` AND EXTRACT(YEAR FROM c.fecha_inicio) = $2`;
      queryParams.push(anio);
    }

    query += ` GROUP BY c.id ORDER BY c.numero_ciclo DESC`;

    const ciclosResult = await pool.query(query, queryParams);

    res.json({
      ok: true,
      participante,
      ciclos: ciclosResult.rows
    });
  } catch (error) {
    console.error('Error al obtener historial de ciclos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener historial' });
  }
}

export async function actualizarPagoCicloGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { monto_pagado, metodo_pago } = req.body;

    if (monto_pagado === undefined) {
      res.status(400).json({ ok: false, mensaje: 'Monto pagado es requerido' });
      return;
    }

    const cicloResult = await pool.query(
      `SELECT monto, monto_pagado FROM geronto_cycles WHERE id = $1`,
      [id]
    );

    if (cicloResult.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Ciclo no encontrado' });
      return;
    }

    const ciclo = cicloResult.rows[0];
    const nuevoMontoPagado = monto_pagado;
    const montoTotal = parseFloat(ciclo.monto);
    
    let estado_pago = 'pendiente';
    if (nuevoMontoPagado >= montoTotal) {
      estado_pago = 'pagado';
    } else if (nuevoMontoPagado > 0) {
      estado_pago = 'parcial';
    }

    await pool.query(
      `UPDATE geronto_cycles 
       SET monto_pagado = $1, estado_pago = $2, metodo_pago = COALESCE($3, metodo_pago)
       WHERE id = $4`,
      [nuevoMontoPagado, estado_pago, metodo_pago, id]
    );

    res.json({ ok: true, mensaje: 'Pago actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar pago:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar pago' });
  }
}

export async function getReportesGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { anio, numero_ciclo, solo_deudas } = req.query;

    let query = `
      SELECT 
        c.id as ciclo_id,
        p.id as participante_id,
        p.nombre,
        p.telefono,
        p.carnet,
        c.numero_ciclo,
        c.fecha_inicio,
        c.monto,
        COALESCE(c.monto_pagado, 0) as monto_pagado,
        c.estado_pago,
        (c.monto - COALESCE(c.monto_pagado, 0)) as deuda,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'asistio') as clases_asistidas,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'falta') as clases_falta,
        (SELECT COUNT(*) FROM geronto_attendance ga 
         WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'permiso') as clases_permiso
      FROM geronto_cycles c
      JOIN geronto_participants p ON p.id = c.participant_id
      WHERE p.activo = true
    `;

    const queryParams: any[] = [];
    let paramIndex = 1;

    if (anio) {
      query += ` AND EXTRACT(YEAR FROM c.fecha_inicio) = $${paramIndex}`;
      queryParams.push(anio);
      paramIndex++;
    }

    if (numero_ciclo) {
      query += ` AND c.numero_ciclo = $${paramIndex}`;
      queryParams.push(numero_ciclo);
      paramIndex++;
    }

    if (solo_deudas === 'true') {
      query += ` AND c.estado_pago != 'pagado'`;
    }

    query += ` ORDER BY p.nombre, c.numero_ciclo DESC`;

    const reportesResult = await pool.query(query, queryParams);

    const aniosResult = await pool.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM fecha_inicio) as anio 
       FROM geronto_cycles 
       ORDER BY anio DESC`
    );
    const aniosDisponibles = aniosResult.rows.map(r => parseInt(r.anio));

    const maxCicloResult = await pool.query(
      `SELECT MAX(numero_ciclo) as max_ciclo FROM geronto_cycles`
    );
    const maxCiclo = parseInt(maxCicloResult.rows[0].max_ciclo || 0);

    res.json({
      ok: true,
      registros: reportesResult.rows,
      anios_disponibles: aniosDisponibles,
      max_ciclo: maxCiclo
    });
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener reportes' });
  }
}

export async function eliminarAsistenciaGeronto(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { participant_id, cycle_id, activity_id, fecha } = req.body;

    await pool.query(
      `DELETE FROM geronto_attendance 
       WHERE participant_id = $1 
         AND cycle_id = $2 
         AND activity_id = $3 
         AND fecha = $4`,
      [participant_id, cycle_id, activity_id, fecha]
    );

    res.json({ ok: true, mensaje: 'Asistencia eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar asistencia:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar asistencia' });
  }
}

export async function getActividadesConProfesionales(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const query = `
      SELECT 
        ga.id,
        ga.nombre,
        ga.emoji,
        ga.dia,
        ga.hora_inicio,
        ga.hora_fin,
        ga.color,
        ga.precio,
        ga.activo,
        u.id AS profesional_id,
        u.nombre AS profesional_nombre
      FROM geronto_activities ga
      LEFT JOIN user_geronto_activities uga 
        ON uga.activity_id = ga.id
      LEFT JOIN users u 
        ON u.id = uga.user_id 
        AND u.role_id = 3
        AND u.activo = true
      WHERE ga.activo = true
      ORDER BY 
        CASE ga.dia
          WHEN 'Lunes' THEN 1
          WHEN 'Martes' THEN 2
          WHEN 'Miercoles' THEN 3
          WHEN 'Jueves' THEN 4
          WHEN 'Viernes' THEN 5
          WHEN 'Sabado' THEN 6
          WHEN 'Domingo' THEN 7
          ELSE 8
        END,
        ga.hora_inicio
    `;

    const resultado = await pool.query(query);
    
    const actividadesMap = new Map();
    
    resultado.rows.forEach(row => {
      if (!actividadesMap.has(row.id)) {
        actividadesMap.set(row.id, {
          id: row.id,
          nombre: row.nombre,
          emoji: row.emoji || '●',
          dia: row.dia,
          hora_inicio: row.hora_inicio,
          hora_fin: row.hora_fin,
          color: row.color || '#8B5CF6',
          precio: row.precio,
          activo: row.activo,
          profesional: row.profesional_id ? {
            id: row.profesional_id,
            nombre: row.profesional_nombre
          } : null
        });
      }
    });
    
    res.json({
      ok: true,
      actividades: Array.from(actividadesMap.values())
    });
  } catch (error) {
    console.error('Error en getActividadesConProfesionales:', error);
    res.status(500).json({ 
      ok: false, 
      mensaje: 'Error al obtener actividades con profesionales' 
    });
  }
}