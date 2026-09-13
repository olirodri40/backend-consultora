import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

export async function getNotificaciones(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT id, titulo, cuerpo, url, leido, created_at
       FROM notificaciones
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.usuario!.id]
    );
    const noLeidas = await pool.query(
      `SELECT COUNT(*) as total FROM notificaciones WHERE user_id = $1 AND leido = false`,
      [req.usuario!.id]
    );
    res.json({
      ok: true,
      notificaciones: resultado.rows,
      noLeidas: parseInt(noLeidas.rows[0].total),
    });
  } catch (error) {
    console.error('Error al obtener notificaciones:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener notificaciones' });
  }
}

export async function marcarLeida(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE notificaciones SET leido = true WHERE id = $1 AND user_id = $2`,
      [id, req.usuario!.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error al marcar leida:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al marcar leída' });
  }
}

export async function marcarTodasLeidas(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    await pool.query(
      `UPDATE notificaciones SET leido = true WHERE user_id = $1 AND leido = false`,
      [req.usuario!.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error al marcar todas leidas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al marcar todas' });
  }
}