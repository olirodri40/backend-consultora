import { Router } from 'express';
import {
  getAreas,
  actualizarArea,
  eliminarArea,
  getVisibilidadPublica,
} from '../controllers/areas.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

// Pública — la consume el sitio web público, sin login
router.get('/public/visibilidad', getVisibilidadPublica);

router.get('/',       verificarToken, getAreas);
router.put('/:id',    verificarToken, soloRol('administrador'), actualizarArea);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarArea);

export default router;