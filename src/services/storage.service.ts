// src/services/storage.service.ts
//
// Punto único donde vive la lógica de "dónde se guardan los archivos".
// Hoy: disco local (para pruebas en tu PC).
// El día que migres a Supabase, solo reescribes ESTE archivo
// (usando Supabase Storage, que es compatible con S3) — controllers,
// rutas y la base de datos no cambian nada.

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const UPLOAD_DIR = path.join(__dirname, '../../uploads/site-gallery');

// Crea la carpeta de subidas si no existe (al arrancar el servidor)
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const MIME_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nombreUnico = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, nombreUnico);
  },
});

export const uploadGaleria = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (cubre el caso más grande: video)
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Usa jpg, png, webp, mp4 o webm.'));
    }
  },
});

// Convierte el nombre de archivo guardado en la ruta pública que se sirve
// vía express.static (ver server.ts) y que consume el sitio público.
export function rutaPublicaArchivo(nombreArchivo: string): string {
  return `/uploads/site-gallery/${nombreArchivo}`;
}

// Borra un archivo físico del disco (al eliminar o reemplazar un item).
// Genérico: funciona para cualquier subcarpeta de /uploads (site-gallery,
// site-articles, etc.) porque usa la ruta pública completa para ubicarlo.
// No lanza error si el archivo ya no existe.
export function eliminarArchivoLocal(rutaPublica: string | null): void {
  if (!rutaPublica) return;
  const rutaCompleta = path.join(__dirname, '../..', rutaPublica);
  fs.unlink(rutaCompleta, (err) => {
    if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error al eliminar archivo:', err.message);
    }
  });
}

// ============================================================
// Subida de imágenes para Artículos (carpeta separada de la galería)
// ============================================================
const UPLOAD_DIR_ARTICULOS = path.join(__dirname, '../../uploads/site-articles');

if (!fs.existsSync(UPLOAD_DIR_ARTICULOS)) {
  fs.mkdirSync(UPLOAD_DIR_ARTICULOS, { recursive: true });
}

const MIME_PERMITIDOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

const storageArticulos = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_ARTICULOS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nombreUnico = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, nombreUnico);
  },
});

export const uploadArticulo = multer({
  storage: storageArticulos,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB (solo imagen)
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS_IMAGEN.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Usa jpg, png o webp.'));
    }
  },
});

export function rutaPublicaArticulo(nombreArchivo: string): string {
  return `/uploads/site-articles/${nombreArchivo}`;
}

// ============================================================
// Subida de la foto del edificio para Ubicación
// ============================================================
const UPLOAD_DIR_SETTINGS = path.join(__dirname, '../../uploads/site-settings');

if (!fs.existsSync(UPLOAD_DIR_SETTINGS)) {
  fs.mkdirSync(UPLOAD_DIR_SETTINGS, { recursive: true });
}

const storageSettings = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_SETTINGS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nombreUnico = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, nombreUnico);
  },
});

export const uploadImagenSettings = multer({
  storage: storageSettings,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS_IMAGEN.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Usa jpg, png o webp.'));
    }
  },
});

export function rutaPublicaSettings(nombreArchivo: string): string {
  return `/uploads/site-settings/${nombreArchivo}`;
}