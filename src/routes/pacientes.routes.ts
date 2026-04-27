import { Router } from 'express';
import {
  getPacientes,
  getPacientePorId,
  actualizarPaciente,
  eliminarPaciente,
  crearPaciente,
} from '../controllers/pacientes.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/',     verificarToken, getPacientes);
router.post('/',    verificarToken, soloRol('administrador', 'recepcionista', 'profesional'), crearPaciente);
router.get('/:id',  verificarToken, getPacientePorId);
router.put('/:id',  verificarToken, soloRol('administrador', 'recepcionista', 'profesional'), actualizarPaciente);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarPaciente);

export default router;