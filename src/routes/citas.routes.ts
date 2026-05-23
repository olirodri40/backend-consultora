import { Router } from 'express';
import {
  getCitas,
  getCitaPorId,
  crearCita,
  crearMultiplesCitasController,
  actualizarCita,
  eliminarCita,
} from '../controllers/citas.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/', verificarToken, getCitas);
router.get('/:id', verificarToken, getCitaPorId);

router.post('/multiples', verificarToken, soloRol('administrador', 'recepcionista', 'profesional'), crearMultiplesCitasController);
router.post('/', verificarToken, soloRol('administrador', 'recepcionista', 'profesional'), crearCita);
router.put('/:id', verificarToken, soloRol('administrador', 'recepcionista', 'profesional'), actualizarCita);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarCita);

export default router;