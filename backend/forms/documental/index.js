// Rutas del módulo documental: /api/documental/*
const express = require('express');
const path = require('path');
const multer = require('multer');
const { col } = require('../../lib/db');
const storage = require('../../lib/storage');
const { exige } = require('../../lib/permisos');
const { auditar } = require('../../lib/audit');
const { param } = require('../../core/config/parametros');
const { contextoDe } = require('../../core/config/destinatarios');
const formularios = require('../../core/formularios/definicion');
const { validar } = require('./schemas');
const { previsualizarCodigo, recomponerCodigo } = require('./codificacion');
const svc = require('./services/DocumentosService');
const externos = require('./externos');
const solicitudes = require('./solicitudes');

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'tmp_uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const router = express.Router();

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[documental]', e);
      res.status(status).json({ error: e.message || 'Error interno' });
    }
  };
}

// Contexto de identidad de quien pregunta —correo, cargo, área, sede y grupos—,
// que es lo que permite evaluar la audiencia de cada documento en memoria. Se
// resuelve UNA vez por petición: hacerlo por documento costaría una lectura del
// catálogo de grupos por fila del listado maestro.
async function conContexto(req, res, next) {
  try {
    req.identidad = await contextoDe(req.usuario);
    next();
  } catch (e) {
    console.error('[documental]', e);
    res.status(500).json({ error: 'Error resolviendo su identidad para el control de acceso' });
  }
}

router.use(conContexto);

// ¿Este usuario puede llegar a este documento? Dos negativas distintas que se
// responden igual —404— porque en ambos casos el documento no debe existir para
// él: ni se revela que hay un documento local de otro país, ni que hay un
// borrador en curso en un proceso ajeno.
function alcanzable(doc, req) {
  if (!svc.puedeVer(doc, req.usuario, req.identidad)) return false;
  return svc.veCicloCompleto(doc, req.usuario) || svc.tieneVigencia(doc);
}

async function cargarDocumento(req, res, next) {
  try {
    const doc = await col('documentos').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Documento no existe' });
    if (!alcanzable(doc, req)) {
      return res.status(404).json({ error: 'Documento no existe o está fuera de su ámbito de consulta' });
    }
    req.doc = doc;
    next();
  } catch (e) {
    console.error('[documental]', e);
    res.status(500).json({ error: 'Error consultando documento' });
  }
}

function soloGestores(req, res, next) {
  if (!svc.puedeAdministrar(req.doc, req.usuario)) {
    return res.status(403).json({ error: 'Requiere ser administrador o líder del proceso' });
  }
  next();
}

// Cambiar un código afecta la identidad del documento y la de las referencias
// que lo citan: se reserva al administrador del SGC, no al líder del proceso.
const soloAdministrador = exige('sgc.administrador');

// El trabajo sobre la versión en curso (cargar archivos, enviar el flujo,
// responder comentarios, recordar, reanudar) le corresponde también al EQUIPO
// elaborador —autor y co-elaboradores—, que no siempre son gestores formales
// del proceso pero sí los responsables de que su documento avance.
function gestorOElaborador(req, res, next) {
  const ver = svc.versionActual(req.doc);
  const esDelEquipo = !!ver && svc.elaboradoresDe(ver).includes(req.usuario.correo);
  if (!svc.puedeAdministrar(req.doc, req.usuario) && !esDelEquipo) {
    return res.status(403).json({ error: 'Requiere ser gestor del documento o parte de su equipo elaborador' });
  }
  next();
}

// Campos personalizados definidos por el administrador, validados contra su
// definición vigente. Se guardan bajo `documento.datos`.
async function datosPersonalizados(body) {
  return formularios.validarValores(body.datos || {}, 'documento');
}

// Clasificación de confidencialidad y su lista de acceso, como una unidad:
//   · la lista se guarda en minúsculas, porque se compara contra el correo ya
//     normalizado del usuario (una mayúscula del directorio negaría el acceso);
//   · si el documento no es confidencial la lista se vacía: dejarla guardada
//     sería una restricción invisible que reaparece al volver a clasificarlo.
// `actual` es el documento guardado (al editar), para completar lo que no viaja.
function normalizarConfidencialidad(patch, actual = {}) {
  if (patch.confidencialidad === undefined && patch.accesoConfidencial === undefined) return patch;
  const nivel = patch.confidencialidad ?? actual.confidencialidad ?? 'interno';
  const lista = patch.accesoConfidencial ?? actual.accesoConfidencial ?? [];
  patch.accesoConfidencial = nivel === 'confidencial'
    ? [...new Set(lista.map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
    : [];
  return patch;
}

// Filtra, proyecta y ordena el listado maestro respetando el ámbito del usuario.
//
// ┌─ DEUDA CONOCIDA DE COSTO ───────────────────────────────────────────────────┐
// │ Esta función no está paginada, y es el mayor consumo de lecturas de la      │
// │ plataforma. No se puede paginar tal como está, y el motivo es de diseño:    │
// │                                                                            │
// │   · `estado` NO es un campo: se deriva de `versiones[]` en cada lectura     │
// │     (svc.estadoDocumento). Firestore no puede filtrar ni ordenar por algo   │
// │     que no está almacenado.                                                 │
// │   · `puedeVer` depende del usuario que pregunta (sede, confidencialidad,    │
// │     audiencia por cargo o grupo, participación en el flujo), así que el     │
// │     recorte de visibilidad no es expresable como consulta.                  │
// │   · la búsqueda por texto barre nombre, código, códigos retirados y         │
// │     palabras clave.                                                        │
// │                                                                            │
// │ Habilitarlo requiere denormalizar `estado` y una clave de visibilidad en    │
// │ cada escritura, más reíndice. Es un cambio de contrato de la API (pasa a    │
// │ devolver {filas, cursor, total}) y toca 4 pantallas del frontend, así que   │
// │ va como paso propio y no colado aquí.                                       │
// │                                                                            │
// │ Plan y costo: docs/POLITICA-COSTOS.md §Migración pendiente.                │
// └────────────────────────────────────────────────────────────────────────────┘
async function listar(req, { soloObsoletos = false } = {}) {
  const { q, procesoId, subprocesoId, tipoId, estado, confidencialidad, alcance, sedeId, norma } = req.query;
  const diasAlerta = await param('diasAlertaRevision');

  // Los filtros de igualdad simples los resuelve Firestore; el resto (búsqueda
  // de texto, estado derivado, ámbito por sede) se evalúa en memoria.
  const crudos = await col('documentos').query({ procesoId, tipoId, confidencialidad, alcance });
  let filas = crudos
    .filter((d) => svc.puedeVer(d, req.usuario, req.identidad))
    // El ciclo se calcula una vez por documento y decide dos cosas: si la fila
    // aparece y con qué versión se pinta. Ver DocumentosService.veCicloCompleto:
    // quien no administra ni participa en el flujo solo ve documentación vigente,
    // así que un borrador o un obsoleto no existen para él (tampoco en
    // /obsoletos, que usa esta misma función).
    .map((d) => ({ doc: d, cicloCompleto: svc.veCicloCompleto(d, req.usuario) }))
    .filter(({ doc, cicloCompleto }) => cicloCompleto || svc.tieneVigencia(doc))
    .map(({ doc, cicloCompleto }) => svc.proyectar(doc, diasAlerta, { soloVigente: !cicloCompleto }))
    .filter((d) => (soloObsoletos ? d.estado === 'obsoleto' : d.estado !== 'obsoleto'));

  if (q) {
    const term = String(q).toLowerCase();
    filas = filas.filter((d) =>
      d.nombre.toLowerCase().includes(term) ||
      d.codigo.toLowerCase().includes(term) ||
      // Un código retirado sigue encontrando su documento: es lo que mantiene
      // la trazabilidad cuando alguien busca por la referencia vieja.
      (d.codigosAnteriores || []).some((c) => c.toLowerCase().includes(term)) ||
      (d.palabrasClave || []).some((p) => p.toLowerCase().includes(term)));
  }
  if (subprocesoId) filas = filas.filter((d) => d.subprocesoId === subprocesoId);
  if (estado) filas = filas.filter((d) => d.estado === estado);
  if (sedeId) filas = filas.filter((d) => (d.sedes || []).includes(sedeId));
  if (norma) filas = filas.filter((d) => (d.normas || []).includes(norma));

  filas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  return filas;
}

// ---------- Listado maestro ----------
router.get('/documentos', manejar(async (req, res) => {
  res.json(await listar(req));
}));

// Repositorio estricto de obsoletos: separado del listado maestro para que un
// documento sin vigencia nunca aparezca junto a los vigentes. Solo lo alimentan
// los documentos de quien administra o participó en su flujo: para el resto de
// la compañía la documentación no aplicable no existe.
router.get('/obsoletos', manejar(async (req, res) => {
  res.json(await listar(req, { soloObsoletos: true }));
}));

// Exportación del listado (o de los obsoletos) a CSV.
//
// Lectura completa DELIBERADA y admitida por la política: el usuario pidió
// explícitamente todo el conjunto, así que pagar por todo el conjunto es
// correcto. Lo que no sería correcto es que una pantalla de consulta costara lo
// mismo que una exportación. Si el volumen crece hasta que la exportación no
// quepa en memoria, se reescribe con col().recorrer() emitiendo por streaming.
router.get('/documentos.csv', manejar(async (req, res) => {
  const filas = await listar(req, { soloObsoletos: req.query.obsoletos === '1' });
  const [procesos, tipos, sedes] = await Promise.all([
    col('procesos').list(), col('tipos_documento').list(), col('sedes').list()
  ]);
  const nombre = (lista, id) => (lista.find((x) => x.id === id) || {}).nombre || id || '';

  const COLUMNAS = [
    ['Código', (d) => d.codigo],
    ['Nombre', (d) => d.nombre],
    ['Proceso', (d) => nombre(procesos, d.procesoId)],
    ['Tipo', (d) => nombre(tipos, d.tipoId)],
    ['Versión', (d) => d.version],
    ['Estado', (d) => d.estado],
    ['Alcance', (d) => d.alcance],
    ['Sedes', (d) => (d.sedes || []).map((s) => nombre(sedes, s)).join(' | ')],
    ['Confidencialidad', (d) => d.confidencialidad],
    ['Palabras clave', (d) => (d.palabrasClave || []).join(' | ')],
    ['Vigente desde', (d) => (d.fechaVigencia || '').slice(0, 10)],
    ['Próxima revisión', (d) => (d.proximaRevision || '').slice(0, 10)],
    ['Días para revisión', (d) => (d.diasParaRevision === null ? '' : d.diasParaRevision)]
  ];

  const escapar = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const lineas = [
    COLUMNAS.map(([t]) => escapar(t)).join(';'),
    ...filas.map((d) => COLUMNAS.map(([, fn]) => escapar(fn(d))).join(';'))
  ];

  const archivo = `listado-maestro-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  // BOM para que Excel en Windows reconozca UTF-8 y respete las tildes.
  res.send('﻿' + lineas.join('\r\n'));
}));

// Mapa de procesos: la cadena de valor con el conteo de documentos que el
// usuario puede consultar en cada proceso y subproceso. Cuando entren los demás
// módulos, cada uno aportará sus propios contadores a esta misma estructura.
//
// DEUDA DE COSTO: los contadores deberían venir de col().contar() (agregación en
// el servidor: 1 lectura por cada 1.000 entradas de índice). Hoy no pueden,
// porque el conteo excluye obsoletos —estado derivado— y respeta la visibilidad
// del usuario, y ninguna de las dos cosas es expresable como filtro de Firestore.
// Se resuelve con la misma denormalización que el listado maestro; comparten
// causa y se arreglan de una vez. Ver docs/POLITICA-COSTOS.md §Migración pendiente.
router.get('/mapa-procesos', manejar(async (req, res) => {
  const [procesos, tipos, docsCrudos] = await Promise.all([
    col('procesos').list((p) => p.activo !== false),
    col('tipos_documento').list((t) => t.activo !== false),
    col('documentos').list(null, {
      motivo: 'DEUDA: contadores del mapa que dependen de estado derivado y visibilidad por usuario'
    })
  ]);

  const visibles = docsCrudos
    .filter((d) => svc.puedeVer(d, req.usuario, req.identidad))
    .filter((d) => svc.estadoDocumento(d) !== 'obsoleto')
    // El contador tiene que cuadrar con lo que el usuario encuentra al entrar al
    // proceso: si solo ve documentación vigente, un borrador no puede sumar.
    .filter((d) => svc.veCicloCompleto(d, req.usuario) || svc.tieneVigencia(d));

  const contar = (predicado) => {
    const propios = visibles.filter(predicado);
    const porTipo = tipos
      .map((t) => ({ tipoId: t.id, codigo: t.codigo, nombre: t.nombre, total: propios.filter((d) => d.tipoId === t.id).length }))
      .filter((x) => x.total > 0);
    return { total: propios.length, porTipo };
  };

  res.json(procesos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    tipo: p.tipo || 'apoyo',
    orden: p.orden ?? 99,
    documentos: contar((d) => d.procesoId === p.id),
    subprocesos: (p.subprocesos || []).map((s) => ({
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      documentos: contar((d) => d.procesoId === p.id && d.subprocesoId === s.id)
    }))
  })));
}));

// ---------- Codificación ----------
router.post('/previsualizar-codigo', validar('previsualizarCodigo'), manejar(async (req, res) => {
  res.json(await previsualizarCodigo(req.body) || { codigo: null });
}));

// Recodificación masiva por proceso: el caso real es "corregí la sigla del
// proceso y hay que actualizar los códigos ya emitidos". Recalcula cada
// documento del proceso conservando su consecutivo y archivando el código
// anterior. Es simulable con ?simulacro=1 para ver qué cambiaría antes de
// tocar nada: recodificar en masa no es una operación para hacer a ciegas.
router.post('/recodificar-proceso', soloAdministrador, manejar(async (req, res) => {
  const { procesoId, motivo } = req.body || {};
  const simulacro = req.query.simulacro === '1';
  if (!procesoId) return res.status(400).json({ error: 'Indique el proceso a recodificar' });
  if (!simulacro && !String(motivo || '').trim()) {
    return res.status(400).json({ error: 'Debe registrar el motivo del cambio de códigos' });
  }

  const documentos = await col('documentos').query({ procesoId });
  const cambios = [];
  const sinCambio = [];
  const errores = [];

  for (const doc of documentos) {
    try {
      const nuevo = await recomponerCodigo(doc);
      if (nuevo.codigo === doc.codigo) { sinCambio.push(doc.codigo); continue; }
      if (!simulacro) await svc.recodificar(doc, { motivo }, req.usuario);
      cambios.push({ id: doc.id, nombre: doc.nombre, anterior: doc.codigo, nuevo: nuevo.codigo });
    } catch (e) {
      errores.push({ id: doc.id, codigo: doc.codigo, error: e.message });
    }
  }

  res.json({ simulacro, procesoId, cambios, sinCambio, errores });
}));

// ---------- CRUD y ciclo de vida ----------
router.post('/documentos', validar('documentoNuevo'), manejar(async (req, res) => {
  if (!svc.puedeAdministrar({ procesoId: req.body.procesoId }, req.usuario)) {
    return res.status(403).json({ error: 'Requiere ser administrador o líder del proceso' });
  }
  const datos = await datosPersonalizados(req.body);
  const doc = await svc.crearDocumento({ ...normalizarConfidencialidad(req.body), datos }, req.usuario);
  res.status(201).json(doc);
}));

// Resuelve un código —vigente o retirado— al documento que lo lleva. Es lo que
// hace útil el histórico: alguien encuentra "GETI-PRO-7-COL" citado en un
// documento viejo o en un registro de auditoría y llega al documento actual.
// Debe declararse antes de `/documentos/:id` para que Express no interprete
// "por-codigo" como un identificador.
router.get('/documentos/por-codigo/:codigo', manejar(async (req, res) => {
  const buscado = String(req.params.codigo).trim().toUpperCase();

  // Consulta indexada sobre `codigosPlanos`, que contiene el código vigente y
  // los retirados: resuelve ambos casos en una sola lectura. Antes se traía la
  // colección entera para buscar en memoria.
  const hallado = await svc.documentoConCodigo(buscado);

  if (!hallado || !alcanzable(hallado.doc, req)) {
    return res.status(404).json({ error: `Ningún documento usa o usó el código ${buscado}` });
  }
  const { doc, esHistorico } = hallado;

  res.json({
    id: doc.id,
    codigo: doc.codigo,
    nombre: doc.nombre,
    estado: svc.veCicloCompleto(doc, req.usuario) ? svc.estadoDocumento(doc) : 'vigente',
    // Avisa que el código consultado ya fue reemplazado, y por qué.
    codigoConsultadoEsHistorico: esHistorico,
    cambio: esHistorico
      ? (doc.codigosAnteriores || []).find((c) => String(c.codigo).toUpperCase() === buscado)
      : null,
    ruta: `/documental/documentos/${doc.id}`
  });
}));

router.get('/documentos/:id', cargarDocumento, manejar(async (req, res) => {
  const tipo = await col('tipos_documento').get(req.doc.tipoId);
  const cicloCompleto = svc.veCicloCompleto(req.doc, req.usuario);
  const descargarPdf = svc.puedeDescargarPdf(req.doc, req.usuario);
  res.json({
    ...svc.detalle(req.doc, req.usuario),
    estado: cicloCompleto ? svc.estadoDocumento(req.doc) : 'vigente',
    diasParaRevision: svc.diasParaRevision(req.doc),
    alertaRevision: svc.alertaRevision(req.doc, await param('diasAlertaRevision')),
    permisos: {
      administrar: svc.puedeAdministrar(req.doc, req.usuario),
      // Puede trabajar la versión en curso: gestor, o parte del equipo
      // elaborador (autor o co-elaborador). Gobierna los paneles de borrador,
      // ajustes y seguimiento en la interfaz.
      elaborar: svc.puedeAdministrar(req.doc, req.usuario) ||
        (() => { const v = svc.versionActual(req.doc); return !!v && svc.elaboradoresDe(v).includes(req.usuario.correo); })(),
      descargarOriginal: svc.puedeDescargarOriginal(req.doc, req.usuario, tipo),
      descargarPdf,
      // Si la descarga la habilita un permiso excepcional (y no el rol), la ficha
      // lo cuenta con su vigencia; `null` cuando descarga por rol o no descarga.
      descargaPorPermiso: svc.permisoDescargaDe(req.doc, req.usuario),
      // Quien administra el módulo da permisos de descarga sin vencimiento; el
      // líder del proceso debe ponerles fecha (la interfaz lo exige de entrada).
      otorgaDescargaIndefinida: svc.administraDocumentacion(req.usuario),
      // La ficha se marca como no imprimible cuando quien la abre no puede
      // llevarse el documento: si no puede descargar el PDF, imprimir la pantalla
      // sería la vía de escape evidente.
      imprimir: descargarPdf,
      // Le dice a la interfaz si está viendo el documento completo o solo su
      // versión vigente, para que no ofrezca acciones que el backend negaría.
      verCicloCompleto: cicloCompleto
    }
  });
}));

// Cambia el código de un documento archivando el anterior. Sin `codigo` en el
// cuerpo, se recalcula con las siglas actuales del catálogo.
router.post('/documentos/:id/recodificar', cargarDocumento, soloAdministrador, manejar(async (req, res) => {
  res.json(await svc.recodificar(req.doc, req.body || {}, req.usuario));
}));

router.put('/documentos/:id', cargarDocumento, soloGestores, validar('documentoEditar'), manejar(async (req, res) => {
  // El código, el consecutivo y las versiones nunca se editan por esta vía.
  const patch = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined));
  if (req.body.datos !== undefined) patch.datos = await datosPersonalizados(req.body);
  // Las audiencias se guardan normalizadas a { tipo, valor }, igual que al crear.
  for (const campo of ['audienciaVisualizacion', 'audienciaDescarga']) {
    if (patch[campo] !== undefined) patch[campo] = svc.normalizarAudiencia(patch[campo]);
  }
  // La confidencialidad la cambia quien administra el documento (administrador
  // del SGC, del módulo o líder del proceso): mismo guarda `soloGestores` que el
  // resto de los permisos de acceso.
  normalizarConfidencialidad(patch, req.doc);
  patch.updatedBy = req.usuario.correo;
  const doc = await col('documentos').update(req.doc.id, patch);
  // Los cambios de metadatos incluyen audiencias y permisos de descarga:
  // material de control de acceso que un auditor de 27001 espera trazado.
  await auditar(req.usuario.correo, 'documental.editar', `documentos/${req.doc.id}`, {
    campos: Object.keys(req.body)
  });
  res.json(doc);
}));

router.post('/documentos/:id/versiones', cargarDocumento, soloGestores, validar('nuevaVersion'), manejar(async (req, res) => {
  res.json(await svc.nuevaVersion(req.doc, req.body.controlCambios, req.usuario));
}));

router.post('/documentos/:id/enviar-flujo', cargarDocumento, gestorOElaborador, validar('enviarFlujo'), manejar(async (req, res) => {
  res.json(await svc.enviarFlujo(req.doc, req.body, req.usuario));
}));

// Equipo elaborador de la versión en curso (agregar/retirar co-elaboradores).
// Decidir quién elabora es administración del documento: solo gestores.
router.post('/documentos/:id/elaboradores', cargarDocumento, soloGestores, validar('elaboradoresFlujo'),
  manejar(async (req, res) => {
    res.json(await svc.modificarElaboradores(req.doc, req.body, req.usuario));
  }));

router.post('/documentos/:id/decision', cargarDocumento, validar('decisionFlujo'), manejar(async (req, res) => {
  res.json(await svc.registrarDecision(req.doc, req.body, req.usuario));
}));

// Reanuda un flujo devuelto para ajustes: quien devolvió vuelve a pendiente.
router.post('/documentos/:id/reanudar-flujo', cargarDocumento, gestorOElaborador, validar('reanudarFlujo'),
  manejar(async (req, res) => {
    res.json(await svc.reanudarFlujo(req.doc, req.body, req.usuario));
  }));

// Agregar o retirar participantes con el flujo en curso.
router.post('/documentos/:id/flujo/participantes', cargarDocumento, soloGestores, validar('participantesFlujo'),
  manejar(async (req, res) => {
    res.json(await svc.modificarParticipantes(req.doc, req.body, req.usuario));
  }));

// Respuesta del responsable al comentario de un revisor/aprobador.
router.post('/documentos/:id/flujo/comentarios', cargarDocumento, gestorOElaborador, validar('respuestaComentario'),
  manejar(async (req, res) => {
    res.json(await svc.responderComentario(req.doc, req.body, req.usuario));
  }));

// Recordatorio manual a quien tiene la decisión pendiente (máx. 1/día).
router.post('/documentos/:id/flujo/recordar', cargarDocumento, gestorOElaborador, validar('recordatorioFlujo'),
  manejar(async (req, res) => {
    res.json(await svc.recordarPendientes(req.doc, req.body, req.usuario));
  }));

// Corrida manual del cron de recordatorios (la programada entra por
// /api/documental-cron con el secreto de Cloud Scheduler).
router.post('/recordatorios/procesar', soloAdministrador, manejar(async (req, res) => {
  res.json(await require('./recordatorios').procesar());
}));

router.post('/documentos/:id/obsoletizar', cargarDocumento, soloGestores, validar('obsoletizar'), manejar(async (req, res) => {
  res.json(await svc.obsoletizar(req.doc, req.usuario, req.body.motivo));
}));

// ---------- Archivos (original + PDF por versión) ----------
router.post('/documentos/:id/archivos', cargarDocumento, gestorOElaborador,
  upload.fields([{ name: 'original', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  manejar(async (req, res) => {
    const ver = svc.versionActual(req.doc);
    // `en_ajustes` también recibe archivos: es justamente el estado en el que el
    // elaborador corrige lo observado antes de reanudar el flujo.
    if (!ver || !['borrador', 'en_ajustes'].includes(ver.estado)) {
      throw svc.httpError(409, 'Solo se cargan archivos mientras la versión está en borrador o en ajustes');
    }
    const permitidas = await param('extensionesOriginal');
    const subidos = [];

    for (const campo of ['original', 'pdf']) {
      const archivo = req.files && req.files[campo] && req.files[campo][0];
      if (!archivo) continue;
      const nombre = storage.nombreCliente(archivo.originalname);
      const ext = path.extname(nombre).toLowerCase();

      if (campo === 'pdf' && ext !== '.pdf') {
        throw svc.httpError(400, 'El archivo de publicación debe ser un PDF');
      }
      if (campo === 'original' && !permitidas.includes(ext)) {
        throw svc.httpError(400, `El archivo original debe ser editable (${permitidas.join(', ')})`);
      }

      const key = storage.buildKey('documental', req.doc.id, ver.numero, nombre);
      await storage.saveFile(archivo.path, key, { contentType: archivo.mimetype });
      ver.archivos[campo] = { key, nombre, tamano: archivo.size };
      subidos.push({ campo, nombre });
    }

    const doc = await col('documentos').update(req.doc.id, {
      versiones: req.doc.versiones, updatedBy: req.usuario.correo
    });
    await auditar(req.usuario.correo, 'documental.archivos', `documentos/${req.doc.id}`, {
      version: ver.numero, estado: ver.estado, archivos: subidos
    });
    res.json(doc);
  }));

// CORRECCIÓN EDITORIAL sobre la versión vigente: reemplaza archivos sin nueva
// versión ni re-aprobación. El motivo es obligatorio y los archivos anteriores
// quedan referenciados en la corrección (nunca se sobreescriben en Storage).
router.post('/documentos/:id/correccion', cargarDocumento, soloGestores,
  upload.fields([{ name: 'original', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  manejar(async (req, res) => {
    const ver = svc.versionVigente(req.doc);
    if (!ver) throw svc.httpError(409, 'Solo se corrige la versión vigente, y este documento no tiene ninguna');
    const permitidas = await param('extensionesOriginal');
    // El prefijo con el número de corrección evita que la clave choque con la
    // del archivo aprobado si ambos se suben el mismo día con el mismo nombre.
    const n = (ver.correcciones || []).length + 1;
    const archivos = {};

    for (const campo of ['original', 'pdf']) {
      const archivo = req.files && req.files[campo] && req.files[campo][0];
      if (!archivo) continue;
      const nombre = storage.nombreCliente(archivo.originalname);
      const ext = path.extname(nombre).toLowerCase();
      if (campo === 'pdf' && ext !== '.pdf') {
        throw svc.httpError(400, 'El archivo de publicación debe ser un PDF');
      }
      if (campo === 'original' && !permitidas.includes(ext)) {
        throw svc.httpError(400, `El archivo original debe ser editable (${permitidas.join(', ')})`);
      }
      const key = storage.buildKey('documental', req.doc.id, ver.numero, `corr${n}-${nombre}`);
      await storage.saveFile(archivo.path, key, { contentType: archivo.mimetype });
      archivos[campo] = { key, nombre, tamano: archivo.size };
    }

    res.json(await svc.registrarCorreccion(req.doc, { motivo: req.body.motivo, archivos }, req.usuario));
  }));

router.get('/documentos/:id/archivo/:numero/:tipo', cargarDocumento, manejar(async (req, res) => {
  const { numero, tipo } = req.params;
  if (!['pdf', 'original'].includes(tipo)) throw svc.httpError(400, 'Tipo de archivo inválido');

  const ver = (req.doc.versiones || []).find((v) => v.numero === Number(numero));
  if (!ver || !ver.archivos) throw svc.httpError(404, 'Archivo no existe');

  // ?correccion=N entrega el archivo que la corrección editorial N reemplazó:
  // es la evidencia que un auditor puede pedir ("el PDF antes de la corrección").
  // Solo para quien administra el documento.
  if (req.query.correccion) {
    if (!svc.puedeAdministrar(req.doc, req.usuario)) throw svc.httpError(404, 'Archivo no existe');
    const corr = (ver.correcciones || [])[Number(req.query.correccion) - 1];
    const anterior = corr && corr.anteriores && corr.anteriores[tipo];
    if (!anterior) throw svc.httpError(404, 'Archivo no existe');
    if (!await storage.exists(anterior.key)) throw svc.httpError(404, 'Archivo no encontrado en almacenamiento');
    return storage.servir(res, anterior.key, { req, nombre: anterior.nombre, inline: req.query.descargar !== '1' });
  }

  if (!ver.archivos[tipo]) throw svc.httpError(404, 'Archivo no existe');

  // Quien solo ve documentación vigente no alcanza los archivos de un borrador
  // en curso ni de una versión ya reemplazada. Se responde 404 y no 403: para él
  // esas versiones no existen, y decirle que existen ya sería información.
  if (!svc.puedeVerVersion(req.doc, req.usuario, numero)) {
    throw svc.httpError(404, 'Archivo no existe');
  }

  const descargar = req.query.descargar === '1';
  if (tipo === 'original') {
    // Control ISO 27001: el editable solo sale si el tipo lo permite (formatos)
    // o si quien pide administra/elaboró el documento.
    const tipoDoc = await col('tipos_documento').get(req.doc.tipoId);
    if (!svc.puedeDescargarOriginal(req.doc, req.usuario, tipoDoc)) {
      throw svc.httpError(403, 'La descarga del archivo original está restringida para este documento');
    }
  } else if (descargar && !svc.puedeDescargarPdf(req.doc, req.usuario)) {
    throw svc.httpError(403, 'La descarga de este documento está restringida: consúltelo en línea');
  }

  if (!await storage.exists(ver.archivos[tipo].key)) {
    throw svc.httpError(404, 'Archivo no encontrado en almacenamiento');
  }
  await storage.servir(res, ver.archivos[tipo].key, {
    req,
    nombre: ver.archivos[tipo].nombre,
    inline: !descargar
  });
  // Quién consultó o se llevó qué versión (ISO 27001 A.8.15, registro de
  // eventos): es la pregunta que se hace cuando un documento aparece fuera de
  // la compañía. Se audita DESPUÉS de servir para no gastar la escritura en una
  // petición rechazada; auditar() ya atrapa sus propios errores.
  const porPermiso = descargar && tipo === 'pdf' ? svc.permisoDescargaDe(req.doc, req.usuario) : null;
  auditar(req.usuario.correo, descargar ? 'documental.descargar' : 'documental.consultar',
    `documentos/${req.doc.id}`, {
      codigo: req.doc.codigo, version: Number(numero), tipo,
      // Si la descarga salió por un permiso excepcional y no por el rol, queda
      // dicho: es lo que un auditor de 27001 va a pedir.
      ...(porPermiso ? { permisoId: porPermiso.id, permisoOtorgadoPor: porPermiso.otorgadoPor, permisoMotivo: porPermiso.motivo } : {})
    });
}));

// ---------- Permisos excepcionales por persona ----------
// Quien administra el documento (líder del proceso, administrador del módulo o
// de la plataforma) otorga y revoca, siempre con motivo. Las reglas de vigencia
// (quién puede dar descarga indefinida, tope de días) viven en el servicio.
// Los permisos NO se editan por el PUT de metadatos: `documentoEditar` los rechaza.
router.post('/documentos/:id/permisos', cargarDocumento, soloGestores, validar('permisoDocumento'),
  manejar(async (req, res) => {
    res.status(201).json(await svc.otorgarPermiso(req.doc, req.body, req.usuario));
  }));

router.post('/documentos/:id/permisos/:pid/revocar', cargarDocumento, soloGestores, validar('motivoPermiso'),
  manejar(async (req, res) => {
    res.json(await svc.revocarPermiso(req.doc, req.params.pid, req.body.motivo, req.usuario));
  }));

// ---------- Submódulos ----------
// La gestión de documentos externos tiene su propio recurso de acceso; la
// consulta queda abierta a quien ya entró al módulo.
router.use('/externos', externos.router);
router.use('/solicitudes', solicitudes.router);

module.exports = { router };
