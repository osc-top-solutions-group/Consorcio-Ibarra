// "Solicitar documento": cualquier usuario pide crear, modificar o eliminar
// un documento; el responsable la atiende (con pendiente y notificación).
const express = require('express');
const path = require('path');
const multer = require('multer');
const { col } = require('../../lib/db');
const storage = require('../../lib/storage');
const { notificar } = require('../../lib/mailer');
const { auditar } = require('../../lib/audit');
const { crearPendiente, cerrarPendientes } = require('../../core/pendientes');
const { validar } = require('./schemas');

const upload = multer({ dest: path.join(__dirname, '..', '..', 'tmp_uploads'), limits: { fileSize: 100 * 1024 * 1024 } });

const router = express.Router();

// Un gestor ve todas las solicitudes; cualquier otra persona ve solo las suyas
// (las que pidió y las que le toca atender).
//
// Para quien NO es gestor —la mayoría de la plantilla— se resuelve con dos
// consultas de igualdad en lugar de leer la colección: Firestore no combina un
// OR entre campos distintos en una sola consulta, pero dos consultas indexadas
// cuestan lo que devuelven, mientras que el scan costaba la colección completa
// en cada visita a la pantalla.
router.get('/', async (req, res) => {
  try {
    const esGestor = ['admin', 'lider'].includes(req.usuario.rol);

    let rows;
    if (esGestor) {
      rows = await col('solicitudes').list(null, {
        motivo: 'DEUDA: la bandeja del gestor no está paginada (ver docs/POLITICA-COSTOS.md)'
      });
    } else {
      const [mias, asignadas] = await Promise.all([
        col('solicitudes').query({ solicitante: req.usuario.correo }),
        col('solicitudes').query({ responsable: req.usuario.correo })
      ]);
      // Una solicitud donde alguien es a la vez solicitante y responsable sale
      // en las dos consultas: se deduplica por id.
      rows = [...new Map([...mias, ...asignadas].map((s) => [s.id, s])).values()];
    }

    rows.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    res.json(rows);
  } catch (e) {
    console.error('[solicitudes]', e);
    res.status(500).json({ error: 'Error consultando solicitudes' });
  }
});

router.post('/', validar('solicitud'), async (req, res) => {
  try {
    const s = await col('solicitudes').insert({
      ...req.body,
      solicitante: req.usuario.correo,
      estado: 'abierta',
      adjunto: null,
      respuesta: null
    });
    // El pendiente y el correo nombran el documento solicitado: "atender una
    // solicitud de creación" sin decir de qué obliga a abrir la pantalla para
    // saber si le corresponde.
    await crearPendiente({
      correo: s.responsable, modulo: 'documental', tipo: 'solicitud',
      titulo: `Atender solicitud de ${s.tipo}: ${s.nombreDocumento} (${req.usuario.correo})`,
      refTipo: 'solicitud', refId: s.id, ruta: '/documental/solicitudes'
    });
    await notificar({
      para: s.responsable,
      asunto: `la plataforma: solicitud de ${s.tipo} — ${s.nombreDocumento}`,
      cuerpo: `${req.usuario.correo} solicitó ${s.tipo} del documento "${s.nombreDocumento}": ${s.descripcion}`,
      modulo: 'documental', refId: s.id,
      etiqueta: 'Solicitud recibida', ruta: '/documental/solicitudes'
    });
    await auditar(req.usuario.correo, 'documental.solicitud.crear', `solicitudes/${s.id}`, { tipo: s.tipo });
    res.status(201).json(s);
  } catch (e) {
    console.error('[solicitudes]', e);
    res.status(500).json({ error: 'Error creando solicitud' });
  }
});

// Adjuntar borrador a la solicitud.
router.post('/:id/adjunto', upload.single('archivo'), async (req, res) => {
  try {
    const s = await col('solicitudes').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Solicitud no existe' });
    if (s.solicitante !== req.usuario.correo) return res.status(403).json({ error: 'Solo el solicitante adjunta borradores' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const nombre = storage.nombreCliente(req.file.originalname);
    const key = storage.buildKey('documental-solicitudes', s.id, 1, nombre);
    await storage.saveFile(req.file.path, key, { contentType: req.file.mimetype });
    const actualizado = await col('solicitudes').update(s.id, { adjunto: { key, nombre } });
    res.json(actualizado);
  } catch (e) {
    console.error('[solicitudes]', e);
    res.status(500).json({ error: 'Error adjuntando archivo' });
  }
});

router.get('/:id/adjunto', async (req, res) => {
  try {
    const s = await col('solicitudes').get(req.params.id);
    if (!s || !s.adjunto) return res.status(404).json({ error: 'Adjunto no existe' });
    // Misma frontera que el listado: el borrador adjunto lo ve quien lo pidió,
    // quien lo atiende o un gestor. Antes cualquiera con el módulo podía abrir
    // el adjunto de una solicitud ajena conociendo el id (auditoría 2026-11-04).
    const esGestor = ['admin', 'lider'].includes(req.usuario.rol);
    if (!esGestor && s.solicitante !== req.usuario.correo && s.responsable !== req.usuario.correo) {
      return res.status(404).json({ error: 'Adjunto no existe' });
    }
    if (!await storage.exists(s.adjunto.key)) {
      return res.status(404).json({ error: 'Archivo no encontrado en almacenamiento' });
    }
    await storage.servir(res, s.adjunto.key, { req, nombre: s.adjunto.nombre, inline: true });
  } catch (e) {
    // storage.servir lanza 403 cuando la consulta no viene del visor de la app.
    const status = e.status || 500;
    if (status === 500) console.error('[solicitudes]', e);
    res.status(status).json({ error: status === 500 ? 'Error descargando adjunto' : e.message });
  }
});

router.post('/:id/responder', validar('respuestaSolicitud'), async (req, res) => {
  try {
    const s = await col('solicitudes').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Solicitud no existe' });
    if (s.estado !== 'abierta') return res.status(409).json({ error: 'La solicitud ya fue atendida' });
    if (s.responsable !== req.usuario.correo && req.usuario.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo el responsable atiende la solicitud' });
    }
    const actualizado = await col('solicitudes').update(s.id, {
      estado: req.body.decision, respuesta: req.body.respuesta || null, atendidaPor: req.usuario.correo
    });
    await cerrarPendientes({ refTipo: 'solicitud', refId: s.id });
    await notificar({
      para: s.solicitante,
      asunto: `la plataforma: su solicitud sobre "${s.nombreDocumento || 'un documento'}" fue ${req.body.decision}`,
      cuerpo: req.body.respuesta || '(sin comentario)',
      modulo: 'documental', refId: s.id,
      etiqueta: 'Solicitud atendida', ruta: '/documental/solicitudes'
    });
    await auditar(req.usuario.correo, `documental.solicitud.${req.body.decision}`, `solicitudes/${s.id}`);
    res.json(actualizado);
  } catch (e) {
    console.error('[solicitudes]', e);
    res.status(500).json({ error: 'Error respondiendo solicitud' });
  }
});

module.exports = { router };
