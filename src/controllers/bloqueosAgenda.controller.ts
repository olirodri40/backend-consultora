import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { registrarAudit } from '../db/audit';

// GET /api/bloqueos-agenda?desde=&hasta=&professional_id=
// Trae los bloqueos (cursos/capacitaciones/seminarios) en un rango de fechas,
// para pintarlos en la grilla de Agenda igual que las citas.
export async function getBloqueos(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { desde, hasta, professional_id } = req.query;

    let query = `
      SELECT b.id, b.professional_id, b.area_id, b.nombre, b.tipo,
             b.fecha::text, b.hora_inicio::text, b.hora_fin::text, b.notas,
             u.nombre as profesional_nombre, ar.nombre as area_nombre
      FROM bloqueos_agenda b
      JOIN users u ON u.id = b.professional_id
      JOIN areas ar ON ar.id = b.area_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let n = 1;

    if (desde) {
      query += ` AND b.fecha >= $${n++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND b.fecha <= $${n++}`;
      params.push(hasta);
    }
    if (professional_id) {
      query += ` AND b.professional_id = $${n++}`;
      params.push(professional_id);
    }
    query += ` ORDER BY b.fecha, b.hora_inicio`;

    const resultado = await pool.query(query, params);
    res.json({ ok: true, bloqueos: resultado.rows });
  } catch (error) {
    console.error('Error al obtener bloqueos de agenda:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener los bloqueos de agenda' });
  }
}

// POST /api/bloqueos-agenda
// body: { professional_id, area_id, nombre, tipo, fechas: string[], hora_inicio, hora_fin, notas? }
// Crea un bloqueo por cada fecha del arreglo (todas comparten nombre/tipo/horario),
// validando que ninguna choque con una cita real o con otro bloqueo ya existente.
export async function crearBloqueo(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { professional_id, area_id, nombre, tipo, fechas, hora_inicio, hora_fin, notas } = req.body;

    if (!professional_id || !area_id || !nombre || !Array.isArray(fechas) || fechas.length === 0 || !hora_inicio || !hora_fin) {
      res.status(400).json({ ok: false, mensaje: 'Faltan datos obligatorios del bloqueo' });
      return;
    }
    if (hora_fin <= hora_inicio) {
      res.status(400).json({ ok: false, mensaje: 'La hora de fin debe ser posterior a la hora de inicio' });
      return;
    }
    const tiposValidos = ['virtual', 'presencial', 'semipresencial'];
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'presencial';

    // Validar conflictos ANTES de insertar nada (todo o nada)
    for (const fecha of fechas) {
      const conflictoCita = await pool.query(
        `SELECT id FROM appointments
         WHERE professional_id=$1 AND fecha=$2 AND estado != 'cancelada'
           AND hora >= $3::time AND hora < $4::time`,
        [professional_id, fecha, hora_inicio, hora_fin]
      );
      if (conflictoCita.rows.length > 0) {
        res.status(409).json({ ok: false, mensaje: `El profesional ya tiene una cita el ${fecha} entre ${hora_inicio} y ${hora_fin}` });
        return;
      }

      const conflictoBloqueo = await pool.query(
        `SELECT id FROM bloqueos_agenda
         WHERE professional_id=$1 AND fecha=$2 AND hora_inicio < $4::time AND hora_fin > $3::time`,
        [professional_id, fecha, hora_inicio, hora_fin]
      );
      if (conflictoBloqueo.rows.length > 0) {
        res.status(409).json({ ok: false, mensaje: `El profesional ya tiene otro curso/bloqueo el ${fecha} que se cruza con ese horario` });
        return;
      }
    }

    const idsCreados: number[] = [];
    for (const fecha of fechas) {
      const resultado = await pool.query(
        `INSERT INTO bloqueos_agenda (professional_id, area_id, nombre, tipo, fecha, hora_inicio, hora_fin, notas, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [professional_id, area_id, nombre, tipoFinal, fecha, hora_inicio, hora_fin, notas || null, req.usuario!.id]
      );
      idsCreados.push(resultado.rows[0].id);
    }

    await registrarAudit({
      tabla: 'bloqueos_agenda',
      registro_id: idsCreados[0],
      accion: 'crear',
      datos_despues: { professional_id, area_id, nombre, tipo: tipoFinal, fechas, hora_inicio, hora_fin },
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.status(201).json({ ok: true, mensaje: 'Bloqueo creado correctamente', ids: idsCreados });
  } catch (error) {
    console.error('Error al crear bloqueo de agenda:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear el bloqueo de agenda' });
  }
}

// DELETE /api/bloqueos-agenda/:id
export async function eliminarBloqueo(req: RequestConUsuario, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const resultado = await pool.query('DELETE FROM bloqueos_agenda WHERE id = $1 RETURNING id', [id]);
    if (resultado.rows.length === 0) {
      res.status(404).json({ ok: false, mensaje: 'Bloqueo no encontrado' });
      return;
    }

    await registrarAudit({
      tabla: 'bloqueos_agenda',
      registro_id: Number(id),
      accion: 'eliminar',
      user_id: req.usuario!.id,
      user_nombre: req.usuario!.rol,
      user_rol: req.usuario!.rol,
      ip: req.ip,
    });

    res.json({ ok: true, mensaje: 'Bloqueo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar bloqueo de agenda:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el bloqueo' });
  }
}
