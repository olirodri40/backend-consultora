import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import webpush from '../db/webpush';
export async function suscribir(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ ok: false, mensaje: 'Suscripción inválida' });
      return;
    }

    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = $1, p256dh = $3, auth = $4`,
      [req.usuario!.id, endpoint, keys.p256dh, keys.auth]
    );

    res.json({ ok: true, mensaje: 'Suscripción guardada' });
  } catch (error) {
    console.error('Error al suscribir:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al suscribir' });
  }
}

export async function desuscribir(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ ok: false, mensaje: 'Endpoint requerido' });
      return;
    }
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    res.json({ ok: true, mensaje: 'Suscripción eliminada' });
  } catch (error) {
    console.error('Error al desuscribir:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al desuscribir' });
  }
}

export async function getVapidPublicKey(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  res.json({ ok: true, publicKey: process.env.VAPID_PUBLIC_KEY });
}

export async function enviarPrueba(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const subs = await pool.query(
      `SELECT * FROM push_subscriptions WHERE user_id = $1`,
      [req.usuario!.id]
    );

    if (subs.rows.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'No tienes ninguna suscripción activa' });
      return;
    }

    for (const sub of subs.rows) {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: '🔔 Prueba', body: 'Si ves esto, las notificaciones funcionan', url: '/' })
      );
    }

    res.json({ ok: true, mensaje: 'Notificación de prueba enviada' });
  } catch (error: any) {
    console.error('Error en prueba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al enviar prueba' });
  }
}