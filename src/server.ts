import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// Importar pool — esto activa la conexion con PostgreSQL al arrancar
import pool from './db/pool';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString(),
  });
});

// Ruta para verificar conexion con la base de datos
app.get('/api/health/db', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW() as tiempo');
    res.json({
      ok: true,
      mensaje: 'Base de datos conectada',
      tiempo: resultado.rows[0].tiempo,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: 'Error conectando a la base de datos',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});