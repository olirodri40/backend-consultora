import { Router } from 'express';
import { verificarToken } from '../middlewares/auth';
import { suscribir, desuscribir, getVapidPublicKey, enviarPrueba } from '../controllers/push.controller';

const router = Router();

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/suscribir', verificarToken, suscribir);
router.post('/desuscribir', verificarToken, desuscribir);
router.post('/prueba', verificarToken, enviarPrueba);

export default router;