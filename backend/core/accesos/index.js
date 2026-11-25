// MÓDULO DE GESTIÓN DE ACCESOS — endpoints /api/accesos/*
//
// Dos niveles de autorización:
//   PÚBLICO (cualquier usuario autenticado por IAP):
//     GET  /mis-accesos          → qué puede ver quien pregunta (alimenta la UI)
//   SOLO ADMINISTRADORES DEL PANEL:
//     GET  /catalogo             → recursos con sus titulares
//     PUT  /recurso/:id          → guardar titulares
//     GET  /simular?correo=      → "¿qué vería esta persona?"
//     GET  /auditoria
//     POST /sembrar              → siembra inicial idempotente
//   DEL DIRECTOR DE TALENTO HUMANO (aprobador de los recursos soloTitulares):
//     GET  /solicitudes          → bandeja paginada por estado
//     POST /solicitudes/:id/aprobar | /rechazar
//   En los recursos `soloTitulares` el PUT aplica de inmediato solo lo que
//   QUITA acceso; lo que lo DA responde 202 y espera esa aprobación.
const express = require('express');
const { col } = require('../../lib/db');
const { auditar, bitacora } = require('../../lib/audit');
const { invalidarUsuarios } = require('../../lib/permisos');
const { RECURSOS, GRUPOS, getRecurso } = require('./registry');
const engine = require('./engine');
const solicitudes = require('./solicitudes');
const empleados = require('../empleados');

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Sin dominio corporativo: cualquier correo válido puede ser titular.
const DOMINIOS = [];

const router = express.Router();

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[accesos]', e);
      res.status(status).json({ error: e.message || 'Error interno' });
    }
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Exige ser administrador del panel. Devuelve el correo detectado en el 403:
// si a un administrador legítimo le sale esto, lo primero es ver con qué
// identidad está entrando.
async function soloAdminAccesos(req, res, next) {
  try {
    if (!(await engine.esAdminAccesos(req.usuario.correo))) {
      return res.status(403).json({
        error: 'No tiene permiso para administrar accesos',
        correoDetectado: req.usuario.correo
      });
    }
    next();
  } catch (e) {
    console.error('[accesos]', e);
    res.status(500).json({ error: 'Error verificando permisos' });
  }
}

// ---------- Validación de titulares ----------

function limpiarCorreos(lista, etiqueta, errores, advertencias) {
  if (!Array.isArray(lista)) {
    errores.push(`${etiqueta}: se esperaba una lista.`);
    return [];
  }
  const vistos = new Set();
  const salida = [];
  for (const cruda of lista) {
    const e = engine.normalizarCorreo(cruda);
    if (!e) continue;
    if (!RE_CORREO.test(e)) { errores.push(`${etiqueta}: "${cruda}" no es un correo válido.`); continue; }
    if (vistos.has(e)) continue;
    vistos.add(e);
    if (DOMINIOS.length && !DOMINIOS.includes(e.split('@')[1])) {
      advertencias.push(`${e} no pertenece a un dominio corporativo (${DOMINIOS.join(', ')}).`);
    }
    salida.push(e);
  }
  return salida;
}

async function validar(recurso, body) {
  const errores = [];
  const advertencias = [];
  const datos = { emails: [], scopes: {}, roles: {}, abierto: false };

  datos.emails = limpiarCorreos(body?.emails || [], 'Acceso total', errores, advertencias);

  const CLAVE_SCOPE = { 'scope-procesos': 'procesos', 'scope-sedes': 'sedes', 'scope-areas': 'areas', 'scope-apps': 'apps' };
  if (CLAVE_SCOPE[recurso.tipo]) {
    const clave = CLAVE_SCOPE[recurso.tipo];
    // Procesos y sedes se validan contra sus catálogos; las áreas no tienen
    // catálogo propio: son las del directorio de Talento Humano. Si el
    // directorio no responde, no se puede validar y se rechaza el guardado
    // (falla cerrado, como todo el motor de accesos).
    //
    // Las apps son los asset_id de la fuente que importa el módulo de
    // seguridad: aquí solo se valida la FORMA (enteros) —la existencia la
    // ofrece la interfaz con las opciones del propio módulo— porque este panel
    // no lee colecciones de un módulo de negocio (regla de fronteras).
    let validos = null;
    if (clave === 'areas') {
      try {
        validos = new Set((await empleados.listar()).map((e) => e.area).filter(Boolean));
      } catch {
        throw httpError(503, 'El directorio de empleados no está disponible; ' +
          'no se pueden validar las áreas asignadas. Intente de nuevo más tarde.');
      }
    } else if (clave !== 'apps') {
      validos = new Set((await col(clave).list()).map((x) => x.id));
    }

    for (const [correoCrudo, ambito] of Object.entries(body?.scopes || {})) {
      const e = engine.normalizarCorreo(correoCrudo);
      if (!e) continue;
      if (!RE_CORREO.test(e)) { errores.push(`Ámbito: "${correoCrudo}" no es un correo válido.`); continue; }
      let ids = Array.isArray(ambito?.[clave]) ? ambito[clave].filter(Boolean) : null;
      if (!ids) { errores.push(`Ámbito de ${e}: se esperaba una lista de ${clave}.`); continue; }
      const desconocidos = validos
        ? ids.filter((id) => !validos.has(id))
        : ids.filter((id) => !/^\d+$/.test(String(id)));   // apps: solo enteros
      if (desconocidos.length) {
        errores.push(`Ámbito de ${e}: ${clave} ${validos ? 'inexistentes' : 'inválidas'} (${desconocidos.join(', ')}).`);
        continue;
      }
      if (ids.length === 0) continue;                 // sin ámbito = no asignar
      if (datos.emails.includes(e)) {
        advertencias.push(`${e} tiene acceso TOTAL y además un ámbito limitado; el total manda.`);
      }
      if (clave === 'apps') ids = ids.map(String);    // ids homogéneos entre panel y motor
      datos.scopes[e] = { [clave]: [...new Set(ids)] };
    }
  } else if (body?.scopes && Object.keys(body.scopes).length) {
    errores.push(`El recurso "${recurso.id}" es de tipo ${recurso.tipo} y no admite ámbitos.`);
  }

  if (recurso.tipo === 'roles') {
    const validos = new Set((recurso.roles || []).map((r) => r.key));
    for (const [rol, lista] of Object.entries(body?.roles || {})) {
      if (!validos.has(rol)) { errores.push(`Rol desconocido: "${rol}".`); continue; }
      datos.roles[rol] = limpiarCorreos(lista, `Rol ${rol}`, errores, advertencias);
    }
  }

  if (typeof body?.abierto === 'boolean') {
    if (!recurso.abrible) {
      errores.push(`El recurso "${recurso.id}" no admite apertura total.`);
    } else {
      datos.abierto = body.abierto;
      if (datos.abierto) {
        advertencias.push('Este recurso queda ABIERTO a cualquier colaborador autenticado; ' +
          'la lista de correos deja de aplicar mientras el interruptor esté encendido.');
      }
    }
  }

  // Dejar un recurso sin nadie suele ser un error de dedo, no una intención.
  if (!datos.abierto && !datos.emails.length && !Object.keys(datos.scopes).length &&
      !Object.values(datos.roles).flat().length) {
    advertencias.push('Va a dejar este recurso SIN NINGUNA persona con acceso.');
  }

  return { ok: errores.length === 0, datos, errores, advertencias };
}

// ---------- Público ----------

// Solicitudes de acceso a recursos soloTitulares: las decide el director de
// Talento Humano, que normalmente NO administra el panel. Por eso no pasan por
// soloAdminAccesos; cada ruta revalida la condición de aprobador.
router.use('/solicitudes', solicitudes.router);

router.get('/mis-accesos', manejar(async (req, res) => {
  const perfil = await engine.resolverUsuario(req.usuario.correo);
  res.json({
    ...perfil,
    esAdminAccesos: await engine.esAdminAccesos(req.usuario.correo)
  });
}));

// ---------- Panel ----------

router.get('/catalogo', soloAdminAccesos, manejar(async (req, res) => {
  const [recursos, procesos, sedes] = await Promise.all([
    engine.catalogo(),
    col('procesos').list((p) => p.activo !== false),
    col('sedes').list((s) => s.activo !== false)
  ]);
  // Las áreas salen del directorio, no de un catálogo. Si BigQuery no responde,
  // el panel abre igual: solo el ámbito por áreas queda sin opciones para marcar.
  let areas = [];
  try {
    areas = [...new Set((await empleados.listar()).map((e) => e.area).filter(Boolean))].sort();
  } catch (e) {
    console.warn('[accesos] directorio no disponible para listar áreas:', e.message);
  }
  // Solicitudes en espera de cada recurso protegido: el panel avisa que hay
  // otorgamientos pendientes del director. Un contar() por recurso (son tres).
  for (const r of recursos.filter((x) => x.soloTitulares)) {
    r.solicitudesPendientes = await col('solicitudes_acceso').contar({ recursoId: r.id, estado: 'pendiente' }).catch(() => null);
  }
  res.json({
    actor: req.usuario.correo,
    grupos: GRUPOS,
    recursos,
    procesos: procesos.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre })),
    sedes: sedes.map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre })),
    areas: areas.map((a) => ({ id: a, nombre: a })),
    generadoEn: new Date().toISOString()
  });
}));

router.get('/recurso/:id', soloAdminAccesos, manejar(async (req, res) => {
  const recurso = getRecurso(req.params.id);
  if (!recurso) throw httpError(404, `Recurso desconocido: "${req.params.id}"`);
  res.json({ recurso, titulares: await engine.titulares(recurso.id, { usarCache: false }) });
}));

router.put('/recurso/:id', soloAdminAccesos, manejar(async (req, res) => {
  const recurso = getRecurso(req.params.id);
  if (!recurso) throw httpError(404, `Recurso desconocido: "${req.params.id}"`);

  const { ok, datos, errores, advertencias } = await validar(recurso, req.body || {});
  if (!ok) return res.status(400).json({ error: 'Datos inválidos', details: errores, advertencias });

  // Salvaguardas del propio panel: nunca dejarlo sin dueño, y nadie se quita a
  // sí mismo (obliga a que sea otro administrador quien lo retire).
  if (recurso.id === 'sgc.accesos') {
    if (!datos.emails.length) {
      throw httpError(400, 'Debe quedar al menos un administrador del panel de accesos.');
    }
    if (!datos.emails.includes(req.usuario.correo)) {
      throw httpError(400, 'No puede quitarse a sí mismo de la lista de administradores del panel. ' +
        'Pídale a otro administrador que lo haga.');
    }
  }
  if (recurso.id === 'sgc.administrador' && !datos.emails.length) {
    throw httpError(400, 'Debe quedar al menos un administrador de la plataforma.');
  }
  // El recurso que APRUEBA (director de Talento Humano) no puede quedar vacío
  // desde el panel: sin director nadie aprueba, y el único camino de vuelta
  // sería el script de arranque. Retirar al último exige nombrar antes a otro.
  if (recurso.aprueba && !datos.emails.length) {
    throw httpError(400, 'Debe quedar al menos un director de Talento Humano. Nombre primero a su ' +
      'reemplazo (requiere aprobación) y después retire al actual.');
  }

  // Datos personales de Talento Humano: lo que quita se aplica, lo que da
  // espera la aprobación del director. Ver core/accesos/solicitudes.js.
  if (recurso.soloTitulares) return guardarProtegido(req, res, recurso, datos, advertencias);

  const antes = await engine.titulares(recurso.id, { usarCache: false });
  const despues = await engine.guardar(recurso.id, datos, req.usuario.correo);
  // El perfil de cada usuario lleva sus permisos resueltos y se cachea aparte:
  // sin esto, conceder o revocar un acceso tardaría hasta 30 s en surtir efecto.
  invalidarUsuarios();

  await auditar(req.usuario.correo, 'accesos.actualizar', `accesos/${recurso.id}`, {
    recurso: recurso.nombre,
    antes: { emails: antes.emails, scopes: antes.scopes, roles: antes.roles, abierto: antes.abierto },
    despues: { emails: despues.emails, scopes: despues.scopes, roles: despues.roles, abierto: despues.abierto }
  });

  res.json({ ok: true, titulares: despues, advertencias });
}));

// Guardado de un recurso `soloTitulares`. La petición se valida entera ANTES de
// escribir: si trae un autootorgamiento (403) o no hay director que pueda
// aprobar (409), no se toca nada, ni siquiera las bajas, para que el panel no
// quede a medias con un error en pantalla.
async function guardarProtegido(req, res, recurso, datos, advertencias) {
  const actor = req.usuario.correo;
  const antes = await engine.titulares(recurso.id, { usarCache: false });
  const { altas, reducido, hayBajas } = solicitudes.comparar(recurso, antes, datos);
  // El chequeo del PUT mira la lista PEDIDA, pero aquí se aplica la REDUCIDA:
  // reemplazar al único director por otro en un solo guardado pide una lista
  // no vacía, la baja se aplica ya y el alta queda esperando la aprobación… de
  // un director que ya no existe. Nadie podría aprobarla nunca (bloqueo). Por
  // eso, para el recurso que aprueba, lo que debe quedar no vacío es lo que se
  // aplica AHORA: primero se nombra al reemplazo (y se aprueba), después se
  // retira al anterior.
  if (recurso.aprueba && !reducido.emails.length) {
    throw httpError(400, 'Debe quedar al menos un director de Talento Humano vigente. Las altas esperan ' +
      'aprobación y las bajas se aplican de inmediato: nombre primero al reemplazo, espere su aprobación ' +
      'y después retire al actual.');
  }
  const aprobadores = altas.length ? await solicitudes.verificarAltas(recurso, altas, actor) : [];

  let vigente = antes;
  if (hayBajas) {
    vigente = await engine.guardar(recurso.id, reducido, actor);
    invalidarUsuarios();
    await auditar(actor, 'accesos.actualizar', `accesos/${recurso.id}`, {
      recurso: recurso.nombre,
      soloBajas: true,
      antes: { emails: antes.emails, scopes: antes.scopes, roles: antes.roles, abierto: antes.abierto },
      despues: { emails: vigente.emails, scopes: vigente.scopes, roles: vigente.roles, abierto: vigente.abierto }
    });
    await bitacora(solicitudes.BITACORA, solicitudes.COL_BITACORA, {
      evento: 'acceso_revocado', actor, correo: actor, recursoId: recurso.id,
      detalle: { antes: { emails: antes.emails, scopes: antes.scopes }, despues: { emails: vigente.emails, scopes: vigente.scopes } }
    });
  }

  if (!altas.length) return res.json({ ok: true, titulares: vigente, advertencias });

  const solicitud = await solicitudes.crearSolicitud({ recurso, altas, actor, aprobadores });
  res.status(202).json({
    ok: true,
    pendienteAprobacion: true,
    mensaje: `Pendiente de aprobación del director de Talento Humano: ${altas.map((a) => solicitudes.describirAlta(a, recurso)).join('; ')}.` +
      (hayBajas ? ' Las bajas ya se aplicaron.' : ''),
    solicitud,
    titulares: vigente,
    advertencias
  });
}

// "¿Qué vería esta persona?" — evita repartir accesos a ciegas.
router.get('/simular', soloAdminAccesos, manejar(async (req, res) => {
  const correo = engine.normalizarCorreo(req.query.correo);
  if (!correo || !RE_CORREO.test(correo)) throw httpError(400, 'Parámetro "correo" inválido o ausente');
  const perfil = await engine.resolverUsuario(correo);
  res.json({
    ...perfil,
    detalle: RECURSOS.map((r) => ({
      id: r.id, nombre: r.nombre, grupo: r.grupo, tipo: r.tipo, permitido: perfil.permisos[r.id]
    }))
  });
}));

// DEUDA DE COSTO — la peor de las que quedan, aunque no la más visible.
//
// `auditoria` es append-only: una fila por cada escritura de toda la plataforma,
// para siempre, y nada la poda (es trazabilidad ISO, no se borra). Es la
// colección que más va a crecer de la plataforma, y este endpoint la lee entera
// para devolver 100 filas.
//
// No se arregla con un filtro porque el criterio es un PREFIJO de `accion`
// ("accesos.*"), y ordenar por fecha con un filtro de rango sobre otro campo
// exige un índice compuesto que hoy no existe. La solución es denormalizar
// `modulo` en lib/audit.js y consultar por igualdad + fecha.
// Plan completo: docs/POLITICA-COSTOS.md §Migración pendiente.
router.get('/auditoria', soloAdminAccesos, manejar(async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 100, 500);
  const filas = await col('auditoria').list((a) => String(a.accion || '').startsWith('accesos.'), {
    motivo: 'DEUDA: filtro por prefijo de accion sin campo `modulo` denormalizado'
  });
  filas.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  res.json({ registros: filas.slice(0, limite) });
}));

// Siembra inicial: idempotente y NUNCA sobreescribe un recurso que ya exista,
// para que sembrar dos veces no pise un cambio hecho desde el panel.
router.post('/sembrar', soloAdminAccesos, manejar(async (req, res) => {
  const simulacro = req.query.simulacro === '1';
  const sembrados = [];
  const omitidos = [];

  for (const r of RECURSOS) {
    if (await col('accesos').get(r.id)) { omitidos.push(r.id); continue; }
    const semilla = { emails: [], scopes: {}, roles: {}, abierto: false };
    // Arranque razonable: el módulo documental abierto a consulta para todos,
    // el resto cerrado. Los administradores se siembran con quien ejecuta.
    if (r.id === 'modulo.documental') semilla.abierto = true;
    if (r.id === 'sgc.administrador' || r.id === 'sgc.accesos' || r.id === 'sgc.configuracion') {
      semilla.emails = [req.usuario.correo];
    }
    if (!simulacro) await engine.guardar(r.id, semilla, `${req.usuario.correo} (siembra inicial)`);
    sembrados.push({ id: r.id, nombre: r.nombre, abierto: semilla.abierto, emails: semilla.emails });
  }
  if (!simulacro) invalidarUsuarios();

  if (!simulacro && sembrados.length) {
    await auditar(req.usuario.correo, 'accesos.siembra', 'accesos', { sembrados: sembrados.map((s) => s.id) });
  }
  res.json({ ok: true, simulacro, sembrados, omitidos });
}));

// Directorio de empleados: alimenta el selector de personas del panel.
router.use('/empleados', empleados.router);

module.exports = { router };
