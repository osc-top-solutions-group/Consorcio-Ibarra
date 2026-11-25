// Periodos de calendario (semana / mes / año) — utilidad TRANSVERSAL del frontend.
//
// Nació en modules/equipos/constants.js para el cronograma de mantenimiento; el
// programa de capacitación (Talento Humano) usa el mismo calendario, así que se
// promueve a shared/. Equipos re-exporta estas funciones desde su constants.js.
//
// El backend trabaja con 'YYYY-MM-DD' en UTC. Construir un Date con esa cadena
// suelta la interpreta como medianoche UTC y en Bogotá (UTC-5) la pinta como el
// día ANTERIOR: por eso todo lo que formatea fechas pasa por `aFecha`.

export const VISTAS = [
  ['semana', 'Semana'],
  ['mes', 'Mes'],
  ['anio', 'Año']
];

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function aFecha(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, (m || 1) - 1, d || 1);
}

export function isoDe(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

export function hoyIso() {
  return isoDe(new Date());
}

export function fechaLarga(iso) {
  if (!iso) return '—';
  return aFecha(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function fechaCortaLocal(iso) {
  if (!iso) return '—';
  return aFecha(iso).toLocaleDateString('es-CO', { month: 'short', day: 'numeric' });
}

export function diasHasta(iso, desde = hoyIso()) {
  if (!iso) return null;
  return Math.round((aFecha(iso) - aFecha(desde)) / 86400000);
}

// Semana ISO 8601 ('2026-W34'). Espejo de semanaIso() del backend
// (lib/periodos.js), con la misma regla del jueves: sin ella, la semana del 31
// de diciembre queda partida.
export function semanaIso(iso) {
  const d = aFecha(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const anio = d.getFullYear();
  const primerJueves = new Date(anio, 0, 4);
  primerJueves.setDate(primerJueves.getDate() - ((primerJueves.getDay() + 6) % 7) + 3);
  const semana = 1 + Math.round((d - primerJueves) / (7 * 86400000));
  return `${anio}-W${String(semana).padStart(2, '0')}`;
}

// Lunes de una semana ISO, para poder pintar sus siete días.
export function lunesDeSemana(anioSemana) {
  const [anio, semana] = String(anioSemana).split('-W').map(Number);
  const cuatroEnero = new Date(anio, 0, 4);
  const lunesSemana1 = new Date(cuatroEnero);
  lunesSemana1.setDate(cuatroEnero.getDate() - ((cuatroEnero.getDay() + 6) % 7));
  const lunes = new Date(lunesSemana1);
  lunes.setDate(lunesSemana1.getDate() + (semana - 1) * 7);
  return lunes;
}

// Etiqueta legible del periodo que se está viendo.
export function etiquetaPeriodo(vista, periodo) {
  if (vista === 'anio') return String(periodo);
  if (vista === 'semana') {
    const lunes = lunesDeSemana(periodo);
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    const mismoMes = lunes.getMonth() === domingo.getMonth();
    const fmt = (d, conMes) => d.toLocaleDateString('es-CO', conMes ? { day: 'numeric', month: 'short' } : { day: 'numeric' });
    return `${fmt(lunes, !mismoMes)} – ${fmt(domingo, true)} de ${domingo.getFullYear()}`;
  }
  const [a, m] = String(periodo).split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
}

// Periodo anterior / siguiente, según la vista. Devuelve la cadena que el
// backend espera como `periodo`.
export function moverPeriodo(vista, periodo, paso) {
  if (vista === 'anio') return String(Number(periodo) + paso);
  if (vista === 'semana') {
    const lunes = lunesDeSemana(periodo);
    lunes.setDate(lunes.getDate() + paso * 7);
    return semanaIso(isoDe(lunes));
  }
  const [a, m] = String(periodo).split('-').map(Number);
  const d = new Date(a, m - 1 + paso, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Periodo que corresponde a hoy, para el botón "Hoy" y el arranque.
export function periodoDeHoy(vista) {
  const hoy = hoyIso();
  if (vista === 'anio') return hoy.slice(0, 4);
  if (vista === 'semana') return semanaIso(hoy);
  return hoy.slice(0, 7);
}

// Días 'YYYY-MM-DD' entre dos fechas, ambas incluidas (para pintar un evento de
// varios días en cada celda que abarca). Acotado a 62 días: más que eso no es
// un evento de calendario, es otra cosa.
export function diasEntre(desde, hasta) {
  const dias = [];
  const fin = hasta && hasta > desde ? aFecha(hasta) : aFecha(desde);
  for (const d = aFecha(desde); d <= fin && dias.length < 62; d.setDate(d.getDate() + 1)) dias.push(isoDe(d));
  return dias;
}
