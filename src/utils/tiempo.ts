// Fecha y hora del negocio (Bolivia), sin depender de dónde corra el proceso.
//
// En tu PC Node usa la hora local, pero en Render el servidor corre en UTC —
// 4 horas adelante de Bolivia. Usar `new Date().getHours()` allá hacía que el
// sistema creyera que son las 15:00 cuando en el consultorio son las 11:00
// (por eso el sitio web marcaba como "ya pasó" horarios que aún no llegaban).
// Estas funciones siempre responden en hora boliviana, corra donde corra.

const ZONA_NEGOCIO = process.env.TZ_NEGOCIO || 'America/La_Paz';

function partesLocales(fecha: Date = new Date()): Record<string, string> {
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formateador.formatToParts(fecha).map((p) => [p.type, p.value])
  );
}

// "YYYY-MM-DD" de hoy en Bolivia.
export function fechaHoy(fecha: Date = new Date()): string {
  const p = partesLocales(fecha);
  return `${p.year}-${p.month}-${p.day}`;
}

// "HH:MM" de ahora en Bolivia (24h).
export function horaAhora(fecha: Date = new Date()): string {
  const p = partesLocales(fecha);
  return `${p.hour}:${p.minute}`;
}

// Día de la semana en Bolivia, en el formato que usa el sistema para los
// horarios ("Lunes", "Martes", ... sin tildes, como está en la base).
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

export function diaDeLaSemanaHoy(fecha: Date = new Date()): string {
  // Se arma a partir de la fecha local (no de getDay(), que usaría la zona
  // del servidor) para que el día cambie a medianoche boliviana, no a las
  // 20:00 como pasaría en UTC.
  const [anio, mes, dia] = fechaHoy(fecha).split('-').map(Number);
  return DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
}
