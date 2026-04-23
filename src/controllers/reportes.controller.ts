import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';

export async function getReporteGeneral(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { mes } = req.query;

    let filtroFecha = '';
    const params: any[] = [];

    if (mes) {
      filtroFecha = `AND TO_CHAR(a.fecha_pago, 'YYYY-MM') = $1`;
      params.push(mes);
    }

    const ingresosSalud = await pool.query(
      `SELECT
        ar.nombre as area,
        ar.emoji,
        COUNT(a.id)    as total_sesiones,
        SUM(a.monto)   as total_ingresos
       FROM appointments a
       JOIN areas ar ON a.area_id = ar.id
       WHERE a.estado = 'confirmada'
       AND a.monto IS NOT NULL
       ${filtroFecha}
       GROUP BY ar.id
       ORDER BY total_ingresos DESC`,
      params
    );

    const ingresosZumba = await pool.query(
      `SELECT
        COUNT(c.id)  as total_ciclos,
        SUM(c.monto) as total_ingresos
       FROM zumba_cycles c
       WHERE 1=1
       ${mes ? `AND TO_CHAR(c.fecha_inicio, 'YYYY-MM') = $1` : ''}`,
      mes ? [mes] : []
    );

    const ingresosGeronto = await pool.query(
      `SELECT
        COUNT(c.id)  as total_ciclos,
        SUM(c.monto) as total_ingresos
       FROM geronto_cycles c
       WHERE 1=1
       ${mes ? `AND TO_CHAR(c.fecha_inicio, 'YYYY-MM') = $1` : ''}`,
      mes ? [mes] : []
    );

    const citasHoy = await pool.query(
      `SELECT COUNT(*) as total
       FROM appointments
       WHERE fecha = CURRENT_DATE AND estado = 'confirmada'`
    );

    const citasPendientes = await pool.query(
      `SELECT COUNT(*) as total
       FROM appointments
       WHERE estado = 'pendiente'`
    );

    const totalPacientes = await pool.query(
      `SELECT COUNT(DISTINCT patient_id) as total
       FROM appointments
       WHERE estado = 'confirmada'`
    );

    const totalZumba = await pool.query(
      `SELECT COUNT(*) as total
       FROM zumba_participants
       WHERE activo = true`
    );

    const totalGeronto = await pool.query(
      `SELECT COUNT(*) as total
       FROM geronto_participants
       WHERE activo = true`
    );

    const totalSalud = ingresosSalud.rows.reduce(
      (s: number, r: any) => s + parseFloat(r.total_ingresos || 0), 0
    );
    const totalZ = parseFloat(ingresosZumba.rows[0].total_ingresos || 0);
    const totalG = parseFloat(ingresosGeronto.rows[0].total_ingresos || 0);

    res.json({
      ok: true,
      resumen: {
        citas_hoy:        parseInt(citasHoy.rows[0].total),
        citas_pendientes: parseInt(citasPendientes.rows[0].total),
        total_pacientes:  parseInt(totalPacientes.rows[0].total),
        total_zumba:      parseInt(totalZumba.rows[0].total),
        total_geronto:    parseInt(totalGeronto.rows[0].total),
        ingresos_total:   totalSalud + totalZ + totalG,
        ingresos_salud:   totalSalud,
        ingresos_zumba:   totalZ,
        ingresos_geronto: totalG,
      },
      ingresos_por_area: ingresosSalud.rows,
      ingresos_zumba:    ingresosZumba.rows[0],
      ingresos_geronto:  ingresosGeronto.rows[0],
    });
  } catch (error) {
    console.error('Error al obtener reporte:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener reporte' });
  }
}

export async function getHistorialPagos(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { mes } = req.query;

    const pagosSalud = await pool.query(
      `SELECT
        'salud'       as tipo,
        a.fecha_pago  as fecha,
        p.nombre      as paciente,
        p.carnet,
        ar.nombre     as area,
        ar.emoji,
        a.sesion,
        a.monto,
        a.metodo_pago,
        a.estado_pago
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN areas ar   ON a.area_id    = ar.id
       WHERE a.estado = 'confirmada'
       AND a.monto IS NOT NULL
       ${mes ? `AND TO_CHAR(a.fecha_pago, 'YYYY-MM') = '${mes}'` : ''}
       ORDER BY a.fecha_pago DESC`
    );

    const pagosZumba = await pool.query(
      `SELECT
        'zumba'        as tipo,
        c.fecha_inicio as fecha,
        p.nombre       as paciente,
        p.carnet,
        'Zumba'        as area,
        '💃'           as emoji,
        CONCAT('Ciclo ', c.numero_ciclo) as sesion,
        c.monto,
        c.metodo_pago,
        'pagado completo' as estado_pago
       FROM zumba_cycles c
       JOIN zumba_participants p ON c.participant_id = p.id
       ${mes ? `WHERE TO_CHAR(c.fecha_inicio, 'YYYY-MM') = '${mes}'` : ''}
       ORDER BY c.fecha_inicio DESC`
    );

    const pagosGeronto = await pool.query(
      `SELECT
        'geronto'      as tipo,
        c.fecha_inicio as fecha,
        p.nombre       as paciente,
        p.carnet,
        'Gerontologia' as area,
        '👴'           as emoji,
        CONCAT('Ciclo ', c.numero_ciclo) as sesion,
        c.monto,
        c.metodo_pago,
        'pagado completo' as estado_pago
       FROM geronto_cycles c
       JOIN geronto_participants p ON c.participant_id = p.id
       ${mes ? `WHERE TO_CHAR(c.fecha_inicio, 'YYYY-MM') = '${mes}'` : ''}
       ORDER BY c.fecha_inicio DESC`
    );

    const todos = [
      ...pagosSalud.rows,
      ...pagosZumba.rows,
      ...pagosGeronto.rows,
    ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    res.json({
      ok: true,
      pagos: todos,
      total: todos.length,
    });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener historial' });
  }
}