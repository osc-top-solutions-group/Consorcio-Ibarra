// Prepara en la raíz de DESARROLLO lo que las pruebas end-to-end dan por
// sentado: las personas con sus roles, el proceso `geti` con sus subprocesos y
// las sedes `col` y `bol`. Las suites nacieron en el SGC original, donde esa
// gente y esa estructura existían de verdad (directorio corporativo y seed);
// aquí se recrean como datos de prueba para no reescribir 2.000 verificaciones.
//
//   node pruebas/preparar.js      (con el backend apagado o encendido; es idempotente)
//
// Nunca corre sobre la raíz `sgc` (la demostración).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { col, RAIZ } = require('../lib/db');

if (RAIZ === 'sgc') {
  console.error('ABORTADO: SGC_ROOT apunta a la raíz de la demostración "sgc". Use sgc_dev.');
  process.exit(1);
}

const ADMIN = 'cristian.moreno@ejemplo.com';
const LIDERES = ['javier.correa@ejemplo.com', 'fidel.urrea@ejemplo.com'];

const USUARIOS = [
  { correo: ADMIN, nombre: 'Cristian Moreno', cargo: 'Administrador', area: 'TICS', sedeId: 'col' },
  { correo: 'javier.correa@ejemplo.com', nombre: 'Javier Correa', cargo: 'Líder GETI', area: 'TICS', sedeId: 'col' },
  { correo: 'fidel.urrea@ejemplo.com', nombre: 'Fidel Urrea', cargo: 'Líder GETI', area: 'TICS', sedeId: 'col' },
  { correo: 'juan.beleno@ejemplo.com', nombre: 'Juan Beleño', cargo: 'Analista', area: 'OPERACIONES', sedeId: 'col' },
  { correo: 'alan.chavez@ejemplo.com', nombre: 'Alan Chávez', cargo: 'Analista', area: 'OPERACIONES', sedeId: 'bol' },
  { correo: 'hernando.castellanos@ejemplo.com', nombre: 'Hernando (pruebas)', cargo: 'Administrador', area: 'HSEQ', sedeId: 'col' }
];

const PROCESOS = [
  {
    id: 'geti', codigo: 'GETI', nombre: 'Gestión de Tecnologías de la Información (pruebas)', tipo: 'apoyo', orden: 9,
    subprocesos: [
      { id: 'dss', codigo: 'DSS', nombre: 'Desarrollo de Software y Soluciones' },
      { id: 'eti', codigo: 'ETI', nombre: 'Estrategia y Seguridad de TI' },
      { id: 'cst', codigo: 'CST', nombre: 'Centro de Soporte Técnico' }
    ]
  }
];

const SEDES = [
  ['col', 'COL', 'Colombia', 'America/Bogota'],
  ['bol', 'BOL', 'Bolivia', 'America/La_Paz'],
  ['mex', 'MEX', 'México', 'America/Mexico_City']
];

const GRUPOS = [
  { id: 'tics', nombre: 'TICS', regla: { tipo: 'area', valor: 'TICS' } },
  { id: 'hseq', nombre: 'HSEQ', regla: { tipo: 'area', valor: 'HSEQ' } }
];

async function upsert(coleccion, id, datos) {
  const actual = await col(coleccion).get(id);
  if (actual) await col(coleccion).update(id, { ...datos, activo: true });
  else await col(coleccion).insert({ id, ...datos, activo: true });
}

async function agregarTitulares(recursoId, correos, scopes = {}) {
  const actual = (await col('accesos').get(recursoId)) || { emails: [], scopes: {}, roles: {}, abierto: false };
  const emails = [...new Set([...(actual.emails || []), ...correos])];
  await col('accesos').insert({
    id: recursoId, emails, scopes: { ...(actual.scopes || {}), ...scopes }, roles: actual.roles || {},
    abierto: actual.abierto === true, updatedAt: new Date().toISOString(), updatedBy: 'pruebas/preparar'
  });
}

(async () => {
  console.log(`Preparando datos de prueba en la raíz "${RAIZ}"`);
  for (const u of USUARIOS) await upsert('usuarios', u.correo, u);
  for (const p of PROCESOS) await upsert('procesos', p.id, p);
  for (const [id, codigo, nombre, zonaHoraria] of SEDES) await upsert('sedes', id, { codigo, nombre, pais: nombre, zonaHoraria, moneda: 'USD' });
  for (const g of GRUPOS) await upsert('grupos', g.id, g);
  for (const r of ['sgc.administrador', 'sgc.accesos', 'sgc.configuracion', 'documental.externos', 'documental.glosario', 'documental.ver-todas-sedes']) {
    await agregarTitulares(r, [ADMIN, 'hernando.castellanos@ejemplo.com']);
  }
  await agregarTitulares('documental.crear', [], Object.fromEntries(LIDERES.map((c) => [c, { procesos: ['geti'] }])));
  console.log('Listo: usuarios, proceso GETI (DSS/ETI/CST), sedes COL/BOL/MEX, grupos y accesos de prueba.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
