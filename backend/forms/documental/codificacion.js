// Codificación estándar del SGC.
//
//   PROCESO[-SUBPROCESO]-TIPO-consecutivo-ÁMBITO
//   GETI-DSS-PRO-7-COL   → procedimiento local de Colombia
//   GETI-ETI-POL-14-REG  → política regional (aplica a varios países)
//   GC-MAN-2-GLO         → manual global (toda la compañía)
//
// El último segmento sale del alcance del documento (requerimiento: el código
// se compone de iniciales del proceso, la región o sede, el tipo y un
// consecutivo). Los literales GLO/REG son parametrizables desde el panel de
// configuración; el código de sede viene del catálogo de sedes.
//
// El consecutivo es independiente por combinación proceso+subproceso+tipo+ámbito,
// de modo que el manual 1 de Colombia y el manual 1 de Bolivia coexisten.
const { col, nextConsecutivo } = require('../../lib/db');
const { param } = require('../../core/config/parametros');
// El alcance y su validación se comparten con Mejoramiento Continuo, así que
// viven en core/. Se re-exportan más abajo para no romper a quien ya los
// importaba desde aquí.
const { ALCANCES, validarAlcance, httpError } = require('../../core/alcance');

// Determina el último segmento del código a partir del alcance y las sedes.
async function sufijoAlcance({ alcance, sedes }, catalogoSedes) {
  if (alcance === 'global') return param('sufijoGlobal');
  if (alcance === 'regional') return param('sufijoRegional');
  if (alcance === 'especifico') {
    const ids = sedes || [];
    if (ids.length !== 1) {
      throw httpError(400, 'El alcance específico requiere exactamente una sede');
    }
    const sede = (catalogoSedes || []).find((s) => s.id === ids[0]);
    if (!sede) throw httpError(400, `La sede "${ids[0]}" no existe en el catálogo`);
    if (!sede.codigo) throw httpError(400, `La sede "${sede.nombre}" no tiene código asignado`);
    return String(sede.codigo).toUpperCase();
  }
  throw httpError(400, `Alcance inválido: ${alcance}`);
}

// Clave del contador de consecutivos. Debe ser estable y sin "/" (id Firestore).
function claveConsecutivo({ procesoCodigo, subprocesoCodigo, tipoCodigo, sufijo }) {
  return [procesoCodigo, subprocesoCodigo, tipoCodigo, sufijo].filter(Boolean).join('-');
}

// Genera el código definitivo y consume el consecutivo (transaccional).
async function generarCodigo({ procesoId, subprocesoId, tipoId, alcance, sedes }) {
  const proceso = await col('procesos').get(procesoId);
  if (!proceso) throw httpError(400, 'El proceso no existe');
  const tipo = await col('tipos_documento').get(tipoId);
  if (!tipo) throw httpError(400, 'El tipo de documento no existe');

  let sub = null;
  if (subprocesoId) {
    sub = (proceso.subprocesos || []).find((s) => s.id === subprocesoId);
    if (!sub) throw httpError(400, 'El subproceso no pertenece al proceso seleccionado');
  }

  validarAlcance({ alcance, sedes });
  const catalogoSedes = alcance === 'especifico' ? await col('sedes').list() : [];
  const sufijo = await sufijoAlcance({ alcance, sedes }, catalogoSedes);

  const clave = claveConsecutivo({
    procesoCodigo: proceso.codigo,
    subprocesoCodigo: sub ? sub.codigo : null,
    tipoCodigo: tipo.codigo,
    sufijo
  });
  const consecutivo = await nextConsecutivo(clave);
  const base = [proceso.codigo, sub && sub.codigo, tipo.codigo].filter(Boolean).join('-');

  return { codigo: `${base}-${consecutivo}-${sufijo}`, consecutivo, sufijo };
}

// Vista previa sin consumir consecutivo (para mostrarla en el formulario).
async function previsualizarCodigo({ procesoId, subprocesoId, tipoId, alcance, sedes }) {
  const [proceso, tipo] = await Promise.all([col('procesos').get(procesoId), col('tipos_documento').get(tipoId)]);
  if (!proceso || !tipo) return null;
  const sub = subprocesoId ? (proceso.subprocesos || []).find((s) => s.id === subprocesoId) : null;
  validarAlcance({ alcance, sedes });
  const catalogoSedes = alcance === 'especifico' ? await col('sedes').list() : [];
  const sufijo = await sufijoAlcance({ alcance, sedes }, catalogoSedes);
  const base = [proceso.codigo, sub && sub.codigo, tipo.codigo].filter(Boolean).join('-');
  const clave = claveConsecutivo({
    procesoCodigo: proceso.codigo, subprocesoCodigo: sub ? sub.codigo : null, tipoCodigo: tipo.codigo, sufijo
  });
  const contador = await col('contadores').get(clave);
  const siguiente = ((contador && contador.valor) || 0) + 1;
  return { codigo: `${base}-${siguiente}-${sufijo}`, sufijo, consecutivo: siguiente };
}

// Reconstruye el código de un documento YA EXISTENTE con las siglas actuales del
// catálogo, conservando su consecutivo.
//
// Es la operación que hace falta cuando el administrador corrige la sigla de un
// proceso o de un tipo después de que ya se cargaron documentos: el documento
// sigue siendo el número 7 de su serie, solo cambia el prefijo. Por eso NO se
// consume un consecutivo nuevo: hacerlo dejaría huecos en la numeración y
// rompería la correspondencia con los registros de auditoría.
async function recomponerCodigo(doc) {
  const [proceso, tipo] = await Promise.all([
    col('procesos').get(doc.procesoId),
    col('tipos_documento').get(doc.tipoId)
  ]);
  if (!proceso) throw httpError(400, 'El proceso del documento ya no existe en el catálogo');
  if (!tipo) throw httpError(400, 'El tipo del documento ya no existe en el catálogo');

  const sub = doc.subprocesoId
    ? (proceso.subprocesos || []).find((s) => s.id === doc.subprocesoId)
    : null;
  if (doc.subprocesoId && !sub) {
    throw httpError(400, 'El subproceso del documento ya no existe en el proceso');
  }

  const catalogoSedes = doc.alcance === 'especifico' ? await col('sedes').list() : [];
  const sufijo = await sufijoAlcance({ alcance: doc.alcance, sedes: doc.sedes }, catalogoSedes);
  const base = [proceso.codigo, sub && sub.codigo, tipo.codigo].filter(Boolean).join('-');

  return { codigo: `${base}-${doc.consecutivo}-${sufijo}`, sufijo, consecutivo: doc.consecutivo };
}

module.exports = {
  ALCANCES, generarCodigo, previsualizarCodigo, recomponerCodigo,
  sufijoAlcance, claveConsecutivo, validarAlcance, httpError
};
