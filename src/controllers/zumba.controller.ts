import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { HOY_SQL } from '../utils/tiempo';

export async function getParticipantes(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { anio } = req.query;
    const usuario = req.usuario;
    const esProfesional = usuario?.rol === 'profesional';

    let profesionalAsignado = false;
    if (esProfesional) {
      const check = await pool.query(
        `SELECT 1 FROM user_areas ua
         JOIN areas a ON a.id = ua.area_id
         WHERE ua.user_id = $1 AND LOWER(a.nombre) = 'zumba'`,
        [usuario.id]
      );
      profesionalAsignado = check.rows.length > 0;
    }

    if (esProfesional && !profesionalAsignado) {
      res.json({ ok: true, participantes: [], anios_disponibles: [] });
      return;
    }

    let anioCondition = '';
    let params: any[] = [];

    if (anio && anio !== 'todos') {
      anioCondition = 'AND c.anio = $1';
      params = [Number(anio)];
    }

    // 👇 Clave del fix: LATERAL JOIN que trae SOLO el último ciclo
    // que coincide con el filtro (o el último global si no hay filtro de año)
    const query = `
      SELECT
        p.id,
        p.nombre,
        p.carnet,
        p.telefono,
        p.fecha_nac,
        p.activo,
        p.contacto_relacion,
        p.contacto_nombre,
        p.contacto_telefono,
        c.id              as ciclo_id,
        c.numero_ciclo,
        c.fecha_inicio,
        c.clases_pagadas,
        c.monto,
        c.monto_pagado,
        c.metodo_pago,
        c.estado          as ciclo_estado,
        c.anio            as anio_ciclo,
        CASE
          WHEN c.monto_pagado IS NULL       THEN 'sin_pago'
          WHEN c.monto_pagado < c.monto     THEN 'parcial'
          ELSE                                   'pagado'
        END               as estado_pago,
        (c.monto - COALESCE(c.monto_pagado, 0)) as deuda,
        COALESCE((
          SELECT SUM(c2.monto - COALESCE(c2.monto_pagado, 0))
          FROM zumba_cycles c2
          WHERE c2.participant_id = p.id
        ), 0) as deuda_total,
        COUNT(a.id) FILTER (WHERE a.estado = 'asistio')  as clases_asistidas,
        COUNT(a.id) FILTER (WHERE a.estado = 'falta')    as clases_falta,
        COUNT(a.id) FILTER (WHERE a.estado = 'permiso')  as clases_permiso,
        EXISTS (
          SELECT 1 FROM zumba_attendance za
          WHERE za.cycle_id = c.id AND za.fecha = ${HOY_SQL}
        ) as marcado_hoy
              FROM zumba_participants p
       LEFT JOIN LATERAL (
         SELECT *
         FROM zumba_cycles c
         WHERE c.participant_id = p.id
         ${anioCondition}
         ORDER BY c.anio DESC, c.numero_ciclo DESC
         LIMIT 1
       ) c ON true
       LEFT JOIN zumba_attendance a ON a.cycle_id = c.id
       WHERE p.activo = true
       GROUP BY p.id, c.id, c.numero_ciclo, c.fecha_inicio, c.clases_pagadas,
                c.monto, c.monto_pagado, c.metodo_pago, c.estado, c.anio
       ORDER BY c.id DESC NULLS LAST, p.nombre
    `;

    const resultado = await pool.query(query, params);

    const aniosDisponibles = await pool.query(
      `SELECT DISTINCT anio
       FROM zumba_cycles
       WHERE anio IS NOT NULL
       ORDER BY anio DESC`
    );

    res.json({
      ok: true,
      participantes: resultado.rows,
      anios_disponibles: aniosDisponibles.rows.map((r: any) => r.anio)
    });
  } catch (error) {
    console.error('Error al obtener participantes zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener participantes' });
  }
}

export async function crearParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const {
      nombre, carnet, telefono, fecha_nac,
      fecha_inicio, clases_pagadas, monto, metodo_pago, monto_pagado,
      contacto_relacion, contacto_nombre, contacto_telefono
    } = req.body;

    if (!nombre || !fecha_inicio || !monto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Nombre, fecha de inicio y monto son obligatorios'
      });
      return;
    }

    const participante = await pool.query(
      `INSERT INTO zumba_participants (nombre, carnet, telefono, fecha_nac, contacto_relacion, contacto_nombre, contacto_telefono)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nombre, carnet || null, telefono || null, fecha_nac || null, 
       contacto_relacion || null, contacto_nombre || null, contacto_telefono || null]
    );

    const pid = participante.rows[0].id;
    
    const montoPagadoFinal = monto_pagado !== undefined ? monto_pagado : monto;
    
    // ✅ CALCULAR nuevoAnio ANTES de usarlo
    const nuevoAnio = new Date(fecha_inicio).getFullYear();

    await pool.query(
      `INSERT INTO zumba_cycles
        (participant_id, numero_ciclo, fecha_inicio, anio, clases_pagadas, monto, monto_pagado, metodo_pago)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [pid, fecha_inicio, nuevoAnio, clases_pagadas || 8, monto, montoPagadoFinal, metodo_pago || 'efectivo']
    );

    res.status(201).json({
      ok: true,
      mensaje: 'Participante inscrito correctamente',
      id: pid
    });
  } catch (error) {
    console.error('Error al crear participante:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear participante' });
  }
}

export async function renovarCiclo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { fecha_inicio, monto, metodo_pago, clases_pagadas, monto_pagado } = req.body;

    if (!fecha_inicio || !monto) {
      res.status(400).json({
        ok: false,
        mensaje: 'Fecha de inicio y monto son obligatorios'
      });
      return;
    }

    await pool.query(
      `UPDATE zumba_cycles SET estado = 'completado'
       WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    // Obtener el año de la nueva fecha de inicio
    const nuevoAnio = new Date(fecha_inicio).getFullYear();

    // Buscar el último ciclo del mismo año
    const ultimoCicloMismoAnio = await pool.query(
      `SELECT MAX(numero_ciclo) as ultimo
       FROM zumba_cycles 
       WHERE participant_id = $1 AND anio = $2`,
      [id, nuevoAnio]
    );

    // Si existe ciclo en el mismo año, incrementar; si no, empezar en 1
    const nuevoCiclo = (ultimoCicloMismoAnio.rows[0].ultimo || 0) + 1;

    const montoPagadoFinal = monto_pagado !== undefined ? monto_pagado : monto;

    await pool.query(
      `INSERT INTO zumba_cycles
        (participant_id, numero_ciclo, fecha_inicio, anio, clases_pagadas, monto, monto_pagado, metodo_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, nuevoCiclo, fecha_inicio, nuevoAnio, clases_pagadas || 8, monto, montoPagadoFinal, metodo_pago || 'efectivo']
    );

    res.json({
      ok: true,
      mensaje: `Ciclo ${nuevoCiclo} del año ${nuevoAnio} iniciado correctamente`
    });
  } catch (error) {
    console.error('Error al renovar ciclo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al renovar ciclo' });
  }
}

export async function marcarAsistencia(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { participant_id, cycle_id, fecha, estado } = req.body;

    if (!participant_id || !cycle_id || !fecha || !estado) {
      res.status(400).json({
        ok: false,
        mensaje: 'participant_id, cycle_id, fecha y estado son obligatorios'
      });
      return;
    }

    const estadosValidos = ['asistio', 'falta', 'permiso', 'suspendida'];
    if (!estadosValidos.includes(estado)) {
      res.status(400).json({
        ok: false,
        mensaje: `Estado invalido. Use: ${estadosValidos.join(', ')}`
      });
      return;
    }

    await pool.query(
      `INSERT INTO zumba_attendance (participant_id, cycle_id, fecha, estado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (participant_id, cycle_id, fecha)
       DO UPDATE SET estado = $4`,
      [participant_id, cycle_id, fecha, estado]
    );

    res.json({ ok: true, mensaje: 'Asistencia registrada correctamente' });
  } catch (error) {
    console.error('Error al marcar asistencia:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al marcar asistencia' });
  }
}

export async function getAsistencia(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { cycle_id } = req.params;

    const resultado = await pool.query(
      `SELECT
        a.id,
        a.fecha,
        a.estado,
        p.nombre as participante_nombre,
        p.id     as participant_id
       FROM zumba_attendance a
       JOIN zumba_participants p ON a.participant_id = p.id
       WHERE a.cycle_id = $1
       ORDER BY a.fecha, p.nombre`,
      [cycle_id]
    );

    res.json({ ok: true, asistencia: resultado.rows });
  } catch (error) {
    console.error('Error al obtener asistencia:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener asistencia' });
  }
}



export async function eliminarParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    // Traer TODOS los ciclos de este participante, del más reciente al más antiguo
    const ciclos = await pool.query(
      `SELECT id, numero_ciclo, anio, estado
       FROM zumba_cycles
       WHERE participant_id = $1
       ORDER BY anio DESC, numero_ciclo DESC`,
      [id]
    );

    // Caso 1: no tiene ciclos, o es su único ciclo → eliminar el participante completo
    if (ciclos.rows.length <= 1) {
      await pool.query(
        'UPDATE zumba_participants SET activo = false WHERE id = $1',
        [id]
      );
      res.json({
        ok: true,
        mensaje: 'Participante eliminado correctamente',
        tipo: 'participante',
      });
      return;
    }

    // Caso 2: tiene 2 o más ciclos → eliminar SOLO el último ciclo creado
    const ultimoCiclo = ciclos.rows[0];
    const cicloAnterior = ciclos.rows[1];

    await pool.query('DELETE FROM zumba_attendance WHERE cycle_id = $1', [ultimoCiclo.id]);
    await pool.query('DELETE FROM zumba_cycles WHERE id = $1', [ultimoCiclo.id]);

    // El ciclo anterior vuelve a ser el ciclo vigente del participante
    await pool.query(
      `UPDATE zumba_cycles SET estado = 'activo' WHERE id = $1`,
      [cicloAnterior.id]
    );

    res.json({
      ok: true,
      mensaje: `Ciclo ${ultimoCiclo.numero_ciclo} eliminado correctamente`,
      tipo: 'ciclo',
    });
  } catch (error) {
    console.error('Error al eliminar participante zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar' });
  }
}


export async function editarParticipante(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, carnet, telefono, fecha_nac, fecha_inicio, clases_pagadas, monto, metodo_pago,
            contacto_relacion, contacto_nombre, contacto_telefono } = req.body;

    await pool.query(
      `UPDATE zumba_participants SET
        nombre    = COALESCE($1, nombre),
        carnet    = COALESCE($2, carnet),
        telefono  = COALESCE($3, telefono),
        fecha_nac = COALESCE($4, fecha_nac),
        contacto_relacion = COALESCE($5, contacto_relacion),
        contacto_nombre   = COALESCE($6, contacto_nombre),
        contacto_telefono = COALESCE($7, contacto_telefono)
       WHERE id = $8`,
      [nombre, carnet || null, telefono || null, fecha_nac || null,
       contacto_relacion || null, contacto_nombre || null, contacto_telefono || null, id]
    );

    const cicloActivo = await pool.query(
      `SELECT id FROM zumba_cycles WHERE participant_id = $1 AND estado = 'activo'`,
      [id]
    );

    if (cicloActivo.rows.length > 0) {
      const cid = cicloActivo.rows[0].id;
      await pool.query(
        `UPDATE zumba_cycles SET
          fecha_inicio   = COALESCE($1, fecha_inicio),
          clases_pagadas = COALESCE($2, clases_pagadas),
          monto          = COALESCE($3, monto),
          metodo_pago    = COALESCE($4, metodo_pago)
         WHERE id = $5`,
        [fecha_inicio || null, clases_pagadas || null, monto || null, metodo_pago || null, cid]
      );
    }

    res.json({ ok: true, mensaje: 'Participante actualizado correctamente' });
  } catch (error) {
    console.error('Error al editar participante zumba:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al editar participante' });
  }
}
export async function getHistorialCiclos(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { anio } = req.query;
 
    const participante = await pool.query(
      `SELECT id, nombre, carnet, telefono, contacto_relacion, contacto_nombre, contacto_telefono 
       FROM zumba_participants WHERE id = $1`,
      [id]
    );
 
    if (participante.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Participante no encontrado' });
      return;
    }
 
    let anioCondition = '';
    let queryParams: any[] = [id];  // ✅ Cambiar a any[] o string[]
    
    if (anio) {
      anioCondition = `AND c.anio = $2`;
      queryParams.push(anio);  // ✅ No usar Number(), enviar como string
    }
 
    const ciclos = await pool.query(
      `SELECT
         c.id,
         c.numero_ciclo,
         c.fecha_inicio,
         c.anio,
         c.clases_pagadas,
         c.monto,
         c.monto_pagado,
         c.metodo_pago,
         c.estado,
         c.created_at,
         CASE
           WHEN c.monto_pagado IS NULL       THEN 'sin_pago'
           WHEN c.monto_pagado < c.monto     THEN 'parcial'
           ELSE                                   'pagado'
         END as estado_pago,
         (c.monto - COALESCE(c.monto_pagado, 0)) as deuda,
         COUNT(a.id) FILTER (WHERE a.estado = 'asistio')  as clases_asistidas,
         COUNT(a.id) FILTER (WHERE a.estado = 'falta')    as clases_falta,
         COUNT(a.id) FILTER (WHERE a.estado = 'permiso')  as clases_permiso
       FROM zumba_cycles c
       LEFT JOIN zumba_attendance a ON a.cycle_id = c.id
       WHERE c.participant_id = $1
       ${anioCondition}
       GROUP BY c.id
       ORDER BY c.anio DESC, c.numero_ciclo DESC`,
      queryParams
    );
 
    res.json({
      ok: true,
      participante: participante.rows[0],
      ciclos: ciclos.rows,
    });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener historial' });
  }
}
 
// ─────────────────────────────────────────────────────────────
// NUEVA FUNCIÓN 2: Reporte general filtrable
// GET /zumba/reportes?anio=2025&numero_ciclo=1&solo_deudas=true
// ─────────────────────────────────────────────────────────────
export async function getReportes(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { anio, numero_ciclo, solo_deudas } = req.query;
 
    const condiciones: string[] = ['p.activo = true'];
    const valores: any[] = [];
 
    if (anio) {
      valores.push(Number(anio));
      condiciones.push(`EXTRACT(YEAR FROM c.fecha_inicio) = $${valores.length}`);
    }
    if (numero_ciclo) {
      valores.push(Number(numero_ciclo));
      condiciones.push(`c.numero_ciclo = $${valores.length}`);
    }
    if (solo_deudas === 'true') {
      condiciones.push(
        `(c.monto_pagado IS NULL OR c.monto_pagado < c.monto)`
      );
    }
 
    const where = `WHERE ${condiciones.join(' AND ')}`;
 
    const resultado = await pool.query(
      `SELECT
         p.id            as participant_id,
         p.nombre,
         p.telefono,
         p.carnet,
         c.id            as ciclo_id,
         c.numero_ciclo,
         c.fecha_inicio,
         c.clases_pagadas,
         c.monto,
         c.monto_pagado,
         c.metodo_pago,
         c.estado        as ciclo_estado,
         CASE
           WHEN c.monto_pagado IS NULL       THEN 'sin_pago'
           WHEN c.monto_pagado < c.monto     THEN 'parcial'
           ELSE                                   'pagado'
         END             as estado_pago,
         (c.monto - COALESCE(c.monto_pagado, 0)) as deuda,
         COUNT(a.id) FILTER (WHERE a.estado = 'asistio')  as clases_asistidas,
         COUNT(a.id) FILTER (WHERE a.estado = 'falta')    as clases_falta,
         COUNT(a.id) FILTER (WHERE a.estado = 'permiso')  as clases_permiso
       FROM zumba_participants p
       JOIN zumba_cycles c ON c.participant_id = p.id
       LEFT JOIN zumba_attendance a ON a.cycle_id = c.id
       ${where}
       GROUP BY p.id, c.id
       ORDER BY p.nombre, c.numero_ciclo DESC`,
      valores
    );
 
    const anios = await pool.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM fecha_inicio)::int as anio
       FROM zumba_cycles ORDER BY anio DESC`
    );
 
    const maxCiclo = await pool.query(
      `SELECT MAX(numero_ciclo) as max FROM zumba_cycles`
    );
 
    res.json({
      ok: true,
      registros: resultado.rows,
      anios_disponibles: anios.rows.map((r: any) => r.anio),
      max_ciclo: maxCiclo.rows[0]?.max || 1,
    });
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener reportes' });
  }
}
 
// ─────────────────────────────────────────────────────────────
// NUEVA FUNCIÓN 3: Actualizar pago de un ciclo
// PATCH /zumba/ciclos/:ciclo_id/pago
// ─────────────────────────────────────────────────────────────
export async function actualizarPagoCiclo(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { ciclo_id } = req.params;
    const { monto_pagado, metodo_pago } = req.body;
 
    if (monto_pagado === undefined || monto_pagado === null) {
      res.status(400).json({ ok: false, mensaje: 'monto_pagado es obligatorio' });
      return;
    }
 
    await pool.query(
      `UPDATE zumba_cycles
       SET monto_pagado = $1,
           metodo_pago  = COALESCE($2, metodo_pago)
       WHERE id = $3`,
      [Number(monto_pagado), metodo_pago || null, ciclo_id]
    );
 
    res.json({ ok: true, mensaje: 'Pago actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar pago:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar pago' });
  }
}

export async function getProfesionalZumba(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const query = `
      SELECT 
        u.id,
        u.nombre,
        u.usuario,
        u.email,
        u.telefono,
        u.especialidad
      FROM users u
      JOIN user_areas ua ON ua.user_id = u.id
      JOIN areas a ON a.id = ua.area_id
      WHERE u.role_id = 3 
        AND u.activo = true
        AND LOWER(a.nombre) = 'zumba'
      LIMIT 1
    `;

    const resultado = await pool.query(query);
    
    res.json({
      ok: true,
      profesional: resultado.rows[0] || null
    });
  } catch (error) {
    console.error('Error al obtener profesional de Zumba:', error);
    res.status(500).json({ 
      ok: false, 
      mensaje: 'Error al obtener profesional de Zumba' 
    });
  }
}