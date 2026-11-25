// "Mis Pendientes" — servicio TRANSVERSAL del SGC.
// Cualquier módulo (documental hoy; indicadores, mejoras, auditorías mañana)
// crea y cierra pendientes a través de este servicio, nunca directamente.
// Modelo: { correo, modulo, tipo, titulo, refTipo, refId, ruta, estado }
const express = require('express');
const { col } = require('../../lib/db');

// `fechaLimite` (opcional, ISO) habilita los recordatorios y el escalamiento del
// cron del módulo dueño del pendiente; sin ella el pendiente no caduca.
async function crearPendiente({ correo, modulo, tipo, titulo, refTipo, refId, ruta, fechaLimite }) {
  return col('pendientes').insert({
    correo, modulo, tipo, titulo, refTipo, refId, ruta: ruta || null,
    fechaLimite: fechaLimite || null, estado: 'pendiente'
  });
}

// Cierra los pendientes que coincidan (por referencia y opcionalmente correo/tipo).
//
// Los cuatro criterios son igualdades, así que los resuelve Firestore: se leen
// los pendientes de ESA referencia (un puñado), no la colección entera. Antes
// esto era un list() con predicado, y cada aprobación de documento pagaba un
// scan completo de `pendientes`.
async function cerrarPendientes({ refTipo, refId, correo, tipo }) {
  const abiertos = await col('pendientes').query({
    estado: 'pendiente', refTipo, refId, correo, tipo
  });
  for (const p of abiertos) {
    await col('pendientes').update(p.id, { estado: 'hecho' });
  }
  return abiertos.length;
}

const router = express.Router();

// La bandeja de UNA persona. El shell del frontend la pide en cada navegación
// (components/Layout.jsx), así que es el endpoint más caliente de la plataforma:
// tiene que costar lo que cuesta la bandeja de esa persona y nada más.
//
// Filtro de igualdad sobre correo + estado: Firestore devuelve solo los suyos.
// Se ordena en memoria porque el conjunto ya está acotado a los pendientes
// abiertos de un usuario; añadir orderBy exigiría un índice compuesto para no
// ganar nada. El orden en Firestore se justifica cuando hay que paginar.
router.get('/', async (req, res) => {
  try {
    const pendientes = await col('pendientes').query({
      correo: req.usuario.correo, estado: 'pendiente'
    });
    pendientes.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    res.json(pendientes);
  } catch (e) {
    console.error('[pendientes]', e);
    res.status(500).json({ error: 'Error consultando pendientes' });
  }
});

// Últimas 50 notificaciones de quien pregunta.
//
// `notificaciones` crece sin techo (una fila por aviso enviado, para siempre),
// y es justo el tipo de colección donde un list() se vuelve caro en silencio:
// nada en la pantalla cambia, pero la factura sube cada mes. Se lee por correo.
router.get('/notificaciones', async (req, res) => {
  try {
    const noti = await col('notificaciones').query({ correo: req.usuario.correo });
    noti.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    res.json(noti.slice(0, 50));
  } catch (e) {
    console.error('[pendientes]', e);
    res.status(500).json({ error: 'Error consultando notificaciones' });
  }
});

module.exports = { router, crearPendiente, cerrarPendientes };
