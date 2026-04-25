import { Router } from 'express';
import {
  getUsuarios,
  getUsuarioPorId,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  getHorariosUsuario,
  guardarHorariosUsuario,
  getAuditLog,
} from '../controllers/users.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/',     verificarToken, soloRol('administrador', 'supervisor'), getUsuarios);
router.get('/:id',  verificarToken, getUsuarioPorId);
router.post('/',    verificarToken, soloRol('administrador'), crearUsuario);
router.put('/:id',  verificarToken, soloRol('administrador'), actualizarUsuario);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarUsuario);

router.get('/:id/horarios',  verificarToken, getHorariosUsuario);
router.post('/:id/horarios', verificarToken, soloRol('administrador'), guardarHorariosUsuario);

router.get('/audit/log', verificarToken, soloRol('administrador'), getAuditLog);

export default router;