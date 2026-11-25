// Ingreso sin login: la persona elige con quién entra (ver lib/sesion.js).
//
//   GET    /api/sesion/usuarios  → usuarios registrados que se pueden elegir
//   POST   /api/sesion           → { correo, clave? } usuario registrado
//                                  { nombre, correo? } visitante nuevo
//   DELETE /api/sesion           → cerrar la sesión
//
// Un usuario registrado puede tener una `clave` en el catálogo `usuarios`
// (Configuración › Usuarios). Si la tiene, hay que escribirla para entrar como
// él; si no, basta con elegirlo. Es el único freno disponible sin un login real:
// sirve para que un visitante no entre como administrador por curiosidad.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { col } = require('../lib/db');
const catalogos = require('../core/config/catalogos');
const empleados = require('../core/empleados');
const { emitirCookie, borrarCookie } = require('../lib/sesion');
const { auditar } = require('../lib/audit');
const claves = require('../lib/claves');

const router = express.Router();
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Freno ante un script que pruebe claves o cree visitantes en masa. Es por
// instancia; para una demostración basta.
const limite = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, validate: { trustProxy: false, xForwardedForHeader: false } });

function slug(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 40);
}

router.get('/usuarios', async (req, res) => {
  try {
    // Solo los sembrados o creados desde el panel: los visitantes que se
    // registraron solos no se ofrecen como opción (cada quien entra con su nombre).
    const filas = (await catalogos.leer('usuarios')).filter((u) => u.origen !== 'visitante');
    res.json(filas.map((u) => ({
      correo: u.correo, nombre: u.nombre, cargo: u.cargo || null, area: u.area || null,
      descripcion: u.descripcion || null, requiereClave: Boolean(u.clave)
    })));
  } catch (e) {
    console.error('[sesion]', e);
    res.status(500).json({ error: 'No se pudo leer la lista de usuarios' });
  }
});

router.post('/', limite, async (req, res) => {
  try {
    const body = req.body || {};
    const correoPedido = String(body.correo || '').trim().toLowerCase();

    if (correoPedido) {
      const usuario = (await catalogos.leer('usuarios')).find((u) => u.correo === correoPedido);
      if (usuario) {
        if (usuario.clave && !claves.verificar(body.clave, usuario.clave)) {
          return res.status(403).json({ error: 'La clave no es correcta' });
        }
        emitirCookie(res, usuario.correo);
        await auditar(usuario.correo, 'sesion.ingresar', `usuarios/${usuario.correo}`);
        return res.json({ correo: usuario.correo, nombre: usuario.nombre });
      }
    }

    // Visitante: cualquiera entra con su nombre, como colaborador sin accesos
    // especiales. Queda en el catálogo con origen `visitante`, para que su
    // nombre aparezca en la auditoría y en la marca de agua del visor.
    const nombre = String(body.nombre || '').trim().replace(/\s+/g, ' ');
    if (nombre.length < 3) return res.status(400).json({ error: 'Escriba su nombre para entrar como visitante' });
    let correo = correoPedido;
    if (correo && !CORREO_VALIDO.test(correo)) return res.status(400).json({ error: 'El correo no es válido' });
    if (!correo) correo = `${slug(nombre) || 'visitante'}@visitante.ibarra`;
    const existente = await col('usuarios').get(correo);
    if (existente && existente.origen !== 'visitante') {
      return res.status(403).json({ error: 'Ese correo pertenece a un usuario registrado: elíjalo en la lista' });
    }
    if (!existente) {
      await col('usuarios').insert({ id: correo, correo, nombre, cargo: 'Visitante', area: null, sedeId: 'ecu', origen: 'visitante', activo: true });
      catalogos.invalidar('usuarios');
      empleados.invalidar();
    }
    emitirCookie(res, correo);
    await auditar(correo, 'sesion.ingresar', `usuarios/${correo}`, { visitante: true, nombre });
    res.json({ correo, nombre });
  } catch (e) {
    console.error('[sesion]', e);
    res.status(500).json({ error: 'No se pudo iniciar la sesión' });
  }
});

router.delete('/', (req, res) => {
  borrarCookie(res);
  res.json({ ok: true });
});

module.exports = { router };
