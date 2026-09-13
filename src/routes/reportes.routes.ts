import { Router } from 'express';

import { verificarToken, soloRol } from '../middlewares/auth';
import { getReporteGeneral, getHistorialPagos, getDashboard, getProgresoAreas, getProgresoTemporal  } from '../controllers/reportes.controller';

console.log('✅ Rutas reportes cargadas - getProgresoTemporal:', typeof getProgresoTemporal);

const router = Router();

router.get('/',        verificarToken, soloRol('administrador'), getReporteGeneral);
router.get('/pagos',   verificarToken, soloRol('administrador'), getHistorialPagos);
router.get('/dashboard', verificarToken, getDashboard);
router.get('/progreso-areas', verificarToken, getProgresoAreas);
router.get('/progreso-temporal', verificarToken, getProgresoTemporal);
export default router;