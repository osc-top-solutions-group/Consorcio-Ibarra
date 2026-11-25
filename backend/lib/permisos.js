// Autorización de negocio (la identidad la da la cookie de sesión, ver lib/sesion.js).
//
// La identidad viene del catálogo de USUARIOS (core/empleados) y los permisos del
// MOTOR DE ACCESOS (Firestore, administrado desde /accesos). Este archivo solo
// compone las dos cosas y expone los ayudantes que consumen los módulos.
//
// Roles derivados, por compatibilidad con el módulo documental:
//   admin   → está en el recurso `sgc.administrador`
//   lider   → administra al menos un proceso (`documental.crear`)
//   usuario → consulta y participa en los flujos donde esté asignado
const { getUsuarioEmail } = require('./sesion');
const engine = require('../core/accesos/engine');

// Caché por petición: resolver un usuario toca BigQuery y varios documentos de
// Firestore, y varios middlewares lo piden en la misma petición.
const TTL_MS = 30_000;
// Quien tiene algún recurso `soloTitulares` (carpetas, costos y nómina, director
// de Talento Humano) se re-resuelve cada 5 s (2026-11-13). Esta caché es por
// instancia de Cloud Run y `invalidarUsuarios` solo limpia la que atendió el
// cambio: con 30 s, a quien se le retiraba el acceso a los datos personales
// seguía leyéndolos medio minuto en las demás instancias. Junto con los 2 s de
// los titulares de esos recursos (core/accesos/engine.js), el retiro surte
// efecto en todas en ~7 s. Solo afecta a ese puñado de personas: el resto
// conserva los 30 s, y re-resolver cuesta unas pocas lecturas.
const TTL_SENSIBLE_MS = 5_000;
const cache = new Map();

async function getUsuario(correo) {
  if (!correo) return null;
  const email = engine.normalizarCorreo(correo);

  const hit = cache.get(email);
  if (hit && Date.now() < hit.expiraEn) return hit.perfil;

  const perfil = await engine.resolverUsuario(email);
  const sensible = Object.entries(perfil.permisos || {}).some(([id, v]) => v === true && engine.soloTitulares(id));
  cache.set(email, { perfil, expiraEn: Date.now() + (sensible ? TTL_SENSIBLE_MS : TTL_MS) });
  return perfil;
}

function invalidarUsuarios() {
  cache.clear();
}

function esAdmin(usuario) {
  return !!usuario && usuario.rol === 'admin';
}

// ¿Administra los documentos de este proceso?
function esLiderDe(usuario, procesoId) {
  if (!usuario) return false;
  if (usuario.rol === 'admin' || usuario.administraTodosLosProcesos) return true;
  return (usuario.procesos || []).includes(procesoId);
}

// ¿Valida los accesos a aplicaciones de esta área? (matriz de roles y perfiles).
// El admin global pasa —como en esLiderDe—, pero el administrador del módulo de
// seguridad NO: administrar la herramienta y certificar accesos son
// responsabilidades separadas (ISO 27001 A.5.3).
function esValidadorDe(usuario, area) {
  if (!usuario) return false;
  if (usuario.rol === 'admin' || usuario.validaTodasLasAreas) return true;
  return !!area && (usuario.areasQueValida || []).includes(area);
}

// ¿Es responsable de esta aplicación en la matriz de roles y perfiles?
// (define áreas huérfanas y marca corregidas las observaciones de SU app).
function esResponsableDeApp(usuario, appId) {
  if (!usuario) return false;
  if (usuario.rol === 'admin' || usuario.gestionaTodasLasApps) return true;
  return appId !== undefined && appId !== null &&
    (usuario.appsQueGestiona || []).includes(String(appId));
}

function veTodasLasSedes(usuario) {
  return esAdmin(usuario) || (!!usuario && usuario.verTodasLasSedes === true);
}

function sedesDe(usuario) {
  return (usuario && usuario.sedes) || [];
}

// ¿Tiene el permiso de un recurso del catálogo de accesos?
//
// El atajo del rol 'admin' NO cubre los recursos `soloTitulares` (datos
// personales de Talento Humano): ahí manda el mapa `permisos` que resolvió el
// motor, donde el administrador de la plataforma solo aparece si está en la
// lista. Sin esta excepción, el motor negaba y este atajo volvía a abrir.
function puede(usuario, recursoId) {
  if (!usuario) return false;
  if (usuario.rol === 'admin' && !engine.soloTitulares(recursoId)) return true;
  return usuario.permisos ? usuario.permisos[recursoId] === true : false;
}

// ¿Cubre esta sede en un recurso de ámbito por sede (`scope-sedes`)? Es la
// pregunta que Talento Humano hace por cada perfil y cada paz y salvo: Andrea
// gestiona Colombia, Diana México y Centroamérica, con el MISMO recurso. Sin
// sede (un registro viejo sin país) basta con tener el permiso. Si el perfil no
// trae el mapa (un llamador que no pasó por el motor) se niega: falla cerrado.
function cubreSede(usuario, recursoId, sedeId) {
  if (!puede(usuario, recursoId)) return false;
  if (usuario.rol === 'admin' && !engine.soloTitulares(recursoId)) return true;
  const alcance = usuario.sedesPorRecurso?.[recursoId];
  if (!alcance) return false;
  if (alcance.todas || !sedeId) return true;
  return (alcance.sedes || []).includes(sedeId);
}

// ¿La petición la hizo el frontend del SGC (fetch) y no una pestaña, un enlace
// pegado o una herramienta externa? El header X-Requested-With no lo pone el
// navegador en una navegación ni en un formulario cruzado: solo el código de la
// aplicación. Sirve para dos cosas:
//   · consulta de archivos en línea SOLO dentro del visor de la herramienta
//     (abrir el PDF en otra pestaña daba el visor nativo con botón de descarga);
//   · defensa CSRF de las escrituras, junto con Sec-Fetch-Site/Origin.
// No es un control criptográfico: quien tiene sesión y una consola puede poner
// el header. Cierra el camino fácil (copiar el enlace, compartirlo) y deja
// rastro en auditoría del resto.
function desdeLaApp(req) {
  return String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
}

// EXCEPCIÓN DE DESARROLLO LOCAL.
//
// En la máquina de un desarrollador el frontend y el backend viven en PUERTOS
// distintos: Vite sirve la aplicación en :5173 y proxea /api al backend en
// :8080 (o los que fije SGC_PUERTO / SGC_API en vite.config.js). El navegador
// manda `Origin: http://localhost:5173` y el proxy reenvía la petición con
// `Host: localhost:8080`, así que la
// comparación de abajo ve dos hosts distintos y bloquea TODA escritura con un
// «origen cruzado» que no explica nada: el usuario no hizo nada raro, es el
// precio de partir el origen en dos puertos. Pasa con cualquier par de puertos,
// no solo con estos, y en producción no pasa nunca porque el balanceador sirve
// la aplicación y la API bajo el mismo origen.
//
// La excepción se acota a dos condiciones que NO pueden darse a la vez en el
// despliegue real:
//   · el origen es de loopback (localhost, 127.0.0.1, ::1), cualquier puerto;
//   · el proceso no corre en Cloud Run y no apunta a la raíz de producción.
//
// `K_SERVICE` solo existe dentro de Cloud Run —es lo mismo que ya distingue la
// raíz de Firestore en lib/db.js—, y la segunda condición cubre el caso de un
// backend local apuntado por error a los datos reales: ahí el control sigue
// estricto aunque el origen sea localhost.
//
// No se configura con una lista de orígenes en el .env a propósito: una variable
// que hay que acordarse de exportar es la misma trampa que ya documentó
// SGC_API, y el día que alguien levante el SGC en otro puerto volvería a
// encontrarse el 403 sin pista de por qué.
//
// LÍMITE ASUMIDO: en una máquina de desarrollo, una página local en otro puerto
// puede escribir contra el backend local. Son datos de `sgc_dev` y hace falta
// además la identidad de desarrollo; a cambio, el arreglo de dos puertos que el
// repo documenta funciona sin tocar el control en producción.
const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE);
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function esOrigenDeDesarrollo(origen) {
  if (EN_CLOUD_RUN || !origen || origen === 'null') return false;
  // Se lee aquí y no arriba para no atar el orden de carga de los módulos: db.js
  // resuelve la raíz al importarse, y permisos.js se carga antes en index.js.
  if (require('./db').RAIZ === 'sgc') return false;
  try {
    const url = new URL(origen);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      HOSTS_LOCALES.has(url.hostname);
  } catch {
    return false;
  }
}

// Middleware CSRF para escrituras: un formulario o script de otro sitio que
// aproveche la cookie de IAP llega con Sec-Fetch-Site: cross-site (navegadores
// modernos) o con un Origin distinto del Host (los demás). Las lecturas no se
// filtran: no cambian estado y el visor de archivos las necesita por navegación
// en el caso de la descarga autorizada.
function bloquearEscrituraCruzada(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Va antes de las dos comprobaciones y no dentro de una de ellas: el arreglo
  // de dos puertos puede disparar cualquiera de las dos según el navegador.
  if (esOrigenDeDesarrollo(req.headers.origin)) return next();
  const sitio = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sitio && !['same-origin', 'same-site', 'none'].includes(sitio)) {
    return res.status(403).json({ error: 'Petición rechazada: origen cruzado' });
  }
  const origen = req.headers.origin;
  if (origen && origen !== 'null') {
    let host = null;
    try { host = new URL(origen).host; } catch { host = null; }
    const propio = req.headers['x-forwarded-host'] || req.headers.host;
    if (!host || !propio || host !== String(propio).split(',')[0].trim()) {
      return res.status(403).json({ error: 'Petición rechazada: origen cruzado' });
    }
  }
  next();
}

// Middleware: adjunta req.usuario o responde 401.
async function conUsuario(req, res, next) {
  try {
    const correo = await getUsuarioEmail(req);
    if (!correo) return res.status(401).json({ error: 'No autenticado' });
    req.usuario = await getUsuario(correo);
    next();
  } catch (e) {
    console.error('[permisos]', e);
    res.status(500).json({ error: 'Error resolviendo usuario' });
  }
}

function soloAdmin(req, res, next) {
  if (!esAdmin(req.usuario)) return res.status(403).json({ error: 'Requiere rol administrador' });
  next();
}

// Middleware generador: exige un recurso concreto del catálogo de accesos.
function exige(recursoId) {
  return (req, res, next) => {
    if (!puede(req.usuario, recursoId)) {
      return res.status(403).json({
        error: 'No tiene acceso a esta función',
        recurso: recursoId,
        correoDetectado: req.usuario ? req.usuario.correo : null
      });
    }
    next();
  };
}

module.exports = {
  getUsuario, invalidarUsuarios, esAdmin, esLiderDe, esValidadorDe, esResponsableDeApp,
  veTodasLasSedes, sedesDe, puede, cubreSede, conUsuario, soloAdmin, exige,
  desdeLaApp, bloquearEscrituraCruzada
};
