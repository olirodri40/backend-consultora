import { Router } from 'express';
import { verificarToken } from '../middlewares/auth';
import { getNotificaciones, marcarLeida, marcarTodasLeidas } from '../controllers/notificaciones.controller';

const router = Router();

router.get('/', verificarToken, getNotificaciones);
router.put('/:id/leer', verificarToken, marcarLeida);
router.put('/leer-todas', verificarToken, marcarTodasLeidas);

export default router;