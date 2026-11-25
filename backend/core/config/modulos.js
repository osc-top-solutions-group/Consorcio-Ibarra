// MÓDULOS EN «PRÓXIMAMENTE» (interruptor de producción).
//
// Un módulo puede estar desplegado y a la vez no estar listo para la gente:
// falta desarrollo, falta la validación de los usuarios o falta la aprobación
// para lanzarlo. Mientras tanto, en el Home aparecía como «Disponible» y la
// gente entraba, se confundía y preguntaba (Expedientes y Visitantes, nov-2026).
//
// El parámetro global `modulosProximamente` (lista de ids de `src/app/menu.js`:
// expedientes, visitantes…) lo resuelve sin desplegar: el módulo se ve como
// «Próximamente» y su API responde 403 con `proximamente: true`.
//
// EXCEPCIÓN DELIBERADA: el administrador global y los administradores del
// módulo (`{modulo}.administrar`) SÍ entran. Son quienes tienen que validarlo
// en producción antes de abrirlo; sin esta puerta habría que apagar el
// candado para probar y volver a encenderlo, y en ese rato entra todo el mundo.
// El Home se los muestra con la marca «En preparación» para que sepan que el
// resto no lo ve.
//
// Lo que no se ve con el candado: la tarjeta del Home, el menú lateral y las
// pantallas del módulo (el frontend lee la lista en /api/profile). Los
// pendientes ya generados y los correos del módulo no se tocan: si hay que
// frenarlos también, es el modo de pruebas de lib/mailer.js.
const { param } = require('./parametros');
const { esAdmin } = require('../../lib/permisos');

// Acepta el id del módulo («visitantes») o su nombre tal como sale en el panel
// («Control de Visitantes»): el 2026-11-04 se escribió con los nombres y el
// candado no cerró nada. Lo que no se reconoce se descarta con aviso.
const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function normalizar(valor) {
  const { MODULOS } = require('./registro');
  const lista = Array.isArray(valor) ? valor : String(valor || '').split(',');
  const ids = lista.map((x) => {
    const texto = sinTildes(x);
    if (!texto) return null;
    const m = MODULOS.find((mod) => mod.id === texto || sinTildes(mod.nombre) === texto);
    if (!m) console.warn(`[modulos] modulosProximamente: «${String(x).trim()}» no es un módulo conocido, se ignora`);
    return m ? m.id : null;
  }).filter(Boolean);
  return [...new Set(ids)];
}

async function modulosProximamente() {
  return normalizar(await param('modulosProximamente'));
}

function puedePrevisualizar(usuario, moduloId) {
  return esAdmin(usuario) || (usuario?.administraModulos || []).includes(moduloId);
}

// Middleware para montar DELANTE de `exige('modulo.x')` en index.js.
function moduloHabilitado(moduloId) {
  return async (req, res, next) => {
    try {
      const cerrados = await modulosProximamente();
      if (cerrados.includes(moduloId) && !puedePrevisualizar(req.usuario, moduloId)) {
        return res.status(403).json({
          error: 'Este módulo todavía no está disponible',
          proximamente: true,
          modulo: moduloId
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { modulosProximamente, puedePrevisualizar, moduloHabilitado, normalizar };
