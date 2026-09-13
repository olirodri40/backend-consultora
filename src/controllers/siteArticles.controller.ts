import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';
import { subirArchivoArticulo, eliminarArchivo } from '../services/storage.service';

const CATEGORIAS_VALIDAS = ['Fisioterapia', 'Medicina', 'Psicología'];

// GET /api/site-articles  (admin — todos, activos e inactivos)
export async function getArticulosAdmin(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT * FROM site_articles ORDER BY publicado_en DESC, id DESC`
    );
    res.json({ ok: true, items: resultado.rows });
  } catch (error) {
    console.error('Error al obtener articulos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener los articulos' });
  }
}

// GET /api/site-articles/public?limit=3  (sin auth — sitio web público)
export async function getArticulosPublicos(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const limite = req.query.limit ? parseInt(req.query.limit as string) : null;

    const resultado = await pool.query(
      `SELECT id, titulo, descripcion, contenido, categoria, imagen_url, publicado_en
       FROM site_articles
       WHERE activo = true
       ORDER BY publicado_en DESC, id DESC
       ${limite ? 'LIMIT $1' : ''}`,
      limite ? [limite] : []
    );

    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, items: resultado.rows });
  } catch (error) {
    console.error('Error al obtener articulos publicos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener los articulos' });
  }
}

// POST /api/site-articles  (admin)
export async function crearArticulo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { titulo, descripcion, contenido, categoria, publicado_en, orden } = req.body;

    if (!titulo || !descripcion || !contenido) {
      res.status(400).json({ ok: false, mensaje: 'Titulo, descripcion y contenido son obligatorios' });
      return;
    }
    if (!categoria || !CATEGORIAS_VALIDAS.includes(categoria)) {
      res.status(400).json({ ok: false, mensaje: 'Categoria invalida' });
      return;
    }

    const imagenUrl = req.file ? await subirArchivoArticulo(req.file) : null;

    const resultado = await pool.query(
      `INSERT INTO site_articles (titulo, descripcion, contenido, categoria, imagen_url, publicado_en, orden, activo, creado_por)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, true, $8)
       RETURNING *`,
      [
        titulo,
        descripcion,
        contenido,
        categoria,
        imagenUrl,
        publicado_en || null,
        orden !== undefined ? Number(orden) : 0,
        req.usuario!.id,
      ]
    );

    const nuevoArticulo = resultado.rows[0];

    await registrarAudit({
      tabla: 'site_articles',
      registro_id: nuevoArticulo.id,
      accion: 'crear',
      datos_despues: nuevoArticulo,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Articulo creado correctamente', item: nuevoArticulo });
  } catch (error) {
    console.error('Error al crear articulo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear el articulo' });
  }
}

// PUT /api/site-articles/:id  (admin)
export async function actualizarArticulo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { titulo, descripcion, contenido, categoria, publicado_en, activo, orden } = req.body;

    const actual = await pool.query('SELECT * FROM site_articles WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Articulo no encontrado' });
      return;
    }

    if (categoria && !CATEGORIAS_VALIDAS.includes(categoria)) {
      res.status(400).json({ ok: false, mensaje: 'Categoria invalida' });
      return;
    }

    // Si viene una imagen nueva, reemplaza la anterior y borra la vieja del disco
    let imagenUrl: string | null = actual.rows[0].imagen_url;
    if (req.file) {
      await eliminarArchivo(imagenUrl);
      imagenUrl = await subirArchivoArticulo(req.file);
    }

    // FormData siempre manda strings; usamos null (no undefined) para
    // que COALESCE conserve el valor existente cuando no vino el campo.
    const activoVal = activo !== undefined ? (activo === 'true' || activo === true) : null;
    const ordenVal = orden !== undefined ? Number(orden) : null;

    const resultado = await pool.query(
      `UPDATE site_articles SET
        titulo       = COALESCE($1, titulo),
        descripcion  = COALESCE($2, descripcion),
        contenido    = COALESCE($3, contenido),
        categoria    = COALESCE($4, categoria),
        publicado_en = COALESCE($5, publicado_en),
        activo       = COALESCE($6, activo),
        orden        = COALESCE($7, orden),
        imagen_url   = $8,
        updated_at   = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        titulo ?? null,
        descripcion ?? null,
        contenido ?? null,
        categoria ?? null,
        publicado_en ?? null,
        activoVal,
        ordenVal,
        imagenUrl,
        id,
      ]
    );

    const articuloActualizado = resultado.rows[0];

    await registrarAudit({
      tabla: 'site_articles',
      registro_id: parseInt(id as string),
      accion: 'editar',
      datos_despues: articuloActualizado,
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Articulo actualizado correctamente', item: articuloActualizado });
  } catch (error) {
    console.error('Error al actualizar articulo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar el articulo' });
  }
}

// DELETE /api/site-articles/:id  (admin)
export async function eliminarArticulo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      'DELETE FROM site_articles WHERE id = $1 RETURNING *',
      [id]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Articulo no encontrado' });
      return;
    }

    await eliminarArchivo(resultado.rows[0].imagen_url);

    await registrarAudit({
      tabla: 'site_articles',
      registro_id: parseInt(id as string),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Articulo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar articulo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el articulo' });
  }
}