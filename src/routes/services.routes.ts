import { Router } from 'express';
import {
  getServicios,
  crearServicio,
  actualizarServicio,
  eliminarServicio,
  getHorariosZumba,
  crearHorarioZumba,
  actualizarHorarioZumba,
  eliminarHorarioZumba,
  getActividadesAdmin,
  crearActividadGeronto,
  actualizarActividadGeronto,
  eliminarActividadGeronto,
} from '../controllers/services.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

// Servicios
router.get('/',       verificarToken, getServicios);
router.post('/',      verificarToken, soloRol('administrador'), crearServicio);
router.put('/:id',    verificarToken, soloRol('administrador'), actualizarServicio);
router.delete('/:id', verificarToken, soloRol('administrador'), eliminarServicio);

// Horarios Zumba
router.get('/zumba/horarios',       verificarToken, getHorariosZumba);
router.post('/zumba/horarios',      verificarToken, soloRol('administrador'), crearHorarioZumba);
router.put('/zumba/horarios/:id',   verificarToken, soloRol('administrador'), actualizarHorarioZumba);
router.delete('/zumba/horarios/:id',verificarToken, soloRol('administrador'), eliminarHorarioZumba);

// Actividades Gerontologia
router.get('/geronto/actividades',       verificarToken, getActividadesAdmin);
router.post('/geronto/actividades',      verificarToken, soloRol('administrador'), crearActividadGeronto);
router.put('/geronto/actividades/:id',   verificarToken, soloRol('administrador'), actualizarActividadGeronto);
router.delete('/geronto/actividades/:id',verificarToken, soloRol('administrador'), eliminarActividadGeronto);

export default router;