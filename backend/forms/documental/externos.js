// Documentos externos (de proveedores, clientes o entes normativos) que
// impactan la operación: se controlan con metadatos (ID, nombre, archivo/URL,
// tipo, versión y fecha de implementación) según requisito ISO.
const express = require('express');
const path = require('path');
const multer = require('multer');
const { col } = require('../../lib/db');
const storage = require('../../lib/storage');
const { puede } = require('../../lib/permisos');
const { auditar } = require('../../lib/audit');
const { validar } = require('./schemas');

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'tmp_uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const router = express.Router();

const SIN_ACCESO = 'No tiene el acceso de gestión de documentos externos. ' +
  'Un administrador puede otorgarlo en Gestión de Accesos.';

// El acceso se reparte desde el panel: recurso `documental.externos`.
function puedeGestionar(usuario) {
  return puede(usuario, 'documental.externos');
}

function exigirGestion(req, res, next) {
  if (!puedeGestionar(req.usuario)) return res.status(403).json({ error: SIN_ACCESO });
  next();
}

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[externos]', e);
      res.status(status).json({ error: e.message || 'Error interno' });
    }
  };
}

// La consulta queda abierta a quien ya entró al módulo documental.
//
// Lectura completa declarada: los documentos externos son normas, contratos y
// anexos de terceros, del orden de cientos, y el filtro `activo !== false`
// incluye los registros sin el campo (los anteriores a que existiera), que
// Firestore no puede expresar como consulta. Si esta colección pasa de unos
// miles hay que paginarla como el listado maestro.
router.get('/', manejar(async (req, res) => {
  const rows = await col('documentos_externos').list((r) => r.activo !== false, {
    motivo: 'colección acotada (cientos de registros) y filtro sobre campo ausente'
  });
  rows.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  res.json(rows);
}));

router.post('/', exigirGestion, validar('externo'), manejar(async (req, res) => {
  const row = await col('documentos_externos').insert({
    ...req.body, archivo: null, activo: true, createdBy: req.usuario.correo
  });
  await auditar(req.usuario.correo, 'documental.externo.crear', `documentos_externos/${row.id}`, { nombre: row.nombre });
  res.status(201).json(row);
}));

router.post('/:id/archivo', exigirGestion, upload.single('archivo'), manejar(async (req, res) => {
  const row = await col('documentos_externos').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'El documento externo no existe' });
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

  const nombre = storage.nombreCliente(req.file.originalname);
  const key = storage.buildKey('documental-externos', row.id, 1, nombre);
  await storage.saveFile(req.file.path, key, { contentType: req.file.mimetype });
  const actualizado = await col('documentos_externos').update(row.id, {
    archivo: { key, nombre, tamano: req.file.size },
    updatedBy: req.usuario.correo
  });
  await auditar(req.usuario.correo, 'documental.externo.archivo', `documentos_externos/${row.id}`);
  res.json(actualizado);
}));

router.get('/:id/archivo', manejar(async (req, res) => {
  const row = await col('documentos_externos').get(req.params.id);
  if (!row || !row.archivo) return res.status(404).json({ error: 'El archivo no existe' });
  if (!await storage.exists(row.archivo.key)) {
    return res.status(404).json({ error: 'Archivo no encontrado en almacenamiento' });
  }
  await storage.servir(res, row.archivo.key, { req, nombre: row.archivo.nombre, inline: true });
}));

router.put('/:id', exigirGestion, validar('externo'), manejar(async (req, res) => {
  const row = await col('documentos_externos').update(req.params.id, {
    ...req.body, updatedBy: req.usuario.correo
  });
  await auditar(req.usuario.correo, 'documental.externo.editar', `documentos_externos/${req.params.id}`);
  res.json(row);
}));

// Inactivación lógica: nada se borra físicamente (trazabilidad ISO).
router.delete('/:id', exigirGestion, manejar(async (req, res) => {
  const row = await col('documentos_externos').update(req.params.id, {
    activo: false, updatedBy: req.usuario.correo
  });
  await auditar(req.usuario.correo, 'documental.externo.inactivar', `documentos_externos/${req.params.id}`);
  res.json(row);
}));

module.exports = { router };
