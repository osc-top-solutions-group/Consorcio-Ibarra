// Identidad del usuario SIN login.
//
// Esta instalación es una demostración pública y temporal: no hay IAP delante
// ni un directorio corporativo detrás. La persona ELIGE quién es en la pantalla
// de ingreso (api/sesion.js) y el backend le entrega una cookie firmada con su
// correo. Quien no está en el catálogo `usuarios` entra como visitante, con los
// permisos de cualquier colaborador (consulta de lo vigente), y queda registrado
// en el catálogo para que la auditoría y la marca de agua lleven su nombre.
//
// Por qué una cookie FIRMADA aunque no haya contraseña: el ingreso pasa por
// POST /api/sesion, que es el único punto que decide con qué identidad se entra
// (y el que exige la clave opcional de un usuario). Sin la firma, bastaría con
// editar la cookie en el navegador para saltarse esa clave.
//
// En desarrollo local (fuera de Cloud Run) se sigue aceptando el header
// `x-dev-user-email` y DEV_USER_EMAIL, que es lo que usan las pruebas
// end-to-end para actuar como distintas personas. En Cloud Run se ignoran.
const crypto = require('crypto');

const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE);
const NOMBRE_COOKIE = 'gd_sesion';
const DIAS_VIGENCIA = 7;

// El secreto firma la cookie. En Cloud Run se fija por variable de entorno para
// que todas las instancias acepten la misma cookie; en local se genera uno por
// proceso (reiniciar el backend cierra las sesiones, que es aceptable).
const SECRETO = process.env.SESION_SECRETO || crypto.randomBytes(32).toString('hex');
if (EN_CLOUD_RUN && !process.env.SESION_SECRETO) {
  console.warn('[sesion] SESION_SECRETO no definido: cada instancia firmará con un secreto distinto');
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function firmar(cuerpo) {
  return crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64url');
}

function emitirCookie(res, correo) {
  const cuerpo = b64u(JSON.stringify({ correo, exp: Date.now() + DIAS_VIGENCIA * 86400 * 1000 }));
  const valor = `${cuerpo}.${firmar(cuerpo)}`;
  const partes = [
    `${NOMBRE_COOKIE}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${DIAS_VIGENCIA * 86400}`
  ];
  if (EN_CLOUD_RUN) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function borrarCookie(res) {
  res.setHeader('Set-Cookie', `${NOMBRE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function leerCookie(req) {
  const crudo = String(req.headers.cookie || '');
  const par = crudo.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${NOMBRE_COOKIE}=`));
  if (!par) return null;
  const valor = par.slice(NOMBRE_COOKIE.length + 1);
  const [cuerpo, firma] = valor.split('.');
  if (!cuerpo || !firma) return null;
  const esperada = firmar(cuerpo);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!datos.correo || !datos.exp || Date.now() > datos.exp) return null;
    return String(datos.correo).toLowerCase();
  } catch {
    return null;
  }
}

async function getUsuarioEmail(req) {
  const deCookie = leerCookie(req);
  if (deCookie) return deCookie;
  if (EN_CLOUD_RUN) return null;
  return req.headers['x-dev-user-email'] || process.env.DEV_USER_EMAIL || null;
}

module.exports = { getUsuarioEmail, emitirCookie, borrarCookie, NOMBRE_COOKIE };
