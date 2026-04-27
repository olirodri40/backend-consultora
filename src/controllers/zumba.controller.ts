import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

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
        c.id            as ciclo_id,
        c.numero_ciclo,
        c.fecha_inicio,
        c.clases_pagadas,
        c.monto,
        c.metodo_pago,
        c.estado        as ciclo_estado,
        COUNT(a.id) FILTER (WHERE a.estado = 'asistio')   as clases_asistidas,
        COUNT(a.id) FILTER (WHERE a.estado = 'falta')     as clases_falta,
        COUNT(a.id) FILTER (WHERE a.estado = 'permiso')   as clases_permiso
       FROM zumba_participants p
       LEFT JOIN zumba_cycles c ON c.participant_id = p.id AND c.estado = 'activo'
       LEFT JOIN zumba_attendance a ON a.cycle_id = c.id
       WHERE p.activo = true
       GROUP BY p.id, c.id
       ORDER BY p.nombre`
    );

    res.json({ ok: true, participantes: resultado.rows });
  } catch (error) {
    console.error('Error al obtener participantes zumba:', error);
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
      fecha_inicio, clases_pagadas, monto, metodo_pago
    } = req.body;

    if (!nombre || !fecha_inicio || !monto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Nombre, fecha de inicio y monto son obligatorios'
      });
      return;
    }

    const participante = await pool.query(
      `INSERT INTO zumba_participants (nombre, carnet, telefono, fecha_nac)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [nombre, carnet || null, telefono || null, fecha_nac || null]
    );

    const pid = participante.rows[0].id;

    await pool.query(
      `INSERT INTO zumba_cycles
        (participant_id, numero_ciclo, fecha_inicio, clases_pagadas, monto, metodo_pago)
       VALUES ($1, 1, $2, $3, $4, $5)`,
      [pid, fecha_inicio, clases_pagadas || 8, monto, metodo_pago || 'efectivo']
    );

    res.status(201).json({
      ok: true,
      mensaje: 'Participante inscrito correctamente',
      id: pid
    });
  } catch (error) {
    console.error('Error al crear participante:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear participante' });
  }
}

export async function renovarCiclo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { fecha_inicio, monto, metodo_pago, clases_pagadas } = req.body;

    if (!fecha_inicio || !monto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Fecha de inicio y monto son obligatorios'
      });
      return;
    }

    await pool.query(
      `UPDATE zumba_cycles SET estado = 'completado'
       WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    const ultimoCiclo = await pool.query(
      `SELECT MAX(numero_ciclo) as ultimo
       FROM zumba_cycles WHERE participant_id = $1`,
      [id]
    );

    const nuevoCiclo = (ultimoCiclo.rows[0].ultimo || 0) + 1;

    await pool.query(
      `INSERT INTO zumba_cycles
        (participant_id, numero_ciclo, fecha_inicio, clases_pagadas, monto, metodo_pago)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, nuevoCiclo, fecha_inicio, clases_pagadas || 8, monto, metodo_pago || 'efectivo']
    );

    res.json({
      ok: true,
      mensaje: `Ciclo ${nuevoCiclo} iniciado correctamente`
    });
  } catch (error) {
    console.error('Error al renovar ciclo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al renovar ciclo' });
  }
}

export async function marcarAsistencia(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { participant_id, cycle_id, fecha, estado } = req.body;

    if (!participant_id || !cycle_id || !fecha || !estado) {
      res.status(400).json({
        ok: false,
        mensaje: 'participant_id, cycle_id, fecha y estado son obligatorios'
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
      `INSERT INTO zumba_attendance (participant_id, cycle_id, fecha, estado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (participant_id, cycle_id, fecha)
       DO UPDATE SET estado = $4`,
      [participant_id, cycle_id, fecha, estado]
    );

    res.json({ ok: true, mensaje: 'Asistencia registrada correctamente' });
  } catch (error) {
    console.error('Error al marcar asistencia:', error);
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
        p.nombre as participante_nombre,
        p.id     as participant_id
       FROM zumba_attendance a
       JOIN zumba_participants p ON a.participant_id = p.id
       WHERE a.cycle_id = $1
       ORDER BY a.fecha, p.nombre`,
      [cycle_id]
    );

    res.json({ ok: true, asistencia: resultado.rows });
  } catch (error) {
    console.error('Error al obtener asistencia:', error);
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
      'UPDATE zumba_participants SET activo = false WHERE id = $1',
      [id]
    );

    res.json({ ok: true, mensaje: 'Participante desactivado correctamente' });
  } catch (error) {
    console.error('Error al eliminar participante:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar participante' });
  }
}
export async function editarParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, carnet, telefono, fecha_nac, fecha_inicio, clases_pagadas, monto, metodo_pago } = req.body;

    await pool.query(
      `UPDATE zumba_participants SET
        nombre    = COALESCE($1, nombre),
        carnet    = COALESCE($2, carnet),
        telefono  = COALESCE($3, telefono),
        fecha_nac = COALESCE($4, fecha_nac)
       WHERE id = $5`,
      [nombre, carnet || null, telefono || null, fecha_nac || null, id]
    );

    const cicloActivo = await pool.query(
      `SELECT id FROM zumba_cycles WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    if (cicloActivo.rows.length > 0) {
      const cid = cicloActivo.rows[0].id;
      await pool.query(
        `UPDATE zumba_cycles SET
          fecha_inicio   = COALESCE($1, fecha_inicio),
          clases_pagadas = COALESCE($2, clases_pagadas),
          monto          = COALESCE($3, monto),
          metodo_pago    = COALESCE($4, metodo_pago)
         WHERE id = $5`,
        [fecha_inicio || null, clases_pagadas || null, monto || null, metodo_pago || null, cid]
      );
    }

    res.json({ ok: true, mensaje: 'Participante actualizado correctamente' });
  } catch (error) {
    console.error('Error al editar participante zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al editar participante' });
  }
}