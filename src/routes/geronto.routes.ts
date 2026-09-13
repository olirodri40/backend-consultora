import { Router } from 'express';
import { verificarToken } from '../middlewares/auth';
import {
  getActividades,
  getParticipantesConFiltro,
  crearParticipante,
  renovarCiclo,
  marcarAsistencia,
  getAsistencia,
  eliminarParticipante,
  editarParticipante,
  getHistorialCiclosGeronto,
  actualizarPagoCicloGeronto,
  getReportesGeronto,
  eliminarAsistenciaGeronto,
  getActividadesConProfesionales,
} from '../controllers/geronto.controller';

const router = Router();

// ========== ACTIVIDADES ==========
router.get('/actividades', getActividades);
router.get('/actividades-con-profesionales', getActividadesConProfesionales);

// ========== PARTICIPANTES ==========
router.get('/participantes', verificarToken, getParticipantesConFiltro); 
router.get('/participantes', getParticipantesConFiltro);
router.post('/participantes', crearParticipante);
router.put('/participantes/:id', editarParticipante);
router.delete('/participantes/:id', eliminarParticipante);


// ========== CICLOS ==========
router.put('/participantes/:id/renovar', renovarCiclo);
router.get('/participantes/:id/ciclos', getHistorialCiclosGeronto);
router.put('/ciclos/:id/pago', actualizarPagoCicloGeronto);

// ========== ASISTENCIA ==========
router.post('/asistencia', marcarAsistencia);
router.delete('/asistencia', eliminarAsistenciaGeronto);
router.get('/asistencia/:cycle_id', getAsistencia);

// ========== REPORTES ==========
router.get('/reportes', getReportesGeronto);


export default router;