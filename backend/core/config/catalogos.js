// Lectura cacheada de los catálogos de configuración.
//
// Vive aparte del router porque no solo la interfaz los necesita: la resolución
// de destinatarios y la pertenencia a grupos leen los MISMOS catálogos, y tienen
// que compartir la caché y —sobre todo— su invalidación. Dos claves distintas
// para el mismo catálogo dejan caché fantasma tras un guardado, y el síntoma
// sería "cambié los integrantes del grupo y el documento sigue viéndose igual".
//
// `list()` aquí es legítimo y está dentro del umbral de la política de costo:
// son decenas de documentos que cambian una vez al mes (docs/POLITICA-COSTOS.md).
const { col } = require('../../lib/db');
const cache = require('../../lib/cache');

function claveCache(catalogo) {
  return `config:${catalogo}`;
}

// Orden de presentación: por `orden` si el catálogo lo define, y si no por el
// nombre legible. Numérico, para que "Sede 10" no quede antes de "Sede 2".
function ordenar(filas) {
  return filas.sort((a, b) => String(a.orden ?? a.nombre ?? a.termino ?? a.id)
    .localeCompare(String(b.orden ?? b.nombre ?? b.termino ?? b.id), 'es', { numeric: true }));
}

// Filas activas de un catálogo, ordenadas. Se ordena ANTES de cachear: ordenar
// en cada petición sobre un arreglo ya cacheado es trabajo repetido sin motivo.
async function leer(catalogo) {
  return cache.memo(claveCache(catalogo), async () => ordenar(await col(catalogo).list((r) => r.activo !== false)));
}

// Catálogo COMPLETO, incluidos los inactivados. Solo lo consume el panel de
// configuración, y no pasa por la caché a propósito: la caché guarda el catálogo
// vigente, que es lo que consume el resto de la aplicación, y mezclar las dos
// respuestas bajo la misma clave haría aparecer registros inactivos en los
// formularios.
async function leerConInactivos(catalogo) {
  return ordenar(await col(catalogo).list());
}

function invalidar(catalogo) {
  cache.invalidar(claveCache(catalogo));
}

module.exports = { leer, leerConInactivos, invalidar, claveCache, ordenar };
