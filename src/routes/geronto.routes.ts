import { Router } from 'express';
import {
  getActividades,
  getParticipantes,
  crearParticipante,
  renovarCiclo,
  marcarAsistencia,
  getAsistencia,
  eliminarParticipante,
  editarParticipante,
} from '../controllers/geronto.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/actividades',                verificarToken, getActividades);
router.get('/participantes',              verificarToken, getParticipantes);
router.post('/participantes',             verificarToken, soloRol('administrador', 'profesional'), crearParticipante);
router.put('/participantes/:id/renovar',  verificarToken, soloRol('administrador', 'profesional'), renovarCiclo);
router.put('/participantes/:id',          verificarToken, soloRol('administrador', 'profesional'), editarParticipante);
router.delete('/participantes/:id',       verificarToken, soloRol('administrador'), eliminarParticipante);
router.post('/asistencia',                verificarToken, marcarAsistencia);
router.get('/asistencia/:cycle_id',       verificarToken, getAsistencia);

export default router;