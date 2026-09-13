import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../db/pool';
import { enviarCorreo, plantillaCodigoRecuperacion } from '../utils/mailer';

export async function login(req: Request, res: Response): Promise<void> {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    res.status(400).json({
      ok: false,
      mensaje: 'Usuario y contrasena son requeridos',
    });
    return;
  }

  try {
    // 1. Buscar el usuario — por nombre de usuario o por correo, para que el
    // login funcione con cualquiera de los dos.
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
       WHERE u.usuario = $1 OR LOWER(u.email) = $1`,
      [usuario.toLowerCase()]
    );

    if (resultado.rows.length === 0) {
      res.status(401).json({
        ok: false,
        mensaje: 'Usuario incorrecto',
        campo: 'usuario',
      });
      return;
    }

    const user = resultado.rows[0];

    if (!user.activo) {
      res.status(401).json({
        ok: false,
        mensaje: 'Usuario inactivo. Contacta al administrador',
      });
      return;
    }

    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      res.status(401).json({
        ok: false,
        mensaje: 'Contraseña incorrecta',
        campo: 'password',
      });
      return;
    }

    // 👇 2. OBTENER LAS ÁREAS DEL USUARIO
    const areasResult = await pool.query(
      `SELECT a.nombre 
       FROM user_areas ua
       JOIN areas a ON a.id = ua.area_id
       WHERE ua.user_id = $1`,
      [user.id]
    );
    const areas = areasResult.rows.map(row => row.nombre);

    // 👇 3. CREAR EL TOKEN CON LAS ÁREAS
    const secreto = process.env.JWT_SECRET || 'secreto';
    const token = jwt.sign(
      {
        id: user.id,
        rol: user.rol,
        area_id: user.area_id,
        areas: areas, // 👈 NUEVO
      },
      secreto,
      // La sesión no debe cerrarse sola nunca — solo cuando el usuario haga
      // logout manualmente. "365d" es, en la práctica, indefinido.
      { expiresIn: '365d' }
    );

    // 👇 4. RESPONDER CON LAS ÁREAS
    res.json({
      ok: true,
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        usuario: user.usuario,
        rol: user.rol,
        area_id: user.area_id,
        areas: areas, // 👈 NUEVO
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

const CODIGO_VIGENCIA_MIN = 10;

function generarCodigo(): string {
  // Código numérico de 6 dígitos, sin ceros a la izquierda que se pierdan al mostrarlo.
  return crypto.randomInt(100000, 1000000).toString();
}

// POST /api/auth/olvide-password — genera un código de 6 dígitos, lo guarda
// (hasheado, como una contraseña) con 10 minutos de vigencia, y lo envía por
// correo al usuario dueño de ese email.
export async function olvidePassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ ok: false, mensaje: 'El correo es requerido' });
      return;
    }

    const resultado = await pool.query(
      `SELECT id, nombre, email FROM users WHERE LOWER(email) = $1`,
      [String(email).toLowerCase()]
    );

    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'No existe ninguna cuenta con ese correo' });
      return;
    }

    const user = resultado.rows[0];
    const codigo = generarCodigo();
    const codigoHash = await bcrypt.hash(codigo, 10);
    const expiraEn = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60 * 1000);

    // Invalidar códigos anteriores sin usar de este usuario antes de crear uno nuevo.
    await pool.query(
      `DELETE FROM password_reset_codes WHERE user_id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, codigoHash, expiraEn]
    );

    await enviarCorreo(
      user.email,
      'Código para restablecer tu contraseña',
      plantillaCodigoRecuperacion(user.nombre, codigo)
    );

    res.json({ ok: true, mensaje: 'Te enviamos un código a tu correo' });
  } catch (error: any) {
    console.error('Error al enviar código de recuperación:', error);
    res.status(500).json({ ok: false, mensaje: error.message?.includes('EMAIL_') ? error.message : 'No se pudo enviar el código. Intenta de nuevo más tarde' });
  }
}

// POST /api/auth/verificar-codigo — valida el código sin consumirlo, para que
// el frontend pueda avanzar al paso de "nueva contraseña" solo si es correcto.
export async function verificarCodigo(req: Request, res: Response): Promise<void> {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
      res.status(400).json({ ok: false, mensaje: 'Correo y código son requeridos' });
      return;
    }

    const usuarioResult = await pool.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [String(email).toLowerCase()]);
    if (usuarioResult.rows.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    const codigoResult = await pool.query(
      `SELECT code_hash, expires_at, used FROM password_reset_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [usuarioResult.rows[0].id]
    );

    if (codigoResult.rows.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    const registro = codigoResult.rows[0];
    if (registro.used || new Date(registro.expires_at) < new Date()) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    const coincide = await bcrypt.compare(String(codigo), registro.code_hash);
    if (!coincide) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    res.json({ ok: true, mensaje: 'Código correcto' });
  } catch (error) {
    console.error('Error al verificar código:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al verificar el código' });
  }
}

// POST /api/auth/restablecer-password — vuelve a validar el código (nunca
// confiar en que el frontend ya lo verificó) y, si es válido, actualiza la
// contraseña y marca el código como usado para que no se pueda reutilizar.
export async function restablecerPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email, codigo, password_nueva } = req.body;
    if (!email || !codigo || !password_nueva) {
      res.status(400).json({ ok: false, mensaje: 'Faltan datos' });
      return;
    }
    if (String(password_nueva).length < 8) {
      res.status(400).json({ ok: false, mensaje: 'La contraseña debe tener al menos 8 caracteres' });
      return;
    }

    const usuarioResult = await pool.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [String(email).toLowerCase()]);
    if (usuarioResult.rows.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }
    const userId = usuarioResult.rows[0].id;

    const codigoResult = await pool.query(
      `SELECT id, code_hash, expires_at, used FROM password_reset_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (codigoResult.rows.length === 0) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    const registro = codigoResult.rows[0];
    if (registro.used || new Date(registro.expires_at) < new Date()) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    const coincide = await bcrypt.compare(String(codigo), registro.code_hash);
    if (!coincide) {
      res.status(400).json({ ok: false, mensaje: 'Código inválido o vencido' });
      return;
    }

    const hash = await bcrypt.hash(String(password_nueva), 10);
    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hash, userId]);
    await pool.query('UPDATE password_reset_codes SET used = true WHERE id = $1', [registro.id]);

    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error al restablecer contraseña:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al restablecer la contraseña' });
  }
}