import pool from './pool';

type AccionAudit = 'crear' | 'editar' | 'eliminar';

type AuditParams = {
  tabla: string;
  registro_id: number;
  accion: AccionAudit;
  datos_antes?: any;
  datos_despues?: any;
  user_id: number;
  user_nombre: string;
  user_rol: string;
  ip?: string;
};

export async function registrarAudit(params: AuditParams) {
  try {
    await pool.query(
      `INSERT INTO audit_log
        (tabla, registro_id, accion, datos_antes, datos_despues,
         user_id, user_nombre, user_rol, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        params.tabla,
        params.registro_id,
        params.accion,
        params.datos_antes ? JSON.stringify(params.datos_antes) : null,
        params.datos_despues ? JSON.stringify(params.datos_despues) : null,
        params.user_id,
        params.user_nombre,
        params.user_rol,
        params.ip || null,
      ]
    );
  } catch (error) {
    console.error('Error al registrar auditoria:', error);
  }
}