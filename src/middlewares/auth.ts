import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extender el tipo Request de Express para agregar el usuario
export interface RequestConUsuario extends Request {
  usuario?: {
    id: number;
    rol: string;
    area_id: number | null;
  };
}

export function verificarToken(
  req: RequestConUsuario,
  res: Response,
  next: NextFunction
): void {
  // El token viene en el header: Authorization: Bearer <token>
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, mensaje: 'Token requerido' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const secreto = process.env.JWT_SECRET || 'secreto';
    const payload = jwt.verify(token, secreto) as {
      id: number;
      rol: string;
      area_id: number | null;
    };

    // Agregar el usuario al request para usarlo en los controladores
    req.usuario = payload;
    next();
  } catch {
    res.status(401).json({ ok: false, mensaje: 'Token invalido o expirado' });
  }
}

// Middleware para verificar roles
export function soloRol(...roles: string[]) {
  return (req: RequestConUsuario, res: Response, next: NextFunction): void => {
    if (!req.usuario) {
      res.status(401).json({ ok: false, mensaje: 'No autenticado' });
      return;
    }

    if (!roles.includes(req.usuario.rol)) {
      res.status(403).json({
        ok: false,
        mensaje: `Acceso denegado. Se requiere rol: ${roles.join(' o ')}`,
      });
      return;
    }

    next();
  };
}