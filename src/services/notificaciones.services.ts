import pool from '../db/pool';
import webpush from '../db/webpush';

// ─────────────────────────────────────────────
// Helper interno: busca destinatarios por área/rol
// y les manda la notificación (guardada en la app + push)
// ─────────────────────────────────────────────
// `profesionalId`: si la cita/reserva ya tiene un profesional específico
// asignado (que es el caso normal), la notificación de rol "profesional"
// llega SOLO a ese usuario — no a todos los que trabajan en la misma área.
// Si no se pasa (ej. un aviso general del área sin profesional puntual), se
// mantiene el comportamiento anterior: le llega a todos los del área.
async function notificarUsuarios(areaNombre: string, titulo: string, cuerpo: string, url: string, profesionalId?: number | null) {
  const usuariosDestino = await pool.query(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE r.nombre IN ('administrador', 'supervisor', 'recepcionista')
     OR (
       r.nombre = 'profesional'
       AND (
         CASE
           WHEN $2::int IS NOT NULL THEN u.id = $2::int
           ELSE EXISTS (
             SELECT 1 FROM user_areas ua
             JOIN areas ar2 ON ar2.id = ua.area_id
             WHERE ua.user_id = u.id AND ar2.nombre = $1
           )
         END
       )
     )`,
    [areaNombre, profesionalId ?? null]
  );

  await entregarA(usuariosDestino.rows.map((u) => u.id), titulo, cuerpo, url);
}

// Guarda la notificación en la app (campanita) y manda el push a cada
// dispositivo suscrito de esos usuarios.
async function entregarA(userIds: number[], titulo: string, cuerpo: string, url: string) {
  for (const userId of userIds) {
    await pool.query(
      `INSERT INTO notificaciones (user_id, titulo, cuerpo, url) VALUES ($1, $2, $3, $4)`,
      [userId, titulo, cuerpo, url]
    );

    const subs = await pool.query(
      `SELECT * FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    for (const sub of subs.rows) {
      await enviarPush(sub, { title: titulo, body: cuerpo, url });
    }
  }
}

async function enviarPush(sub: any, payload: { title: string; body: string; url: string }) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (error: any) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
    } else {
      console.error('Error al enviar push:', error.statusCode, error.body);
    }
  }
}

// ─────────────────────────────────────────────
// NUEVO: Recordatorio: cita en 3 horas
// ─────────────────────────────────────────────
export async function enviarRecordatorios3h() {
  try {
    const citas = await pool.query(
      `SELECT
        a.id, a.hora::text, a.professional_id,
        p.nombre as paciente_nombre,
        ar.nombre as area_nombre
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN areas ar   ON a.area_id    = ar.id
       WHERE a.fecha = CURRENT_DATE
       AND a.estado = 'confirmada'
       AND a.hora::time > CURRENT_TIME
       AND a.hora::time <= (CURRENT_TIME + INTERVAL '3 hours 10 minutes')
       AND a.hora::time > (CURRENT_TIME + INTERVAL '2 hours 50 minutes')
       AND NOT EXISTS (
         SELECT 1 FROM notificaciones_enviadas ne
         WHERE ne.appointment_id = a.id AND ne.tipo = 'recordatorio_3h'
       )`
    );

    for (const cita of citas.rows) {
      const reserva = await pool.query(
        `INSERT INTO notificaciones_enviadas (appointment_id, tipo) VALUES ($1, 'recordatorio_3h')
         ON CONFLICT DO NOTHING RETURNING id`,
        [cita.id]
      );
      if (reserva.rows.length === 0) continue;

      const titulo = 'Cita en 3 horas';
      const cuerpo = `${cita.paciente_nombre} · ${cita.area_nombre} · ${cita.hora?.slice(0, 5)}`;
      await notificarUsuarios(cita.area_nombre, titulo, cuerpo, '/agenda', cita.professional_id);
    }

    if (citas.rows.length > 0) {
      console.log(`🔔 ${citas.rows.length} recordatorio(s) 3h procesado(s)`);
    }
  } catch (error) {
    console.error('Error al enviar recordatorios 3h:', error);
  }
}

// ─────────────────────────────────────────────
// 2. NUEVO: Recordatorio: cita en 24 horas
// ─────────────────────────────────────────────
export async function enviarRecordatorios24h() {
  try {
    const citas = await pool.query(
      `SELECT
        a.id, a.hora::text, a.fecha::text, a.professional_id,
        p.nombre as paciente_nombre,
        ar.nombre as area_nombre
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN areas ar   ON a.area_id    = ar.id
       WHERE a.estado = 'confirmada'
       AND (a.fecha + a.hora) >= (NOW() + INTERVAL '23 hours 50 minutes')
       AND (a.fecha + a.hora) <= (NOW() + INTERVAL '24 hours 10 minutes')
       AND NOT EXISTS (
         SELECT 1 FROM notificaciones_enviadas ne
         WHERE ne.appointment_id = a.id AND ne.tipo = 'recordatorio_24h'
       )`
    );

    for (const cita of citas.rows) {
  const reserva = await pool.query(
    `INSERT INTO notificaciones_enviadas (appointment_id, tipo) VALUES ($1, 'recordatorio_24h')
     ON CONFLICT DO NOTHING RETURNING id`,
    [cita.id]
  );
  if (reserva.rows.length === 0) continue;

  const titulo = 'Cita mañana';
  const cuerpo = `${cita.paciente_nombre} · ${cita.area_nombre} · ${cita.hora?.slice(0, 5)}`;
  await notificarUsuarios(cita.area_nombre, titulo, cuerpo, '/agenda', cita.professional_id);
}

    if (citas.rows.length > 0) {
      console.log(`🔔 ${citas.rows.length} recordatorio(s) 24h procesado(s)`);
    }
  } catch (error) {
    console.error('Error al enviar recordatorios 24h:', error);
  }
}

// ─────────────────────────────────────────────
// 3. Notificación: nueva cita / paciente registrado (el que ya tenías)
// ─────────────────────────────────────────────
export async function notificarNuevaCita(
  areaId: number,
  pacienteNombre: string,
  fecha: string,
  hora: string,
  estado: string,
  servicioNombre?: string | null,
  totalSesiones?: number | null,
  profesionalId?: number | null
) {
  try {
    const areaResult = await pool.query(`SELECT nombre FROM areas WHERE id = $1`, [areaId]);
    if (areaResult.rows.length === 0) return;
    const areaNombre = areaResult.rows[0].nombre;

    const etiquetaEstado = estado === 'confirmada' ? 'Confirmada' : 'Reserva';
    const titulo = 'Nuevo paciente registrado';
    // El servicio (con la cantidad de sesiones al lado, si tiene más de una)
    // va primero después del área, para que resalte más que antes.
    const servicioConSesiones = servicioNombre
      ? `${servicioNombre}${totalSesiones && totalSesiones > 1 ? ` (${totalSesiones} sesiones)` : ''}`
      : (totalSesiones && totalSesiones > 1 ? `${totalSesiones} sesiones` : null);
    const partes = [pacienteNombre, areaNombre, servicioConSesiones, `${fecha} ${hora?.slice(0, 5)}`, etiquetaEstado].filter(Boolean);
    const cuerpo = partes.join(' · ');

    // Si la cita ya tiene un profesional específico asignado (el caso
    // normal), la notificación de rol "profesional" le llega SOLO a ese
    // usuario — no a todos los que trabajan en la misma área.
    await notificarUsuarios(areaNombre, titulo, cuerpo, '/agenda', profesionalId);
  } catch (error) {
    console.error('Error al notificar nueva cita:', error);
  }
}

// ─────────────────────────────────────────────
// Notificación: alguien reservó desde el sitio web público
// ─────────────────────────────────────────────
// Solo se avisa a quienes pueden gestionar esa reserva (asignarle profesional
// y confirmarla): administrador, supervisor y recepcionista. A los
// profesionales NO les llega — todavía no hay un profesional asignado, y
// cuando se confirme ya recibirán la notificación normal de nueva cita.
export async function notificarNuevaReservaWeb(
  pacienteNombre: string,
  areaNombre: string,
  servicioNombre: string | null,
  fecha: string,
  hora: string
) {
  try {
    const staff = await pool.query(
      `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.nombre IN ('administrador', 'supervisor', 'recepcionista')
         AND u.activo IS NOT FALSE`
    );

    const titulo = 'Nueva reserva del sitio web';
    const partes = [pacienteNombre, areaNombre, servicioNombre, `${fecha} ${hora?.slice(0, 5)}`].filter(Boolean);
    const cuerpo = `${partes.join(' · ')} · Pendiente de confirmar`;

    await entregarA(staff.rows.map((u) => u.id), titulo, cuerpo, '/agenda');
  } catch (error) {
    console.error('Error al notificar nueva reserva del sitio web:', error);
  }
}

// ─────────────────────────────────────────────
// 4. NUEVO: Notificación: cita reagendada
// ─────────────────────────────────────────────
export async function notificarReagendamiento(
  areaId: number,
  pacienteNombre: string,
  fechaAnterior: string,
  horaAnterior: string,
  fechaNueva: string,
  horaNueva: string,
  profesionalId?: number | null
) {
  try {
    const areaResult = await pool.query(`SELECT nombre FROM areas WHERE id = $1`, [areaId]);
    if (areaResult.rows.length === 0) return;
    const areaNombre = areaResult.rows[0].nombre;

    const titulo = 'Cita reagendada';
    const cuerpo = `${pacienteNombre} · ${areaNombre} · ahora ${fechaNueva} ${horaNueva?.slice(0, 5)} (antes ${fechaAnterior} ${horaAnterior?.slice(0, 5)})`;

    await notificarUsuarios(areaNombre, titulo, cuerpo, '/agenda', profesionalId);
  } catch (error) {
    console.error('Error al notificar reagendamiento:', error);
  }
}