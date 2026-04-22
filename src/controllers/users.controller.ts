import { Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

export async function getUsuarios(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const resultado = await pool.query(
      `SELECT
        u.id,
        u.nombre,
        u.usuario,
        u.email,
        u.telefono,
        u.especialidad,
        u.tipo_horario,
        u.fecha_nac,
        u.sueldo,
        u.contrato,
        u.fecha_ingreso,
        u.activo,
        u.created_at,
        r.id   as role_id,
        r.nombre as rol,
        a.id   as area_id,
        a.nombre as area_nombre,
        a.emoji  as area_emoji
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
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
        u.id, u.nombre, u.usuario, u.email, u.telefono,
        u.especialidad, u.tipo_horario, u.fecha_nac,
        u.sueldo, u.contrato, u.fecha_ingreso, u.activo,
        r.id as role_id, r.nombre as rol,
        a.id as area_id, a.nombre as area_nombre
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN areas a ON u.area_id = a.id
       WHERE u.id = $1`,
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

export async function crearUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      nombre, usuario, password, email, telefono,
      role_id, area_id, especialidad, tipo_horario,
      fecha_nac, sueldo, contrato, fecha_ingreso
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
      res.status(409).json({
        ok: false,
        mensaje: `El usuario "${usuario}" ya existe`
      });
      return;
    }

    const hash = await bcrypt.hash(password, 10);

    const resultado = await pool.query(
      `INSERT INTO users
        (nombre, usuario, password, email, telefono, role_id, area_id,
         especialidad, tipo_horario, fecha_nac, sueldo, contrato, fecha_ingreso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        nombre, usuario.toLowerCase(), hash, email || null,
        telefono || null, role_id, area_id || null,
        especialidad || null, tipo_horario || 'diario',
        fecha_nac || null, sueldo || null,
        contrato || 'indefinido', fecha_ingreso || null
      ]
    );

    res.status(201).json({
      ok: true,
      mensaje: 'Usuario creado correctamente',
      id: resultado.rows[0].id
    });
  } catch (error: any) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ 
      ok: false, 
      mensaje: 'Error al crear usuario',
      detalle: error.message 
    });
  }
}

export async function actualizarUsuario(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const {
      nombre, email, telefono, role_id, area_id,
      especialidad, tipo_horario, fecha_nac,
      sueldo, contrato, fecha_ingreso, activo, password
    } = req.body;

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const resultado = await pool.query(
      `UPDATE users SET
        nombre       = COALESCE($1, nombre),
        email        = COALESCE($2, email),
        telefono     = COALESCE($3, telefono),
        role_id      = COALESCE($4, role_id),
        area_id      = COALESCE($5, area_id),
        especialidad = COALESCE($6, especialidad),
        tipo_horario = COALESCE($7, tipo_horario),
        fecha_nac    = COALESCE($8, fecha_nac),
        sueldo       = COALESCE($9, sueldo),
        contrato     = COALESCE($10, contrato),
        fecha_ingreso= COALESCE($11, fecha_ingreso),
        activo       = COALESCE($12, activo),
        password     = COALESCE($13, password)
       WHERE id = $14
       RETURNING id`,
      [
        nombre, email, telefono, role_id, area_id,
        especialidad, tipo_horario, fecha_nac,
        sueldo, contrato, fecha_ingreso, activo,
        passwordHash, id
      ]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      return;
    }

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

   if (parseInt(id as string) === req.usuario?.id)  {
      res.status(400).json({
        ok: false,
        mensaje: 'No puedes eliminar tu propio usuario'
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
      `SELECT id, dia, hora_inicio::text, hora_fin::text
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

    await pool.query('DELETE FROM availability WHERE user_id = $1', [id]);

    for (const h of horarios) {
      await pool.query(
        `INSERT INTO availability (user_id, dia, hora_inicio, hora_fin)
         VALUES ($1, $2, $3, $4)`,
        [id, h.dia, h.hora_inicio, h.hora_fin]
      );
    }

    res.json({ ok: true, mensaje: 'Horarios guardados correctamente' });
  } catch (error) {
    console.error('Error al guardar horarios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar horarios' });
  }
}