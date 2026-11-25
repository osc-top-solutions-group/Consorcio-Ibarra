// MOTOR DE ACCESOS.
//
// Resuelve, para un correo dado, qué puede hacer en el SGC. Es la única fuente
// de verdad: `lib/permisos.js` lo consulta y ningún módulo mantiene su propia
// lista de correos.
//
// Los titulares viven en Firestore: {raiz}/core/accesos/{recursoId}
// con la forma { emails[], scopes{}, roles{}, abierto }.
//
// Caché de 60 s para no leer Firestore en cada petición, invalidada al guardar.
const { col } = require('../../lib/db');
const { getRecurso, RECURSOS, ADMINISTRADORES } = require('./registry');
const empleados = require('../empleados');

const TTL_MS = 60_000;
// Recursos `soloTitulares` (datos personales de Talento Humano): 2 s, no 60
// (2026-11-13). La caché es por proceso y Cloud Run corre varias instancias:
// `invalidar` solo limpia la que atendió el guardado, y en las demás una
// persona retirada de la lista seguía leyendo carpetas y nómina hasta un
// minuto. Con 2 s el retiro se propaga casi en el acto y el costo es acotado:
// son pocos documentos (uno por recurso protegido), y solo se releen al
// resolver un perfil, que lib/permisos cachea aparte. Se deja una ventana
// mínima, y no cero, para que una misma resolución —que consulta el
// administrador del módulo una vez por cada recurso tthh.*— no los relea
// decenas de veces.
const TTL_SOLO_TITULARES_MS = 2_000;

const cache = new Map();       // recursoId → { datos, expiraEn }

function normalizarCorreo(valor) {
  return String(valor || '').trim().toLowerCase();
}

const VACIO = { emails: [], scopes: {}, roles: {}, abierto: false };

// Titulares de un recurso, con caché.
async function titulares(recursoId, { usarCache = true } = {}) {
  if (usarCache) {
    const hit = cache.get(recursoId);
    if (hit && Date.now() < hit.expiraEn) return hit.datos;
  }
  let datos = { ...VACIO };
  try {
    const fila = await col('accesos').get(recursoId);
    if (fila) {
      datos = {
        emails: (fila.emails || []).map(normalizarCorreo).filter(Boolean),
        scopes: fila.scopes || {},
        roles: fila.roles || {},
        abierto: fila.abierto === true,
        updatedAt: fila.updatedAt || null,
        updatedBy: fila.updatedBy || null
      };
    }
  } catch (e) {
    // Sin Firestore no se inventan permisos: se niega, salvo que el recurso sea
    // abrible y ya estuviera abierto (que no se puede saber) — falla cerrado.
    console.error(`[accesos] no se pudieron leer los titulares de ${recursoId}:`, e.message);
  }
  cache.set(recursoId, { datos, expiraEn: Date.now() + (soloTitulares(recursoId) ? TTL_SOLO_TITULARES_MS : TTL_MS) });
  return datos;
}

async function guardar(recursoId, datos, actor) {
  const payload = {
    emails: datos.emails || [],
    scopes: datos.scopes || {},
    roles: datos.roles || {},
    abierto: datos.abierto === true,
    updatedAt: new Date().toISOString(),
    updatedBy: actor
  };
  // Se REEMPLAZA el documento entero, no se fusiona. `update()` escribe con
  // merge, y en Firestore el merge es profundo sobre los mapas: quitar a una
  // persona de `scopes` (o un rol de `roles`) no borraba su llave, así que la
  // revocación de un ámbito se guardaba «bien» y la persona seguía con acceso.
  // `insert` con id hace un set sin merge; se conserva la fecha de creación.
  const existente = await col('accesos').get(recursoId);
  await col('accesos').insert({
    id: recursoId,
    ...payload,
    ...(existente?.createdAt ? { createdAt: existente.createdAt } : {})
  });
  invalidar(recursoId);
  return payload;
}

function invalidar(recursoId) {
  if (recursoId) cache.delete(recursoId);
  else cache.clear();
}

// ---------- Resolución por recurso ----------

// Administradores por módulo: quien esté en el recurso administrador de un
// módulo tiene todos los recursos de ese módulo sin repartirlos uno a uno.
// Existe porque el rol `sgc.administrador` es global (todo el SGC), y hay
// responsables de un solo módulo a quienes no se les puede dar todo el sistema.
//
// La lista sale del catálogo (registry.js › `administraGrupo`), no se escribe a
// mano: así un recurso nuevo del módulo queda cubierto por el solo hecho de
// declararse en el mismo grupo, y un módulo nuevo sin administrador no arranca.
const ADMIN_DE_MODULO = ADMINISTRADORES.map((a) => ({
  recursoAdmin: a.id,
  grupo: a.grupo,
  // `fueraDelAdministrador` (2026-11-13): recursos del módulo que el
  // administrador del módulo NO hereda. En Talento Humano, los costos y nómina y
  // el rol de director: el módulo lo administran varias personas (incluso HSE
  // para capacitaciones) y el salario y la aprobación de accesos son solo de
  // quien esté listado con nombre propio.
  cubre: (id) => {
    const r = getRecurso(id);
    return !!r && r.grupo === a.grupo && !r.fueraDelAdministrador;
  }
}));

// ¿Administra el módulo (grupo) dado? Lo usan los ámbitos: el administrador de
// Gestión Documental administra todos los procesos y ve todas las sedes.
async function esAdminDeGrupo(correo, grupo) {
  const email = normalizarCorreo(correo);
  const a = ADMINISTRADORES.find((x) => x.grupo === grupo);
  if (!a) return false;
  const t = await titulares(a.id);
  return t.emails.includes(email);
}

// Grupos (módulos) que la persona administra, para el perfil.
async function gruposQueAdministra(correo) {
  const email = normalizarCorreo(correo);
  const salida = [];
  for (const a of ADMINISTRADORES) {
    const t = await titulares(a.id);
    if (t.emails.includes(email)) salida.push(a.grupo);
  }
  return salida;
}

// RECURSOS `soloTitulares` (2026-11-12): datos personales de los colaboradores
// (carpetas, costos y nómina) y el propio director de Talento Humano. Ahí el
// administrador de la plataforma NO pasa por serlo: administrar la plataforma no
// da derecho a leer el salario ni la carpeta de nadie (necesidad de conocer).
// Tampoco aplica `abierto`, aunque alguien lo encendiera en la base a mano. Lo
// único que da acceso es estar en la lista —o administrar ese mismo módulo,
// porque el director de Talento Humano es el dueño de esa información—, y a la
// lista solo se entra con la aprobación del director (core/accesos/solicitudes.js).
function soloTitulares(recursoId) {
  return getRecurso(recursoId)?.soloTitulares === true;
}

// ¿Tiene acceso binario al recurso?
async function permite(recursoId, correo) {
  const recurso = getRecurso(recursoId);
  if (!recurso) return false;
  const email = normalizarCorreo(correo);
  const protegido = recurso.soloTitulares === true;

  // El administrador del SGC pasa por todo, menos por el propio panel de
  // accesos (se administra con su propia lista, para que quitar el rol de
  // administrador no deje el panel sin dueño) y por los recursos soloTitulares.
  if (recursoId !== 'sgc.accesos' && recursoId !== 'sgc.administrador' && !protegido) {
    if (await esAdministrador(email)) return true;
  }

  // El administrador de un módulo pasa por todos los recursos de su módulo,
  // menos por el propio recurso administrador (ese se reparte explícitamente).
  for (const { recursoAdmin, cubre } of ADMIN_DE_MODULO) {
    if (recursoId !== recursoAdmin && cubre(recursoId)) {
      const t = await titulares(recursoAdmin);
      if (t.emails.includes(email)) return true;
    }
  }

  const t = await titulares(recursoId);
  if (recurso.abrible && t.abierto && !protegido) return true;
  if (t.emails.includes(email)) return true;
  // En los recursos con ámbito, tener ámbito asignado implica acceso.
  if (recurso.tipo === 'scope-procesos') return (t.scopes[email]?.procesos || []).length > 0;
  if (recurso.tipo === 'scope-sedes') return (t.scopes[email]?.sedes || []).length > 0;
  if (recurso.tipo === 'scope-areas') return (t.scopes[email]?.areas || []).length > 0;
  if (recurso.tipo === 'scope-apps') return (t.scopes[email]?.apps || []).length > 0;
  return false;
}

async function esAdministrador(correo) {
  const t = await titulares('sgc.administrador');
  return t.emails.includes(normalizarCorreo(correo));
}

async function esAdminAccesos(correo) {
  const email = normalizarCorreo(correo);
  const t = await titulares('sgc.accesos');
  if (t.emails.includes(email)) return true;
  // Salvaguarda de arranque: si nadie está declarado como administrador del
  // panel, los administradores del SGC lo son. Evita quedar bloqueado tras la
  // primera instalación, cuando aún no se ha sembrado nada.
  if (t.emails.length === 0) return esAdministrador(email);
  return false;
}

// Procesos que la persona administra. `emails` = todos.
async function procesosDe(correo) {
  const email = normalizarCorreo(correo);
  if (await esAdministrador(email)) return { todos: true, procesos: [] };
  if (await esAdminDeGrupo(email, 'Gestión Documental')) return { todos: true, procesos: [] };
  const t = await titulares('documental.crear');
  if (t.emails.includes(email)) return { todos: true, procesos: [] };
  return { todos: false, procesos: t.scopes[email]?.procesos || [] };
}

// Áreas cuyos accesos a aplicaciones puede validar (matriz de roles y perfiles
// del módulo de seguridad de la información). `emails` = todas las áreas.
// El administrador del módulo NO valida por serlo: administrar la herramienta y
// certificar los accesos de la gente son responsabilidades separadas (ISO 27001
// A.5.3); si alguien debe hacer ambas, se le asignan ambas explícitamente.
async function areasDe(correo) {
  const email = normalizarCorreo(correo);
  if (await esAdministrador(email)) return { todas: true, areas: [] };
  const t = await titulares('seguridad.accesos-validar');
  if (t.emails.includes(email)) return { todas: true, areas: [] };
  return { todas: false, areas: t.scopes[email]?.areas || [] };
}

// Aplicaciones de las que la persona es responsable en la matriz de roles y
// perfiles. `emails` = todas. Los ids se guardan como strings de dígitos (los
// asset_id de la fuente). El admin del módulo NO gestiona apps por serlo: se
// asigna explícito, igual que la validación por áreas.
async function appsDe(correo) {
  const email = normalizarCorreo(correo);
  if (await esAdministrador(email)) return { todas: true, apps: [] };
  const t = await titulares('seguridad.apps-responsable');
  if (t.emails.includes(email)) return { todas: true, apps: [] };
  return { todas: false, apps: (t.scopes[email]?.apps || []).map(String) };
}

// Sedes cuyos documentos locales puede ver. Por defecto, la sede del directorio.
async function sedesDe(correo, sedePropia) {
  const email = normalizarCorreo(correo);
  if (await esAdministrador(email)) return { todas: true, sedes: [] };
  if (await esAdminDeGrupo(email, 'Gestión Documental')) return { todas: true, sedes: [] };
  const t = await titulares('documental.ver-todas-sedes');
  if (t.abierto || t.emails.includes(email)) return { todas: true, sedes: [] };
  const asignadas = t.scopes[email]?.sedes || [];
  // Siempre incluye su propia sede: el aislamiento es entre países, no contra
  // el propio. Si el directorio no la resuelve, queda solo lo asignado.
  const propias = new Set(asignadas);
  if (sedePropia) propias.add(sedePropia);
  return { todas: false, sedes: [...propias] };
}

// ---------- Resolución completa de un usuario ----------

// Perfil de acceso consolidado. Es lo que consume lib/permisos.js.
async function resolverUsuario(correo) {
  const email = normalizarCorreo(correo);

  let empleado = null;
  try {
    empleado = await empleados.buscarPorCorreo(email);
  } catch (e) {
    // Sin directorio se opera con identidad mínima; los permisos siguen valiendo.
    console.warn('[accesos] directorio no disponible:', e.message);
  }

  const [admin, proc, sed, val, apps, modulos] = await Promise.all([
    esAdministrador(email),
    procesosDe(email),
    sedesDe(email, empleado?.sedeId),
    areasDe(email),
    appsDe(email),
    gruposQueAdministra(email)
  ]);

  // Permisos binarios de todos los recursos, para que el frontend oculte lo que
  // no aplica (la autorización real siempre se revalida en el backend).
  const permisos = {};
  for (const r of RECURSOS) permisos[r.id] = await permite(r.id, email);

  // Sedes que cubre en cada recurso de ámbito por sede, resueltas UNA vez por
  // perfil para que los módulos pregunten «¿cubre este país?» sin E/S (el
  // perfil se cachea por petición en lib/permisos). `emails` y el administrador
  // del módulo cubren todas; `scopes` solo las asignadas. En los soloTitulares
  // el administrador del SGC no cubre nada por serlo (mismo criterio que permite()).
  const sedesPorRecurso = {};
  for (const r of RECURSOS.filter((x) => x.tipo === 'scope-sedes')) {
    const t = await titulares(r.id);
    const total = (admin && !r.soloTitulares) || t.emails.includes(email) ||
      (!r.fueraDelAdministrador && await esAdminDeGrupo(email, r.grupo));
    sedesPorRecurso[r.id] = total ? { todas: true, sedes: [] } : { todas: false, sedes: t.scopes[email]?.sedes || [] };
  }

  // Procesos que cubre en cada recurso de ámbito por proceso, con el mismo
  // criterio que `sedesPorRecurso`: `documental.crear` sigue alimentando
  // `procesos` (compatibilidad del documental); los demás recursos
  // scope-procesos (riesgos.editar) se consultan por aquí.
  const procesosPorRecurso = {};
  for (const r of RECURSOS.filter((x) => x.tipo === 'scope-procesos')) {
    const t = await titulares(r.id);
    const total = (admin && !r.soloTitulares) || t.emails.includes(email) ||
      (!r.fueraDelAdministrador && await esAdminDeGrupo(email, r.grupo));
    procesosPorRecurso[r.id] = total ? { todos: true, procesos: [] } : { todos: false, procesos: t.scopes[email]?.procesos || [] };
  }

  // `rol` se mantiene por compatibilidad con el código existente del módulo
  // documental: admin / lider (administra algún proceso) / usuario.
  const rol = admin ? 'admin' : (proc.todos || proc.procesos.length ? 'lider' : 'usuario');

  return {
    correo: email,
    nombre: empleado?.nombre || email.split('@')[0],
    cargo: empleado?.cargo || null,
    area: empleado?.area || null,
    foto: empleado?.foto || null,
    jefe: empleado?.jefe || null,
    sedePropia: empleado?.sedeId || null,
    enDirectorio: !!empleado,
    rol,
    administraTodosLosProcesos: proc.todos,
    procesos: proc.procesos,
    verTodasLasSedes: sed.todas,
    sedes: sed.sedes,
    validaTodasLasAreas: val.todas,
    areasQueValida: val.areas,
    gestionaTodasLasApps: apps.todas,
    appsQueGestiona: apps.apps,
    sedesPorRecurso,
    procesosPorRecurso,
    // Módulos (grupos del catálogo) que administra por completo.
    administraModulos: modulos,
    permisos
  };
}

// APROBADORES de los otorgamientos sobre un recurso soloTitulares: los titulares
// del recurso marcado `aprueba` de su mismo módulo (hoy, `tthh.director`: el
// director de Talento Humano). Se leen SIN caché: es una decisión de acceso y
// no puede tomarse con una lista de hace un minuto (un director recién retirado
// seguiría aprobando). Si el módulo no declara aprobador, nadie aprueba.
async function aprobadoresDe(recursoId) {
  const recurso = getRecurso(recursoId);
  if (!recurso) return [];
  const aprobador = RECURSOS.find((r) => r.aprueba && r.grupo === recurso.grupo);
  if (!aprobador) return [];
  const t = await titulares(aprobador.id, { usarCache: false });
  return t.emails;
}

// Catálogo con titulares vigentes, para el panel.
async function catalogo() {
  return Promise.all(RECURSOS.map(async (r) => {
    const t = await titulares(r.id, { usarCache: false });
    const personas = new Set([
      ...t.emails,
      ...Object.keys(t.scopes || {}),
      ...Object.values(t.roles || {}).flat()
    ]);
    return {
      ...r,
      emails: t.emails,
      scopes: t.scopes,
      roles: t.roles,
      abierto: t.abierto,
      updatedAt: t.updatedAt || null,
      updatedBy: t.updatedBy || null,
      totalPersonas: t.abierto ? null : personas.size
    };
  }));
}

module.exports = {
  titulares, guardar, invalidar, permite, resolverUsuario, catalogo,
  esAdministrador, esAdminAccesos, procesosDe, sedesDe, areasDe, appsDe, normalizarCorreo,
  soloTitulares, aprobadoresDe
};
