import { Router } from 'express';
import { getBloqueos, crearBloqueo, eliminarBloqueo } from '../controllers/bloqueosAgenda.controller';
import { verificarToken, soloRol } from '../middlewares/auth';

const router = Router();

router.get('/', verificarToken, getBloqueos);
router.post('/', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), crearBloqueo);
router.delete('/:id', verificarToken, soloRol('administrador', 'recepcionista', 'supervisor'), eliminarBloqueo);

export default router;
