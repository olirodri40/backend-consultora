import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import pool from './db/pool';
import authRoutes from './routes/auth.routes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

// Rutas
app.use('/api/auth', authRoutes);

// Health check
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