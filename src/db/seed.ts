import bcrypt from 'bcryptjs';
import pool from './pool';

async function seed() {
  console.log('Encriptando contrasenas...');

  const usuarios = [
    { usuario: 'admin',       password: 'admin123'  },
    { usuario: 'laura.perez', password: 'laura123'  },
    { usuario: 'carlos.ruiz', password: 'carlos123' },
  ];

  for (const u of usuarios) {
    // bcrypt.hash(texto, rounds) — rounds=10 es el estandar
    // cuanto mayor el numero, mas seguro pero mas lento
    const hash = await bcrypt.hash(u.password, 10);

    await pool.query(
      'UPDATE users SET password = $1 WHERE usuario = $2',
      [hash, u.usuario]
    );

    console.log(`✅ ${u.usuario} — contrasena encriptada`);
  }

  console.log('Listo. Cerrando conexion...');
  await pool.end();
}

seed().catch(console.error);