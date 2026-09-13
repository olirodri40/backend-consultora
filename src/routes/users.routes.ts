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
  getProfesionales,
  getTodosHorarios,
  actualizarVisibilidadServicioProfesional,
  getUsuariosListaBasica,
  actualizarMiPerfil,
  cambiarMiPassword,
} from '../controllers/users.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/audit/log',     verificarToken, soloRol('administrador'), getAuditLog);
router.get('/lista-basica',  verificarToken, getUsuariosListaBasica);
router.get('/profesionales', verificarToken, soloRol('administrador', 'supervisor'), getProfesionales);
router.put('/me/perfil',     verificarToken, actualizarMiPerfil);
router.put('/me/password',   verificarToken, cambiarMiPassword);

router.get('/',       verificarToken, soloRol('administrador'), getUsuarios);
router.get('/:id',    verificarToken, getUsuarioPorId);
router.post('/',      verificarToken, soloRol('administrador'), crearUsuario);
router.put('/:id',    verificarToken, soloRol('administrador'), actualizarUsuario);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarUsuario);
router.get('/horarios/todos', verificarToken, getTodosHorarios);
router.get('/:id/horarios',  verificarToken, getHorariosUsuario);
router.post('/:id/horarios', verificarToken, soloRol('administrador'), guardarHorariosUsuario);
router.put('/:userId/servicios/:servicioId/visibilidad', verificarToken, soloRol('administrador'), actualizarVisibilidadServicioProfesional);

export default router;