import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';
import { rutaPublicaArchivo, eliminarArchivoLocal } from '../services/storage.service';

// Con multer ya instalado, RequestConUsuario (que extiende Request de Express)
// ya trae "file" automáticamente — no hace falta ningún tipo extra.
const TIPOS_CON_ARCHIVO = ['imagen', 'video', 'hero'];
const TIPOS_VALIDOS = [
  'imagen', 'video', 'youtube', 'shorts', 'tiktok', 'reel', 'facebook', 'instagram', 'hero',
];

// GET /api/site-gallery  (admin — todos los items, activos e inactivos)
export async function getGaleriaAdmin(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT * FROM site_gallery_items ORDER BY tipo, orden, id`
    );
    res.json({ ok: true, items: resultado.rows });
  } catch (error) {
    console.error('Error al obtener galeria:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener la galeria' });
  }
}

// GET /api/site-gallery/public  (sin auth — la consume el sitio web público)
export async function getGaleriaPublica(
  _req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT id, tipo, archivo_url, enlace_url, titulo, descripcion
       FROM site_gallery_items
       WHERE activo = true
       ORDER BY tipo, orden, id`
    );
    // Sin cache: como el admin puede editar en cualquier momento, priorizamos
    // que el sitio público siempre muestre lo último por sobre ahorrar
    // una consulta (la consulta ya es rápida gracias al índice).
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, items: resultado.rows });
  } catch (error) {
    console.error('Error al obtener galeria publica:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener la galeria' });
  }
}

// POST /api/site-gallery  (admin)
export async function crearItemGaleria(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { tipo, titulo, descripcion, enlace_url, orden } = req.body;

    if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
      res.status(400).json({ ok: false, mensaje: 'Tipo de contenido invalido' });
      return;
    }
    if (!titulo) {
      res.status(400).json({ ok: false, mensaje: 'El titulo es obligatorio' });
      return;
    }

    let archivoUrl: string | null = null;
    if (TIPOS_CON_ARCHIVO.includes(tipo)) {
      if (!req.file) {
        res.status(400).json({ ok: false, mensaje: 'Debes subir un archivo para este tipo de contenido' });
        return;
      }
      archivoUrl = rutaPublicaArchivo(req.file.filename);
    } else if (!enlace_url) {
      res.status(400).json({ ok: false, mensaje: 'Debes proporcionar un enlace para este tipo de contenido' });
      return;
    }

    const resultado = await pool.query(
      `INSERT INTO site_gallery_items (tipo, archivo_url, enlace_url, titulo, descripcion, orden, activo, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING *`,
      [
        tipo,
        archivoUrl,
        enlace_url || null,
        titulo,
        descripcion || null,
        orden !== undefined ? Number(orden) : 0,
        req.usuario!.id,
      ]
    );

    const nuevoItem = resultado.rows[0];

    await registrarAudit({
      tabla: 'site_gallery_items',
      registro_id: nuevoItem.id,
      accion: 'crear',
      datos_despues: nuevoItem,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Elemento creado correctamente', item: nuevoItem });
  } catch (error) {
    console.error('Error al crear item de galeria:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear el elemento' });
  }
}

// PUT /api/site-gallery/:id  (admin)
export async function actualizarItemGaleria(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { titulo, descripcion, enlace_url, activo, orden } = req.body;

    const actual = await pool.query('SELECT * FROM site_gallery_items WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Elemento no encontrado' });
      return;
    }

    // Si viene un archivo nuevo, reemplaza el anterior y borra el viejo del disco
    let archivoUrl: string | null = actual.rows[0].archivo_url;
    if (req.file) {
      eliminarArchivoLocal(archivoUrl);
      archivoUrl = rutaPublicaArchivo(req.file.filename);
    }

    // FormData siempre manda strings; convertimos con cuidado y usamos
    // null (no undefined) para que COALESCE conserve el valor existente.
    const tituloVal = titulo !== undefined ? titulo : null;
    const descripcionVal = descripcion !== undefined ? descripcion : null;
    const enlaceVal = enlace_url !== undefined ? enlace_url : null;
    const activoVal = activo !== undefined ? (activo === 'true' || activo === true) : null;
    const ordenVal = orden !== undefined ? Number(orden) : null;

    const resultado = await pool.query(
      `UPDATE site_gallery_items SET
        titulo      = COALESCE($1, titulo),
        descripcion = COALESCE($2, descripcion),
        enlace_url  = COALESCE($3, enlace_url),
        activo      = COALESCE($4, activo),
        orden       = COALESCE($5, orden),
        archivo_url = $6,
        updated_at  = NOW()
       WHERE id = $7
       RETURNING *`,
      [tituloVal, descripcionVal, enlaceVal, activoVal, ordenVal, archivoUrl, id]
    );

    const itemActualizado = resultado.rows[0];

    await registrarAudit({
      tabla: 'site_gallery_items',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: itemActualizado,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Elemento actualizado correctamente', item: itemActualizado });
  } catch (error) {
    console.error('Error al actualizar item de galeria:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar el elemento' });
  }
}

// DELETE /api/site-gallery/:id  (admin)
export async function eliminarItemGaleria(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      'DELETE FROM site_gallery_items WHERE id = $1 RETURNING *',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Elemento no encontrado' });
      return;
    }

    eliminarArchivoLocal(resultado.rows[0].archivo_url);

    await registrarAudit({
      tabla: 'site_gallery_items',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Elemento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar item de galeria:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el elemento' });
  }
}