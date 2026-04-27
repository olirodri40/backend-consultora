import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

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

export async function getParticipantes(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
 const resultado = await pool.query(
  `SELECT
    p.id,
    p.nombre,
    p.carnet,
    p.telefono,
    p.fecha_nac,
    p.activo,
    c.id           as ciclo_id,
    c.numero_ciclo,
    c.fecha_inicio,
    c.monto,
    c.metodo_pago,
    c.estado       as ciclo_estado,
    ARRAY_AGG(DISTINCT ca.activity_id) FILTER (WHERE ca.activity_id IS NOT NULL) as actividades_ids,
    COUNT(DISTINCT ca.activity_id) FILTER (WHERE ca.activity_id IS NOT NULL) as total_actividades,
    (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'asistio')    as clases_asistidas,
    (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'falta')      as clases_falta,
    (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'permiso')    as clases_permiso,
    (SELECT COUNT(*) FROM geronto_attendance ga WHERE ga.participant_id = p.id AND ga.cycle_id = c.id AND ga.estado = 'suspendida') as clases_suspendida,
    JSON_OBJECT_AGG(
      DISTINCT ca.activity_id,
      (SELECT COUNT(*) FROM geronto_attendance ga
       WHERE ga.participant_id = p.id
       AND ga.cycle_id = c.id
       AND ga.activity_id = ca.activity_id
       AND ga.estado = 'asistio')
    ) FILTER (WHERE ca.activity_id IS NOT NULL) as asistencia_por_actividad
   FROM geronto_participants p
   LEFT JOIN geronto_cycles c ON c.participant_id = p.id AND c.estado = 'activo'
   LEFT JOIN geronto_cycle_activities ca ON ca.cycle_id = c.id
   WHERE p.activo = true
   GROUP BY p.id, c.id
   ORDER BY p.nombre`
);
    res.json({ ok: true, participantes: resultado.rows });
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
      fecha_inicio, actividades_ids, monto, metodo_pago
    } = req.body;

    if (!nombre || !fecha_inicio || !monto || !actividades_ids?.length) {
      res.status(400).json({
        ok: false,
        mensaje: 'Nombre, fecha inicio, monto y actividades son obligatorios'
      });
      return;
    }

    const participante = await pool.query(
      `INSERT INTO geronto_participants (nombre, carnet, telefono, fecha_nac)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [nombre, carnet || null, telefono || null, fecha_nac || null]
    );

    const pid = participante.rows[0].id;

    const ciclo = await pool.query(
      `INSERT INTO geronto_cycles
        (participant_id, numero_ciclo, fecha_inicio, monto, metodo_pago)
       VALUES ($1, 1, $2, $3, $4) RETURNING id`,
      [pid, fecha_inicio, monto, metodo_pago || 'efectivo']
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
    const { fecha_inicio, monto, metodo_pago, actividades_ids } = req.body;

    if (!fecha_inicio || !monto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Fecha de inicio y monto son obligatorios'
      });
      return;
    }

    await pool.query(
      `UPDATE geronto_cycles SET estado = 'completado'
       WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    const ultimoCiclo = await pool.query(
      `SELECT MAX(numero_ciclo) as ultimo
       FROM geronto_cycles WHERE participant_id = $1`,
      [id]
    );

    const nuevoCiclo = (ultimoCiclo.rows[0].ultimo || 0) + 1;

    const ciclo = await pool.query(
      `INSERT INTO geronto_cycles
        (participant_id, numero_ciclo, fecha_inicio, monto, metodo_pago)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, nuevoCiclo, fecha_inicio, monto, metodo_pago || 'efectivo']
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
    const { nombre, carnet, telefono, fecha_nac, actividades_ids, fecha_inicio, monto, metodo_pago } = req.body;

    await pool.query(
      `UPDATE geronto_participants SET
        nombre    = COALESCE($1, nombre),
        carnet    = COALESCE($2, carnet),
        telefono  = COALESCE($3, telefono),
        fecha_nac = COALESCE($4, fecha_nac)
       WHERE id = $5`,
      [nombre, carnet || null, telefono || null, fecha_nac || null, id]
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