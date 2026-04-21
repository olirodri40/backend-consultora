import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Pool de conexiones — en vez de abrir y cerrar una conexion
// por cada consulta, mantenemos un grupo de conexiones listas
// Esto es mucho mas eficiente
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'consultora_salud',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'admin123',
});

// Verificar la conexion al arrancar
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error conectando a PostgreSQL:', err.message);
    return;
  }
  console.log('Conectado a PostgreSQL correctamente');
  release();
});

export default pool;