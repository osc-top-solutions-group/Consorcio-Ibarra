// DIRECTORIO DE PERSONAS — servicio transversal.
//
// En el SGC original la identidad venía del directorio corporativo de Talento
// Humano (BigQuery) y el SGC no daba de alta usuarios. En esta instalación no
// hay directorio externo: las personas viven en el catálogo `usuarios`
// (Configuración › Usuarios), con nombre, cargo, área y sede. Los visitantes
// que entran por la pantalla de ingreso se agregan solos a ese catálogo.
//
// Todo lo demás (flujos por cargo, área o sede; audiencias; grupos; selector de
// personas) consume este servicio y no sabe de dónde salen los datos: la
// interfaz es la misma que tenía el directorio de BigQuery.
const express = require('express');
const catalogos = require('../config/catalogos');

function normalizar(u) {
  const correo = String(u.correo || u.id || '').trim().toLowerCase();
  return {
    id: correo,
    correo,
    nombre: u.nombre || correo,
    cargo: u.cargo || null,
    area: u.area || null,
    jefe: null,
    jefeId: null,
    foto: u.foto || null,
    paisCodigo: null,
    sedeId: u.sedeId || null
  };
}

// El catálogo ya viene cacheado y ordenado (core/config/catalogos).
async function listar() {
  const filas = await catalogos.leer('usuarios');
  return filas.map(normalizar).filter((e) => e.correo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

async function buscarPorCorreo(correo) {
  if (!correo) return null;
  const objetivo = String(correo).trim().toLowerCase();
  return (await listar()).find((e) => e.correo === objetivo) || null;
}

// No hay organigrama en el catálogo: nadie tiene jefe registrado.
async function jefeDe() {
  return null;
}

async function indice() {
  return new Map((await listar()).map((e) => [e.correo, e]));
}

function invalidar() {
  catalogos.invalidar('usuarios');
}

// ---------- Router ----------

const router = express.Router();

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error('[empleados]', e.message);
      res.status(503).json({ error: 'El directorio de personas no está disponible en este momento', detalle: e.message });
    }
  };
}

router.get('/', manejar(async (req, res) => {
  const { q, sedeId, area, limite } = req.query;
  let filas = await listar();
  if (q) {
    const t = String(q).toLowerCase();
    filas = filas.filter((e) =>
      e.nombre.toLowerCase().includes(t) || e.correo.includes(t) || (e.cargo || '').toLowerCase().includes(t));
  }
  if (sedeId) filas = filas.filter((e) => e.sedeId === sedeId);
  if (area) filas = filas.filter((e) => e.area === area);
  const tope = Math.min(Number(limite) || 50, 500);
  res.json({ total: filas.length, empleados: filas.slice(0, tope) });
}));

router.get('/dimensiones', manejar(async (req, res) => {
  const filas = await listar();
  const contar = (campo) => {
    const mapa = new Map();
    filas.forEach((e) => { const v = e[campo]; if (v) mapa.set(v, (mapa.get(v) || 0) + 1); });
    return [...mapa.entries()].map(([valor, total]) => ({ valor, total })).sort((a, b) => b.total - a.total);
  };
  res.json({ total: filas.length, areas: contar('area'), sedes: contar('sedeId'), cargos: contar('cargo') });
}));

router.get('/:correo/jefe', manejar(async (req, res) => {
  res.status(404).json({ error: 'La persona no tiene jefe registrado en el directorio' });
}));

router.get('/:correo', manejar(async (req, res) => {
  const empleado = await buscarPorCorreo(req.params.correo);
  if (!empleado) return res.status(404).json({ error: 'La persona no está en el directorio' });
  res.json(empleado);
}));

// La identidad se edita en el propio catálogo: no es externa.
function esExterno() { return false; }

module.exports = { router, listar, buscarPorCorreo, indice, invalidar, jefeDe, esExterno, FUENTE: 'usuarios' };
