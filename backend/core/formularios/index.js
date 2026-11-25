// MÓDULO DE PARAMETRIZACIÓN DE FORMULARIOS — /api/formularios/*
//
// Lectura: cualquier usuario autenticado (el frontend necesita la definición
// para pintar el formulario de documento).
// Escritura: quien tenga el recurso `sgc.configuracion`.
const express = require('express');
const { auditar } = require('../../lib/audit');
const { exige } = require('../../lib/permisos');
const def = require('./definicion');
const registro = require('../config/registro');

const FORMULARIOS = def.IDS_FORMULARIO;

const router = express.Router();

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[formularios]', e);
      res.status(status).json({ error: e.message || 'Error interno', details: e.details });
    }
  };
}

function validarId(req, res, next) {
  if (!FORMULARIOS.includes(req.params.id)) {
    return res.status(404).json({ error: `Formulario desconocido: "${req.params.id}"` });
  }
  next();
}

// Metadatos del motor: tipos de campo, catálogos disponibles y los formularios
// que existen, cada uno con SUS secciones y el módulo al que pertenece. Lo consume
// el panel para agrupar por módulo y armar el constructor de campos.
//
// `modulos` viaja aquí también para que el panel pueda escribir "Mejoramiento
// Continuo" en lugar de "mejoramiento" sin mantener su propia tabla de nombres,
// y para poder listar los módulos que todavía no tienen formulario: un hueco
// visible es lo que evita que se olvide.
router.get('/metadatos', (req, res) => {
  res.json({
    tipos: def.TIPOS.map((t) => ({
      id: t,
      nombre: {
        texto: 'Texto corto', textoLargo: 'Texto largo', numero: 'Número', fecha: 'Fecha',
        booleano: 'Sí / No', seleccion: 'Lista (una opción)', seleccionMultiple: 'Lista (varias opciones)',
        catalogo: 'Catálogo (una opción)', catalogoMultiple: 'Catálogo (varias opciones)',
        etiquetas: 'Etiquetas libres'
      }[t] || t
    })),
    formularios: FORMULARIOS.map((id) => {
      const f = def.FORMULARIOS[id];
      return {
        id, nombre: f.nombre, modulo: f.modulo,
        descripcion: f.descripcion, secciones: f.secciones
      };
    }),
    modulos: registro.MODULOS,
    catalogos: def.CATALOGOS_DISPONIBLES
  });
});

router.get('/:id', validarId, manejar(async (req, res) => {
  res.json(await def.obtener(req.params.id));
}));

router.put('/:id', validarId, exige('sgc.configuracion'), manejar(async (req, res) => {
  const resultado = def.validarDefinicion(req.body || {}, req.params.id);
  if (!resultado.ok) {
    return res.status(400).json({ error: 'La definición no es válida', details: resultado.errores });
  }
  await def.guardar(req.params.id, resultado, req.usuario.correo);
  await auditar(req.usuario.correo, 'formularios.actualizar', `formularios/${req.params.id}`, {
    ajustes: resultado.ajustes.length,
    personalizados: resultado.personalizados.map((c) => c.clave)
  });
  res.json(await def.obtener(req.params.id));
}));

// Restablece el formulario a su definición de fábrica.
router.post('/:id/restablecer', validarId, exige('sgc.configuracion'), manejar(async (req, res) => {
  await def.guardar(req.params.id, { ajustes: [], personalizados: [] }, req.usuario.correo);
  await auditar(req.usuario.correo, 'formularios.restablecer', `formularios/${req.params.id}`);
  res.json(await def.obtener(req.params.id));
}));

module.exports = { router };
