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
    COUNT(DISTINCT CONCAT(a.patient_id, '-', a.area_id, '-', a.ciclo)) as total_ciclos,
    SUM(a.monto) FILTER (WHERE a.sesion::text = '1') as total_ingresos
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
  `WITH ciclos_agrupados AS (
    SELECT
      patient_id,
      area_id,
      ciclo,
      COUNT(*) as total_sesiones,
      MAX(monto) as monto_ciclo,
      MAX(metodo_pago) as metodo_pago,
      MAX(estado_pago) as estado_pago,
      MIN(fecha) as fecha_inicio
    FROM appointments
    WHERE estado = 'confirmada'
    AND monto IS NOT NULL
    ${mes ? `AND TO_CHAR(fecha, 'YYYY-MM') = '${mes}'` : ''}
    GROUP BY patient_id, area_id, ciclo
  )
  SELECT
    'salud'       as tipo,
    ca.fecha_inicio as fecha,
    p.nombre      as paciente,
    p.carnet,
    ar.nombre     as area,
    ar.emoji,
    CONCAT('Ciclo ', ca.ciclo, ' (', ca.total_sesiones, ' sesiones)') as sesion,
    ca.monto_ciclo as monto,
    ca.metodo_pago as metodo_pago,
    ca.estado_pago as estado_pago
   FROM ciclos_agrupados ca
   JOIN patients p ON ca.patient_id = p.id
   JOIN areas ar   ON ca.area_id    = ar.id
   ORDER BY ca.fecha_inicio DESC`
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

export async function getDashboard(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const diasSemana: Record<number, string> = {
      0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miercoles',
      4: 'Jueves', 5: 'Viernes', 6: 'Sabado'
    };
    const diaNombre = diasSemana[new Date().getDay()];

    const citasHoy = await pool.query(
      `SELECT
        a.id, a.hora::text, a.estado, a.modalidad, a.asistio,
        a.monto_pagado, a.metodo_pago, a.sesion, a.total_sesiones, a.ciclo,
        p.nombre as paciente_nombre, p.telefono as paciente_telefono,
        u.nombre as profesional_nombre,
        ar.nombre as area_nombre, ar.emoji as area_emoji, ar.color as area_color
       FROM appointments a
       JOIN patients p  ON a.patient_id      = p.id
       JOIN users u     ON a.professional_id = u.id
       JOIN areas ar    ON a.area_id         = ar.id
       WHERE a.fecha = CURRENT_DATE
       ORDER BY a.hora ASC`
    );

    const citasManana = await pool.query(
      `SELECT
        a.id, a.hora::text, a.estado,
        p.nombre as paciente_nombre,
        u.nombre as profesional_nombre,
        ar.nombre as area_nombre, ar.emoji as area_emoji
       FROM appointments a
       JOIN patients p  ON a.patient_id      = p.id
       JOIN users u     ON a.professional_id = u.id
       JOIN areas ar    ON a.area_id         = ar.id
       WHERE a.fecha = CURRENT_DATE + INTERVAL '1 day'
       ORDER BY a.hora ASC`
    );

    const ingresosHoySalud = await pool.query(
      `SELECT COALESCE(SUM(a.monto_pagado), 0) as total
       FROM appointments a
       WHERE a.fecha = CURRENT_DATE
       AND a.estado = 'confirmada'
       AND a.sesion::text = '1'`
    );

    const ingresosMesSalud = await pool.query(
      `SELECT COALESCE(SUM(a.monto_pagado), 0) as total
       FROM appointments a
       WHERE TO_CHAR(a.fecha, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       AND a.estado = 'confirmada'
       AND a.sesion::text = '1'`
    );

    const ingresosMesZumba = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) as total
       FROM zumba_cycles
       WHERE TO_CHAR(fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')`
    );

    const ingresosMesGeronto = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) as total
       FROM geronto_cycles
       WHERE TO_CHAR(fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')`
    );

    const ciclosCompletos = await pool.query(
      `SELECT
        p.nombre as paciente_nombre,
        ar.nombre as area_nombre, ar.emoji as area_emoji,
        a.total_sesiones, a.ciclo,
        u.nombre as profesional_nombre
       FROM appointments a
       JOIN patients p  ON a.patient_id      = p.id
       JOIN users u     ON a.professional_id = u.id
       JOIN areas ar    ON a.area_id         = ar.id
       WHERE a.fecha = CURRENT_DATE
       AND a.estado = 'confirmada'
       AND a.sesion::text = a.total_sesiones::text`
    );

    const profHoy = await pool.query(
      `SELECT DISTINCT
        u.nombre as profesional_nombre,
        ar.nombre as area_nombre, ar.emoji as area_emoji,
        COUNT(a.id) as total_citas
       FROM appointments a
       JOIN users u  ON a.professional_id = u.id
       JOIN areas ar ON a.area_id = ar.id
       WHERE a.fecha = CURRENT_DATE
       GROUP BY u.id, u.nombre, ar.nombre, ar.emoji
       ORDER BY total_citas DESC`
    );

    const zumbaActivos = await pool.query(
      `SELECT COUNT(*) as total FROM zumba_participants WHERE activo = true`
    );

    const gerontoActivos = await pool.query(
      `SELECT COUNT(*) as total FROM geronto_participants WHERE activo = true`
    );

    const zumbaCiclosMes = await pool.query(
      `SELECT
        zp.nombre as participante,
        zc.numero_ciclo, zc.clases_pagadas, zc.monto, zc.metodo_pago, zc.fecha_inicio
       FROM zumba_cycles zc
       JOIN zumba_participants zp ON zc.participant_id = zp.id
       WHERE TO_CHAR(zc.fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       ORDER BY zc.fecha_inicio DESC
       LIMIT 5`
    );

    const gerontoCiclosMes = await pool.query(
      `SELECT
        gp.nombre as participante,
        gc.numero_ciclo, gc.monto, gc.metodo_pago, gc.fecha_inicio
       FROM geronto_cycles gc
       JOIN geronto_participants gp ON gc.participant_id = gp.id
       WHERE TO_CHAR(gc.fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       ORDER BY gc.fecha_inicio DESC
       LIMIT 5`
    );

    const zumbaHoy = await pool.query(
      `SELECT hora_inicio::text, hora_fin::text, dia
       FROM zumba_horarios
       WHERE activo = true AND dia = $1`,
      [diaNombre]
    );

    const gerontoHoy = await pool.query(
      `SELECT
        ga.id, ga.nombre, ga.emoji, ga.hora_inicio::text, ga.hora_fin::text, ga.dia,
        COUNT(DISTINCT gca.cycle_id) as inscritos
       FROM geronto_activities ga
       LEFT JOIN geronto_cycle_activities gca ON gca.activity_id = ga.id
       LEFT JOIN geronto_cycles gc ON gc.id = gca.cycle_id
       WHERE ga.dia = $1
       GROUP BY ga.id`,
      [diaNombre]
    );

    const ingresosHoy = parseFloat(ingresosHoySalud.rows[0].total);
    const ingresosMes =
      parseFloat(ingresosMesSalud.rows[0].total) +
      parseFloat(ingresosMesZumba.rows[0].total) +
      parseFloat(ingresosMesGeronto.rows[0].total);

    res.json({
      ok: true,
      citasHoy: citasHoy.rows,
      citasManana: citasManana.rows,
      ingresosHoy,
      ingresosMes,
      ingresosMesSalud: parseFloat(ingresosMesSalud.rows[0].total),
      ingresosMesZumba: parseFloat(ingresosMesZumba.rows[0].total),
      ingresosMesGeronto: parseFloat(ingresosMesGeronto.rows[0].total),
      ciclosCompletos: ciclosCompletos.rows,
      profHoy: profHoy.rows,
      zumba: {
        activos: parseInt(zumbaActivos.rows[0].total),
        ciclosMes: zumbaCiclosMes.rows,
        horariosHoy: zumbaHoy.rows,
      },
      geronto: {
        activos: parseInt(gerontoActivos.rows[0].total),
        ciclosMes: gerontoCiclosMes.rows,
        actividadesHoy: gerontoHoy.rows,
      },
    });
  } catch (error) {
    console.error('Error al obtener dashboard:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener dashboard' });
  }
}

export async function getProgresoAreas(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { periodo } = req.query;

    let filtroFecha = '';
    if (periodo === 'semanal') {
      filtroFecha = `AND a.fecha >= date_trunc('week', CURRENT_DATE)::date AND a.fecha <= CURRENT_DATE`;
    } else if (periodo === 'anual') {
      filtroFecha = `AND a.fecha >= date_trunc('year', CURRENT_DATE)::date AND a.fecha <= CURRENT_DATE`;
    } else {
      filtroFecha = `AND a.fecha >= date_trunc('month', CURRENT_DATE)::date AND a.fecha <= CURRENT_DATE`;
    }

    const result = await pool.query(
      `SELECT
        a.area_id,
        ar.nombre as area_nombre,
        ar.emoji as area_emoji,
        COUNT(DISTINCT a.patient_id) as total_pacientes,
        COUNT(*) as total_sesiones,
        COALESCE(SUM(a.monto_pagado), 0) as ingresos
      FROM appointments a
      JOIN areas ar ON a.area_id = ar.id
      WHERE a.estado = 'confirmada'
      ${filtroFecha}
      GROUP BY a.area_id, ar.nombre, ar.emoji
      ORDER BY total_pacientes DESC`
    );

    res.json({ ok: true, data: result.rows });
  } catch (error) {
    console.error('Error al obtener progreso por áreas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener progreso' });
  }
}
export async function getProgresoTemporal(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const { periodo } = req.query;

    if (periodo === 'semanal') {
      // Últimas 4 semanas por área
      const result = await pool.query(
        `SELECT
          ar.id as area_id,
          ar.nombre as area_nombre,
          ar.emoji as area_emoji,
          TO_CHAR(date_trunc('week', a.fecha), 'DD/MM') || ' - ' ||
          TO_CHAR(date_trunc('week', a.fecha) + INTERVAL '6 days', 'DD/MM') as periodo_label,
          date_trunc('week', a.fecha) as periodo_orden,
          COUNT(DISTINCT CASE WHEN a.sesion::text = '1' THEN a.patient_id END) as total_pacientes,
          COUNT(*) as total_sesiones,
          COALESCE(SUM(CASE WHEN a.sesion::text = '1' THEN a.monto_pagado ELSE 0 END), 0) as ingresos
         FROM appointments a
         JOIN areas ar ON a.area_id = ar.id
         WHERE a.estado = 'confirmada'
         AND a.fecha >= date_trunc('week', CURRENT_DATE) - INTERVAL '3 weeks'
         AND a.fecha <= CURRENT_DATE
         GROUP BY ar.id, ar.nombre, ar.emoji, date_trunc('week', a.fecha)
         ORDER BY ar.nombre, periodo_orden ASC`
      );
      res.json({ ok: true, tipo: 'semanal', data: result.rows });

    } else if (periodo === 'anual') {
      // Cada año disponible por área
      const result = await pool.query(
        `SELECT
          ar.id as area_id,
          ar.nombre as area_nombre,
          ar.emoji as area_emoji,
          TO_CHAR(a.fecha, 'YYYY') as periodo_label,
          DATE_TRUNC('year', a.fecha) as periodo_orden,
          COUNT(DISTINCT a.patient_id) as total_pacientes,
          COUNT(*) as total_sesiones,
          COALESCE(SUM(CASE WHEN a.sesion::text = '1' THEN a.monto_pagado ELSE 0 END), 0) as ingresos
         FROM appointments a
         JOIN areas ar ON a.area_id = ar.id
         WHERE a.estado = 'confirmada'
         GROUP BY ar.id, ar.nombre, ar.emoji, DATE_TRUNC('year', a.fecha)
         ORDER BY ar.nombre, periodo_orden ASC`
      );
      res.json({ ok: true, tipo: 'anual', data: result.rows });

    } else {
      // Mensual — todos los meses desde el primero hasta el último
      const result = await pool.query(
        `SELECT
          ar.id as area_id,
          ar.nombre as area_nombre,
          ar.emoji as area_emoji,
          TO_CHAR(DATE_TRUNC('month', a.fecha), 'Mon YYYY') as periodo_label,
          DATE_TRUNC('month', a.fecha) as periodo_orden,
           COUNT(DISTINCT CASE WHEN a.sesion::text = '1' THEN a.patient_id END) as total_pacientes,
          COUNT(*) as total_sesiones,
          COALESCE(SUM(CASE WHEN a.sesion::text = '1' THEN a.monto_pagado ELSE 0 END), 0) as ingresos
         FROM appointments a
         JOIN areas ar ON a.area_id = ar.id
         WHERE a.estado = 'confirmada'
         GROUP BY ar.id, ar.nombre, ar.emoji, DATE_TRUNC('month', a.fecha)
         ORDER BY ar.nombre, periodo_orden ASC`
      );
      res.json({ ok: true, tipo: 'mensual', data: result.rows });
    }

  } catch (error) {
    console.error('Error al obtener progreso temporal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener progreso' });
  }
}