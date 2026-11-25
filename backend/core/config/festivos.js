// CALENDARIO DE DÍAS NO HÁBILES POR PAÍS.
//
// El SGC opera en 18 países y cada uno tiene su propio calendario de festivos,
// que además cambia cada año. Por eso es un CATÁLOGO administrable y no una
// tabla en código: una lista escrita a mano caduca el 31 de diciembre sin que
// nadie se entere, y el síntoma —mantenimientos agendados el 20 de julio— solo
// aparece cuando el técnico llega a una oficina cerrada.
//
// Vive junto a `parametros.js` y no en `lib/` porque, como él, lee un catálogo
// de Firestore: `lib/periodos.js` son funciones puras de calendario y no debe
// depender de la base.
//
// COSTO: se apoya en `catalogos.leer()`, que memoriza la colección completa y se
// invalida sola cuando el panel escribe. Un festivo consultado mil veces en una
// pasada del cronograma cuesta una lectura, no mil.
//
// DEGRADACIÓN DELIBERADA: un país sin festivos cargados no salta ninguno. Es
// preferible a fallar —un equipo sin festivos declarados tiene que poder
// programarse igual— pero significa que el calendario hay que alimentarlo:
// mientras un país esté vacío, sus mantenimientos pueden caer en festivo.
const catalogos = require('./catalogos');

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const normalizarPais = (valor) => String(valor || '').trim().toLowerCase();

// Fechas no hábiles de un país, como conjunto para poder preguntar por una en
// particular sin recorrer la lista.
async function festivosDe(paisId) {
  const pais = normalizarPais(paisId);
  if (!pais) return new Set();
  const filas = await catalogos.leer('festivos');
  return new Set(filas
    .filter((f) => normalizarPais(f.paisId) === pais && FORMATO_FECHA.test(String(f.fecha || '').trim()))
    .map((f) => String(f.fecha).trim()));
}

async function esFestivo(fecha, paisId) {
  return (await festivosDe(paisId)).has(fecha);
}

// Qué países tienen calendario cargado. Lo usa el panel para avisar de los que
// faltan, que es la única forma de que el hueco se vea antes de que un
// mantenimiento caiga en festivo.
async function paisesConCalendario() {
  const filas = await catalogos.leer('festivos');
  return [...new Set(filas.map((f) => normalizarPais(f.paisId)).filter(Boolean))].sort();
}

module.exports = { festivosDe, esFestivo, paisesConCalendario };
