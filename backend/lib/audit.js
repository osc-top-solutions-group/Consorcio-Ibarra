// Trazabilidad ISO: toda operación de escritura registra actor, acción y objeto.
//
// `auditoria` es append-only y nada la poda —no se borra por norma—, así que es
// la colección que más va a crecer de la plataforma. Por eso cada fila guarda
// `modulo` además de `accion`, aunque sea derivable de ella: consultar la
// auditoría de un módulo por igualdad cuesta lo que devuelve, mientras que
// filtrar por prefijo de `accion` obliga a leer la colección completa. Un campo
// redundante de diez bytes evita un scan que crece para siempre.
// Ver docs/POLITICA-COSTOS.md.
const crypto = require('crypto');
const { col } = require('./db');

// Las acciones se nombran "modulo.verbo" ("documental.crear", "accesos.guardar",
// "config.editar"). El módulo es el primer segmento.
function moduloDe(accion) {
  const [modulo] = String(accion || '').split('.');
  return modulo || 'desconocido';
}

async function auditar(correo, accion, objeto, detalle) {
  try {
    await col('auditoria').insert({
      correo,
      accion,
      modulo: moduloDe(accion),
      objeto,
      detalle: detalle || null
    });
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

// ---------- Bitácora inmutable ----------
//
// `auditoria` registra lo que la plataforma hizo; una BITÁCORA registra el
// ciclo de vida de un objeto que la norma exige poder reconstruir años después
// (quién pidió un acceso, quién lo aprobó, cuándo se dio y cuándo se quitó;
// ISO 27001 A.5.18, A.8.15). La diferencia no es el dato sino la garantía:
//
//  1. Inmutabilidad lógica: ninguna ruta de la API edita ni borra un evento, y
//     este módulo solo expone `insert`. Es lo mismo que ya cumple `auditoria`.
//  2. Inmutabilidad real: con el Admin SDK no existe una colección que el Owner
//     del proyecto no pueda borrar desde la consola. Por eso cada evento se
//     emite ADEMÁS como log estructurado a stdout. En Cloud Run, stdout va a
//     Cloud Logging; un sink lo copia a un bucket de logs propio con retención
//     bloqueada (infra/crear-bitacora-inmutable.ps1): una vez bloqueado, ni el
//     Owner puede acortar la retención ni borrar una entrada. Esa copia es la
//     evidencia que un auditor acepta como «no la puede borrar ni el administrador».
//
// El filtro del sink es `jsonPayload.bitacora="<nombre>"`, así que el nombre
// de la bitácora viaja en cada línea. Escribir el log es gratis en costo de
// Firestore y no puede fallar la operación de negocio: si la escritura en
// Firestore falla, el log ya salió (y al revés, el log nunca se pierde por un
// error de Firestore). Se devuelve el id del evento para enlazarlo.
async function bitacora(nombre, coleccion, evento) {
  const fecha = evento.fecha || new Date().toISOString();
  const registro = {
    ...evento,
    bitacora: nombre,
    fecha,
    // Id ordenable por tiempo: la fecha ISO delante de un sufijo aleatorio.
    // Así «los últimos eventos de esta app» es filtro por igualdad + orden por
    // __name__ descendente, que Firestore resuelve sin índice compuesto (la
    // regla del repo, docs/POLITICA-COSTOS.md). Un UUID obligaría a ordenar
    // por `fecha` y a crear un índice por cada filtro.
    id: `${fecha.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`
  };
  // Línea JSON: Cloud Logging la interpreta como entrada estructurada
  // (jsonPayload) y respeta `severity`. En local se ve como una línea más.
  console.log(JSON.stringify({ severity: 'NOTICE', message: `[bitacora:${nombre}] ${registro.evento}`, ...registro }));
  try {
    const guardado = await col(coleccion).insert(registro);
    return guardado.id;
  } catch (e) {
    console.error('[bitacora]', e.message);
    return null;
  }
}

module.exports = { auditar, moduloDe, bitacora };
