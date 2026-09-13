// La columna `dia` (en availability, sesiones_grupales, etc.) se guarda a
// veces sin tilde ("Miercoles") y a veces con tilde ("Miércoles") — estos
// helpers estaban duplicados con ligeras variantes en varios controllers
// (reservasPublicas, sesionesGrupales, citas); centralizados acá para que
// todos comparen días de la misma forma.

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

const DIAS_CON_ACENTO: Record<string, string> = { Miercoles: 'Miércoles', Sabado: 'Sábado' };

// Nombre del día (sin tilde) correspondiente al día de la semana de `fecha`.
export function nombreDelDia(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`);
  return DIAS_SEMANA[d.getDay()];
}

// Ambas formas válidas ("Miercoles" y "Miércoles") del día de la semana de
// `fecha` — para usar con `dia = ANY($1::text[])` y no perder filas guardadas
// con tilde.
export function variantesDia(fecha: string): string[] {
  const nombre = nombreDelDia(fecha);
  const variantes = [nombre];
  if (DIAS_CON_ACENTO[nombre]) variantes.push(DIAS_CON_ACENTO[nombre]);
  return variantes;
}

// Quita las tildes de las vocales acentuadas del español, para comparar
// "Miercoles" con "Miércoles" (o cualquier otro texto con acentos) sin
// importar cómo haya quedado guardado.
export function sinTildes(texto: string): string {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function mismoDia(diaA: string, diaB: string): boolean {
  return sinTildes(diaA).toLowerCase() === sinTildes(diaB).toLowerCase();
}
