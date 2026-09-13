import { Router } from 'express';
import {
  getSecciones,
  crearSeccion,
  actualizarSeccion,
  eliminarSeccion,
} from '../controllers/secciones.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/areas/:areaId/secciones',  verificarToken, getSecciones);
router.post('/areas/:areaId/secciones', verificarToken, soloRol('administrador'), crearSeccion);
router.put('/secciones/:id',            verificarToken, soloRol('administrador'), actualizarSeccion);
router.delete('/secciones/:id',         verificarToken, soloRol('administrador'), eliminarSeccion);

export default router;