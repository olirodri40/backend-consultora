import { Router } from 'express';
import {
  getSesionesGrupales,
  crearSesionGrupal,
  actualizarSesionGrupal,
  eliminarSesionGrupal,
  getOcupacionSesionGrupal,
  inscribirEnSesionGrupal,
} from '../controllers/sesionesGrupales.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/', verificarToken, getSesionesGrupales);
router.post('/', verificarToken, soloRol('administrador', 'supervisor'), crearSesionGrupal);
router.put('/:id', verificarToken, soloRol('administrador', 'supervisor'), actualizarSesionGrupal);
router.delete('/:id', verificarToken, soloRol('administrador', 'supervisor'), eliminarSesionGrupal);
router.get('/:id/ocupacion', verificarToken, getOcupacionSesionGrupal);
router.post(
  '/:id/inscribir',
  verificarToken,
  soloRol('administrador', 'recepcionista', 'supervisor'),
  inscribirEnSesionGrupal
);

export default router;
