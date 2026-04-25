import { Router } from 'express';
import {
  getAreas,
  crearArea,
  actualizarArea,
  eliminarArea,
} from '../controllers/areas.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/',       verificarToken, getAreas);
router.post('/',      verificarToken, soloRol('administrador'), crearArea);
router.put('/:id',    verificarToken, soloRol('administrador'), actualizarArea);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarArea);

export default router;