// Caché en memoria de proceso, con TTL. Es la primera línea de defensa de la
// política de costo: un catálogo que se lee una vez por minuto en lugar de una
// vez por petición cuesta dos órdenes de magnitud menos.
//
// Por qué en memoria y no Memorystore: cada instancia de Cloud Run mantiene su
// propia copia, que es exactamente lo que se quiere. Un Redis costaría más al
// mes que todos los reads que ahorra, y añadiría una dependencia con estado a
// un servicio que hoy escala a cero sin ceremonia.
//
// El precio de esta decisión: con N instancias vivas, un cambio de catálogo
// tarda hasta TTL en verse en todas. Por eso `invalidar()` se llama al guardar
// (efecto inmediato en la instancia que atendió la escritura) y los TTL son
// cortos (60 s). Para catálogos de configuración esa ventana es irrelevante;
// NO use esta caché para datos donde leer un valor viejo cambie una decisión de
// negocio (saldos, consecutivos, estados de flujo).
//
// Uso:
//   const cache = require('./cache');
//   const procesos = await cache.memo('procesos', () => col('procesos').list());
//   cache.invalidar('procesos');        // una entrada
//   cache.invalidar();                  // todas

const TTL_DEFECTO_MS = 60_000;

const entradas = new Map();   // clave → { valor, expiraEn, cargando }

// Devuelve el valor cacheado o lo calcula con `cargar`.
//
// Las llamadas concurrentes con la misma clave COMPARTEN la consulta en vuelo:
// sin eso, un arranque en frío con 20 peticiones simultáneas dispara 20 lecturas
// del mismo catálogo. Es el mismo patrón que ya usa core/empleados.
async function memo(clave, cargar, { ttlMs = TTL_DEFECTO_MS } = {}) {
  const hit = entradas.get(clave);
  if (hit) {
    if (hit.cargando) return hit.cargando;
    if (Date.now() < hit.expiraEn) return hit.valor;
  }

  const cargando = (async () => {
    const valor = await cargar();
    entradas.set(clave, { valor, expiraEn: Date.now() + ttlMs, cargando: null });
    return valor;
  })();

  // Se registra la promesa antes de esperarla para que el segundo llamante la vea.
  entradas.set(clave, { valor: hit ? hit.valor : undefined, expiraEn: 0, cargando });

  try {
    return await cargando;
  } catch (e) {
    // Un fallo no debe quedar cacheado: la próxima petición reintenta.
    entradas.delete(clave);
    throw e;
  }
}

function invalidar(clave) {
  if (clave === undefined) entradas.clear();
  else entradas.delete(clave);
}

// Para /api/health: qué hay cacheado y cuánto le queda de vida.
function estado() {
  const ahora = Date.now();
  return [...entradas.entries()].map(([clave, e]) => ({
    clave,
    vigenteMs: Math.max(0, e.expiraEn - ahora),
    cargando: Boolean(e.cargando)
  }));
}

module.exports = { memo, invalidar, estado, TTL_DEFECTO_MS };
