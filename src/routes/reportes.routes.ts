import { Router } from 'express';
import {
  getReporteGeneral,
  getHistorialPagos,
} from '../controllers/reportes.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/',        verificarToken, soloRol('administrador', 'supervisor'), getReporteGeneral);
router.get('/pagos',   verificarToken, soloRol('administrador', 'supervisor'), getHistorialPagos);

export default router;