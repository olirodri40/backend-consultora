import { Router } from 'express';
import { login, olvidePassword, verificarCodigo, restablecerPassword } from '../controllers/auth.controller';

const router = Router();

// POST /api/auth/login
router.post('/login', login);

// Recuperación de contraseña por código enviado al correo
router.post('/olvide-password', olvidePassword);
router.post('/verificar-codigo', verificarCodigo);
router.post('/restablecer-password', restablecerPassword);

export default router;