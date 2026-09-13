import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

// POST /api/notas
// body: { mensaje, destinatarios_ids?: number[], para_todos?: boolean }
// Cualquier usuario logueado puede crear una nota. Si para_todos es true se
// le manda a todos los usuarios activos (menos al autor); si no, solo a los
// ids indicados en destinatarios_ids.
export async function crearNota(req: RequestConUsuario, res: Response): Promise<void> {
  const client = await pool.connect();
  try {
    const { mensaje, destinatarios_ids, para_todos } = req.body;
    const autorId = req.usuario!.id;

    if (!mensaje || !mensaje.trim()) {
      res.status(400).json({ ok: false, mensaje: 'El mensaje de la nota es obligatorio' });
      return;
    }

    let idsFinal: number[] = [];
    if (para_todos) {
      const activos = await client.query('SELECT id FROM users WHERE activo IS NOT FALSE AND id != $1', [autorId]);
      idsFinal = activos.rows.map(r => r.id);
    } else {
      idsFinal = Array.isArray(destinatarios_ids) ? destinatarios_ids.map(Number).filter(Boolean) : [];
    }

    if (idsFinal.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'Selecciona al menos un destinatario (o marca "Todos")' });
      return;
    }

    await client.query('BEGIN');
    const notaRes = await client.query(
      `INSERT INTO notas (autor_id, mensaje, para_todos) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [autorId, mensaje.trim(), !!para_todos]
    );
    const notaId = notaRes.rows[0].id;

    for (const userId of idsFinal) {
      await client.query(
        `INSERT INTO notas_destinatarios (nota_id, user_id) VALUES ($1, $2)
         ON CONFLICT (nota_id, user_id) DO NOTHING`,
        [notaId, userId]
      );
    }
    await client.query('COMMIT');

    res.status(201).json({ ok: true, mensaje: 'Nota enviada correctamente', id: notaId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al crear nota:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear la nota' });
  } finally {
    client.release();
  }
}

// GET /api/notas/recibidas — notas dirigidas al usuario logueado.
export async function getNotasRecibidas(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT n.id, n.mensaje, n.para_todos, n.created_at,
              u.nombre as autor_nombre, r.nombre as autor_rol,
              nd.leido, nd.atendido, nd.atendido_at
       FROM notas_destinatarios nd
       JOIN notas n ON n.id = nd.nota_id
       JOIN users u ON u.id = n.autor_id
       JOIN roles r ON r.id = u.role_id
       WHERE nd.user_id = $1
       ORDER BY nd.atendido ASC, n.created_at DESC`,
      [req.usuario!.id]
    );
    res.json({ ok: true, notas: resultado.rows });
  } catch (error) {
    console.error('Error al obtener notas recibidas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener las notas' });
  }
}

// GET /api/notas/enviadas — notas creadas por el usuario logueado, con el
// detalle de quién ya la leyó/atendió.
export async function getNotasEnviadas(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT n.id, n.mensaje, n.para_todos, n.created_at,
              COALESCE(
                JSON_AGG(
                  jsonb_build_object(
                    'user_id', u.id, 'nombre', u.nombre, 'rol', r.nombre,
                    'leido', nd.leido, 'atendido', nd.atendido, 'atendido_at', nd.atendido_at
                  ) ORDER BY u.nombre
                ) FILTER (WHERE u.id IS NOT NULL), '[]'
              ) as destinatarios
       FROM notas n
       LEFT JOIN notas_destinatarios nd ON nd.nota_id = n.id
       LEFT JOIN users u ON u.id = nd.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE n.autor_id = $1
       GROUP BY n.id
       ORDER BY n.created_at DESC`,
      [req.usuario!.id]
    );
    res.json({ ok: true, notas: resultado.rows });
  } catch (error) {
    console.error('Error al obtener notas enviadas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener las notas enviadas' });
  }
}

// PUT /api/notas/:id/atender — el destinatario marca su copia como atendida
// (y de paso como leída). body: { atendido?: boolean } — por defecto true,
// para poder también "desmarcarla" si se equivocó.
export async function marcarNotaAtendida(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const atendido = req.body?.atendido !== false;

    const resultado = await pool.query(
      `UPDATE notas_destinatarios
       SET atendido = $1, atendido_at = CASE WHEN $1 THEN NOW() ELSE NULL END, leido = true
       WHERE nota_id = $2 AND user_id = $3
       RETURNING id`,
      [atendido, id, req.usuario!.id]
    );
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Esta nota no está dirigida a ti' });
      return;
    }

    res.json({ ok: true, mensaje: atendido ? 'Nota marcada como atendida' : 'Nota marcada como pendiente' });
  } catch (error) {
    console.error('Error al marcar nota como atendida:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar la nota' });
  }
}

// PUT /api/notas/:id/leido — marca solo como leída (sin atenderla todavía).
export async function marcarNotaLeida(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE notas_destinatarios SET leido = true WHERE nota_id = $1 AND user_id = $2`,
      [id, req.usuario!.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error al marcar nota como leída:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar la nota' });
  }
}

// DELETE /api/notas/:id — solo el autor (o un administrador) puede borrarla.
export async function eliminarNota(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const notaRes = await pool.query('SELECT autor_id FROM notas WHERE id = $1', [id]);
    if (notaRes.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Nota no encontrada' });
      return;
    }
    const esAutor = notaRes.rows[0].autor_id === req.usuario!.id;
    if (!esAutor && req.usuario!.rol !== 'administrador') {
      res.status(403).json({ ok: false, mensaje: 'No puedes eliminar una nota que no escribiste' });
      return;
    }

    await pool.query('DELETE FROM notas WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Nota eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar nota:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar la nota' });
  }
}
