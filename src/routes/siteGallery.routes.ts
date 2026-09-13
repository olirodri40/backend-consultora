import { Router } from 'express';
import {
  getGaleriaAdmin,
  getGaleriaPublica,
  crearItemGaleria,
  actualizarItemGaleria,
  eliminarItemGaleria,
} from '../controllers/siteGallery.controller';
import { verificarToken, soloRol } from '../middlewares/auth';
import { uploadGaleria } from '../services/storage.service';

const router = Router();

// Pública — la consume el sitio web público (medyfisio.com), sin login
router.get('/public', getGaleriaPublica);

// Admin — requieren sesión de administrador
router.get('/',       verificarToken, soloRol('administrador'), getGaleriaAdmin);
router.post('/',      verificarToken, soloRol('administrador'), uploadGaleria.single('archivo'), crearItemGaleria);
router.put('/:id',    verificarToken, soloRol('administrador'), uploadGaleria.single('archivo'), actualizarItemGaleria);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarItemGaleria);

export default router;