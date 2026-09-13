import { Router } from 'express';
import {
  getParticipantes,
  crearParticipante,
  renovarCiclo,
  marcarAsistencia,
  getAsistencia,
  eliminarParticipante,
  editarParticipante,
  getHistorialCiclos,
  getReportes,
  actualizarPagoCiclo,
} from '../controllers/zumba.controller';
import { verificarToken, soloRol } from '../middlewares/auth';
import { getProfesionalZumba } from '../controllers/zumba.controller';
const router = Router();

// RUTA DE PRUEBA
router.get('/prueba', (req, res) => {
  res.json({ ok: true, mensaje: 'Prueba funcionando' });
});

// RUTA DE PRUEBA
router.get('/prueba', (req, res) => {
  console.log('🔵🔵🔵 RUTA PRUEBA EJECUTADA 🔵🔵🔵');
  res.json({ ok: true, mensaje: 'Prueba funcionando' });
});
router.get('/profesional', getProfesionalZumba);

// RUTAS ESPECÍFICAS PRIMERO
router.get('/participantes/:id/historial', verificarToken, getHistorialCiclos);
router.put('/participantes/:id/renovar', verificarToken, soloRol('administrador', 'profesional'), renovarCiclo);
router.put('/participantes/:id', verificarToken, soloRol('administrador', 'profesional'), editarParticipante);
router.delete('/participantes/:id', verificarToken, soloRol('administrador'), eliminarParticipante);

// RUTAS SIMPLES
router.get('/participantes', verificarToken, getParticipantes);
router.post('/participantes', verificarToken, soloRol('administrador', 'profesional'), crearParticipante);

router.post('/asistencia', verificarToken, marcarAsistencia);
router.get('/asistencia/:cycle_id', verificarToken, getAsistencia);

router.get('/reportes', verificarToken, getReportes);
router.patch('/ciclos/:ciclo_id/pago', verificarToken, soloRol('administrador', 'profesional'), actualizarPagoCiclo);

console.log('✅ Zumba routes cargadas COMPLETAMENTE');

export default router;