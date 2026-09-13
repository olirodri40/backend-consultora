import { Router } from 'express';
import {
  getCuposPublicos,
  crearReservaPublica,
  getReservasPendientes,
  getReservasHistorial,
  eliminarReservaPublica,
  getCandidatosReserva,
  confirmarReservaPublica,
  rechazarReservaPublica,
} from '../controllers/reservasPublicas.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

// Públicas — las consume el sitio web público, sin login
router.get('/cupos', getCuposPublicos);
router.post('/', crearReservaPublica);

// Staff — gestión desde Agenda
router.get('/pendientes', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), getReservasPendientes);
router.get('/historial', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), getReservasHistorial);
router.get('/:id/candidatos', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), getCandidatosReserva);
router.put('/:id/confirmar', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), confirmarReservaPublica);
router.put('/:id/rechazar', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), rechazarReservaPublica);
router.delete('/:id', verificarToken, soloRol('administrador', 'supervisor'), eliminarReservaPublica);

export default router;
