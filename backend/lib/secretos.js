// Comparación de secretos en tiempo constante.
//
// Un `===` sobre un secreto permite un ataque de temporización: el atacante
// mide cuánto tarda el rechazo y deduce el prefijo correcto byte a byte. Los
// endpoints expuestos sin IAP (webhooks, crons) comparan SIEMPRE con esta
// función (OWASP A02 — fallas criptográficas).
const crypto = require('crypto');

function igualSeguro(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  // La longitud se filtra igual (timingSafeEqual exige buffers iguales), pero
  // conocer la longitud de un secreto largo y aleatorio no ayuda al atacante.
  return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
}

module.exports = { igualSeguro };
