import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import pool from './db/pool';
import authRoutes      from './routes/auth.routes';
import citasRoutes     from './routes/citas.routes';
import usersRoutes     from './routes/users.routes';
import pacientesRoutes from './routes/pacientes.routes';
import zumbaRoutes     from './routes/zumba.routes';
import gerontoRoutes   from './routes/geronto.routes';
import reportesRoutes  from './routes/reportes.routes';
import areasRoutes     from './routes/areas.routes';
import servicesRoutes  from './routes/services.routes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/citas',     citasRoutes);
app.use('/api/users',     usersRoutes);
app.use('/api/pacientes', pacientesRoutes);
app.use('/api/zumba',     zumbaRoutes);
app.use('/api/geronto',   gerontoRoutes);
app.use('/api/reportes',  reportesRoutes);
app.use('/api/areas',     areasRoutes);
app.use('/api/services',  servicesRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mensaje: 'Servidor funcionando' });
});

app.get('/api/health/db', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW() as tiempo');
    res.json({ ok: true, tiempo: resultado.rows[0].tiempo });
  } catch {
    res.status(500).json({ ok: false, mensaje: 'Error de base de datos' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});