import { Router } from 'express';
import {
  getSettingsAdmin,
  getSettingsPublicos,
  actualizarSettings,
} from '../controllers/siteSettings.controller';
import { verificarToken, soloRol } from '../middlewares/auth';
import { uploadImagenSettings } from '../services/storage.service';

const router = Router();

// Pública — la consume el sitio web público, sin login
router.get('/public', getSettingsPublicos);

// Admin — requieren sesión de administrador
router.get('/', verificarToken, soloRol('administrador'), getSettingsAdmin);
router.put('/', verificarToken, soloRol('administrador'), uploadImagenSettings.single('imagen'), actualizarSettings);

export default router;