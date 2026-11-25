// SOLICITUDES DE ACCESO A RECURSOS `soloTitulares` — endpoints /api/accesos/solicitudes/*
//
// Requerimiento del dueño del proceso (2026-11-12) sobre los datos personales de
// Talento Humano (carpetas, costos y nómina):
//   1. El administrador de la plataforma no los ve por serlo (engine.js · permite).
//   2. Nadie se otorga a sí mismo acceso a esa información. Quien administra el
//      panel PUEDE pedirlo para sí (2026-11-13: así lo definió el dueño), pero
//      queda como cualquier otra solicitud: no surte efecto hasta que un director
//      de Talento Humano que no sea él lo apruebe.
//   3. Todo otorgamiento, a otro o a sí mismo, espera la aprobación del director
//      de Talento Humano (titular del recurso `aprueba` del módulo) antes de
//      surtir efecto.
//
// Por eso el PUT del panel (index.js) parte cada cambio en dos:
//   · lo que QUITA acceso se aplica de inmediato: reducir acceso nunca es el
//     riesgo, y demorar una revocación sí lo es (un retiro, un cambio de cargo);
//   · lo que DA acceso no se aplica: queda una solicitud `pendiente` y un
//     pendiente para cada aprobador. Al aprobarse, las altas se aplican sobre el
//     estado VIGENTE del recurso, no sobre la foto del día de la solicitud: si en
//     medio alguien revocó a otra persona, aprobar no la resucita.
//
// Las rutas de aprobación NO pasan por `soloAdminAccesos`: el director de
// Talento Humano normalmente no administra el panel, y no debe necesitarlo. Las
// protege la propia condición de aprobador, revalidada en cada petición.
//
// Segregación de funciones (ISO 27001 A.5.3): quien pidió no aprueba, y nadie
// aprueba una solicitud que lo beneficie.
const crypto = require('crypto');
const express = require('express');
const { col } = require('../../lib/db');
const { auditar, bitacora } = require('../../lib/audit');
const { invalidarUsuarios } = require('../../lib/permisos');
const { crearPendiente, cerrarPendientes } = require('../pendientes');
const { getRecurso } = require('./registry');
const engine = require('./engine');

const COLECCION = 'solicitudes_acceso';
const TIPO_PENDIENTE = 'accesos_aprobar_solicitud';
const REF_TIPO = 'solicitud_acceso';
// Ruta del frontend que atiende el pendiente (src/modules/inicio): transversal,
// abierta a cualquier usuario autenticado y protegida por el backend.
const RUTA = '/solicitudes-acceso';

// Bitácora inmutable: cada línea sale a stdout (Cloud Logging, sink con
// retención bloqueada; ver lib/audit.js) y su copia en Firestore va a
// `auditoria`, que es core, append-only y ya no se borra por norma. Si mañana
// se quiere consultar aparte, basta registrar una colección propia en AMBITOS.
const BITACORA = 'sgc-accesos-protegidos';
const COL_BITACORA = 'auditoria';

const CLAVE_SCOPE = { 'scope-procesos': 'procesos', 'scope-sedes': 'sedes', 'scope-areas': 'areas', 'scope-apps': 'apps' };

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[accesos/solicitudes]', e);
      res.status(status).json({ error: e.message || 'Error interno' });
    }
  };
}

// ---------- Diferencias entre dos estados de titulares ----------
//
// La cobertura de una persona es 'total' (está en `emails`), un conjunto de
// ids de ámbito (sedes, procesos…) o null (nada). Se compara persona por
// persona: así «pasar de Colombia a acceso total» es un ALTA (gana sedes) y
// «pasar de total a solo Colombia» es una BAJA (las pierde), sin depender de en
// qué lista esté escrito el correo.
function cobertura(t, correo, clave) {
  if ((t.emails || []).includes(correo)) return 'total';
  const ids = clave ? (t.scopes?.[correo]?.[clave] || []) : [];
  return ids.length ? new Set(ids.map(String)) : null;
}

function interseccion(a, b) {
  if (!a || !b) return null;
  if (a === 'total') return b;
  if (b === 'total') return a;
  const comun = [...a].filter((x) => b.has(x));
  return comun.length ? new Set(comun) : null;
}

function iguales(a, b) {
  if (a === b) return true;
  if (!a || !b || a === 'total' || b === 'total') return false;
  return a.size === b.size && [...a].every((x) => b.has(x));
}

// Devuelve:
//   altas     → [{ correo, total: true } | { correo, total: false, [clave]: [...] }]
//   reducido  → el estado ANTES menos lo que el cambio quita (sin ninguna alta)
//   hayBajas  → si `reducido` difiere de ANTES
function comparar(recurso, antes, despues) {
  const clave = CLAVE_SCOPE[recurso.tipo] || null;
  const personas = new Set([
    ...(antes.emails || []), ...Object.keys(antes.scopes || {}),
    ...(despues.emails || []), ...Object.keys(despues.scopes || {})
  ]);
  const altas = [];
  const reducido = { emails: [], scopes: {}, roles: antes.roles || {}, abierto: false };
  let hayBajas = false;
  for (const correo of personas) {
    const a = cobertura(antes, correo, clave);
    const d = cobertura(despues, correo, clave);
    const r = interseccion(a, d);
    if (!iguales(a, r)) hayBajas = true;
    if (r === 'total') reducido.emails.push(correo);
    else if (r) reducido.scopes[correo] = { [clave]: [...r] };

    if (d === 'total' && a !== 'total') altas.push({ correo, total: true });
    else if (d && d !== 'total' && a !== 'total') {
      const nuevas = [...d].filter((x) => !(a && a.has(x)));
      if (nuevas.length) altas.push({ correo, total: false, [clave]: nuevas });
    }
  }
  // Un `abierto` que estuviera encendido en la base se apaga: en estos
  // recursos no aplica nunca, y dejarlo escrito confunde al panel.
  if (antes.abierto) hayBajas = true;
  return { altas, reducido, hayBajas };
}

// Aplica las altas aprobadas sobre el estado VIGENTE del recurso.
function aplicarAltas(recurso, vigente, altas) {
  const clave = CLAVE_SCOPE[recurso.tipo] || null;
  const emails = [...(vigente.emails || [])];
  const scopes = JSON.parse(JSON.stringify(vigente.scopes || {}));
  for (const alta of altas) {
    if (alta.total) {
      if (!emails.includes(alta.correo)) emails.push(alta.correo);
      delete scopes[alta.correo];               // el total manda; el ámbito sobra
    } else if (clave && !emails.includes(alta.correo)) {
      const previas = scopes[alta.correo]?.[clave] || [];
      scopes[alta.correo] = { [clave]: [...new Set([...previas, ...(alta[clave] || [])])] };
    }
  }
  return { emails, scopes, roles: vigente.roles || {}, abierto: false };
}

function describirAlta(alta, recurso) {
  if (alta.total) return `${alta.correo} (acceso total)`;
  const clave = CLAVE_SCOPE[recurso.tipo];
  return `${alta.correo} (${clave}: ${(alta[clave] || []).join(', ')})`;
}

function moduloDePendiente(recurso) {
  return recurso.grupo === 'Talento Humano' ? 'talento-humano' : 'accesos';
}

// ---------- Crear la solicitud (la llama el PUT del panel) ----------

// Lanza 409 si no hay quién apruebe. Se llama ANTES de escribir nada: o la
// petición entera es aceptable o no se toca el recurso.
//
// Pedir acceso para sí mismo ya no se rechaza: queda como solicitud igual que
// las demás. Lo que lo hace seguro es que NADA de lo que da acceso se escribe
// aquí, y que el aprobador nunca puede ser quien pide ni quien se beneficia
// (filtro de abajo y revalidación en `decidir`).
async function verificarAltas(recurso, altas, actor) {
  const beneficiarios = new Set(altas.map((a) => a.correo));
  const aprobadores = (await engine.aprobadoresDe(recurso.id))
    .filter((c) => c !== actor && !beneficiarios.has(c));
  if (!aprobadores.length) {
    throw httpError(409, `Otorgar acceso a «${recurso.nombre}» exige la aprobación del director de ` +
      'Talento Humano, y no hay ningún director que pueda aprobar esta solicitud (quien la pide y ' +
      'quien se beneficia no cuentan). Primero debe existir un director: el primero se nombra con ' +
      'seed/nombrar-director-tthh.js; los siguientes, con la aprobación de uno vigente. ' +
      'Si además quería quitar accesos, guarde primero solo las bajas.');
  }
  return aprobadores;
}

async function crearSolicitud({ recurso, altas, actor, aprobadores }) {
  const fecha = new Date().toISOString();
  // Id ordenable por tiempo (como la bitácora): «las pendientes más recientes»
  // es igualdad por estado + orden por __name__, sin índice compuesto.
  const id = `${fecha.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const solicitud = await col(COLECCION).insert({
    id,
    recursoId: recurso.id,
    recursoNombre: recurso.nombre,
    grupo: recurso.grupo,
    solicitante: actor,
    altas,
    beneficiarios: [...new Set(altas.map((a) => a.correo))],
    // Foto de quiénes podían aprobar al crearla: solo informativa. La decisión
    // se revalida contra los titulares vigentes al aprobar.
    aprobadores,
    estado: 'pendiente',
    creadaEn: fecha
  });
  const titulo = `Aprobar acceso a «${recurso.nombre}»: ${altas.map((a) => describirAlta(a, recurso)).join('; ')}`;
  for (const correo of aprobadores) {
    await crearPendiente({
      correo, modulo: moduloDePendiente(recurso), tipo: TIPO_PENDIENTE, titulo,
      refTipo: REF_TIPO, refId: solicitud.id, ruta: `${RUTA}?id=${encodeURIComponent(solicitud.id)}`
    });
  }
  await auditar(actor, 'accesos.solicitud.crear', `${COLECCION}/${solicitud.id}`, {
    recurso: recurso.nombre, recursoId: recurso.id, altas, aprobadores
  });
  await bitacora(BITACORA, COL_BITACORA, {
    evento: 'solicitud_creada', actor, correo: actor, recursoId: recurso.id,
    solicitudId: solicitud.id, beneficiarios: solicitud.beneficiarios, detalle: { altas }
  });
  return solicitud;
}

// ---------- Rutas de aprobación ----------

const router = express.Router();

// ¿Puede esta persona decidir esta solicitud? Se revalida en cada petición
// contra los titulares VIGENTES del aprobador, sin caché.
async function esAprobadorDe(correo, recursoId) {
  return (await engine.aprobadoresDe(recursoId)).includes(correo);
}

// ¿Aprueba en algún módulo? Habilita el listado. Hoy solo Talento Humano
// declara aprobador; se pregunta por un recurso del grupo.
async function esAprobador(correo) {
  return (await engine.aprobadoresDe('tthh.director')).includes(correo);
}

// Bandeja del aprobador: paginada por estado, de la más reciente a la más
// antigua. Transaccional: nunca list().
router.get('/', manejar(async (req, res) => {
  const correo = req.usuario.correo;
  if (!(await esAprobador(correo)) && !(await engine.esAdminAccesos(correo))) {
    throw httpError(403, 'Solo el director de Talento Humano (o quien administra el panel de accesos) ' +
      'consulta las solicitudes de acceso.');
  }
  const estado = ['pendiente', 'aprobada', 'rechazada'].includes(req.query.estado) ? req.query.estado : 'pendiente';
  const pagina = await col(COLECCION).page({
    filtros: { estado }, orden: '__name__', desc: true,
    limite: Number(req.query.limite) || 25, cursor: req.query.cursor || null
  });
  const filas = pagina.filas.map((s) => ({
    ...s,
    puedoDecidir: s.estado === 'pendiente' && s.solicitante !== correo && !(s.beneficiarios || []).includes(correo)
  }));
  res.json({ ...pagina, filas, soyAprobador: await esAprobador(correo) });
}));

router.get('/:id', manejar(async (req, res) => {
  const correo = req.usuario.correo;
  const s = await col(COLECCION).get(req.params.id);
  if (!s) throw httpError(404, 'La solicitud no existe');
  const aprobador = await esAprobadorDe(correo, s.recursoId);
  if (!aprobador && s.solicitante !== correo && !(await engine.esAdminAccesos(correo))) {
    throw httpError(403, 'No puede consultar esta solicitud');
  }
  res.json({
    ...s,
    puedoDecidir: aprobador && s.estado === 'pendiente' && s.solicitante !== correo &&
      !(s.beneficiarios || []).includes(correo)
  });
}));

// Carga la solicitud y verifica que quien decide pueda hacerlo.
async function cargarParaDecidir(req) {
  const correo = req.usuario.correo;
  const s = await col(COLECCION).get(req.params.id);
  if (!s) throw httpError(404, 'La solicitud no existe');
  if (!(await esAprobadorDe(correo, s.recursoId))) {
    throw httpError(403, 'Solo el director de Talento Humano aprueba o rechaza las solicitudes de acceso a esta información.');
  }
  if (s.estado !== 'pendiente') throw httpError(409, `La solicitud ya fue ${s.estado}.`);
  if (s.solicitante === correo) {
    throw httpError(403, 'No puede decidir una solicitud que usted mismo hizo: debe aprobarla otro director.');
  }
  if ((s.beneficiarios || []).includes(correo)) {
    throw httpError(403, 'No puede decidir una solicitud que le otorga acceso a usted: debe aprobarla otro director.');
  }
  const recurso = getRecurso(s.recursoId);
  if (!recurso) throw httpError(409, `El recurso ${s.recursoId} ya no existe en el catálogo.`);
  return { s, recurso, correo };
}

router.post('/:id/aprobar', manejar(async (req, res) => {
  const { s, recurso, correo } = await cargarParaDecidir(req);
  // Se marca ANTES de aplicar y se relee: si dos directores aprueban a la vez,
  // el segundo encuentra la solicitud ya decidida (la ventana que queda es de
  // milisegundos y aplicar dos veces las mismas altas es idempotente).
  const fresca = await col(COLECCION).get(s.id);
  if (fresca.estado !== 'pendiente') throw httpError(409, `La solicitud ya fue ${fresca.estado}.`);
  const resueltaEn = new Date().toISOString();
  await col(COLECCION).update(s.id, { estado: 'aprobada', resueltaPor: correo, resueltaEn });

  const vigente = await engine.titulares(recurso.id, { usarCache: false });
  const nuevo = aplicarAltas(recurso, vigente, s.altas || []);
  let despues;
  try {
    despues = await engine.guardar(recurso.id, nuevo, `${correo} (aprueba solicitud ${s.id})`);
  } catch (e) {
    // Si el acceso no se pudo escribir, la solicitud vuelve a pendiente: una
    // «aprobada» que no se aplicó es peor que un error visible.
    await col(COLECCION).update(s.id, { estado: 'pendiente', resueltaPor: null, resueltaEn: null });
    throw e;
  }
  invalidarUsuarios();
  await cerrarPendientes({ refTipo: REF_TIPO, refId: s.id });

  await auditar(correo, 'accesos.solicitud.aprobar', `${COLECCION}/${s.id}`, {
    recurso: recurso.nombre, recursoId: recurso.id, solicitante: s.solicitante, altas: s.altas,
    antes: { emails: vigente.emails, scopes: vigente.scopes },
    despues: { emails: despues.emails, scopes: despues.scopes }
  });
  await bitacora(BITACORA, COL_BITACORA, {
    evento: 'solicitud_aprobada', actor: correo, correo, recursoId: recurso.id, solicitudId: s.id,
    solicitante: s.solicitante, beneficiarios: s.beneficiarios, detalle: { altas: s.altas }
  });
  res.json({ ok: true, solicitud: { ...s, estado: 'aprobada', resueltaPor: correo, resueltaEn }, titulares: despues });
}));

router.post('/:id/rechazar', manejar(async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw httpError(400, 'El motivo del rechazo es obligatorio.');
  const { s, recurso, correo } = await cargarParaDecidir(req);
  const resueltaEn = new Date().toISOString();
  await col(COLECCION).update(s.id, { estado: 'rechazada', resueltaPor: correo, resueltaEn, motivoRechazo: motivo });
  await cerrarPendientes({ refTipo: REF_TIPO, refId: s.id });
  await auditar(correo, 'accesos.solicitud.rechazar', `${COLECCION}/${s.id}`, {
    recurso: recurso.nombre, recursoId: recurso.id, solicitante: s.solicitante, altas: s.altas, motivo
  });
  await bitacora(BITACORA, COL_BITACORA, {
    evento: 'solicitud_rechazada', actor: correo, correo, recursoId: recurso.id, solicitudId: s.id,
    solicitante: s.solicitante, beneficiarios: s.beneficiarios, detalle: { altas: s.altas, motivo }
  });
  res.json({ ok: true, solicitud: { ...s, estado: 'rechazada', resueltaPor: correo, resueltaEn, motivoRechazo: motivo } });
}));

module.exports = {
  router, comparar, aplicarAltas, verificarAltas, crearSolicitud, describirAlta,
  BITACORA, COL_BITACORA
};
