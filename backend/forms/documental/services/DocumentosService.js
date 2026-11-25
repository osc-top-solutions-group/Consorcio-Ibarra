// Lógica de negocio del ciclo de vida documental:
// borrador → en_revision → en_aprobacion → vigente → obsoleto.
// Las versiones viven embebidas en el documento; al aprobar una nueva versión
// la anterior pasa automáticamente a "obsoleta" y queda solo para trazabilidad.
const crypto = require('crypto');
const { col } = require('../../../lib/db');
const { esAdmin, esLiderDe, puede, veTodasLasSedes, sedesDe } = require('../../../lib/permisos');
const { notificar } = require('../../../lib/mailer');
const plantillasCorreo = require('../../../lib/plantillasCorreo');
const { auditar } = require('../../../lib/audit');
const { crearPendiente, cerrarPendientes } = require('../../../core/pendientes');
const { param } = require('../../../core/config/parametros');
const { resolver, normalizar, perteneceA } = require('../../../core/config/destinatarios');
const { generarCodigo, recomponerCodigo, httpError } = require('../codificacion');

// Estados donde hay decisiones pendientes de registrar. `en_ajustes` NO está:
// mientras el elaborador corrige, nadie puede decidir sobre la versión.
const ESTADOS_EN_PROCESO = ['en_revision', 'en_aprobacion'];
// Estados de una versión que aún no llega a vigente (para el estado derivado).
const ESTADOS_TRAMITE = ['borrador', 'en_revision', 'en_aprobacion', 'en_ajustes'];

// Participantes que cuentan para cerrar una etapa. `no_aplica` (anulados por un
// rechazo) y `retirado` (sacados del flujo por un gestor) no bloquean ni suman.
function participantesActivos(lista) {
  return (lista || []).filter((p) => !['no_aplica', 'retirado'].includes(p.estado));
}

// ---------- Índice de códigos (denormalizado) ----------
//
// `codigosPlanos` es el código vigente MÁS todos los retirados, en mayúsculas y
// como arreglo de strings planos. Existe solo para que Firestore pueda resolver
// "¿quién usa o usó este código?" con un `array-contains`, que cuesta 1 lectura.
//
// Sin este campo hay que traer la colección completa y buscar en memoria, porque
// el histórico vive en `codigosAnteriores` como objetos {codigo, motivo, fecha,
// por} y Firestore no indexa el subcampo de un objeto dentro de un arreglo. Eso
// convertía dos operaciones —buscar por código y verificar colisión al
// recodificar— en scans completos de `documentos`.
//
// Es redundante por diseño: la fuente de verdad sigue siendo `codigo` +
// `codigosAnteriores`. Se recalcula entero en cada escritura que toca códigos,
// nunca se parchea, para que no pueda quedar desincronizado.
function codigosPlanos(doc) {
  const todos = [doc.codigo, ...(doc.codigosAnteriores || []).map((c) => c.codigo)];
  return [...new Set(todos.filter(Boolean).map((c) => String(c).trim().toUpperCase()))];
}

// ¿Algún documento usa o usó este código? Una consulta indexada en lugar de leer
// la colección entera. `excluirId` sirve al recodificar, para no chocar consigo
// mismo. Devuelve { doc, esHistorico } o null.
async function documentoConCodigo(codigo, excluirId = null) {
  const buscado = String(codigo).trim().toUpperCase();
  const halladas = await col('documentos').contiene('codigosPlanos', buscado, { limite: 5 });
  const doc = halladas.find((d) => d.id !== excluirId) || null;
  if (!doc) return null;
  return { doc, esHistorico: String(doc.codigo).trim().toUpperCase() !== buscado };
}

// ---------- Visibilidad ----------

function versiones(doc) {
  return doc.versiones || [];
}

// El EQUIPO ELABORADOR de una versión: el autor (quien la creó, inamovible) más
// los co-elaboradores asignados. Un documento lo suelen construir varias
// personas, y todas necesitan los mismos derechos de trabajo sobre el borrador.
function elaboradoresDe(ver) {
  const f = (ver && ver.flujo) || {};
  return [
    f.elaboro && f.elaboro.correo,
    ...(f.elaboradores || []).map((e) => e.correo)
  ].filter(Boolean);
}

function participaEnFlujo(doc, correo) {
  return versiones(doc).some((v) => {
    const f = v.flujo || {};
    return elaboradoresDe(v).includes(correo) ||
      (f.revisores || []).some((r) => r.correo === correo) ||
      (f.aprobadores || []).some((a) => a.correo === correo);
  });
}

function esElaborador(doc, correo) {
  return versiones(doc).some((v) => elaboradoresDe(v).includes(correo));
}

// Quien administra el documento o participa en su flujo siempre lo ve: sin esto
// un aprobador corporativo no podría firmar un documento local de otro país.
function accesoPrivilegiado(doc, usuario) {
  return esAdmin(usuario) || esLiderDe(usuario, doc.procesoId) || participaEnFlujo(doc, usuario.correo);
}

// AISLAMIENTO POR SEDES (privacidad local).
//   global     → aplica y se ve en toda la compañía
//   regional   → aplica a las sedes listadas, pero se consulta desde cualquier
//                sede (es un documento corporativo multipaís)
//   especifico → local de UNA sede: solo lo ven los usuarios de esa sede
// Así, un usuario de Bolivia no alcanza los documentos locales de Colombia,
// pero sí los globales y los regionales.
function visiblePorSede(doc, usuario) {
  if (doc.alcance !== 'especifico') return true;
  if (veTodasLasSedes(usuario) || accesoPrivilegiado(doc, usuario)) return true;
  const propias = sedesDe(usuario);
  return propias.some((s) => (doc.sedes || []).includes(s));
}

// Confidencialidad ISO 27001. Público e interno son visibles para todo usuario
// autenticado; confidencial exige estar en la lista de acceso o administrar.
function visiblePorConfidencialidad(doc, usuario) {
  if (doc.confidencialidad !== 'confidencial') return true;
  return accesoPrivilegiado(doc, usuario) || (doc.accesoConfidencial || []).includes(usuario.correo);
}

// AUDIENCIA DEL DOCUMENTO (permisos por usuario, cargo, área, grupo o sede).
//
// El alcance resuelve la geografía y la confidencialidad el nivel de reserva,
// pero no todos los documentos se publican a todo el mundo dentro de su alcance:
// hay procedimientos que solo aplican a un equipo. `audienciaVisualizacion`
// declara quién los consulta y `audienciaDescarga` quién puede llevarse el PDF
// (el caso real: se ve a nivel regional, pero solo Comercial y HSE lo descargan
// para atender auditorías y licitaciones).
//
// Vacía significa "sin restricción adicional", no "nadie": un documento sin
// audiencia se comporta como antes de que existiera este campo.
//
// Se evalúa con `perteneceA` contra el contexto de identidad del usuario, que se
// resuelve UNA vez por petición: filtrar el listado maestro no puede costar una
// lectura por documento (docs/POLITICA-COSTOS.md).
function visiblePorAudiencia(doc, usuario, contexto) {
  const visual = doc.audienciaVisualizacion || [];
  if (!visual.length) return true;
  if (accesoPrivilegiado(doc, usuario)) return true;
  // Quien está en la audiencia de descarga necesariamente puede ver: configurar
  // "ve toda la regional, descarga Comercial" no debe dejar a Comercial fuera
  // porque alguien olvidó incluirlo también en la visualización.
  return perteneceA(visual, contexto) || perteneceA(doc.audienciaDescarga || [], contexto);
}

// Los tres filtros son independientes y se aplican juntos.
//
// `contexto` viene de destinatarios.contextoDe(usuario). Si falta, la audiencia
// no se puede evaluar y se niega: falla cerrado a propósito.
function puedeVer(doc, usuario, contexto) {
  // Un permiso excepcional de consulta pasa por encima de los tres filtros
  // (decisión D3): es una excepción nominal, con motivo, vigencia y quién la dio.
  if (permisoVigente(doc, usuario, 'consultar')) return true;
  return visiblePorSede(doc, usuario) &&
    visiblePorConfidencialidad(doc, usuario) &&
    visiblePorAudiencia(doc, usuario, contexto);
}

// ---------- Permisos excepcionales por persona ----------
//
// Un PERMISO EXCEPCIONAL es una autorización nominal (una persona), sobre un
// documento, de un tipo (consultar o descargar), con motivo, vigencia y quién la
// otorgó. Se revoca con motivo y nunca se borra. Vive embebido en el documento
// (`permisosExcepcionales[]`) para que `puedeVer` y `puedeDescargarPdf` se
// resuelvan sin una lectura adicional por documento: es la restricción de costo
// del listado maestro. `permisosCorreos[]` es el índice denormalizado (solo los
// correos con permiso activo, sin revocar y sin vencer) que permite preguntar
// «¿en qué documentos tiene permiso X?» con un array-contains.
//
// La vigencia se evalúa EN LECTURA, no por cron: el día siguiente al vencimiento
// el permiso simplemente deja de aplicar. Ver docs/ANALISIS-PERMISOS-EXCEPCIONALES-DOCUMENTAL.md.
function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

function permisoActivo(p, hoy = hoyIso()) {
  return !p.revocado && (!p.hasta || p.hasta >= hoy);
}

// Descargar implica consultar.
function permisoVigente(doc, usuario, tipo) {
  if (!usuario || !usuario.correo) return false;
  const correo = String(usuario.correo).toLowerCase();
  const hoy = hoyIso();
  return (doc.permisosExcepcionales || []).some((p) => p.correo === correo && permisoActivo(p, hoy) &&
    (p.tipo === tipo || (tipo === 'consultar' && p.tipo === 'descargar')));
}

// Los permisos activos de UNA persona, para contárselos en la ficha.
function misPermisos(doc, usuario) {
  const correo = String((usuario && usuario.correo) || '').toLowerCase();
  return (doc.permisosExcepcionales || []).filter((p) => p.correo === correo && permisoActivo(p));
}

function permisosCorreos(lista) {
  const hoy = hoyIso();
  return [...new Set((lista || []).filter((p) => permisoActivo(p, hoy)).map((p) => p.correo))];
}

function diasEntre(desdeIso, hastaIso) {
  return Math.round((new Date(hastaIso) - new Date(desdeIso)) / 86400000);
}

const ETIQUETA_TIPO = { consultar: 'consulta en línea', descargar: 'consulta y descarga del PDF' };

async function avisarPermiso(doc, permiso, { revocado = false, motivoRevocacion = null } = {}) {
  try {
    await notificar({
      para: [permiso.correo],
      asunto: `la plataforma: ${revocado ? 'se revocó' : 'se le otorgó'} un permiso sobre el documento ${doc.codigo}`,
      cuerpo: revocado
        ? `Se revocó su permiso de ${ETIQUETA_TIPO[permiso.tipo]} sobre "${doc.nombre}" (${doc.codigo}).`
        : `Se le otorgó permiso de ${ETIQUETA_TIPO[permiso.tipo]} sobre "${doc.nombre}" (${doc.codigo}).`,
      modulo: 'documental', refId: doc.id,
      etiqueta: revocado ? 'Permiso revocado' : 'Permiso otorgado',
      ruta: `/documental/documentos/${doc.id}`,
      html: plantillasCorreo.envolver({
        etiqueta: revocado ? 'Permiso revocado' : 'Permiso otorgado',
        titulo: revocado ? `Se revocó su permiso sobre ${doc.codigo}` : `Tiene un permiso sobre ${doc.codigo}`,
        parrafos: [revocado
          ? `${permiso.revocado.por} revocó el permiso excepcional que tenía sobre el siguiente documento de la plataforma.`
          : `${permiso.otorgadoPor} le otorgó un permiso excepcional sobre el siguiente documento de la plataforma.`],
        datos: [
          { campo: 'Código', valor: doc.codigo },
          { campo: 'Documento', valor: doc.nombre },
          { campo: 'Permiso', valor: ETIQUETA_TIPO[permiso.tipo] },
          { campo: 'Motivo', valor: revocado ? motivoRevocacion : permiso.motivo },
          { campo: 'Vigente hasta', valor: revocado ? null : (permiso.hasta || 'indefinido') }
        ],
        accion: revocado ? null : { texto: 'Abrir el documento', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) },
        nota: revocado
          ? null
          : (permiso.tipo === 'descargar'
            ? 'La descarga del PDF queda registrada en la auditoría de la plataforma. Un documento controlado que sale como archivo deja de estar controlado: úselo solo para el fin indicado en el motivo.'
            : 'Consulte el documento en línea dentro de la plataforma; la descarga del PDF sigue restringida.')
      })
    });
  } catch (e) {
    console.error(`[documental] no se pudo avisar el permiso sobre ${doc.codigo}:`, e.message);
  }
}

// Otorga un permiso. Reglas (D1, D4, D5 del análisis):
//   · quien otorga administra el documento (líder del proceso, administrador del
//     módulo o de la plataforma): lo verifica la ruta con `soloGestores`;
//   · `descargar` indefinido solo lo da quien administra el MÓDULO; el líder del
//     proceso debe poner fecha, y no más allá de `diasMaximoPermisoDocumento`;
//   · `hasta` no puede ser anterior a hoy (no hay permisos retroactivos);
//   · si la persona ya tiene un permiso activo del mismo tipo se trata como
//     PRÓRROGA: el anterior se revoca con motivo «prorrogado» y se crea el nuevo.
//     La historia queda lineal y nada se edita en sitio.
async function otorgarPermiso(doc, { correo, tipo, motivo, hasta }, usuario) {
  const destinatario = String(correo).trim().toLowerCase();
  const hoy = hoyIso();
  if (destinatario === String(usuario.correo).toLowerCase()) {
    throw httpError(400, 'No puede otorgarse un permiso a sí mismo');
  }
  if (!administraDocumentacion(usuario) && tipo === 'descargar' && !hasta) {
    throw httpError(400, 'El permiso de descarga que otorga el líder del proceso debe tener fecha de vencimiento; ' +
      'solo el administrador del módulo documental puede darlo indefinido');
  }
  if (hasta) {
    if (hasta < hoy) throw httpError(400, 'La fecha de vencimiento no puede ser anterior a hoy');
    const maximo = Number(await param('diasMaximoPermisoDocumento')) || 90;
    if (!administraDocumentacion(usuario) && tipo === 'descargar' && diasEntre(hoy, hasta) > maximo) {
      throw httpError(400, `Un permiso de descarga otorgado por el líder del proceso dura máximo ${maximo} días`);
    }
  }
  if (doc.obsoleto) throw httpError(409, 'Un documento obsoleto no recibe permisos');

  const lista = [...(doc.permisosExcepcionales || [])];
  if (lista.filter((p) => permisoActivo(p, hoy)).length >= 100) {
    throw httpError(409, 'El documento ya tiene 100 permisos activos');
  }
  const ahora = new Date().toISOString();
  let prorrogaDe = null;
  for (const p of lista) {
    if (p.correo === destinatario && p.tipo === tipo && permisoActivo(p, hoy)) {
      p.revocado = { por: usuario.correo, fecha: ahora, motivo: 'Prorrogado: reemplazado por un permiso nuevo' };
      prorrogaDe = p.id;
    }
  }
  const nuevo = {
    id: crypto.randomUUID(),
    correo: destinatario, tipo, motivo: String(motivo).trim(),
    desde: hoy, hasta: hasta || null,
    otorgadoPor: usuario.correo, fecha: ahora,
    prorrogaDe,
    revocado: null
  };
  lista.push(nuevo);
  const actualizado = await col('documentos').update(doc.id, {
    permisosExcepcionales: lista,
    permisosCorreos: permisosCorreos(lista),
    updatedBy: usuario.correo
  });
  // Evento propio, no un `documental.editar` genérico: «¿quién le dio descarga a
  // X y por qué?» tiene que responderse con un filtro de la bitácora (ISO 27001 A.5.15/A.8.15).
  await auditar(usuario.correo, 'documental.permiso.otorgar', `documentos/${doc.id}`, {
    codigo: doc.codigo, permisoId: nuevo.id, correo: destinatario, tipo, motivo: nuevo.motivo,
    desde: nuevo.desde, hasta: nuevo.hasta, prorrogaDe
  });
  await avisarPermiso(actualizado, nuevo);
  return actualizado;
}

async function revocarPermiso(doc, permisoId, motivo, usuario) {
  const lista = [...(doc.permisosExcepcionales || [])];
  const p = lista.find((x) => x.id === permisoId);
  if (!p) throw httpError(404, 'El permiso no existe');
  if (p.revocado) throw httpError(409, 'El permiso ya estaba revocado');
  p.revocado = { por: usuario.correo, fecha: new Date().toISOString(), motivo: String(motivo).trim() };
  const actualizado = await col('documentos').update(doc.id, {
    permisosExcepcionales: lista,
    permisosCorreos: permisosCorreos(lista),
    updatedBy: usuario.correo
  });
  await auditar(usuario.correo, 'documental.permiso.revocar', `documentos/${doc.id}`, {
    codigo: doc.codigo, permisoId, correo: p.correo, tipo: p.tipo, motivo: p.revocado.motivo
  });
  await avisarPermiso(actualizado, p, { revocado: true, motivoRevocacion: p.revocado.motivo });
  return actualizado;
}

// ---------- Documentación vigente vs. trabajo en curso ----------
//
// Control documental: el colaborador ve ÚNICAMENTE lo vigente. Un borrador o una
// versión en revisión no son información controlada, y un obsoleto no es
// aplicable; mostrarlos invita a consultar y a trabajar sobre lo que no está
// aprobado, que es exactamente lo que el sistema debe evitar.
//
// Quien administra el documento (administrador del SGC o líder del proceso) o
// participa en su flujo sí ve el ciclo completo: sin eso no podría elaborar,
// revisar ni aprobar. Es la misma frontera que ya usa `accesoPrivilegiado`.
function veCicloCompleto(doc, usuario) {
  return accesoPrivilegiado(doc, usuario);
}

// ¿Tiene una versión aprobada y sigue siendo aplicable?
function tieneVigencia(doc) {
  return !doc.obsoleto && !!versionVigente(doc);
}

// ¿Puede pedir los archivos de ESTA versión? Quien solo ve lo vigente no alcanza
// los archivos de un borrador en curso ni de una versión ya reemplazada.
function puedeVerVersion(doc, usuario, numero) {
  if (veCicloCompleto(doc, usuario)) return true;
  const vig = versionVigente(doc);
  return !!vig && vig.numero === Number(numero);
}

// Ficha recortada a lo que el usuario puede ver. Para quien no ve el ciclo
// completo se entrega SOLO la versión vigente: dejar las demás en la respuesta
// las pinta en pantalla y expone sus archivos por la API. La audiencia y la
// lista de acceso confidencial también se omiten: son datos de administración.
function detalle(doc, usuario) {
  // La lista de permisos excepcionales (quién, por qué, hasta cuándo) es dato
  // de administración: la ve quien administra el documento. A todos los demás se
  // les entregan solo SUS permisos activos, para que la ficha les diga «tiene
  // permiso de descarga hasta el …» (decisión D7: el beneficiario ve el motivo).
  const propios = misPermisos(doc, usuario);
  if (veCicloCompleto(doc, usuario)) {
    if (puedeAdministrar(doc, usuario)) return { ...doc, misPermisosExcepcionales: propios };
    const { permisosExcepcionales, permisosCorreos: _pc, ...resto } = doc;
    return { ...resto, misPermisosExcepcionales: propios };
  }
  const vig = versionVigente(doc);
  const {
    audienciaVisualizacion, audienciaDescarga, accesoConfidencial, permisosExcepcionales, permisosCorreos: _pc2, ...publico
  } = doc;
  return { ...publico, versiones: vig ? [vig] : [], misPermisosExcepcionales: propios };
}

// Normaliza una audiencia a [{ tipo, valor }]. El esquema admite un correo suelto
// por compatibilidad con la gramática de asignación; guardarla ya normalizada
// evita que cada lectura tenga que interpretar dos formas.
function normalizarAudiencia(lista) {
  return (lista || []).map(normalizar);
}

function puedeAdministrar(doc, usuario) {
  return esAdmin(usuario) || esLiderDe(usuario, doc.procesoId);
}

// ---------- Reglas de descarga e impresión ----------

// ---------- Quién se lleva un archivo ----------
//
// REGLA ÚNICA (2026-09-25, decisión de dirección): un documento del sistema de
// gestión SOLO lo descarga el administrador global de la plataforma o el
// administrador del módulo documental. Nadie más, sin excepciones por documento.
//
// Antes esto era configurable por documento —«todos los que pueden verlo»,
// «solo estas personas», «nadie»— y además lo abría el líder del proceso. Un
// documento controlado que sale como archivo deja de estar controlado: circula
// por correo, sobrevive a la obsolescencia de su versión y reaparece en una
// auditoría como evidencia de algo que ya no rige. La consulta EN LÍNEA no
// cambia: cualquiera con acceso lo lee completo en el visor de la herramienta.
//
// Los campos `permitirImpresion` y `audienciaDescarga` SIGUEN GUARDADOS en los
// documentos que ya los traían (varios llegaron así de Kawak, de la columna
// «Quién lo imprime»): no se borran porque son historia de cómo estaba
// configurado el documento, pero ya no otorgan nada.
function administraDocumentacion(usuario) {
  return esAdmin(usuario) || puede(usuario, 'documental.administrar');
}

// El archivo original editable (Word, Excel…). Misma regla, con UNA excepción
// deliberada: los tipos que existen para diligenciarse —los formatos— se siguen
// descargando. Un formato que no se puede bajar no sirve para nada, y no es un
// documento controlado que se esté repartiendo: es una plantilla en blanco.
function puedeDescargarOriginal(doc, usuario, tipo) {
  if (tipo && tipo.permiteOriginal) return true;
  return administraDocumentacion(usuario);
}

// Descarga del PDF. Sin excepciones: ni el líder del proceso, ni el elaborador,
// ni una audiencia configurada en la ficha.
//
// El documento siempre se puede CONSULTAR dentro del visor de la herramienta;
// esto decide solo si sale como archivo. La consulta en línea exige venir del
// frontend (lib/storage.js) y se audita.
//
// EXCEPCIÓN NOMINAL (2026-11-04, revisión de la regla del 2026-09-25): un permiso
// excepcional de DESCARGA vigente, otorgado por quien administra el documento
// con motivo y vigencia, también autoriza. La regla general no cambia: nadie
// descarga por rol salvo los administradores; la excepción es por persona, por
// documento, con fecha y auditada. Ver otorgarPermiso.
function puedeDescargarPdf(doc, usuario) {
  return administraDocumentacion(usuario) || permisoVigente(doc, usuario, 'descargar');
}

// Con qué permiso excepcional (si alguno) se autorizó la descarga: va a la
// auditoría de `documental.descargar` para que conste que la copia salió por una
// excepción y no por el rol.
function permisoDescargaDe(doc, usuario) {
  if (administraDocumentacion(usuario)) return null;
  return misPermisos(doc, usuario).find((p) => p.tipo === 'descargar') || null;
}

// ---------- Estado derivado y alertas de revisión ----------

function versionActual(doc) {
  const vs = versiones(doc);
  return vs.length ? vs[vs.length - 1] : null;
}

function versionVigente(doc) {
  return versiones(doc).find((v) => v.estado === 'vigente') || null;
}

function estadoDocumento(doc) {
  if (doc.obsoleto) return 'obsoleto';
  const vig = versionVigente(doc);
  const ult = versionActual(doc);
  if (vig && ult && ult !== vig && ESTADOS_TRAMITE.includes(ult.estado)) return 'en_actualizacion';
  if (vig) return 'vigente';
  return ult ? ult.estado : 'borrador';
}

function diasParaRevision(doc) {
  if (!doc.proximaRevision || doc.obsoleto) return null;
  return Math.ceil((new Date(doc.proximaRevision) - Date.now()) / 86400000);
}

function alertaRevision(doc, diasAlerta) {
  const dias = diasParaRevision(doc);
  if (dias === null) return null;
  if (dias < 0) return 'vencida';
  if (dias <= diasAlerta) return 'proxima';
  return null;
}

// Proyección para el listado maestro (sin archivos ni flujos completos).
//
// `soloVigente` es para quien no ve el ciclo completo: se le muestra la versión
// VIGENTE y no la que está en curso. Decirle "v3, en actualización" y entregarle
// el PDF de la v2 es información contradictoria sobre qué debe aplicar.
function proyectar(doc, diasAlerta, { soloVigente = false } = {}) {
  const ult = soloVigente ? versionVigente(doc) : versionActual(doc);
  return {
    id: doc.id,
    codigo: doc.codigo,
    nombre: doc.nombre,
    tipoId: doc.tipoId,
    procesoId: doc.procesoId,
    subprocesoId: doc.subprocesoId || null,
    alcance: doc.alcance,
    sedes: doc.sedes || [],
    confidencialidad: doc.confidencialidad,
    palabrasClave: doc.palabrasClave || [],
    // Campos personalizados: el listado maestro pinta los que el administrador
    // marcó para aparecer como columna.
    datos: doc.datos || {},
    // Códigos con los que este documento se identificó antes: se muestran en el
    // listado y permiten encontrarlo buscando por el código viejo.
    codigosAnteriores: (doc.codigosAnteriores || []).map((c) => c.codigo),
    estado: soloVigente ? 'vigente' : estadoDocumento(doc),
    version: ult ? ult.numero : null,
    fechaVigencia: doc.fechaVigencia || null,
    proximaRevision: doc.proximaRevision || null,
    diasParaRevision: diasParaRevision(doc),
    alertaRevision: alertaRevision(doc, diasAlerta),
    updatedAt: doc.updatedAt || doc.createdAt
  };
}

// ---------- Operaciones ----------

async function crearDocumento(datos, usuario) {
  const { codigo, consecutivo, sufijo } = await generarCodigo(datos);
  const doc = await col('documentos').insert({
    ...datos,
    codigo,
    consecutivo,
    sufijoCodigo: sufijo,
    // Índice de búsqueda por código: ver codigosPlanos() arriba.
    codigosPlanos: [String(codigo).trim().toUpperCase()],
    palabrasClave: datos.palabrasClave || [],
    audienciaVisualizacion: normalizarAudiencia(datos.audienciaVisualizacion),
    audienciaDescarga: normalizarAudiencia(datos.audienciaDescarga),
    obsoleto: false,
    fechaVigencia: null,
    proximaRevision: null,
    versiones: [{
      numero: 1,
      estado: 'borrador',
      controlCambios: 'Versión inicial',
      archivos: { original: null, pdf: null },
      flujo: { elaboro: { correo: usuario.correo, fecha: new Date().toISOString() }, revisores: [], aprobadores: [] }
    }],
    createdBy: usuario.correo
  });
  await auditar(usuario.correo, 'documental.crear', `documentos/${doc.id}`, { codigo, nombre: doc.nombre });
  return doc;
}

async function nuevaVersion(doc, controlCambios, usuario) {
  if (estadoDocumento(doc) !== 'vigente') throw httpError(409, 'Solo se puede versionar un documento vigente');
  const ult = versionActual(doc);
  const version = {
    numero: ult.numero + 1,
    estado: 'borrador',
    controlCambios,
    archivos: { original: null, pdf: null },
    flujo: { elaboro: { correo: usuario.correo, fecha: new Date().toISOString() }, revisores: [], aprobadores: [] }
  };
  const actualizado = await col('documentos').update(doc.id, {
    versiones: [...versiones(doc), version], updatedBy: usuario.correo
  });
  await auditar(usuario.correo, 'documental.nueva_version', `documentos/${doc.id}`, { version: version.numero, controlCambios });
  return actualizado;
}

// ---------- Recodificación ----------
//
// El código lleva dentro la sigla del proceso y del tipo. Si el administrador
// corrige esas siglas después de que ya se cargaron documentos, los códigos
// existentes quedan mal, y renombrarlos a secas destruiría la trazabilidad: ese
// código aparece citado en otros documentos, en registros de auditoría y en
// copias que la gente ya imprimió.
//
// Por eso recodificar nunca pierde el código anterior: lo archiva en
// `codigosAnteriores` con motivo, fecha y responsable, y el documento sigue
// siendo encontrable buscando por el código viejo.
async function recodificar(doc, { codigo, motivo }, usuario) {
  if (!String(motivo || '').trim()) {
    throw httpError(400, 'Debe registrar el motivo del cambio de código');
  }

  // Sin código explícito se reconstruye con las siglas actuales del catálogo,
  // que es el caso habitual: "corregí la sigla del proceso, actualiza los códigos".
  const nuevo = codigo
    ? { codigo: String(codigo).trim().toUpperCase(), sufijo: doc.sufijoCodigo, consecutivo: doc.consecutivo }
    : await recomponerCodigo(doc);

  if (nuevo.codigo === doc.codigo) {
    throw httpError(409, `El código ya es ${doc.codigo}: no hay nada que recodificar`);
  }

  // Un código es identidad: no puede haber dos documentos con el mismo, ni uno
  // nuevo que choque con el histórico de otro. Consulta indexada sobre
  // `codigosPlanos`: antes esto leía la colección completa en cada recodificación,
  // y la recodificación masiva por proceso lo hacía una vez POR DOCUMENTO.
  const choque = await documentoConCodigo(nuevo.codigo, doc.id);
  if (choque) {
    throw httpError(409,
      `El código ${nuevo.codigo} ya pertenece a "${choque.doc.nombre}" (${choque.doc.codigo})`);
  }

  const historico = [
    ...(doc.codigosAnteriores || []),
    { codigo: doc.codigo, motivo: String(motivo).trim(), fecha: new Date().toISOString(), por: usuario.correo }
  ];

  const actualizado = await col('documentos').update(doc.id, {
    codigo: nuevo.codigo,
    sufijoCodigo: nuevo.sufijo,
    codigosAnteriores: historico,
    // Se recalcula entero desde la fuente de verdad, nunca se parchea.
    codigosPlanos: codigosPlanos({ codigo: nuevo.codigo, codigosAnteriores: historico }),
    updatedBy: usuario.correo
  });

  await auditar(usuario.correo, 'documental.recodificar', `documentos/${doc.id}`, {
    anterior: doc.codigo, nuevo: nuevo.codigo, motivo
  });
  return actualizado;
}

// Verifica que la versión tenga los archivos que exige la norma antes de firmar.
async function validarArchivos(version) {
  if (!version.archivos || !version.archivos.pdf) {
    throw httpError(409, 'Debe cargar el archivo PDF antes de enviar el documento a flujo');
  }
  if (await param('exigirArchivoOriginal') && !version.archivos.original) {
    throw httpError(409, 'Debe cargar el archivo original editable (Word/Excel) además del PDF');
  }
}

async function enviarFlujo(doc, { revisores, aprobadores }, usuario) {
  const ver = versionActual(doc);
  if (!ver || ver.estado !== 'borrador') throw httpError(409, 'La versión actual no está en borrador');
  await validarArchivos(ver);

  // Las asignaciones pueden venir por usuario, cargo, grupo o sede.
  const revs = await resolver(revisores);
  const aprs = await resolver(aprobadores);
  if (!aprs.length) throw httpError(400, 'Debe asignar al menos un aprobador');

  // Segregación de funciones: nadie del EQUIPO elaborador (autor o co-elaborador)
  // se revisa ni se aprueba a sí mismo. Parametrizable porque en procesos con un
  // solo responsable puede ser inviable exigirlo.
  if (await param('exigirSegregacionFunciones')) {
    const equipo = elaboradoresDe(ver);
    const cruzado = [...revs, ...aprs].find((p) => equipo.includes(p.correo));
    if (cruzado) {
      throw httpError(400,
        `${cruzado.correo} está en el equipo elaborador y no puede figurar como revisor ni aprobador (segregación de funciones). ` +
        'Un administrador puede desactivar esta regla en Configuración.');
    }
  }

  // Un reenvío tras un rechazo sobreescribe el flujo. La ronda anterior se
  // archiva en la versión: sin esto, los comentarios y decisiones de esa ronda
  // solo sobrevivían en la colección de auditoría, invisibles en pantalla.
  if ((ver.flujo.revisores || []).length || (ver.flujo.aprobadores || []).length) {
    ver.rondasAnteriores = [...(ver.rondasAnteriores || []), {
      revisores: ver.flujo.revisores,
      aprobadores: ver.flujo.aprobadores,
      fechaEnvio: ver.fechaEnvio || null,
      archivadaEl: new Date().toISOString()
    }];
  }

  const nuevo = (p) => ({ correo: p.correo, asignadoPor: p.asignadoPor, estado: 'pendiente', fecha: null, comentario: null });
  ver.flujo.revisores = revs.map(nuevo);
  ver.flujo.aprobadores = aprs.map(nuevo);
  ver.estado = ver.flujo.revisores.length ? 'en_revision' : 'en_aprobacion';
  ver.fechaEnvio = new Date().toISOString();

  // Convocar antes de persistir: fija la fecha límite en cada participante y
  // esa fecha tiene que quedar guardada con el resto del flujo.
  const etapa = ver.estado === 'en_revision' ? 'revision' : 'aprobacion';
  await convocar(doc, ver, ver.estado === 'en_revision' ? ver.flujo.revisores : ver.flujo.aprobadores, etapa);
  const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
  await auditar(usuario.correo, 'documental.enviar_flujo', `documentos/${doc.id}`, {
    version: ver.numero,
    revisores: revs.map((r) => r.correo),
    aprobadores: aprs.map((a) => a.correo)
  });
  return actualizado;
}

// Crea los pendientes y envía el correo obligatorio de asignación de tarea.
//
// Cada convocado queda con FECHA LÍMITE (parámetro diasPlazoDecision): es lo que
// permite que el cron de recordatorios sepa a quién insistirle y cuándo escalar.
// La fecha se escribe en el participante (para la pantalla) y en el pendiente
// (para el cron, que no puede pagar una lectura del documento por pendiente).
async function convocar(doc, ver, participantes, etapa) {
  if (!participantes.length) return;
  const plazoDias = await param('diasPlazoDecision');
  const fechaLimite = new Date(Date.now() + plazoDias * 86400000).toISOString();
  const verbo = etapa === 'revision' ? 'Revisar' : 'Aprobar';
  for (const p of participantes) {
    p.fechaLimite = fechaLimite;
    await crearPendiente({
      correo: p.correo, modulo: 'documental', tipo: etapa,
      titulo: `${verbo} documento ${doc.codigo} v${ver.numero} — ${doc.nombre}`,
      refTipo: 'documento', refId: doc.id, ruta: `/documental/documentos/${doc.id}`,
      fechaLimite
    });
  }
  await notificar({
    para: participantes.map((p) => p.correo),
    asunto: `la plataforma: documento ${doc.codigo} pendiente de ${etapa}`,
    cuerpo: `El documento "${doc.nombre}" (v${ver.numero}) requiere su ${etapa}.`,
    modulo: 'documental', refId: doc.id,
    etiqueta: 'Tarea asignada',
    ruta: `/documental/documentos/${doc.id}`,
    html: plantillasCorreo.envolver({
      etiqueta: 'Tarea asignada',
      titulo: `Tiene un documento pendiente de ${etapa === 'revision' ? 'revisión' : 'aprobación'}`,
      parrafos: [`Se le asignó la <strong>${etapa === 'revision' ? 'revisión' : 'aprobación'}</strong> del siguiente documento de la plataforma.`],
      datos: [
        { campo: 'Código', valor: doc.codigo },
        { campo: 'Documento', valor: doc.nombre },
        { campo: 'Versión', valor: `v${ver.numero}` },
        { campo: 'Elaboró', valor: ver.flujo && ver.flujo.elaboro && ver.flujo.elaboro.correo },
        { campo: 'Plazo para decidir', valor: fechaLimite.slice(0, 10) }
      ],
      accion: { texto: `${verbo} documento`, url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) },
      nota: 'Mientras no registre su decisión, el documento no avanza en el flujo. ' +
        'Si no decide dentro del plazo, el sistema le enviará recordatorios y avisará al responsable del documento.'
    })
  });
}

// AVISO DE PUBLICACIÓN — cuando una versión queda vigente.
//
// Solo se difunde si el documento declara audiencia. Sin audiencia el documento
// es de consulta general dentro de su alcance, y avisar significaría escribirle
// a la compañía entera en cada aprobación: eso no es una notificación, es correo
// masivo, y termina en que nadie lee ninguna.
//
// Se mandan dos mensajes distintos porque no dicen lo mismo: quien solo
// visualiza consulta en línea, y quien además puede descargar se lleva el PDF
// (el caso de auditorías y licitaciones). Un fallo aquí NO revierte nada: el
// documento ya quedó vigente y perder un correo no puede desaprobarlo.
async function notificarPublicacion(doc, ver) {
  const visual = doc.audienciaVisualizacion || [];
  const descarga = doc.audienciaDescarga || [];
  if (!visual.length && !descarga.length) return;

  try {
    const [conVista, conDescarga] = await Promise.all([resolver(visual), resolver(descarga)]);
    const correosDescarga = new Set(conDescarga.map((p) => p.correo));
    const soloConsulta = conVista.map((p) => p.correo).filter((c) => !correosDescarga.has(c));

    for (const [correos, descargable] of [[soloConsulta, false], [[...correosDescarga], true]]) {
      if (!correos.length) continue;
      await notificar({
        para: correos,
        asunto: `la plataforma: publicación del documento ${doc.codigo} v${ver.numero}`,
        cuerpo: `El documento "${doc.nombre}" (${doc.codigo}) quedó vigente en su versión ${ver.numero}.`,
        modulo: 'documental', refId: doc.id,
        etiqueta: 'Documento publicado',
        ruta: `/documental/documentos/${doc.id}`,
        html: plantillasCorreo.envolver({
          etiqueta: 'Documento publicado',
          titulo: `${doc.nombre} está vigente`,
          parrafos: [
            'Se publicó una versión vigente de un documento de la plataforma que le aplica. ' +
            'La versión anterior deja de ser aplicable desde este momento.'
          ],
          datos: [
            { campo: 'Código', valor: doc.codigo },
            { campo: 'Documento', valor: doc.nombre },
            { campo: 'Versión vigente', valor: `v${ver.numero}` },
            { campo: 'Próxima revisión', valor: doc.proximaRevision ? doc.proximaRevision.slice(0, 10) : null }
          ],
          accion: { texto: 'Consultar el documento', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) },
          nota: descargable
            ? 'Puede descargar el PDF desde la plataforma para adjuntarlo a auditorías o licitaciones.'
            : 'Este documento es de consulta en línea: la descarga del PDF está restringida.'
        })
      });
    }
  } catch (e) {
    // Queda en el log con el código del documento para poder reclamarlo; no se
    // oculta y no se propaga.
    console.error(`[documental] no se pudo avisar la publicación de ${doc.codigo}:`, e.message);
  }
}

// ¿Terminó la etapa actual? Se evalúa sobre los participantes ACTIVOS: si un
// gestor retira al último pendiente, la etapa también debe cerrar, y por eso
// esta función existe aparte de registrarDecision (la llama también el retiro).
async function avanzarEtapaSiCompleta(doc, ver) {
  if (ver.estado === 'en_revision') {
    const activos = participantesActivos(ver.flujo.revisores);
    if (!activos.every((p) => p.estado === 'aprobado')) return;
    // Revisión completa (o sin revisores activos) → pasa a aprobación. No se
    // retorna aquí: si los aprobadores ya estaban todos aprobados (p. ej. un
    // revisor tardío que regresó la etapa), la versión debe seguir hasta vigente.
    ver.estado = 'en_aprobacion';
    await convocar(doc, ver, participantesActivos(ver.flujo.aprobadores).filter((p) => p.estado === 'pendiente'), 'aprobacion');
  }
  if (ver.estado !== 'en_aprobacion') return;
  const activos = participantesActivos(ver.flujo.aprobadores);
  // A diferencia de la revisión, aquí una lista vacía NO aprueba: un documento
  // no puede quedar vigente sin ninguna firma de aprobación.
  if (!activos.length || !activos.every((p) => p.estado === 'aprobado')) return;

  // Aprobación completa → vigente; la versión anterior pasa a obsoleta.
  ver.estado = 'vigente';
  ver.fechaAprobacion = new Date().toISOString();
  versiones(doc).forEach((v) => { if (v !== ver && v.estado === 'vigente') v.estado = 'obsoleta'; });
  doc.fechaVigencia = ver.fechaAprobacion;
  const meses = doc.mesesRevision || (await param('mesesRevisionPorDefecto'));
  const prox = new Date();
  prox.setMonth(prox.getMonth() + meses);
  doc.proximaRevision = prox.toISOString();
  await notificar({
    para: elaboradoresDe(ver),
    asunto: `la plataforma: documento ${doc.codigo} v${ver.numero} aprobado y vigente`,
    cuerpo: `Todas las aprobaciones fueron registradas. El documento "${doc.nombre}" quedó vigente.`,
    modulo: 'documental', refId: doc.id,
    etiqueta: 'Documento vigente',
    ruta: `/documental/documentos/${doc.id}`,
    html: plantillasCorreo.envolver({
      etiqueta: 'Documento vigente',
      titulo: `${doc.codigo} v${ver.numero} quedó vigente`,
      parrafos: [`Se registraron todas las aprobaciones de <strong>${doc.nombre}</strong>. La versión anterior pasó automáticamente a obsoleta.`],
      datos: [
        { campo: 'Código', valor: doc.codigo },
        { campo: 'Versión vigente', valor: `v${ver.numero}` },
        { campo: 'Próxima revisión', valor: doc.proximaRevision ? doc.proximaRevision.slice(0, 10) : null }
      ],
      accion: { texto: 'Ver el documento', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) }
    })
  });
  // Aviso a la audiencia configurada del documento. Va después de fijar la
  // vigencia y la próxima revisión, para que el correo las informe correctas.
  await notificarPublicacion(doc, ver);
}

async function registrarDecision(doc, { decision, comentario }, usuario) {
  const ver = versionActual(doc);
  if (!ver || !ESTADOS_EN_PROCESO.includes(ver.estado)) throw httpError(409, 'La versión no está en flujo');
  const etapa = ver.estado === 'en_revision' ? 'revisores' : 'aprobadores';
  const participante = ver.flujo[etapa].find((p) => p.correo === usuario.correo && p.estado === 'pendiente');
  if (!participante) throw httpError(403, 'No tiene una decisión pendiente en esta etapa');
  if (['rechazado', 'devuelto'].includes(decision) && !String(comentario || '').trim()) {
    throw httpError(400, decision === 'rechazado'
      ? 'Para rechazar debe registrar un comentario'
      : 'Para devolver a ajustes debe indicar qué se debe corregir');
  }

  participante.estado = decision;
  participante.fecha = new Date().toISOString();
  participante.comentario = comentario || null;
  await cerrarPendientes({ refTipo: 'documento', refId: doc.id, correo: usuario.correo });

  const elaborador = elaboradoresDe(ver);

  if (decision === 'rechazado') {
    // Rechazo en cualquier etapa: la versión vuelve a borrador y se anula el avance.
    ver.estado = 'borrador';
    for (const grupo of ['revisores', 'aprobadores']) {
      ver.flujo[grupo].forEach((p) => { if (p.estado === 'pendiente') p.estado = 'no_aplica'; });
    }
    await cerrarPendientes({ refTipo: 'documento', refId: doc.id });
    await notificar({
      para: elaborador,
      asunto: `la plataforma: documento ${doc.codigo} devuelto a borrador`,
      cuerpo: `${usuario.correo} rechazó la versión ${ver.numero}. Comentario: ${comentario}`,
      modulo: 'documental', refId: doc.id,
      etiqueta: 'Devuelto a borrador',
      ruta: `/documental/documentos/${doc.id}`,
      html: plantillasCorreo.envolver({
        etiqueta: 'Devuelto a borrador',
        titulo: `Su documento ${doc.codigo} volvió a borrador`,
        parrafos: [`La versión ${ver.numero} de <strong>${doc.nombre}</strong> fue rechazada y regresó a borrador para que la ajuste.`],
        datos: [
          { campo: 'Rechazó', valor: usuario.correo },
          { campo: 'Comentario', valor: comentario }
        ],
        accion: { texto: 'Ver el documento', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) }
      })
    });
  } else if (decision === 'devuelto') {
    // DEVOLUCIÓN PARA AJUSTES: a diferencia del rechazo, la ronda sobrevive.
    // Las decisiones ya emitidas se conservan, los pendientes quedan congelados
    // (sus tareas se cierran y se recrean al reanudar) y solo quien devolvió
    // vuelve a decidir después de que el elaborador corrija y responda.
    ver.estado = 'en_ajustes';
    ver.etapaAjustes = etapa;
    await cerrarPendientes({ refTipo: 'documento', refId: doc.id });
    await notificar({
      para: elaborador,
      asunto: `la plataforma: documento ${doc.codigo} devuelto para ajustes`,
      cuerpo: `${usuario.correo} devolvió la versión ${ver.numero} para ajustes. Comentario: ${comentario}`,
      modulo: 'documental', refId: doc.id,
      etiqueta: 'Devuelto para ajustes',
      ruta: `/documental/documentos/${doc.id}`,
      html: plantillasCorreo.envolver({
        etiqueta: 'Devuelto para ajustes',
        titulo: `Su documento ${doc.codigo} requiere ajustes`,
        parrafos: [
          `La versión ${ver.numero} de <strong>${doc.nombre}</strong> fue devuelta para ajustes. ` +
          'Las aprobaciones ya registradas se conservan: corrija lo observado, responda el comentario y reanude el flujo.'
        ],
        datos: [
          { campo: 'Devolvió', valor: usuario.correo },
          { campo: 'Comentario', valor: comentario }
        ],
        accion: { texto: 'Atender los ajustes', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) }
      })
    });
  } else {
    await avanzarEtapaSiCompleta(doc, ver);
  }

  const actualizado = await col('documentos').update(doc.id, {
    versiones: versiones(doc),
    fechaVigencia: doc.fechaVigencia || null,
    proximaRevision: doc.proximaRevision || null,
    updatedBy: usuario.correo
  });
  await auditar(usuario.correo, `documental.${etapa === 'revisores' ? 'revision' : 'aprobacion'}.${decision}`,
    `documentos/${doc.id}`, { version: ver.numero, comentario });
  return actualizado;
}

// Reanuda un flujo que estaba en ajustes: quien devolvió vuelve a pendiente (su
// decisión anterior queda en su historial) y se le convoca de nuevo. Los demás
// pendientes de la etapa también recuperan su tarea, que se cerró al devolver.
async function reanudarFlujo(doc, { respuesta }, usuario) {
  const ver = versionActual(doc);
  if (!ver || ver.estado !== 'en_ajustes') throw httpError(409, 'La versión no está en ajustes');
  await validarArchivos(ver);

  const etapa = ver.etapaAjustes || 'revisores';
  const texto = String(respuesta || '').trim();
  for (const p of ver.flujo[etapa]) {
    if (p.estado !== 'devuelto') continue;
    p.historial = [...(p.historial || []), { estado: 'devuelto', fecha: p.fecha, comentario: p.comentario }];
    if (texto) {
      p.respuestas = [...(p.respuestas || []), { autor: usuario.correo, fecha: new Date().toISOString(), texto }];
    }
    p.estado = 'pendiente';
    p.fecha = null;
    p.comentario = null;
  }

  ver.estado = etapa === 'aprobadores' ? 'en_aprobacion' : 'en_revision';
  delete ver.etapaAjustes;
  await convocar(doc, ver, ver.flujo[etapa].filter((p) => p.estado === 'pendiente'),
    etapa === 'aprobadores' ? 'aprobacion' : 'revision');

  const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
  await auditar(usuario.correo, 'documental.reanudar_flujo', `documentos/${doc.id}`, {
    version: ver.numero, respuesta: texto || null
  });
  return actualizado;
}

// Respuesta del elaborador (o de un gestor) al comentario de un participante:
// el hilo observación → respuesta es la evidencia de que la revisión se atendió.
async function responderComentario(doc, { correo, texto }, usuario) {
  const ver = versionActual(doc);
  if (!ver) throw httpError(409, 'El documento no tiene versiones');
  const participante = [...(ver.flujo.revisores || []), ...(ver.flujo.aprobadores || [])]
    .find((p) => p.correo === correo);
  if (!participante) throw httpError(404, `${correo} no participa en el flujo de esta versión`);

  participante.respuestas = [...(participante.respuestas || []), {
    autor: usuario.correo, fecha: new Date().toISOString(), texto: String(texto).trim()
  }];
  const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
  await auditar(usuario.correo, 'documental.flujo.respuesta', `documentos/${doc.id}`, {
    version: ver.numero, para: correo, texto: String(texto).trim()
  });
  return actualizado;
}

// Agrega o retira participantes con el flujo EN CURSO (faltó un aprobador clave,
// alguien salió de la empresa). Reglas: nunca se toca a quien ya decidió, el
// retiro no borra al participante (queda `retirado`, con quién y por qué), y
// siempre debe quedar al menos un aprobador activo.
async function modificarParticipantes(doc, { accion, etapa, asignacion, correo, motivo }, usuario) {
  const ver = versionActual(doc);
  if (!ver || ![...ESTADOS_EN_PROCESO, 'en_ajustes'].includes(ver.estado)) {
    throw httpError(409, 'El flujo no está en curso: los participantes se definen al enviarlo');
  }

  if (accion === 'agregar') {
    if (!asignacion) throw httpError(400, 'Indique a quién agregar');
    // Los revisores solo se agregan mientras la revisión sigue abierta. Una vez
    // la etapa cerró (el documento está en aprobación, o en ajustes de la
    // aprobación), el proceso no se devuelve: si la revisión faltante es de
    // fondo, el camino es que un aprobador rechace o devuelva para ajustes.
    if (etapa === 'revisores' && (ver.estado === 'en_aprobacion' ||
      (ver.estado === 'en_ajustes' && ver.etapaAjustes === 'aprobadores'))) {
      throw httpError(409, 'La revisión ya terminó: solo se pueden agregar aprobadores');
    }
    const nuevos = await resolver([asignacion]);
    const equipo = elaboradoresDe(ver);
    const agregados = [];
    for (const n of nuevos) {
      if ((await param('exigirSegregacionFunciones')) && equipo.includes(n.correo)) {
        throw httpError(400, `${n.correo} está en el equipo elaborador y no puede figurar como revisor ni aprobador (segregación de funciones)`);
      }
      if (ver.flujo[etapa].some((p) => p.correo === n.correo && p.estado !== 'retirado')) continue;
      const participante = { correo: n.correo, asignadoPor: n.asignadoPor, estado: 'pendiente', fecha: null, comentario: null };
      ver.flujo[etapa].push(participante);
      agregados.push(participante);
    }
    if (!agregados.length) throw httpError(409, 'Los participantes indicados ya están en el flujo');

    // Se convoca solo si su etapa es la activa; un aprobador agregado durante la
    // revisión recibirá su tarea cuando el documento pase a aprobación.
    const etapaActiva = (ver.estado === 'en_revision' && etapa === 'revisores') ||
      (ver.estado === 'en_aprobacion' && etapa === 'aprobadores');
    if (etapaActiva) {
      await convocar(doc, ver, agregados, etapa === 'revisores' ? 'revision' : 'aprobacion');
    }
    const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
    await auditar(usuario.correo, 'documental.flujo.participante_agregado', `documentos/${doc.id}`, {
      version: ver.numero, etapa, correos: agregados.map((p) => p.correo), motivo: motivo || null
    });
    return actualizado;
  }

  // ----- retirar -----
  if (!correo) throw httpError(400, 'Indique el correo del participante a retirar');
  if (!String(motivo || '').trim()) throw httpError(400, 'Debe registrar el motivo del retiro');
  const participante = ver.flujo[etapa].find((p) => p.correo === correo);
  if (!participante) throw httpError(404, `${correo} no está en la etapa de ${etapa}`);
  if (participante.estado !== 'pendiente') {
    throw httpError(409, 'Solo se puede retirar a quien aún no ha decidido: las decisiones registradas no se eliminan');
  }
  if (etapa === 'aprobadores' &&
    participantesActivos(ver.flujo.aprobadores).filter((p) => p !== participante).length === 0) {
    throw httpError(409, 'No se puede retirar al único aprobador: el documento necesita al menos una aprobación');
  }

  participante.estado = 'retirado';
  participante.retiro = { por: usuario.correo, motivo: String(motivo).trim(), fecha: new Date().toISOString() };
  await cerrarPendientes({ refTipo: 'documento', refId: doc.id, correo });
  // Si el retirado era el último pendiente de la etapa, la etapa cierra aquí:
  // nadie más va a "decidir" y sin esta llamada el flujo quedaría congelado.
  await avanzarEtapaSiCompleta(doc, ver);

  const actualizado = await col('documentos').update(doc.id, {
    versiones: versiones(doc),
    fechaVigencia: doc.fechaVigencia || null,
    proximaRevision: doc.proximaRevision || null,
    updatedBy: usuario.correo
  });
  await auditar(usuario.correo, 'documental.flujo.participante_retirado', `documentos/${doc.id}`, {
    version: ver.numero, etapa, correo, motivo: String(motivo).trim()
  });
  return actualizado;
}

// Recordatorio MANUAL: el gestor o el elaborador insiste a quien tiene la
// decisión pendiente, con mensaje propio. Máximo uno al día por participante
// para que el seguimiento no degenere en spam (los automáticos van por el cron).
async function recordarPendientes(doc, { correo, mensaje }, usuario) {
  const ver = versionActual(doc);
  if (!ver || !ESTADOS_EN_PROCESO.includes(ver.estado)) throw httpError(409, 'La versión no está en flujo');
  const etapa = ver.estado === 'en_revision' ? 'revisores' : 'aprobadores';

  let objetivo = ver.flujo[etapa].filter((p) => p.estado === 'pendiente');
  if (correo) objetivo = objetivo.filter((p) => p.correo === correo);
  if (!objetivo.length) throw httpError(404, 'No hay decisiones pendientes que recordar en la etapa actual');

  const hace24h = Date.now() - 24 * 3600000;
  const frescos = objetivo.filter((p) => !p.ultimoRecordatorio || new Date(p.ultimoRecordatorio).getTime() < hace24h);
  if (!frescos.length) {
    throw httpError(429, 'Ya se envió un recordatorio en las últimas 24 horas: espere antes de insistir');
  }

  const texto = String(mensaje || '').trim();
  const ahora = new Date().toISOString();
  for (const p of frescos) p.ultimoRecordatorio = ahora;
  await notificar({
    para: frescos.map((p) => p.correo),
    asunto: `la plataforma: recordatorio — documento ${doc.codigo} pendiente de su decisión`,
    cuerpo: `${usuario.correo} le recuerda que el documento "${doc.nombre}" (v${ver.numero}) espera su decisión.` +
      (texto ? ` Mensaje: ${texto}` : ''),
    modulo: 'documental', refId: doc.id,
    etiqueta: 'Recordatorio',
    ruta: `/documental/documentos/${doc.id}`,
    html: plantillasCorreo.envolver({
      etiqueta: 'Recordatorio',
      titulo: `El documento ${doc.codigo} sigue esperando su decisión`,
      parrafos: [
        `<strong>${usuario.correo}</strong> le recuerda que tiene una ${etapa === 'revisores' ? 'revisión' : 'aprobación'} pendiente.`,
        ...(texto ? [`«${texto}»`] : [])
      ],
      datos: [
        { campo: 'Código', valor: doc.codigo },
        { campo: 'Documento', valor: doc.nombre },
        { campo: 'Versión', valor: `v${ver.numero}` },
        { campo: 'Plazo', valor: (frescos[0].fechaLimite || '').slice(0, 10) || null }
      ],
      accion: { texto: 'Registrar mi decisión', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) }
    })
  });

  const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
  await auditar(usuario.correo, 'documental.flujo.recordatorio', `documentos/${doc.id}`, {
    version: ver.numero, correos: frescos.map((p) => p.correo), mensaje: texto || null
  });
  return actualizado;
}

// Gestiona el EQUIPO ELABORADOR de la versión en curso. El autor (flujo.elaboro)
// es inamovible: es quien creó la versión y esa autoría no se reasigna. Los
// co-elaboradores se agregan o retiran mientras la versión no esté vigente, y
// heredan los derechos de trabajo del elaborador: ver el ciclo completo,
// descargar el editable, cargar archivos, enviar el flujo y darle seguimiento.
async function modificarElaboradores(doc, { accion, asignacion, correo }, usuario) {
  const ver = versionActual(doc);
  if (!ver || !ESTADOS_TRAMITE.includes(ver.estado)) {
    throw httpError(409, 'El equipo elaborador solo se modifica mientras la versión está en trámite');
  }
  ver.flujo.elaboradores = ver.flujo.elaboradores || [];

  if (accion === 'agregar') {
    if (!asignacion) throw httpError(400, 'Indique a quién agregar como elaborador');
    const nuevos = await resolver([asignacion]);
    const equipo = elaboradoresDe(ver);
    const exigirSegregacion = await param('exigirSegregacionFunciones');
    const agregados = [];
    for (const n of nuevos) {
      if (equipo.includes(n.correo)) continue;
      // Segregación en la otra dirección: quien ya es revisor o aprobador activo
      // de esta versión no puede pasarse al equipo que elabora lo que él firma.
      if (exigirSegregacion) {
        const cruzado = [...(ver.flujo.revisores || []), ...(ver.flujo.aprobadores || [])]
          .some((p) => p.correo === n.correo && !['retirado', 'no_aplica'].includes(p.estado));
        if (cruzado) {
          throw httpError(400,
            `${n.correo} es revisor o aprobador de esta versión y no puede ser también elaborador (segregación de funciones)`);
        }
      }
      const elaborador = { correo: n.correo, asignadoPor: n.asignadoPor, agregadoPor: usuario.correo, fecha: new Date().toISOString() };
      ver.flujo.elaboradores.push(elaborador);
      agregados.push(elaborador);
    }
    if (!agregados.length) throw httpError(409, 'Los indicados ya hacen parte del equipo elaborador');

    const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
    await auditar(usuario.correo, 'documental.flujo.elaborador_agregado', `documentos/${doc.id}`, {
      version: ver.numero, correos: agregados.map((e) => e.correo)
    });
    await notificar({
      para: agregados.map((e) => e.correo),
      asunto: `la plataforma: asignado como elaborador del documento ${doc.codigo}`,
      cuerpo: `${usuario.correo} lo agregó al equipo elaborador de "${doc.nombre}" (v${ver.numero}).`,
      modulo: 'documental', refId: doc.id,
      etiqueta: 'Tarea asignada',
      ruta: `/documental/documentos/${doc.id}`,
      html: plantillasCorreo.envolver({
        etiqueta: 'Tarea asignada',
        titulo: `Es elaborador de ${doc.codigo} v${ver.numero}`,
        parrafos: [`<strong>${usuario.correo}</strong> lo agregó al equipo elaborador de <strong>${doc.nombre}</strong>. ` +
          'Puede cargar archivos, enviar el flujo y dar seguimiento a la versión en curso.'],
        accion: { texto: 'Ver el documento', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) }
      })
    });
    return actualizado;
  }

  // ----- retirar -----
  if (!correo) throw httpError(400, 'Indique el correo del elaborador a retirar');
  if (ver.flujo.elaboro && ver.flujo.elaboro.correo === correo) {
    throw httpError(409, 'El autor de la versión no se puede retirar: la autoría no se reasigna');
  }
  const indice = ver.flujo.elaboradores.findIndex((e) => e.correo === correo);
  if (indice < 0) throw httpError(404, `${correo} no está en el equipo elaborador`);
  ver.flujo.elaboradores.splice(indice, 1);

  const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
  await auditar(usuario.correo, 'documental.flujo.elaborador_retirado', `documentos/${doc.id}`, {
    version: ver.numero, correo
  });
  return actualizado;
}

// CORRECCIÓN EDITORIAL sobre la versión VIGENTE: errores de forma (ortografía,
// una fecha mal digitada, el nombre de la empresa incompleto) que no cambian el
// contenido y no ameritan nueva versión ni re-aprobación. El respaldo normativo
// es que ISO 9001/27001 §7.5.3 exigen CONTROL de cambios, no re-aprobación de
// todo cambio; lo que lo hace defendible en auditoría es la traza: quién, cuándo,
// por qué, y los archivos anteriores conservados (nunca se sobreescriben).
// Cualquier cambio de fondo va por nueva versión: esa frontera la define el
// procedimiento de control documental, no el sistema.
//
// `archivos` llega ya guardado en Storage por el router: { original?, pdf? }
// con { key, nombre, tamano }.
async function registrarCorreccion(doc, { motivo, archivos }, usuario) {
  const ver = versionVigente(doc);
  if (!ver) throw httpError(409, 'Solo se corrige la versión vigente, y este documento no tiene ninguna');
  if (!String(motivo || '').trim() || String(motivo).trim().length < 5) {
    throw httpError(400, 'Debe registrar el motivo de la corrección (qué se corrigió y por qué es de forma)');
  }
  const campos = Object.keys(archivos || {}).filter((c) => archivos[c]);
  if (!campos.length) throw httpError(400, 'Adjunte el archivo corregido (editable y/o PDF)');

  // Los archivos reemplazados se conservan referenciados: un auditor puede pedir
  // "el PDF antes de la corrección" y el sistema debe poder entregarlo.
  const anteriores = {};
  for (const campo of campos) anteriores[campo] = ver.archivos[campo] || null;
  ver.correcciones = [...(ver.correcciones || []), {
    fecha: new Date().toISOString(),
    por: usuario.correo,
    motivo: String(motivo).trim(),
    anteriores
  }];
  for (const campo of campos) ver.archivos[campo] = archivos[campo];

  const actualizado = await col('documentos').update(doc.id, { versiones: versiones(doc), updatedBy: usuario.correo });
  await auditar(usuario.correo, 'documental.correccion', `documentos/${doc.id}`, {
    version: ver.numero, motivo: String(motivo).trim(), archivos: campos
  });

  // Aviso al elaborador cuando corrige otro gestor: su documento cambió de
  // archivos sin pasar por él. No se re-notifica a la audiencia: eso es lo que
  // distingue una corrección de una publicación.
  const equipo = elaboradoresDe(ver).filter((c) => c !== usuario.correo);
  if (equipo.length) {
    await notificar({
      para: equipo,
      asunto: `la plataforma: corrección editorial en el documento ${doc.codigo}`,
      cuerpo: `${usuario.correo} aplicó una corrección editorial a la versión vigente (v${ver.numero}). Motivo: ${motivo}`,
      modulo: 'documental', refId: doc.id,
      etiqueta: 'Corrección editorial',
      ruta: `/documental/documentos/${doc.id}`,
      html: plantillasCorreo.envolver({
        etiqueta: 'Corrección editorial',
        titulo: `Se corrigió ${doc.codigo} v${ver.numero}`,
        parrafos: [`<strong>${usuario.correo}</strong> aplicó una corrección editorial (sin cambio de versión) a <strong>${doc.nombre}</strong>.`],
        datos: [{ campo: 'Motivo', valor: String(motivo).trim() }],
        accion: { texto: 'Ver el documento', url: plantillasCorreo.enlace(`/documental/documentos/${doc.id}`) }
      })
    });
  }
  return actualizado;
}

async function obsoletizar(doc, usuario, motivo) {
  const actualizado = await col('documentos').update(doc.id, {
    obsoleto: true,
    fechaObsolescencia: new Date().toISOString(),
    motivoObsolescencia: motivo || null,
    obsoletizadoPor: usuario.correo,
    updatedBy: usuario.correo
  });
  await cerrarPendientes({ refTipo: 'documento', refId: doc.id });
  await auditar(usuario.correo, 'documental.obsoletizar', `documentos/${doc.id}`, { motivo: motivo || null });
  return actualizado;
}

module.exports = {
  crearDocumento, nuevaVersion, enviarFlujo, registrarDecision, obsoletizar, validarArchivos, recodificar,
  reanudarFlujo, responderComentario, modificarParticipantes, recordarPendientes, registrarCorreccion,
  modificarElaboradores, elaboradoresDe,
  puedeVer, puedeAdministrar, puedeDescargarOriginal, puedeDescargarPdf, permisoDescargaDe,
  otorgarPermiso, revocarPermiso, permisoVigente, misPermisos, administraDocumentacion,
  visiblePorSede, visiblePorConfidencialidad, visiblePorAudiencia, participaEnFlujo, esElaborador,
  veCicloCompleto, tieneVigencia, puedeVerVersion, detalle, normalizarAudiencia,
  versionActual, versionVigente, estadoDocumento, diasParaRevision, alertaRevision, proyectar, httpError,
  codigosPlanos, documentoConCodigo
};
