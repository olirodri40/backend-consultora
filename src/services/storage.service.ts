// src/services/storage.service.ts
//
// Punto único donde vive la lógica de "dónde se guardan los archivos".
// Modo dual, elegido automáticamente según las variables de entorno:
//   - Si SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY están configuradas, los
//     archivos se suben a Supabase Storage (producción).
//   - Si no, se guardan en disco local (desarrollo en tu PC) como antes.
// Los controllers no necesitan saber cuál de los dos modos está activo.

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

const USAR_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = USAR_SUPABASE
  ? createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
  : null;

function nombreUnico(nombreOriginal: string): string {
  const ext = path.extname(nombreOriginal).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

// En modo Supabase, multer guarda el archivo en memoria (se sube el buffer
// directo); en modo local, lo escribe a disco como siempre.
function crearStorageMulter(subcarpeta: string): multer.StorageEngine {
  if (USAR_SUPABASE) return multer.memoryStorage();

  const dir = path.join(__dirname, '../../uploads', subcarpeta);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => cb(null, nombreUnico(file.originalname)),
  });
}

// Sube el archivo ya procesado por multer (buffer en modo Supabase, ya
// escrito en disco en modo local) y devuelve la URL pública final para
// guardar en la base de datos.
async function subirArchivo(subcarpeta: string, file: Express.Multer.File): Promise<string> {
  if (USAR_SUPABASE) {
    const nombre = nombreUnico(file.originalname);
    const rutaStorage = `${subcarpeta}/${nombre}`;
    const { error } = await supabase!.storage.from(SUPABASE_BUCKET).upload(rutaStorage, file.buffer, {
      contentType: file.mimetype,
    });
    if (error) throw new Error(`Error al subir archivo a Supabase Storage: ${error.message}`);
    const { data } = supabase!.storage.from(SUPABASE_BUCKET).getPublicUrl(rutaStorage);
    return data.publicUrl;
  }
  // Local: multer.diskStorage ya guardó el archivo con file.filename
  return `/uploads/${subcarpeta}/${file.filename}`;
}

// Borra un archivo (de Supabase Storage o de disco local, según dónde viva
// la URL guardada). No lanza error si el archivo ya no existe.
export async function eliminarArchivo(urlOrRutaPublica: string | null): Promise<void> {
  if (!urlOrRutaPublica) return;

  const marcaSupabase = `/storage/v1/object/public/${SUPABASE_BUCKET}/`;
  if (urlOrRutaPublica.includes(marcaSupabase)) {
    const rutaStorage = urlOrRutaPublica.split(marcaSupabase)[1];
    if (rutaStorage && supabase) {
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([rutaStorage]);
      if (error) console.error('Error al eliminar archivo de Supabase Storage:', error.message);
    }
    return;
  }

  // Local
  const rutaCompleta = path.join(__dirname, '../..', urlOrRutaPublica);
  fs.unlink(rutaCompleta, (err) => {
    if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error al eliminar archivo:', err.message);
    }
  });
}

// ============================================================
// Galería (imágenes/videos)
// ============================================================
const MIME_PERMITIDOS_GALERIA = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
];

export const uploadGaleria = multer({
  storage: crearStorageMulter('site-gallery'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (cubre el caso más grande: video)
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS_GALERIA.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Usa jpg, png, webp, mp4 o webm.'));
    }
  },
});

export function subirArchivoGaleria(file: Express.Multer.File): Promise<string> {
  return subirArchivo('site-gallery', file);
}

// ============================================================
// Artículos (imagen de portada)
// ============================================================
const MIME_PERMITIDOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

export const uploadArticulo = multer({
  storage: crearStorageMulter('site-articles'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS_IMAGEN.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Usa jpg, png o webp.'));
    }
  },
});

export function subirArchivoArticulo(file: Express.Multer.File): Promise<string> {
  return subirArchivo('site-articles', file);
}

// ============================================================
// Ajustes del sitio (foto del edificio)
// ============================================================
export const uploadImagenSettings = multer({
  storage: crearStorageMulter('site-settings'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS_IMAGEN.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Usa jpg, png o webp.'));
    }
  },
});

export function subirImagenSettings(file: Express.Multer.File): Promise<string> {
  return subirArchivo('site-settings', file);
}
