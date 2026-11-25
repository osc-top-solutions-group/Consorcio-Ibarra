// CLAVE DE INGRESO de los usuarios registrados (catálogo `usuarios`).
//
// La clave nunca se guarda en claro: se almacena como `$s$<sal>$<sha256>`,
// con una sal aleatoria por usuario. El catálogo `usuarios` lo puede leer
// cualquier sesión (los selectores de personas lo consumen), así que lo que se
// expone por la API es solo si la persona TIENE clave, nunca la clave.
//
// Convenciones para el panel de configuración (editor genérico):
//   · GET devuelve `clave: OCULTA` cuando hay clave y '' cuando no.
//   · En POST/PUT, `clave` vacía u OCULTA = no cambiar; `-` = quitar la clave;
//     cualquier otro texto = nueva clave (se cifra aquí).
const crypto = require('crypto');
const { igualSeguro } = require('./secretos');

const OCULTA = '••••';
const QUITAR = '-';
const PREFIJO = '$s$';

function hashear(clave) {
  const sal = crypto.randomBytes(12).toString('hex');
  const hash = crypto.createHash('sha256').update(`${sal}:${clave}`).digest('hex');
  return `${PREFIJO}${sal}$${hash}`;
}

function estaCifrada(valor) {
  return typeof valor === 'string' && valor.startsWith(PREFIJO);
}

// Compara la clave escrita con la almacenada. Acepta también una clave en
// claro (filas escritas directamente en Firestore) para no dejar fuera a nadie.
function verificar(escrita, almacenada) {
  if (!almacenada) return true;
  const texto = String(escrita || '');
  if (!estaCifrada(almacenada)) return igualSeguro(texto, String(almacenada));
  const [, , sal, hash] = almacenada.split('$');
  const calculado = crypto.createHash('sha256').update(`${sal}:${texto}`).digest('hex');
  return igualSeguro(calculado, hash);
}

// Aplica la convención del panel sobre el cuerpo de un POST/PUT de `usuarios`.
// Devuelve el cuerpo listo para guardar: sin `clave` cuando no cambia, con
// `clave: null` cuando se quita y cifrada cuando se fija.
function prepararClave(body) {
  if (!body || body.clave === undefined) return body;
  const valor = String(body.clave ?? '').trim();
  const { clave, ...resto } = body;
  if (valor === '' || valor === OCULTA) return resto;
  if (valor === QUITAR) return { ...resto, clave: null };
  if (estaCifrada(valor)) return { ...resto, clave: valor };
  return { ...resto, clave: hashear(valor) };
}

// Lo que sale por la API: nunca la clave, solo si existe.
function ocultar(fila) {
  if (!fila || !('clave' in fila)) return fila;
  const { clave, ...resto } = fila;
  return { ...resto, clave: clave ? OCULTA : '', tieneClave: Boolean(clave) };
}

module.exports = { OCULTA, QUITAR, hashear, verificar, prepararClave, ocultar, estaCifrada };
