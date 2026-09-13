// backend/src/server.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import pool from './db/pool';
import authRoutes from './routes/auth.routes';
import citasRoutes from './routes/citas.routes';
import usersRoutes from './routes/users.routes';
import pacientesRoutes from './routes/pacientes.routes';
import zumbaRoutes from './routes/zumba.routes';
import gerontoRoutes from './routes/geronto.routes';
import reportesRoutes from './routes/reportes.routes';
import areasRoutes from './routes/areas.routes';
import servicesRoutes from './routes/services.routes';
import pushRoutes from './routes/push.routes';
import notificacionesRoutes from './routes/notificaciones.routes';
import siteGalleryRoutes from './routes/siteGallery.routes';
import siteArticlesRoutes from './routes/siteArticles.routes';
import siteSettingsRoutes from './routes/siteSettings.routes';
import { iniciarScheduler } from './scheduler';
import seccionesRoutes from './routes/secciones.routes';
import reservasPublicasRoutes from './routes/reservasPublicas.routes';
import bloqueosAgendaRoutes from './routes/bloqueosAgenda.routes';
import sesionesGrupalesRoutes from './routes/sesionesGrupales.routes';
import notasRoutes from './routes/notas.routes';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ✅ Configuración CORS
// En desarrollo se acepta cualquier origen de localhost o de una IP de red
// local (192.168.x.x, 10.x.x.x, 172.16-31.x.x) en los puertos del panel admin
// (5173) o del sitio público (5500) — así cualquier otra PC/celular del mismo
// WiFi puede entrar usando la IP de esta máquina, sin tocar este archivo.
//
// En producción, los dominios reales (Vercel, dominio propio, etc.) se
// agregan por variable de entorno ALLOWED_ORIGINS (separados por coma), sin
// necesidad de tocar ni redesplegar código cuando cambian.
const ORIGEN_LOCAL_PERMITIDO = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):(5173|5500)$/;

const ORIGENES_PRODUCCION = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ORIGEN_LOCAL_PERMITIDO.test(origin) || ORIGENES_PRODUCCION.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS: ' + origin));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Archivos subidos (fotos/videos del sitio web) — servidos directo, sin pasar
// por lógica de Node en cada request. En producción/Supabase esto se reemplaza
// por la URL pública del bucket de Storage.
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/citas', citasRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/pacientes', pacientesRoutes);
app.use('/api/zumba', zumbaRoutes);
app.use('/api/geronto', gerontoRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/areas', areasRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/site-gallery', siteGalleryRoutes);
app.use('/api/site-articles', siteArticlesRoutes);
app.use('/api/site-settings', siteSettingsRoutes);
app.use('/api', seccionesRoutes);
app.use('/api/reservas-publicas', reservasPublicasRoutes);
app.use('/api/bloqueos-agenda', bloqueosAgendaRoutes);
app.use('/api/sesiones-grupales', sesionesGrupalesRoutes);
app.use('/api/notas', notasRoutes);
// Health checks
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mensaje: 'Servidor funcionando' });
});

app.get('/api/health/db', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW() as tiempo');
    res.json({ ok: true, tiempo: resultado.rows[0].tiempo });
  } catch (error) {
    console.error('Error de base de datos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error de base de datos' });
  }
});

// ✅ Iniciar servidor (un solo listen — antes había dos, lo que puede
// tirar un error EADDRINUSE porque el puerto ya está en uso)
app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(`✅ Servidor corriendo en http://0.0.0.0:${PORT}`);
  console.log(`🖥️  Local:   http://localhost:${PORT}`);
  console.log(`📱 Celular: http://172.1.3.117:${PORT}`);
  console.log('=================================');
  iniciarScheduler();
});

// Manejo de errores
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});