import { Router } from 'express';
import {
  getArticulosAdmin,
  getArticulosPublicos,
  crearArticulo,
  actualizarArticulo,
  eliminarArticulo,
} from '../controllers/siteArticles.controller';
import { verificarToken, soloRol } from '../middlewares/auth';
import { uploadArticulo } from '../services/storage.service';

const router = Router();

// Pública — la consume el sitio web público, sin login
router.get('/public', getArticulosPublicos);

// Admin — requieren sesión de administrador
router.get('/',       verificarToken, soloRol('administrador'), getArticulosAdmin);
router.post('/',      verificarToken, soloRol('administrador'), uploadArticulo.single('imagen'), crearArticulo);
router.put('/:id',    verificarToken, soloRol('administrador'), uploadArticulo.single('imagen'), actualizarArticulo);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarArticulo);

export default router;