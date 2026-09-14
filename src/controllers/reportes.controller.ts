import { Response } from 'express';
import pool from '../db/pool';
import { RequestConUsuario } from '../middlewares/auth';
import { diaDeLaSemanaHoy } from '../utils/tiempo';

// Helper: decide si el filtro es solo año ('YYYY') o año+mes ('YYYY-MM')
function formatoDeFecha(valor: string): string {
  return valor.length === 4 ? 'YYYY' : 'YYYY-MM';
}

export async function getReporteGeneral(
  req: RequestConUsuario,
  res: Response
): Promise<void> {
  try {
    const mes = (req.query.mes as string) || undefined;   // 'YYYY-MM'
    const anio = (req.query.anio as string) || undefined; // 'YYYY' (solo si no hay mes)

    // ───────────── Ingresos por área (salud) ─────────────
    const paramsSalud: any[] = [];
    let condSalud = `a.estado = 'confirmada' AND a.monto IS NOT NULL`;
    if (mes) {
      paramsSalud.push(mes);
      condSalud += ` AND TO_CHAR(a.fecha, 'YYYY-MM') = $${paramsSalud.length}`;
    } else if (anio) {
      paramsSalud.push(anio);
      condSalud += ` AND TO_CHAR(a.fecha, 'YYYY') = $${paramsSalud.length}`;
    }

    const ingresosSalud = await pool.query(
  `WITH ciclos_deduplicados AS (
     -- Un representante por ciclo real: si es grupal, se colapsa por grupo_id;
     -- si es individual, por patient_id-area_id-ciclo (como antes).
     SELECT DISTINCT ON (COALESCE(a.grupo_id::text, CONCAT(a.patient_id, '-', a.area_id, '-', a.ciclo)))
       a.area_id,
       a.monto
     FROM appointments a
     WHERE ${condSalud} AND a.sesion::text = '1'
   )
   SELECT
     ar.nombre as area,
     COUNT(*) as total_ciclos,
     SUM(cd.monto) as total_ingresos
   FROM ciclos_deduplicados cd
   JOIN areas ar ON cd.area_id = ar.id
   GROUP BY ar.id, ar.nombre
   ORDER BY total_ingresos DESC`,
  paramsSalud
);

    // ───────────── Ingresos Zumba (respeta mes/año, igual que salud) ─────────────
    const paramsZ: any[] = [];
    let condZ = 'zp.activo = true';
    if (mes) { paramsZ.push(mes); condZ += ` AND TO_CHAR(c.fecha_inicio, 'YYYY-MM') = $${paramsZ.length}`; }
    else if (anio) { paramsZ.push(anio); condZ += ` AND TO_CHAR(c.fecha_inicio, 'YYYY') = $${paramsZ.length}`; }
    const ingresosZumba = await pool.query(
      `SELECT COUNT(c.id) as total_ciclos, SUM(c.monto) as total_ingresos
       FROM zumba_cycles c
       JOIN zumba_participants zp ON zp.id = c.participant_id
       WHERE ${condZ}`,
      paramsZ
    );

    // ───────────── Ingresos Gerontología ─────────────
    // (en ambos casos: si el participante fue eliminado —queda como
    // "activo=false"—, sus ciclos ya no cuentan para los ingresos)
    const paramsG: any[] = [];
    let condG = 'gp.activo = true';
    if (mes) { paramsG.push(mes); condG += ` AND TO_CHAR(c.fecha_inicio, 'YYYY-MM') = $${paramsG.length}`; }
    else if (anio) { paramsG.push(anio); condG += ` AND TO_CHAR(c.fecha_inicio, 'YYYY') = $${paramsG.length}`; }
    const ingresosGeronto = await pool.query(
      `SELECT COUNT(c.id) as total_ciclos, SUM(c.monto) as total_ingresos
       FROM geronto_cycles c
       JOIN geronto_participants gp ON gp.id = c.participant_id
       WHERE ${condG}`,
      paramsG
    );

    // ───────────── Citas: "hoy" si no hay filtro, o "del periodo" si hay mes/año ─────────────
    const paramsCitas: any[] = [];
    let condCitas: string;
    if (mes) {
      paramsCitas.push(mes);
      condCitas = `TO_CHAR(fecha, 'YYYY-MM') = $1 AND estado = 'confirmada'`;
    } else if (anio) {
      paramsCitas.push(anio);
      condCitas = `TO_CHAR(fecha, 'YYYY') = $1 AND estado = 'confirmada'`;
    } else {
      condCitas = `fecha = CURRENT_DATE AND estado = 'confirmada'`;
    }
    const citasPeriodo = await pool.query(
      `SELECT COUNT(*) as total FROM appointments WHERE ${condCitas}`,
      paramsCitas
    );

    // ───────────── Citas pendientes (no depende del periodo) ─────────────
    const citasPendientes = await pool.query(
      `SELECT COUNT(*) as total FROM appointments WHERE estado = 'pendiente'`
    );

    // ───────────── Pacientes: "activos" (global) o "atendidos" (en el periodo elegido) ─────────────
    const paramsPac: any[] = [];
    let condPac = `estado = 'confirmada'`;
    if (mes) {
      paramsPac.push(mes);
      condPac += ` AND TO_CHAR(fecha, 'YYYY-MM') = $${paramsPac.length}`;
    } else if (anio) {
      paramsPac.push(anio);
      condPac += ` AND TO_CHAR(fecha, 'YYYY') = $${paramsPac.length}`;
    }
    const totalPacientes = await pool.query(
      `SELECT COUNT(DISTINCT patient_id) as total FROM appointments WHERE ${condPac}`,
      paramsPac
    );

    // ───────────── Zumba / Gerontología activos: SIEMPRE el total real actual, ─────────────
    // sin importar mes/año elegidos (son programas continuos, no "del mes")
    const totalZumba = await pool.query(`SELECT COUNT(*) as total FROM zumba_participants WHERE activo = true`);
    const totalGeronto = await pool.query(`SELECT COUNT(*) as total FROM geronto_participants WHERE activo = true`);

    const totalSalud = ingresosSalud.rows.reduce(
      (s: number, r: any) => s + parseFloat(r.total_ingresos || 0), 0
    );
    const totalZ = parseFloat(ingresosZumba.rows[0].total_ingresos || 0);
    const totalG = parseFloat(ingresosGeronto.rows[0].total_ingresos || 0);

    res.json({
      ok: true,
      filtro: { mes: mes || null, anio: anio || null },
      resumen: {
        citas_hoy:        parseInt(citasPeriodo.rows[0].total),
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
    const mes = (req.query.mes as string) || undefined; // 'YYYY' o 'YYYY-MM'
    const formato = mes ? formatoDeFecha(mes) : null;

   const paramsSalud: any[] = [];
// ✅ Solo tomamos la sesión 1 de cada ciclo (ahí vive el monto/metodo_pago real);
// así cada ciclo —individual o grupal— aporta exactamente una fila de origen.
let condSalud = `a.estado = 'confirmada' AND a.monto IS NOT NULL AND a.sesion::text = '1'`;
if (mes) {
  paramsSalud.push(mes);
  condSalud += ` AND TO_CHAR(a.fecha, '${formato}') = $${paramsSalud.length}`;
}

const pagosSalud = await pool.query(
  `SELECT
     'salud' as tipo,
     MIN(a.fecha) as fecha,
     STRING_AGG(DISTINCT p.nombre, ' + ' ORDER BY p.nombre) as paciente,
     STRING_AGG(DISTINCT p.carnet, ', ') as carnet,
     ar.nombre as area,
     CONCAT('Ciclo ', a.ciclo, ' (', MAX(a.total_sesiones), ' sesiones)') as sesion,
     MAX(a.monto) as monto,
     MAX(a.metodo_pago) as metodo_pago,
     MAX(a.estado_pago) as estado_pago
   FROM appointments a
   JOIN patients p ON a.patient_id = p.id
   JOIN areas ar   ON a.area_id    = ar.id
   WHERE ${condSalud}
   -- ✅ Clave de agrupación: si la cita tiene grupo_id (cita grupal), todos
   -- los pacientes de ese grupo caen en la MISMA fila. Si no tiene grupo_id
   -- (cita individual), se agrupa como antes: por paciente + área + ciclo.
   GROUP BY COALESCE(a.grupo_id::text, CONCAT(a.patient_id, '-', a.area_id, '-', a.ciclo)),
            a.area_id, a.ciclo, ar.nombre
   ORDER BY MIN(a.fecha) DESC`,
  paramsSalud
);

    const paramsZ: any[] = [];
    // Si el participante fue eliminado (queda como activo=false), sus pagos
    // ya no deben aparecer en el historial.
    let condZ = 'p.activo = true';
    if (mes) {
      paramsZ.push(mes);
      condZ += ` AND TO_CHAR(c.fecha_inicio, '${formato}') = $${paramsZ.length}`;
    }
    const pagosZumba = await pool.query(
      `SELECT
        'zumba'        as tipo,
        c.fecha_inicio as fecha,
        p.nombre       as paciente,
        p.carnet,
        'Zumba'        as area,
        CONCAT('Ciclo ', c.numero_ciclo) as sesion,
        c.monto,
        c.metodo_pago,
        'pagado completo' as estado_pago
       FROM zumba_cycles c
       JOIN zumba_participants p ON c.participant_id = p.id
       WHERE ${condZ}
       ORDER BY c.fecha_inicio DESC`,
      paramsZ
    );

    const paramsG: any[] = [];
    let condG = 'p.activo = true';
    if (mes) {
      paramsG.push(mes);
      condG += ` AND TO_CHAR(c.fecha_inicio, '${formato}') = $${paramsG.length}`;
    }
    const pagosGeronto = await pool.query(
      `SELECT
        'geronto'      as tipo,
        c.fecha_inicio as fecha,
        p.nombre       as paciente,
        p.carnet,
        'Gerontologia' as area,
        CONCAT('Ciclo ', c.numero_ciclo) as sesion,
        c.monto,
        c.metodo_pago,
        'pagado completo' as estado_pago
       FROM geronto_cycles c
       JOIN geronto_participants p ON c.participant_id = p.id
       WHERE ${condG}
       ORDER BY c.fecha_inicio DESC`,
      paramsG
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
    // Día de hoy en Bolivia (no en la zona del servidor, que en Render es UTC
    // y cambiaría de día a las 20:00 hora boliviana).
    const diaNombre = diaDeLaSemanaHoy();

        // 👇 Si es profesional: filtra por su(s) área(s) Y por que la cita sea suya
    // (antes solo filtraba por área, mostrando pacientes de otros profesionales
    // de la misma área — esto lo corrige).
    const esProfesional = req.usuario?.rol === 'profesional';
    const areasUsuario = req.usuario?.areas || [];
    const filtroArea = esProfesional ? 'AND ar.nombre = ANY($1) AND a.professional_id = $2' : '';
    const paramsArea = esProfesional ? [areasUsuario, req.usuario!.id] : [];

        const citasHoy = await pool.query(
      `SELECT
        a.id, a.hora::text, a.estado, a.modalidad, a.asistio,
        a.monto_pagado, a.metodo_pago, a.sesion, a.total_sesiones, a.ciclo, a.grupo_id,
        p.id as patient_id, p.nombre as paciente_nombre, p.telefono as paciente_telefono,
        p.contacto_relacion as paciente_contacto_relacion,
        p.contacto_nombre as paciente_contacto_nombre,
        p.contacto_telefono as paciente_contacto_telefono,
        u.nombre as profesional_nombre,
        ar.nombre as area_nombre,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'patient_id', p2.id, 'nombre', p2.nombre, 'telefono', p2.telefono,
            'contacto_nombre', p2.contacto_nombre, 'contacto_telefono', p2.contacto_telefono,
            'contacto_relacion', p2.contacto_relacion
          )), '[]'::json)
          FROM appointments a2
          JOIN patients p2 ON a2.patient_id = p2.id
          WHERE a2.grupo_id = a.grupo_id AND a2.id != a.id AND a.grupo_id IS NOT NULL
        ) as companeros
       FROM appointments a
       JOIN patients p  ON a.patient_id      = p.id
       JOIN users u     ON a.professional_id = u.id
       JOIN areas ar    ON a.area_id         = ar.id
       WHERE a.fecha = CURRENT_DATE
       ${filtroArea}
       ORDER BY a.hora ASC`,
      paramsArea
    );

             const citasManana = await pool.query(
      `SELECT
        a.id, a.hora::text, a.estado, a.sesion, a.total_sesiones, a.grupo_id,
        p.id as patient_id, p.nombre as paciente_nombre, p.telefono as paciente_telefono,
        p.contacto_relacion as paciente_contacto_relacion,
        p.contacto_nombre as paciente_contacto_nombre,
        p.contacto_telefono as paciente_contacto_telefono,
        u.nombre as profesional_nombre,
        ar.nombre as area_nombre,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'patient_id', p2.id, 'nombre', p2.nombre, 'telefono', p2.telefono,
            'contacto_nombre', p2.contacto_nombre, 'contacto_telefono', p2.contacto_telefono,
            'contacto_relacion', p2.contacto_relacion
          )), '[]'::json)
          FROM appointments a2
          JOIN patients p2 ON a2.patient_id = p2.id
          WHERE a2.grupo_id = a.grupo_id AND a2.id != a.id AND a.grupo_id IS NOT NULL
        ) as companeros
       FROM appointments a
       JOIN patients p  ON a.patient_id      = p.id
       JOIN users u     ON a.professional_id = u.id
       JOIN areas ar    ON a.area_id         = ar.id
       WHERE a.fecha = CURRENT_DATE + INTERVAL '1 day'
       ${filtroArea}
       ORDER BY a.hora ASC`,
      paramsArea
    );

    const ingresosHoySalud = await pool.query(
  `SELECT COALESCE(SUM(a.monto_pagado), 0) as total
   FROM appointments a
   WHERE a.fecha = CURRENT_DATE AND a.estado = 'confirmada' AND a.sesion::text = '1'`
);

const ingresosMesSalud = await pool.query(
  `SELECT COALESCE(SUM(a.monto_pagado), 0) as total
   FROM appointments a
   WHERE TO_CHAR(a.fecha, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
   AND a.estado = 'confirmada' AND a.sesion::text = '1'`
);

    const ingresosMesZumba = await pool.query(
      `SELECT COALESCE(SUM(zc.monto), 0) as total
       FROM zumba_cycles zc
       JOIN zumba_participants zp ON zp.id = zc.participant_id
       WHERE zp.activo = true
       AND TO_CHAR(zc.fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')`
    );

    const ingresosMesGeronto = await pool.query(
      `SELECT COALESCE(SUM(gc.monto), 0) as total
       FROM geronto_cycles gc
       JOIN geronto_participants gp ON gp.id = gc.participant_id
       WHERE gp.activo = true
       AND TO_CHAR(gc.fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')`
    );

    // 👇 También filtrado, para no mostrarle a un profesional
    // pacientes de otra área completando ciclo hoy
    const ciclosCompletos = await pool.query(
      `SELECT
        p.nombre as paciente_nombre,
        ar.nombre as area_nombre,
        a.total_sesiones, a.ciclo,
        u.nombre as profesional_nombre
       FROM appointments a
       JOIN patients p  ON a.patient_id      = p.id
       JOIN users u     ON a.professional_id = u.id
       JOIN areas ar    ON a.area_id         = ar.id
       WHERE a.fecha = CURRENT_DATE
       AND a.estado = 'confirmada'
       AND a.sesion::text = a.total_sesiones::text
       ${filtroArea}`,
      paramsArea
    );

    const profHoy = await pool.query(
      `SELECT DISTINCT
        u.nombre as profesional_nombre,
        ar.nombre as area_nombre,
        COUNT(a.id) as total_citas
       FROM appointments a
       JOIN users u  ON a.professional_id = u.id
       JOIN areas ar ON a.area_id = ar.id
       WHERE a.fecha = CURRENT_DATE
       ${filtroArea}
       GROUP BY u.id, u.nombre, ar.nombre
       ORDER BY total_citas DESC`,
      paramsArea
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
       WHERE zp.activo = true
       AND TO_CHAR(zc.fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       ORDER BY zc.fecha_inicio DESC
       LIMIT 5`
    );

    const gerontoCiclosMes = await pool.query(
      `SELECT
        gp.nombre as participante,
        gc.numero_ciclo, gc.monto, gc.metodo_pago, gc.fecha_inicio
       FROM geronto_cycles gc
       JOIN geronto_participants gp ON gc.participant_id = gp.id
       WHERE gp.activo = true
       AND TO_CHAR(gc.fecha_inicio, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       ORDER BY gc.fecha_inicio DESC
       LIMIT 5`
    );

    // Zumba y Gerontología: SIN filtrar, se muestran igual para todos
    const zumbaHorarios = await pool.query(
      `SELECT hora_inicio::text, hora_fin::text, dia
       FROM zumba_horarios
       WHERE activo = true
       ORDER BY CASE dia
         WHEN 'Lunes' THEN 1 WHEN 'Martes' THEN 2 WHEN 'Miercoles' THEN 3
         WHEN 'Jueves' THEN 4 WHEN 'Viernes' THEN 5 WHEN 'Sabado' THEN 6
         WHEN 'Domingo' THEN 7 END, hora_inicio ASC`
    );

    const gerontoActividades = await pool.query(
      `SELECT
         ga.id, ga.nombre, ga.hora_inicio::text, ga.hora_fin::text, ga.dia, ga.precio,
         COUNT(DISTINCT gca.cycle_id) as inscritos
       FROM geronto_activities ga
       LEFT JOIN geronto_cycle_activities gca ON gca.activity_id = ga.id
       LEFT JOIN geronto_cycles gc ON gc.id = gca.cycle_id
       WHERE ga.activo = true
       GROUP BY ga.id
       ORDER BY CASE ga.dia
         WHEN 'Lunes' THEN 1 WHEN 'Martes' THEN 2 WHEN 'Miercoles' THEN 3
         WHEN 'Jueves' THEN 4 WHEN 'Viernes' THEN 5 WHEN 'Sabado' THEN 6
         WHEN 'Domingo' THEN 7 END, ga.hora_inicio ASC`
    );

    // 👇 FILTRADO: pacientes activos por área
    const pacientesActivos = await pool.query(
      `SELECT COUNT(DISTINCT a.patient_id) as total
       FROM appointments a
       JOIN areas ar ON a.area_id = ar.id
       WHERE a.estado = 'confirmada'
       AND a.asistio IS NULL
       ${filtroArea}`,
      paramsArea
    );

    // 👇 FILTRADO: sesiones activas por área
    const sesionesActivas = await pool.query(
      `SELECT COUNT(*) as total
       FROM appointments a
       JOIN areas ar ON a.area_id = ar.id
       WHERE a.estado = 'confirmada'
       AND a.asistio IS NULL
       ${filtroArea}`,
      paramsArea
    );

    // Cursos/capacitaciones/seminarios (bloqueos_agenda) de hoy y mañana, para que
    // el Dashboard avise que ese profesional no está disponible esos días.
    const filtroAreaBloqueo = esProfesional ? 'AND ar.nombre = ANY($1) AND b.professional_id = $2' : '';
    const bloqueosHoy = await pool.query(
      `SELECT b.id, b.nombre, b.tipo, b.hora_inicio::text, b.hora_fin::text,
              u.nombre as profesional_nombre, ar.nombre as area_nombre
       FROM bloqueos_agenda b
       JOIN users u ON u.id = b.professional_id
       JOIN areas ar ON ar.id = b.area_id
       WHERE b.fecha = CURRENT_DATE
       ${filtroAreaBloqueo}
       ORDER BY b.hora_inicio ASC`,
      paramsArea
    );
    const bloqueosManana = await pool.query(
      `SELECT b.id, b.nombre, b.tipo, b.hora_inicio::text, b.hora_fin::text,
              u.nombre as profesional_nombre, ar.nombre as area_nombre
       FROM bloqueos_agenda b
       JOIN users u ON u.id = b.professional_id
       JOIN areas ar ON ar.id = b.area_id
       WHERE b.fecha = CURRENT_DATE + INTERVAL '1 day'
       ${filtroAreaBloqueo}
       ORDER BY b.hora_inicio ASC`,
      paramsArea
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
      bloqueosHoy: bloqueosHoy.rows,
      bloqueosManana: bloqueosManana.rows,
      ingresosHoy,
      ingresosMes,
      ingresosMesSalud: parseFloat(ingresosMesSalud.rows[0].total),
      ingresosMesZumba: parseFloat(ingresosMesZumba.rows[0].total),
      ingresosMesGeronto: parseFloat(ingresosMesGeronto.rows[0].total),
      ciclosCompletos: ciclosCompletos.rows,
      profHoy: profHoy.rows,
      pacientesActivos: parseInt(pacientesActivos.rows[0].total),
      sesionesActivas: parseInt(sesionesActivas.rows[0].total),
      zumba: {
        activos: parseInt(zumbaActivos.rows[0].total),
        ciclosMes: zumbaCiclosMes.rows,
        horarios: zumbaHorarios.rows,
      },
      geronto: {
        activos: parseInt(gerontoActivos.rows[0].total),
        ciclosMes: gerontoCiclosMes.rows,
        actividades: gerontoActividades.rows,
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

        COUNT(DISTINCT a.patient_id) as total_pacientes,
        COUNT(*) as total_sesiones,
        COALESCE(SUM(a.monto_pagado), 0) as ingresos
      FROM appointments a
      JOIN areas ar ON a.area_id = ar.id
      WHERE a.estado = 'confirmada'
      ${filtroFecha}
      GROUP BY a.area_id, ar.nombre
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
         GROUP BY ar.id, ar.nombre, date_trunc('week', a.fecha)
         ORDER BY ar.nombre, periodo_orden ASC`
      );
      res.json({ ok: true, tipo: 'semanal', data: result.rows });

    } else if (periodo === 'anual') {
      // Cada año disponible por área
      const result = await pool.query(
        `SELECT
          ar.id as area_id,
          ar.nombre as area_nombre,
          TO_CHAR(a.fecha, 'YYYY') as periodo_label,
          DATE_TRUNC('year', a.fecha) as periodo_orden,
          COUNT(DISTINCT a.patient_id) as total_pacientes,
          COUNT(*) as total_sesiones,
          COALESCE(SUM(CASE WHEN a.sesion::text = '1' THEN a.monto_pagado ELSE 0 END), 0) as ingresos
         FROM appointments a
         JOIN areas ar ON a.area_id = ar.id
         WHERE a.estado = 'confirmada'
         GROUP BY ar.id, ar.nombre, DATE_TRUNC('year', a.fecha)
         ORDER BY ar.nombre, periodo_orden ASC`
      );
      res.json({ ok: true, tipo: 'anual', data: result.rows });

    } else {
  // Mensual — todos los meses desde el primero hasta el último
  const result = await pool.query(
    `WITH ciclos_deduplicados AS (
       SELECT DISTINCT ON (COALESCE(a.grupo_id::text, CONCAT(a.patient_id, '-', a.area_id, '-', a.ciclo)))
         a.area_id,
         a.patient_id,
         a.monto_pagado,
         DATE_TRUNC('month', a.fecha) as periodo_orden,
         TO_CHAR(DATE_TRUNC('month', a.fecha), 'Mon YYYY') as periodo_label
       FROM appointments a
       WHERE a.estado = 'confirmada' AND a.sesion::text = '1'
     ),
     sesiones_totales AS (
       SELECT
         area_id,
         DATE_TRUNC('month', fecha) as periodo_orden,
         COUNT(*) as total_sesiones
       FROM appointments
       WHERE estado = 'confirmada'
       GROUP BY area_id, DATE_TRUNC('month', fecha)
     )
     SELECT
       ar.id as area_id,
       ar.nombre as area_nombre,
       cd.periodo_label,
       cd.periodo_orden,
       COUNT(DISTINCT cd.patient_id) as total_pacientes,
       COALESCE(st.total_sesiones, 0) as total_sesiones,
       COALESCE(SUM(cd.monto_pagado), 0) as ingresos
     FROM ciclos_deduplicados cd
     JOIN areas ar ON cd.area_id = ar.id
     LEFT JOIN sesiones_totales st ON st.area_id = cd.area_id AND st.periodo_orden = cd.periodo_orden
     GROUP BY ar.id, ar.nombre, cd.periodo_label, cd.periodo_orden, st.total_sesiones
     ORDER BY ar.nombre, cd.periodo_orden ASC`
  );
  res.json({ ok: true, tipo: 'mensual', data: result.rows });
}

  } catch (error) {
    console.error('Error al obtener progreso temporal:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al obtener progreso' });
  }
}