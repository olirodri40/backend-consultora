import { Router } from 'express';
import { verificarToken } from '../middlewares/auth';
import {
  crearNota,
  getNotasRecibidas,
  getNotasEnviadas,
  marcarNotaAtendida,
  marcarNotaLeida,
  eliminarNota,
} from '../controllers/notas.controller';

const router = Router();

// Cualquier usuario autenticado puede crear/ver/atender notas — el control de
// a quién le llega cada una se maneja por destinatario dentro del controlador.
router.post('/', verificarToken, crearNota);
router.get('/recibidas', verificarToken, getNotasRecibidas);
router.get('/enviadas', verificarToken, getNotasEnviadas);
router.put('/:id/atender', verificarToken, marcarNotaAtendida);
router.put('/:id/leido', verificarToken, marcarNotaLeida);
router.delete('/:id', verificarToken, eliminarNota);

export default router;
