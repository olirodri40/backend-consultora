import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';
import { rutaPublicaSettings, eliminarArchivoLocal } from '../services/storage.service';

// GET /api/site-settings  (admin)
export async function getSettingsAdmin(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query('SELECT * FROM site_settings WHERE id = 1');
    res.json({ ok: true, settings: resultado.rows[0] || null });
  } catch (error) {
    console.error('Error al obtener configuracion del sitio:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener la configuracion' });
  }
}

// GET /api/site-settings/public  (sin auth — sitio web público)
export async function getSettingsPublicos(
  _req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query('SELECT * FROM site_settings WHERE id = 1');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, settings: resultado.rows[0] || null });
  } catch (error) {
    console.error('Error al obtener configuracion publica:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener la configuracion' });
  }
}

// PUT /api/site-settings  (admin) — siempre actualiza la fila id=1, nunca crea otra
export async function actualizarSettings(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      ciudad_pais,
      sede_nombre,
      direccion_linea1,
      direccion_linea2,
      telefono_principal,
      telefono_secundario,
      whatsapp,
      whatsapp_grupo_url,
      email_contacto,
      horario_texto,
      mapa_embed_url,
      edificio_detalle,
      edificio_referencia,
    } = req.body;

    const actual = await pool.query('SELECT * FROM site_settings WHERE id = 1');
    if (actual.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'No existe configuracion inicial. Corre la migracion 005.' });
      return;
    }

    let imagenUrl: string | null = actual.rows[0].imagen_edificio_url;
    if (req.file) {
      eliminarArchivoLocal(imagenUrl);
      imagenUrl = rutaPublicaSettings(req.file.filename);
    }

    const resultado = await pool.query(
      `UPDATE site_settings SET
        ciudad_pais         = COALESCE($1, ciudad_pais),
        sede_nombre         = COALESCE($2, sede_nombre),
        direccion_linea1    = COALESCE($3, direccion_linea1),
        direccion_linea2    = COALESCE($4, direccion_linea2),
        telefono_principal  = COALESCE($5, telefono_principal),
        telefono_secundario = COALESCE($6, telefono_secundario),
        whatsapp            = COALESCE($7, whatsapp),
        whatsapp_grupo_url  = COALESCE($8, whatsapp_grupo_url),
        email_contacto      = COALESCE($9, email_contacto),
        horario_texto       = COALESCE($10, horario_texto),
        mapa_embed_url      = COALESCE($11, mapa_embed_url),
        edificio_detalle    = COALESCE($12, edificio_detalle),
        edificio_referencia = COALESCE($13, edificio_referencia),
        imagen_edificio_url = $14,
        updated_at          = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        ciudad_pais ?? null,
        sede_nombre ?? null,
        direccion_linea1 ?? null,
        direccion_linea2 ?? null,
        telefono_principal ?? null,
        telefono_secundario ?? null,
        whatsapp ?? null,
        whatsapp_grupo_url ?? null,
        email_contacto ?? null,
        horario_texto ?? null,
        mapa_embed_url ?? null,
        edificio_detalle ?? null,
        edificio_referencia ?? null,
        imagenUrl,
      ]
    );

    const settingsActualizados = resultado.rows[0];

    await registrarAudit({
      tabla: 'site_settings',
      registro_id: 1,
      accion: 'editar',
      datos_despues: settingsActualizados,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Configuracion actualizada correctamente', settings: settingsActualizados });
  } catch (error) {
    console.error('Error al actualizar configuracion del sitio:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar la configuracion' });
  }
}