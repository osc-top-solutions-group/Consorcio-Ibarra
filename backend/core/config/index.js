// Configuración del SGC — TRANSVERSAL a todos los módulos (documental hoy;
// auditorías, indicadores, mejoramiento, SST... después).
//
// Catálogos: mapa de procesos, tipos de documento, sedes/países, normas, grupos
// de asignación, plantillas institucionales, glosario y parámetros del sistema.
//
// Lo que NO está aquí a propósito:
//   · los ACCESOS de cada usuario → se reparten en /api/accesos
// El catálogo `usuarios` es el directorio de personas de esta instalación
// (nombre, cargo, área, sede): no hay directorio corporativo externo.
//
// Lectura: cualquier usuario autenticado (el frontend los necesita para pintar
// formularios). Escritura: quien tenga el recurso `sgc.configuracion`, salvo los
// catálogos que el registro declara `soloDesdeModulo`.
const express = require('express');
const path = require('path');
const multer = require('multer');
const { col } = require('../../lib/db');
const storage = require('../../lib/storage');
const { exige, puede } = require('../../lib/permisos');
const { auditar } = require('../../lib/audit');
const { invalidar } = require('./parametros');
const catalogos = require('./catalogos');
const registro = require('./registro');
const destinatarios = require('./destinatarios');
const empleados = require('../empleados');
const claves = require('../../lib/claves');

// La escritura exige el recurso de configuración, administrado desde el panel
// de accesos (ya no un rol cableado en código).
const soloConfig = exige('sgc.configuracion');

// El glosario es del módulo documental: lo edita quien tenga `documental.glosario`
// (o el administrador de ese módulo, que lo cubre) además de quien configura el
// SGC. Antes el recurso estaba declarado en el catálogo pero no se comprobaba.
//
// CATÁLOGOS QUE SE ADMINISTRAN SOLO DESDE SU MÓDULO (2026-11-13). El registro
// puede declarar `soloDesdeModulo` (dónde se administran): aquí se leen pero no
// se escriben, NI SIQUIERA con `sgc.configuracion`. Nació con los conceptos de
// nómina, que son por país y los decide Talento Humano de cada país: esta ruta
// genérica no puede validar el permiso por país ni derivar la clave estable, y
// el administrador de la plataforma no debe mover los totales de nómina de
// nadie por tener el panel general.
//
// CATÁLOGOS CON PERMISO PROPIO (2026-11-13). El registro puede declarar
// `exige: '<recurso>'`: ese recurso REEMPLAZA a `sgc.configuracion` para
// escribir (no se suma como alternativa). Nació con `secciones_carpeta`, cuyas
// marcas deciden quién ve los archivos sensibles de las carpetas de Talento
// Humano: con el permiso general, el administrador de la plataforma podría
// abrirlos sin pasar por Talento Humano.
function soloConfigOGlosario(req, res, next) {
  const cat = registro.catalogo(req.params.catalogo);
  const desdeModulo = cat?.soloDesdeModulo;
  if (desdeModulo) {
    return res.status(403).json({ error: `Este catálogo se administra desde ${desdeModulo}` });
  }
  if (cat?.exige) return exige(cat.exige)(req, res, next);
  if (req.params.catalogo === 'definiciones' && puede(req.usuario, 'documental.glosario')) return next();
  return soloConfig(req, res, next);
}

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'tmp_uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const router = express.Router();

// Qué catálogos existen y cuáles llevan id de negocio (código legible en lugar
// de UUID) sale del REGISTRO, no de dos listas paralelas aquí: mantenerlas a mano
// es cómo un catálogo termina servido por la API pero invisible en el panel, que
// es exactamente lo que pasó con tipos_hallazgo y fuentes_hallazgo.
const CATALOGOS = registro.IDS;
const ID_DE_NEGOCIO = registro.IDS_DE_NEGOCIO;

function validarCatalogo(req, res, next) {
  if (!CATALOGOS.includes(req.params.catalogo)) {
    return res.status(404).json({ error: 'Catálogo no existe' });
  }
  next();
}

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[config]', e);
      res.status(status).json({ error: e.message || 'Error interno' });
    }
  };
}

// La regla de un GRUPO se reescribe completa en cada guardado.
//
// `update()` hace merge, y un merge sobre un mapa anidado conserva las claves
// que ya estaban: cambiar un grupo de "por área" a "por usuarios seleccionados"
// dejaría dentro de la regla el `valor` del área anterior. Hoy no rompe nada
// —la resolución conmuta por `tipo`— pero es basura que el día que alguien lea
// `regla.valor` sin mirar el tipo se convierte en un permiso fantasma.
function normalizarGrupo(body) {
  if (!body || !body.regla) return body;
  const { tipo, valor = null, correos = [] } = body.regla;
  const esManual = tipo === 'manual';
  return {
    ...body,
    regla: {
      tipo,
      valor: esManual ? null : valor,
      correos: esManual
        ? [...new Set((correos || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
        : []
    }
  };
}

// El país de una sede se guarda igual a su nombre: el catálogo de sedes ES la
// lista de países donde opera la compañía. Se deriva en el SERVIDOR y no en el
// panel para que cualquier cliente —el panel, el seed, una migración— lo escriba
// igual; antes lo derivaba la interfaz y una sede creada por otra vía quedaba sin
// país, con el filtro por país devolviendo menos documentos de los que hay.
//
// La moneda se guarda en mayúsculas y se valida como código ISO 4217 de tres
// letras: con «cop» o «peso» la tasa presupuestal no se encuentra y la pestaña
// de costos mostraría «sin tasa» sin que nadie entienda por qué.
function normalizarSede(body) {
  if (!body) return body;
  const salida = body.nombre ? { ...body, pais: body.nombre } : { ...body };
  if (salida.moneda !== undefined) {
    const moneda = String(salida.moneda || '').trim().toUpperCase();
    if (moneda && !/^[A-Z]{3}$/.test(moneda)) {
      throw httpError(400, `La moneda "${salida.moneda}" debe ser un código ISO 4217 de tres letras (COP, MXN, USD…)`);
    }
    salida.moneda = moneda;
  }
  return salida;
}

// La sigla del proceso se recorta y se pasa a mayúsculas EN EL SERVIDOR, y su id
// se deriva de ella. Antes lo hacía solo la interfaz, y un espacio final invisible
// en el campo produjo dos procesos "GETI" y "GETI " que en el panel se veían
// idénticos, un contador de consecutivos aparte y un código emitido con espacio
// ("GETI -POL-1-GLO"). Los subprocesos siguen la misma regla.
function normalizarProceso(body) {
  if (!body) return body;
  const codigo = String(body.codigo || body.id || '').trim().toUpperCase();
  const salida = { ...body, codigo, nombre: String(body.nombre || '').trim() };
  if (body.id !== undefined || codigo) salida.id = codigo.toLowerCase();
  if (Array.isArray(body.subprocesos)) {
    salida.subprocesos = body.subprocesos.map((s) => {
      const c = String(s.codigo || s.id || '').trim().toUpperCase();
      return { ...s, id: c.toLowerCase(), codigo: c, nombre: String(s.nombre || '').trim() };
    });
  }
  return salida;
}

// Usuarios: el id ES el correo (en minúsculas), para que el directorio, los
// accesos y la sesión lo encuentren por la misma clave. El panel manda el
// correo tal como se tecleó; aquí se normaliza y se deriva el id.
function normalizarUsuario(body) {
  if (!body) return body;
  // Solo se normaliza lo que viene: un PUT parcial (p. ej. solo la clave) no
  // debe vaciar el correo ni el nombre de la fila.
  const correo = String(body.correo || body.id || '').trim().toLowerCase();
  let salida = { ...body };
  if (correo) { salida.correo = correo; salida.id = correo; }
  if (body.nombre !== undefined) salida.nombre = String(body.nombre || '').trim();
  if (salida.sedeId !== undefined) salida.sedeId = String(salida.sedeId || '').trim().toLowerCase() || null;
  // La clave se guarda cifrada; vacía u oculta no la toca; «-» la quita.
  salida = claves.prepararClave(salida);
  return salida;
}
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizar(catalogo, body) {
  if (catalogo === 'grupos') return normalizarGrupo(body);
  if (catalogo === 'sedes') return normalizarSede(body);
  if (catalogo === 'procesos') return normalizarProceso(body);
  if (catalogo === 'usuarios') { const { id, ...resto } = normalizarUsuario(body); return resto; }
  return body;
}

// Un proceso no puede repetir la sigla de otro ACTIVO, con distinto id o no: la
// sigla va embebida en el código de cada documento y dos procesos con la misma
// producen códigos indistinguibles. La comparación ignora espacios y mayúsculas,
// que es exactamente la diferencia que dejó pasar el duplicado. Los subprocesos
// tampoco se repiten dentro del mismo proceso.
async function validarProceso(datos, { idActual = null } = {}) {
  if (!datos.codigo) throw httpError(400, 'La sigla del proceso es obligatoria');
  if (!/^[A-Z0-9]{2,6}$/.test(datos.codigo)) {
    throw httpError(400, `La sigla "${datos.codigo}" solo admite de 2 a 6 letras o números, sin espacios`);
  }
  const tipos = await catalogos.leer('tipos_proceso');
  if (tipos.length && !tipos.some((t) => t.id === datos.tipo)) {
    throw httpError(400, `La cadena de valor "${datos.tipo || ''}" no existe: elija una del catálogo Cadena de valor`);
  }
  const activos = await col('procesos').list((p) => p.activo !== false);
  const repetido = activos.find((p) =>
    p.id !== idActual && String(p.codigo || '').trim().toUpperCase() === datos.codigo);
  if (repetido) {
    throw httpError(409, `Ya existe el proceso "${repetido.codigo}" (${repetido.nombre}). ` +
      'Si es el mismo, edítelo en lugar de crearlo de nuevo.');
  }
  const subs = (datos.subprocesos || []).map((s) => s.codigo);
  const subRepetido = subs.find((c, i) => subs.indexOf(c) !== i);
  if (subRepetido) throw httpError(400, `El subproceso "${subRepetido}" está repetido`);
  if (subs.some((c) => !c)) throw httpError(400, 'Todo subproceso necesita una sigla');
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// El REGISTRO: qué se configura, agrupado por módulo, y qué módulos comparte cada
// catálogo global. Lo consume el panel para armar sus pestañas y para avisar a
// quién más afecta un cambio.
//
// Va ANTES de `/:catalogo` porque tiene un solo segmento y esa ruta lo capturaría
// (respondiendo "Catálogo no existe"). El guion bajo del nombre deja claro que no
// es un catálogo. Se lee sin permisos especiales: es la estructura, no el dato.
//
// `?conteos=1` agrega cuántos registros ACTIVOS tiene cada catálogo. El panel los
// pinta junto a cada entrada de su árbol, y es lo que hace visible de un vistazo
// el fallo que originó todo esto: un catálogo en cero se ve en cero, en lugar de
// descubrirse como un desplegable vacío tres pantallas más adelante.
//
// Va detrás de un parámetro y no siempre porque obliga a leer las diez
// colecciones. Son catálogos —listables y memoizados (docs/POLITICA-COSTOS.md)—,
// así que la primera llamada las lee y las siguientes salen de caché; aun así, no
// hay razón para que lo pague quien solo quiere la estructura.
router.get('/_registro', manejar(async (req, res) => {
  const base = registro.paraPanel();
  if (req.query.conteos !== '1') return res.json(base);

  const conteos = {};
  await Promise.all(registro.IDS.map(async (id) => {
    // Un catálogo que falle deja su contador en null y el panel lo omite: perder
    // un número no puede impedir administrar los otros nueve.
    try {
      conteos[id] = (await catalogos.leer(id)).length;
    } catch (e) {
      console.warn(`[config] no se pudo contar "${id}":`, e.message);
      conteos[id] = null;
    }
  }));
  res.json({ ...base, conteos });
}));

// Estos catálogos los pide el frontend para pintar CUALQUIER formulario, así que
// sin caché se leen decenas de veces por sesión y por usuario. Son decenas de
// documentos que cambian una vez al mes: el caso de libro para memo().
//
// `?inactivos=1` devuelve además los inactivados. Es exclusivo del panel de
// configuración: en un formulario normal un registro retirado no debe aparecer,
// pero quien administra el catálogo tiene que verlo para poder reactivarlo.
router.get('/:catalogo', validarCatalogo, manejar(async (req, res) => {
  const { catalogo } = req.params;
  if (req.query.inactivos === '1') {
    // Quien administra un catálogo con permiso propio (`exige`) tiene que ver
    // sus inactivos para reactivarlos, aunque no tenga el panel general.
    const exigido = registro.catalogo(catalogo)?.exige;
    if (!puede(req.usuario, 'sgc.configuracion') && !(exigido && puede(req.usuario, exigido))) {
      return res.status(403).json({ error: 'Ver los registros inactivos requiere el acceso de configuración' });
    }
    return res.json(sinClaves(catalogo, await catalogos.leerConInactivos(catalogo)));
  }
  res.json(sinClaves(catalogo, await catalogos.leer(catalogo)));
}));

// El catálogo de usuarios sale sin la clave de ingreso (solo si la tiene): lo
// consume cualquier sesión, y la auditoría tampoco debe guardarla.
function claves_fila(catalogo, fila) {
  return catalogo === 'usuarios' ? claves.ocultar(fila) : fila;
}
function sinClaves(catalogo, filas) {
  return catalogo === 'usuarios' ? filas.map(claves.ocultar) : filas;
}
function detalleAuditable(catalogo, body) {
  if (catalogo !== 'usuarios' || !body) return body;
  const { clave, ...resto } = body;
  return clave === undefined ? resto : { ...resto, clave: '(no se registra)' };
}

router.post('/:catalogo', validarCatalogo, soloConfigOGlosario, manejar(async (req, res) => {
  const { catalogo } = req.params;
  // Los procesos se normalizan ANTES de mirar el id: el id sale de la sigla ya
  // recortada, no de lo que haya tecleado el panel.
  if (catalogo === 'procesos') {
    req.body = normalizarProceso(req.body);
    await validarProceso(req.body);
  }
  if (catalogo === 'usuarios') {
    req.body = normalizarUsuario(req.body);
    if (!CORREO_VALIDO.test(req.body.correo || '')) return res.status(400).json({ error: 'El correo no es válido' });
    if (!req.body.nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  if (ID_DE_NEGOCIO.includes(catalogo) && !req.body.id) {
    return res.status(400).json({ error: 'Este catálogo requiere un id (código) explícito' });
  }

  const existente = req.body.id ? await col(catalogo).get(req.body.id) : null;

  if (existente && existente.activo !== false) {
    return res.status(409).json({
      error: `Ya existe un registro activo con el id "${req.body.id}"`
    });
  }

  // REACTIVACIÓN de un registro inactivado.
  //
  // Aquí nada se borra físicamente (trazabilidad ISO): "eliminar" es inactivar, y
  // el id sigue ocupado aunque la interfaz ya no muestre la fila. Sin esta rama,
  // borrar por error dejaba el id bloqueado para siempre: al intentar volver a
  // crearlo respondía "ya existe" sobre un registro invisible, y la única salida
  // era inventarse otro código.
  //
  // Se reactiva con los datos que lleguen, no con los que tenía: quien lo vuelve
  // a crear está declarando cómo debe quedar.
  if (existente) {
    const row = await col(catalogo).update(existente.id, { ...normalizar(catalogo, req.body), activo: true });
    catalogos.invalidar(catalogo);
    if (catalogo === 'parametros') invalidar();
    await auditar(req.usuario.correo, 'config.reactivar', `${catalogo}/${existente.id}`, detalleAuditable(catalogo, req.body));
    return res.json({ ...claves_fila(catalogo, row), reactivado: true });
  }

  const row = await col(catalogo).insert({ ...normalizar(catalogo, req.body), activo: true });
  catalogos.invalidar(catalogo);
  if (catalogo === 'parametros') invalidar();
  await auditar(req.usuario.correo, 'config.crear', `${catalogo}/${row.id}`, detalleAuditable(catalogo, req.body));
  res.status(201).json(claves_fila(catalogo, row));
}));

router.put('/:catalogo/:id', validarCatalogo, soloConfigOGlosario, manejar(async (req, res) => {
  const { catalogo, id } = req.params;
  let datos = normalizar(catalogo, req.body);
  if (catalogo === 'usuarios') {
    // El correo es el id de la fila: no se cambia editando (se crea otra persona).
    delete datos.correo;
    if (datos.nombre === '') return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  if (catalogo === 'procesos') {
    // El id de un proceso existente no cambia al editar su sigla (los documentos
    // lo referencian por id); la sigla nueva sí se valida contra los demás.
    const actual = await col(catalogo).get(id);
    if (!actual) return res.status(404).json({ error: 'El proceso no existe' });
    datos = { ...datos, id, codigo: datos.codigo || actual.codigo, nombre: datos.nombre || actual.nombre };
    await validarProceso({ ...actual, ...datos }, { idActual: id });
    delete datos.id;
  }
  const row = claves_fila(catalogo, await col(catalogo).update(id, datos));
  catalogos.invalidar(catalogo);
  if (catalogo === 'parametros') invalidar();
  await auditar(req.usuario.correo, 'config.editar', `${catalogo}/${id}`, detalleAuditable(catalogo, req.body));
  res.json(row);
}));

// Inactivación lógica: nada se borra físicamente (trazabilidad ISO).
router.delete('/:catalogo/:id', validarCatalogo, soloConfigOGlosario, manejar(async (req, res) => {
  const { catalogo, id } = req.params;
  const row = await col(catalogo).update(id, { activo: false });
  catalogos.invalidar(catalogo);
  if (catalogo === 'parametros') invalidar();
  await auditar(req.usuario.correo, 'config.inactivar', `${catalogo}/${id}`);
  res.json(row);
}));

// ---------- Grupos: quiénes son sus integrantes HOY ----------
//
// Un grupo guarda una REGLA, no una lista de personas. Eso es lo que hace que un
// cambio de personal no rompa los flujos ni los permisos configurados, pero
// obliga a poder ver a quién alcanza la regla antes de usarla: nadie debería
// asignar la visualización de un documento a "Equipo Comercial" a ciegas.
//
// La ruta tiene tres segmentos, así que no colisiona con `/:catalogo`, que solo
// captura uno.
router.get('/grupos/:id/integrantes', manejar(async (req, res) => {
  const grupo = await col('grupos').get(req.params.id);
  if (!grupo) return res.status(404).json({ error: 'El grupo no existe' });

  let integrantes = [];
  let advertencia = null;
  try {
    const personas = await destinatarios.resolver([{ tipo: 'grupo', valor: grupo.id }]);
    const indice = await empleados.indice();
    integrantes = personas.map(({ correo }) => {
      const e = indice.get(correo) || {};
      return { correo, nombre: e.nombre || correo, cargo: e.cargo || null, area: e.area || null };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } catch (e) {
    // Un grupo que hoy no alcanza a nadie no es un error de la consulta: es
    // justamente lo que hay que poder ver antes de usarlo en un permiso.
    advertencia = e.message;
  }

  res.json({
    id: grupo.id,
    nombre: grupo.nombre,
    regla: grupo.regla || null,
    total: integrantes.length,
    integrantes,
    advertencia
  });
}));

// ---------- Plantillas institucionales ----------
// Sirven de base para crear documentos sin partir de cero. Se descargan siempre
// en su formato editable: para eso existen.

router.post('/plantillas/:id/archivo', soloConfig, upload.single('archivo'), manejar(async (req, res) => {
  const plantilla = await col('plantillas').get(req.params.id);
  if (!plantilla) return res.status(404).json({ error: 'La plantilla no existe' });
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

  const nombre = storage.nombreCliente(req.file.originalname);
  const key = storage.buildKey('plantillas', plantilla.id, 1, nombre);
  await storage.saveFile(req.file.path, key, { contentType: req.file.mimetype });
  const row = await col('plantillas').update(plantilla.id, {
    archivo: { key, nombre, tamano: req.file.size },
    updatedBy: req.usuario.correo
  });
  catalogos.invalidar('plantillas');
  await auditar(req.usuario.correo, 'config.plantilla.archivo', `plantillas/${plantilla.id}`);
  res.json(row);
}));

router.get('/plantillas/:id/archivo', manejar(async (req, res) => {
  const plantilla = await col('plantillas').get(req.params.id);
  if (!plantilla || !plantilla.archivo) {
    return res.status(404).json({ error: 'La plantilla no tiene archivo cargado' });
  }
  if (!await storage.exists(plantilla.archivo.key)) {
    return res.status(404).json({ error: 'Archivo no encontrado en almacenamiento' });
  }
  await storage.servir(res, plantilla.archivo.key, { nombre: plantilla.archivo.nombre });
}));

module.exports = { router };
