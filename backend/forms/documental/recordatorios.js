// Recordatorios y escalamiento de decisiones documentales pendientes.
//
// El correo de convocatoria se manda una vez, y la experiencia con Kawak es que
// con eso no basta: si al aprobador se le pasa, el documento queda detenido y
// nadie se entera hasta que alguien pregunta. Este job (Cloud Scheduler, una
// corrida diaria) cierra ese hueco con dos mecanismos:
//
//   · RECORDATORIO: cada `diasFrecuenciaRecordatorio` días le repite la tarea a
//     quien tenga un pendiente de revisión/aprobación abierto con fecha límite.
//   · ESCALAMIENTO: al vencer la fecha límite (fijada al convocar, parámetro
//     `diasPlazoDecision`) avisa UNA sola vez al elaborador del documento, que
//     es quien puede insistir en persona, reasignar o retirar al participante.
//
// Costo: opera SOLO sobre los pendientes abiertos del módulo (consulta por
// igualdad, lee lo que devuelve) y trae cada documento referenciado una vez por
// corrida. No recorre `documentos` jamás.
//
// Invocación: POST /api/documental-cron/recordatorios con header `x-cron-key`
// (Cloud Scheduler, fuera de IAP), o POST /api/documental/recordatorios/procesar
// como administrador del SGC (corrida manual / pruebas).
const express = require('express');
const { col } = require('../../lib/db');
const { notificar } = require('../../lib/mailer');
const plantillasCorreo = require('../../lib/plantillasCorreo');
const { auditar } = require('../../lib/audit');
const { param } = require('../../core/config/parametros');
const { igualSeguro } = require('../../lib/secretos');

const DIA_MS = 86400000;

// Un pendiente amerita correo cuando nunca se le ha recordado (cuenta desde la
// convocatoria) o cuando el último recordatorio ya cumplió la frecuencia.
function tocaRecordar(p, frecuenciaDias, ahora) {
  const desde = new Date(p.ultimoRecordatorio || p.createdAt || 0).getTime();
  return ahora - desde >= frecuenciaDias * DIA_MS;
}

async function procesar() {
  const ahora = Date.now();
  const frecuencia = await param('diasFrecuenciaRecordatorio');
  const abiertos = await col('pendientes').query({ estado: 'pendiente', modulo: 'documental' });
  const conPlazo = abiertos.filter((p) => p.fechaLimite && ['revision', 'aprobacion'].includes(p.tipo));

  // Cada documento referenciado se lee UNA vez aunque tenga varios pendientes.
  const docs = new Map();
  const documentoDe = async (id) => {
    if (!docs.has(id)) docs.set(id, await col('documentos').get(id));
    return docs.get(id);
  };

  const resultado = { revisados: conPlazo.length, recordados: [], escalados: [], omitidos: 0 };

  for (const p of conPlazo) {
    if (!tocaRecordar(p, frecuencia, ahora)) { resultado.omitidos++; continue; }

    const doc = await documentoDe(p.refId);
    // Documento borrado del alcance del cron (obsoletizado con pendiente
    // huérfano, o inexistente): se cierra el pendiente y no se insiste jamás.
    if (!doc || doc.obsoleto) {
      await col('pendientes').update(p.id, { estado: 'hecho' });
      continue;
    }

    const venceEn = Math.ceil((new Date(p.fechaLimite).getTime() - ahora) / DIA_MS);
    const vencido = venceEn < 0;
    const etapa = p.tipo === 'revision' ? 'revisión' : 'aprobación';
    const plazoTexto = vencido
      ? `venció hace ${Math.abs(venceEn)} ${Math.abs(venceEn) === 1 ? 'día' : 'días'}`
      : venceEn === 0 ? 'vence hoy' : `vence en ${venceEn} ${venceEn === 1 ? 'día' : 'días'}`;

    await notificar({
      para: p.correo,
      asunto: `la plataforma: ${vencido ? 'PLAZO VENCIDO' : 'recordatorio'} — ${etapa} del documento pendiente`,
      cuerpo: `${p.titulo}. El plazo ${plazoTexto}.`,
      modulo: 'documental', refId: p.refId,
      etiqueta: vencido ? 'Plazo vencido' : 'Recordatorio',
      ruta: p.ruta,
      html: plantillasCorreo.envolver({
        etiqueta: vencido ? 'Plazo vencido' : 'Recordatorio',
        titulo: `Tiene una ${etapa} pendiente y el plazo ${plazoTexto}`,
        parrafos: [
          `${p.titulo}.`,
          'Mientras no registre su decisión, el documento no avanza en el flujo.'
        ],
        datos: [{ campo: 'Plazo', valor: String(p.fechaLimite).slice(0, 10) }],
        accion: { texto: 'Registrar mi decisión', url: plantillasCorreo.enlace(p.ruta) }
      })
    });
    resultado.recordados.push({ correo: p.correo, refId: p.refId, plazo: plazoTexto });

    // El escalamiento es UNA vez por pendiente: el objetivo es que el humano
    // responsable retome el seguimiento, no duplicar el goteo de recordatorios.
    const patch = { ultimoRecordatorio: new Date(ahora).toISOString() };
    if (vencido && !p.escaladoEn) {
      const ver = (doc.versiones || [])[doc.versiones.length - 1];
      const flujo = (ver && ver.flujo) || {};
      // Se escala al EQUIPO elaborador completo (autor + co-elaboradores),
      // excluyendo al propio moroso si estuviera en ambos lados.
      const elaborador = [
        flujo.elaboro && flujo.elaboro.correo,
        ...(flujo.elaboradores || []).map((e) => e.correo)
      ].filter((c) => c && c !== p.correo);
      if (elaborador.length) {
        await notificar({
          para: elaborador,
          asunto: `la plataforma: la ${etapa} de ${doc.codigo} está vencida sin decisión`,
          cuerpo: `${p.correo} no ha registrado su decisión sobre "${doc.nombre}" y el plazo ${plazoTexto}.`,
          modulo: 'documental', refId: p.refId,
          etiqueta: 'Escalamiento',
          ruta: p.ruta,
          html: plantillasCorreo.envolver({
            etiqueta: 'Escalamiento',
            titulo: `Su documento ${doc.codigo} está detenido`,
            parrafos: [
              `<strong>${p.correo}</strong> no ha registrado su ${etapa} de <strong>${doc.nombre}</strong> y el plazo ${plazoTexto}.`,
              'Puede enviarle un recordatorio con mensaje propio desde la ficha del documento, o pedir a un gestor que lo retire del flujo si ya no corresponde.'
            ],
            accion: { texto: 'Ver el documento', url: plantillasCorreo.enlace(p.ruta) }
          })
        });
        resultado.escalados.push({ correo: p.correo, elaborador, refId: p.refId });
        patch.escaladoEn = new Date(ahora).toISOString();
      }
    }
    await col('pendientes').update(p.id, patch);
  }

  await auditar('cron', 'documental.recordatorios', 'pendientes/*', {
    revisados: resultado.revisados,
    recordados: resultado.recordados.length,
    escalados: resultado.escalados.length
  });
  return resultado;
}

// Endpoint para Cloud Scheduler: vive FUERA de conUsuario (el scheduler no tiene
// identidad IAP) y se autentica con el secreto compartido, igual que el de Zoho.
const router = express.Router();

router.post('/recordatorios', async (req, res) => {
  if (!igualSeguro(req.headers['x-cron-key'], process.env.CRON_SECRET_KEY)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    res.json(await procesar());
  } catch (e) {
    console.error('[documental-cron]', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = { router, procesar };
