// Notificaciones: bandeja interna («Mis Pendientes» › notificaciones).
//
// En el SGC original esto además enviaba correo por la API de Gmail con la
// delegación de dominio de la compañía. Esta instalación de demostración no
// tiene un dominio de correo propio, así que las notificaciones se REGISTRAN
// siempre en Firestore (es la evidencia de que se intentó avisar y lo que la
// interfaz muestra) y no se envían. Cuando el cliente defina su correo (SMTP,
// Gmail, SendGrid…) basta con implementar `enviarCorreo` y poner MAIL_ENVIAR=1.
//
// Un fallo del correo NUNCA tumba la operación de negocio: perder una
// aprobación porque no salió un aviso sería inaceptable.
const { col } = require('./db');
const plantillas = require('./plantillasCorreo');
const { param } = require('../core/config/parametros');

function aLista(valor) {
  if (Array.isArray(valor)) return valor.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  return String(valor || '').split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
}

// Modo de pruebas por módulo (parámetros modoPruebasModulos / modoPruebasCorreos):
// se conserva por compatibilidad con el módulo, aunque sin envío real no frena nada.
async function modoPruebasDe(modulo) {
  if (!modulo) return null;
  const modulos = aLista(await param('modoPruebasModulos'));
  if (!modulos.includes(String(modulo).toLowerCase())) return null;
  return new Set(aLista(await param('modoPruebasCorreos')));
}

async function destinatariosPermitidos(modulo, correos) {
  const lista = [...new Set((Array.isArray(correos) ? correos : [correos]).filter(Boolean).map((c) => String(c).toLowerCase()))];
  const autorizados = await modoPruebasDe(modulo);
  if (!autorizados) return { permitidos: lista, omitidos: [], enPruebas: false };
  return {
    permitidos: lista.filter((c) => autorizados.has(c)),
    omitidos: lista.filter((c) => !autorizados.has(c)),
    enPruebas: true
  };
}

// Solo con MAIL_ENVIAR=1 explícito; nunca automático por estar en Cloud Run.
const ENVIAR = process.env.MAIL_ENVIAR === '1';

// Punto único para conectar un transporte real. Hoy no hay ninguno.
async function enviarCorreo() {
  throw new Error('No hay un transporte de correo configurado en esta instalación');
}

async function notificar({ para, asunto, cuerpo, modulo, refId, ruta, etiqueta, html, directo = false }) {
  const destinatarios = (Array.isArray(para) ? para : [para]).filter(Boolean);
  const contenido = html || plantillas.generico({ asunto, cuerpo, ruta, etiqueta });
  const pruebas = await destinatariosPermitidos(modulo, destinatarios);
  const frenados = new Set(pruebas.omitidos);

  for (const correo of destinatarios) {
    const envio = { estado: 'omitido', detalle: 'esta instalación no envía correo: solo bandeja interna', fecha: new Date().toISOString() };
    if (frenados.has(String(correo).toLowerCase())) {
      envio.detalle = 'módulo en modo de pruebas: solo se envía a los correos autorizados (parámetro modoPruebasCorreos)';
    } else if (ENVIAR) {
      try {
        await enviarCorreo({ para: correo, asunto, html: contenido, directo });
        envio.estado = 'enviado';
        envio.detalle = null;
      } catch (e) {
        envio.estado = 'error';
        envio.detalle = e.message;
        console.error(`[mailer] FALLÓ el envío a ${correo}: ${e.message}`);
      }
    } else {
      console.log(`[mailer] (bandeja interna) → ${correo}: ${asunto}`);
    }
    await col('notificaciones').insert({
      correo, asunto, cuerpo,
      modulo: modulo || null, refId: refId || null, ruta: ruta || null,
      leida: false, envio
    });
  }
}

function descripcion() {
  return ENVIAR ? 'MAIL_ENVIAR=1 sin transporte configurado' : 'solo bandeja interna';
}

async function invitadosPermitidos(modulo, correos) {
  const { permitidos, omitidos, enPruebas } = await destinatariosPermitidos(modulo, correos);
  return { permitidos, omitidos, enPruebas, desviado: false };
}

module.exports = { notificar, descripcion, destinatariosPermitidos, invitadosPermitidos, ENVIAR };
