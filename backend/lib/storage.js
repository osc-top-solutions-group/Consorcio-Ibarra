// Almacenamiento de archivos con dos adaptadores intercambiables:
//
//   - Cloud Storage  → cuando hay STORAGE_BUCKET (producción y cualquier entorno
//                      que quiera probar contra el bucket real).
//   - Disco local    → solo para desarrollo sin bucket.
//
// Cloud Run es SIN ESTADO: el disco del contenedor se destruye en cada revisión
// y no se comparte entre instancias. Por eso el adaptador local está prohibido
// dentro de Cloud Run: si falta el bucket, el proceso no arranca (ver abajo).
// Es preferible un despliegue que falla ruidosamente a uno que pierde los
// documentos de los responsables sin avisar.
//
// ¿Por qué servimos los archivos por streaming y no con URL firmada?
// El requerimiento 8 exige controlar la impresión y la descarga: hay documentos
// que solo pueden consultarse en línea y tipos que no permiten bajar el editable.
// Una URL firmada es un enlace que se puede copiar y reenviar; ese control se
// perdería. Streaming mantiene cada descarga dentro de nuestra autorización.
// `urlFirmada` queda disponible (la arquitectura la contempla) para casos donde
// no haya restricción de difusión, como las plantillas institucionales.
const fs = require('fs');
const { desdeLaApp } = require('./permisos');
const path = require('path');

const BUCKET = process.env.STORAGE_BUCKET || '';
const ES_GCS = Boolean(BUCKET);
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');
const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE);

if (EN_CLOUD_RUN && !ES_GCS) {
  throw new Error(
    '[storage] STORAGE_BUCKET es obligatorio en Cloud Run: el disco del contenedor ' +
    'es efímero y los archivos subidos se perderían en el siguiente despliegue.'
  );
}

// Cliente perezoso: no queremos abrir conexión a GCS si corremos en disco.
let bucketRef = null;
function bucket() {
  if (!bucketRef) {
    const { Storage } = require('@google-cloud/storage');
    bucketRef = new Storage().bucket(BUCKET);
  }
  return bucketRef;
}

const TIPOS_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.vsd': 'application/vnd.visio',
  '.vsdx': 'application/vnd.ms-visio.drawing',
  // Modelos de proceso: Bizagi Modeler (.bpm, contenedor propio) y BPMN 2.0 (XML).
  '.bpm': 'application/octet-stream',
  '.bpmn': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function tipoMime(nombre, porDefecto = 'application/octet-stream') {
  return TIPOS_MIME[path.extname(String(nombre)).toLowerCase()] || porDefecto;
}

// Recupera el nombre real del archivo subido.
//
// Multer (busboy) decodifica el nombre de la cabecera multipart como latin1 por
// compatibilidad histórica, así que "Política.pdf" llega como "PolÃ­tica.pdf".
// En español eso afecta a casi todos los documentos, y ese nombre es el que se
// guarda y el que se le devuelve al usuario al descargar.
//
// Se revierte reinterpretando los bytes como UTF-8. Si no eran UTF-8 válido, la
// conversión produce U+FFFD; en ese caso el nombre ya venía bien y se respeta.
function nombreCliente(nombre) {
  const texto = String(nombre == null ? '' : nombre);
  const comoUtf8 = Buffer.from(texto, 'latin1').toString('utf8');
  return comoUtf8.includes('�') ? texto : comoUtf8;
}

// El nombre lo elige quien sube el archivo, así que se normaliza antes de
// convertirlo en parte de una clave. Quitar los separadores ya impide recorrer
// directorios; colapsar los puntos seguidos elimina de raíz la necesidad de
// razonar sobre ".." en cualquiera de los dos adaptadores.
function sanitize(name) {
  return String(name).replace(/[^\w.\-()\s]/g, '_').replace(/\.{2,}/g, '.');
}

// Clave interna del objeto. Es la misma en ambos adaptadores, así que un
// entorno puede pasar de disco a bucket sin reescribir lo ya guardado.
function buildKey(modulo, docId, version, originalName) {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.posix.join(modulo, docId, `v${version}`, `${stamp}-${sanitize(originalName)}`);
}

function rutaLocal(key) {
  const abs = path.join(STORAGE_DIR, key);
  if (!abs.startsWith(path.resolve(STORAGE_DIR))) throw new Error('[storage] clave inválida');
  return abs;
}

// Guarda el temporal de multer bajo `key` y borra el temporal. Devuelve la clave.
// `conservarOrigen` evita ese borrado: lo usa el seed, cuyo origen son los PDF
// del usuario y no un temporal desechable.
async function saveFile(tmpPath, key, { contentType, conservarOrigen = false } = {}) {
  if (ES_GCS) {
    await bucket().upload(tmpPath, {
      destination: key,
      resumable: false,   // los documentos son pequeños; evita la sesión de reanudación
      metadata: { contentType: contentType || tipoMime(key) }
    });
  } else {
    const dest = rutaLocal(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(tmpPath, dest);
  }
  if (!conservarOrigen) {
    try { fs.unlinkSync(tmpPath); } catch { /* multer ya pudo limpiarlo */ }
  }
  return key;
}

async function exists(key) {
  try {
    if (ES_GCS) {
      const [hay] = await bucket().file(key).exists();
      return hay;
    }
    return fs.existsSync(rutaLocal(key));
  } catch (e) {
    return false;
  }
}

// Envía el archivo al cliente. `inline` es la consulta en línea; si no, se
// descarga con el nombre indicado.
//
// Consulta en línea = SOLO dentro del visor de la herramienta. Con `req` se
// exige que la petición venga del frontend (fetch con X-Requested-With): abrir
// el enlace en otra pestaña o pegarlo en el navegador responde 403. Antes la
// consulta «inline» entregaba el PDF al visor nativo del navegador, que trae
// botón de descarga e impresión, y con eso la restricción de descarga del
// documento era decorativa. La descarga autorizada (`inline: false`) sí puede
// ser una navegación: la autorizó la regla del módulo, no este header.
//
// `Cache-Control: no-store`: los archivos son información clasificada del SGC y
// no deben quedar en la caché de disco del navegador ni en un proxy.
async function servir(res, key, { nombre, inline = false, contentType, req } = {}) {
  if (inline && req && !desdeLaApp(req)) {
    const err = new Error('Este archivo se consulta dentro de la herramienta, no en una pestaña aparte');
    err.status = 403;
    throw err;
  }
  const original = nombre || path.posix.basename(key);
  res.setHeader('Content-Type', contentType || tipoMime(original));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // RFC 6266: `filename` en ASCII para clientes viejos y `filename*` en UTF-8
  // para que "Política de Calidad.pdf" no llegue con el nombre mutilado.
  res.setHeader('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${sanitize(original)}"; ` +
    `filename*=UTF-8''${encodeURIComponent(original)}`);

  if (!ES_GCS) {
    return new Promise((resolve, reject) => {
      res.sendFile(rutaLocal(key), (err) => (err ? reject(err) : resolve()));
    });
  }

  const archivo = bucket().file(key);
  const [meta] = await archivo.getMetadata();
  if (meta.size) res.setHeader('Content-Length', meta.size);

  return new Promise((resolve, reject) => {
    archivo.createReadStream()
      .on('error', reject)
      .on('end', resolve)
      .pipe(res);
  });
}

// URL firmada v4. Solo para contenido sin restricción de difusión: el enlace
// funciona para cualquiera que lo tenga hasta que expire.
async function urlFirmada(key, { minutos = 5, nombre, inline = false } = {}) {
  if (!ES_GCS) throw new Error('[storage] las URLs firmadas requieren Cloud Storage');
  const [url] = await bucket().file(key).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + minutos * 60 * 1000,
    responseDisposition: `${inline ? 'inline' : 'attachment'}; filename="${sanitize(nombre || path.posix.basename(key))}"`
  });
  return url;
}

// Lee el objeto completo a memoria. Solo para integraciones que deben ENVIAR
// el archivo a un tercero (p. ej. el PDF del contrato al proveedor de firma):
// los documentos del SGC son pequeños y el buffer es puntual. Para entregarle
// un archivo al usuario, servir() por streaming sigue siendo la vía.
async function leer(key) {
  if (ES_GCS) {
    const [contenido] = await bucket().file(key).download();
    return contenido;
  }
  return fs.promises.readFile(rutaLocal(key));
}

async function eliminar(key) {
  try {
    if (ES_GCS) await bucket().file(key).delete({ ignoreNotFound: true });
    else if (fs.existsSync(rutaLocal(key))) fs.unlinkSync(rutaLocal(key));
  } catch (e) {
    console.warn(`[storage] no se pudo eliminar ${key}: ${e.message}`);
  }
}

// Se expone en /api/health para saber de un vistazo dónde están los archivos.
function descripcion() {
  return ES_GCS ? `gs://${BUCKET}` : `disco local (${STORAGE_DIR})`;
}

module.exports = {
  buildKey, saveFile, exists, servir, urlFirmada, leer, eliminar, descripcion, tipoMime, nombreCliente,
  ES_GCS, STORAGE_DIR
};
