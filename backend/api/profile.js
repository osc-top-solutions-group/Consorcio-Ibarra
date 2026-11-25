// Perfil del usuario autenticado (el frontend lo consume en AuthContext).
// La identidad viene del directorio de empleados y los permisos del motor de
// accesos; aquí solo se expone lo que la interfaz necesita para pintarse.
const express = require('express');
const { modulosProximamente, puedePrevisualizar } = require('../core/config/modulos');

const router = express.Router();

router.get('/', async (req, res, next) => {
  const u = req.usuario;
  let proximamente = [];
  try { proximamente = await modulosProximamente(); } catch (e) { return next(e); }
  res.json({
    correo: u.correo,
    nombre: u.nombre,
    cargo: u.cargo,
    area: u.area,
    foto: u.foto,
    rol: u.rol,
    sedes: u.sedes || [],
    sedePropia: u.sedePropia || null,
    procesos: u.procesos || [],
    administraTodosLosProcesos: !!u.administraTodosLosProcesos,
    verTodasLasSedes: !!u.verTodasLasSedes,
    // Módulos que administra por completo (dueño del proceso).
    administraModulos: u.administraModulos || [],
    // El frontend oculta lo que no aplica; la autorización real se revalida
    // siempre en el backend.
    permisos: u.permisos || {},
    // Si es false, el correo autenticó por IAP pero no está en el directorio de
    // Talento Humano: la interfaz lo advierte porque no tendrá sede asignada.
    enDirectorio: !!u.enDirectorio,
    // Módulos cerrados por el parámetro `modulosProximamente`, con la marca de
    // si ESTA persona puede entrar igual (administrador global o del módulo).
    // El Home los pinta «Próximamente» y el Layout no deja abrir sus rutas.
    modulosProximamente: proximamente.map((id) => ({ id, previsualiza: puedePrevisualizar(u, id) }))
  });
});

module.exports = { router };
