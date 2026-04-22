import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

export async function login(req: Request, res: Response): Promise<void> {
  const { usuario, password } = req.body;

  // Validar que vengan los datos
  if (!usuario || !password) {
    res.status(400).json({
      ok: false,
      mensaje: 'Usuario y contrasena son requeridos',
    });
    return;
  }

  try {
    // Buscar el usuario en PostgreSQL con su rol y area
    const resultado = await pool.query(
      `SELECT 
        u.id,
        u.nombre,
        u.usuario,
        u.password,
        u.activo,
        u.area_id,
        r.nombre as rol
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.usuario = $1`,
      [usuario.toLowerCase()]
    );

    // Si no existe el usuario
    if (resultado.rows.length === 0) {
      res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contrasena incorrectos',
      });
      return;
    }

    const user = resultado.rows[0];

    // Si el usuario está inactivo
    if (!user.activo) {
      res.status(401).json({
        ok: false,
        mensaje: 'Usuario inactivo. Contacta al administrador',
      });
      return;
    }

    // Verificar la contrasena con bcrypt
    const passwordValida = await bcrypt.compare(password, user.password);

    if (!passwordValida) {
      res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contrasena incorrectos',
      });
      return;
    }

    // Crear el token JWT
    const secreto = process.env.JWT_SECRET || 'secreto';
    const token = jwt.sign(
      {
        id:      user.id,
        rol:     user.rol,
        area_id: user.area_id,
      },
      secreto,
      { expiresIn: '8h' } // el token dura 8 horas
    );

    // Responder con el token y los datos del usuario
    res.json({
      ok: true,
      token,
      usuario: {
        id:      user.id,
        nombre:  user.nombre,
        usuario: user.usuario,
        rol:     user.rol,
        area_id: user.area_id,
      },
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      ok: false,
      mensaje: 'Error interno del servidor',
    });
  }
}