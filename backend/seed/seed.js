// Seed del Gestor Documental sobre Firestore: catálogos base, usuarios de
// demostración y accesos de arranque.
//
//   npm run seed                      → catálogos, usuarios y accesos
//   npm run seed -- --force           → re-siembra catálogos aunque ya existan documentos
//
// Es idempotente: nunca duplica un registro existente ni pisa un acceso que ya
// se haya cambiado desde el panel. Los procesos, sedes y usuarios de este
// archivo son los de ARRANQUE de la demostración: todo se edita después desde
// Configuración (catálogos) y Gestión de Accesos sin tocar código.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { col, RAIZ, PROJECT_ID } = require('../lib/db');
const REGISTRY = require('../core/accesos/registry');
const { ZONA_POR_SEDE } = require('../lib/zonasHorarias');

const FORZAR = process.argv.includes('--force');

// Mapa de procesos de arranque. La sigla queda embebida en el código de cada
// documento (p. ej. GCA-PRO-1-GLO), así que conviene fijar la estructura real
// desde el panel ANTES de cargar documentos; estos son marcadores razonables
// para una entidad municipal y se pueden editar o inactivar.
// Cadena de valor: los grupos en que se clasifica cada proceso. Es un catálogo
// (Configuración › Global › Cadena de valor): el municipio lo ajusta sin código.
const TIPOS_PROCESO = [
  ['estrategico', 'ESTRATEGICO', 'Procesos Estratégicos', 'Estratégicos', '1'],
  ['operativo', 'OPERATIVO', 'Procesos Operativos', 'Operativos', '2'],
  ['apoyo', 'APOYO', 'Procesos de Apoyo', 'Apoyo', '3'],
  ['asesoria', 'ASESORIA', 'Procesos de Asesoría', 'Asesoría', '4']
];

const PROCESOS = [
  { id: 'dir', codigo: 'DIR', nombre: 'Direccionamiento Estratégico', tipo: 'estrategico', orden: 1, subprocesos: [] },
  { id: 'gca', codigo: 'GCA', nombre: 'Gestión de Calidad', tipo: 'estrategico', orden: 2, subprocesos: [] },
  { id: 'gsc', codigo: 'GSC', nombre: 'Gestión de Servicios al Ciudadano', tipo: 'operativo', orden: 1, subprocesos: [] },
  { id: 'gop', codigo: 'GOP', nombre: 'Gestión de Obras y Proyectos', tipo: 'operativo', orden: 2, subprocesos: [] },
  { id: 'gaj', codigo: 'GAJ', nombre: 'Gestión de Asesoría Jurídica', tipo: 'asesoria', orden: 1, subprocesos: [] },
  { id: 'gth', codigo: 'GTH', nombre: 'Gestión de Talento Humano', tipo: 'apoyo', orden: 1, subprocesos: [] },
  { id: 'gaf', codigo: 'GAF', nombre: 'Gestión Administrativa y Financiera', tipo: 'apoyo', orden: 2, subprocesos: [] },
  {
    id: 'gti', codigo: 'GTI', nombre: 'Gestión de Tecnologías de la Información', tipo: 'apoyo', orden: 3,
    subprocesos: [{ id: 'sop', codigo: 'SOP', nombre: 'Soporte Técnico' }]
  }
];

// `permiteOriginal` = el archivo editable se puede descargar (caso "formato").
const TIPOS = [
  ['POL', 'Política', false], ['MAN', 'Manual', false], ['PRO', 'Procedimiento', false],
  ['INT', 'Instructivo', false], ['FOR', 'Formato', true], ['FLU', 'Flujo de proceso', false],
  ['PLN', 'Plan', false], ['PRG', 'Programa', false], ['PTL', 'Protocolo', false],
  ['RGL', 'Reglamento', false], ['CAR', 'Caracterización', false], ['EST', 'Estándar', false],
  ['INF', 'Informe', false], ['ORG', 'Organigrama', false]
];

// El `codigo` alimenta el último segmento del código documental cuando el
// alcance es específico de una sede (p. ej. GCA-PRO-3-ECU).
const SEDES = [
  ['ecu', 'ECU', 'Ecuador']
];

const NORMAS = [
  ['iso9001', 'ISO 9001:2015', 'Sistemas de gestión de la calidad'],
  ['iso27001', 'ISO 27001:2022', 'Seguridad de la información'],
  ['iso14001', 'ISO 14001:2015', 'Gestión ambiental'],
  ['iso45001', 'ISO 45001:2018', 'Seguridad y salud en el trabajo']
];

// Grupos para asignar flujos sin listar correos uno a uno. Sus integrantes se
// resuelven contra el catálogo de usuarios (área, cargo, sede) en el momento
// del envío, así que un cambio de personal no rompe los flujos configurados.
const GRUPOS = [
  { id: 'calidad', nombre: 'Equipo de Calidad', regla: { tipo: 'area', valor: 'Calidad' } },
  { id: 'direccion', nombre: 'Dirección', regla: { tipo: 'area', valor: 'Dirección' } },
  { id: 'tecnologia', nombre: 'Tecnología', regla: { tipo: 'area', valor: 'Tecnología' } }
];

const PLANTILLAS = [
  ['plantilla-politica', 'Plantilla institucional de Política', 'pol'],
  ['plantilla-manual', 'Plantilla institucional de Manual', 'man'],
  ['plantilla-procedimiento', 'Plantilla institucional de Procedimiento', 'pro'],
  ['plantilla-instructivo', 'Plantilla institucional de Instructivo', 'int'],
  ['plantilla-formato', 'Plantilla institucional de Formato', 'for'],
  ['plantilla-caracterizacion', 'Plantilla de Caracterización de proceso', 'car'],
  ['plantilla-plan', 'Plantilla institucional de Plan', 'pln'],
  ['plantilla-protocolo', 'Plantilla institucional de Protocolo', 'ptl']
];

const DEFINICIONES = [
  ['calidad', 'Calidad', 'Grado en el que un conjunto de características inherentes de un objeto satisface los requisitos.', 'ISO 9000:2015'],
  ['sgc', 'Sistema de Gestión de Calidad', 'Parte de un sistema de gestión relacionada con la calidad, que incluye procesos, recursos y responsabilidades para lograr los objetivos de calidad.', 'ISO 9000:2015'],
  ['proceso', 'Proceso', 'Conjunto de actividades mutuamente relacionadas que utilizan las entradas para proporcionar un resultado previsto.', 'ISO 9000:2015'],
  ['procedimiento', 'Procedimiento', 'Forma especificada de llevar a cabo una actividad o un proceso.', 'ISO 9000:2015'],
  ['documento', 'Documento', 'Información y el medio en el que está contenida. Establece cómo se debe actuar.', 'ISO 9000:2015'],
  ['registro', 'Registro', 'Documento que presenta resultados obtenidos o proporciona evidencia de actividades realizadas.', 'ISO 9000:2015'],
  ['no-conformidad', 'No conformidad', 'Incumplimiento de un requisito.', 'ISO 9000:2015'],
  ['accion-correctiva', 'Acción correctiva', 'Acción para eliminar la causa de una no conformidad y evitar que vuelva a ocurrir.', 'ISO 9000:2015'],
  ['confidencialidad', 'Confidencialidad', 'Propiedad por la que la información no se pone a disposición ni se revela a individuos, entidades o procesos no autorizados.', 'ISO 27001:2022'],
  ['control-cambios', 'Control de cambios', 'Registro de qué cambió en una nueva versión de un documento, por qué y quién lo autorizó.', 'Gestor Documental'],
  ['documento-obsoleto', 'Documento obsoleto', 'Versión que perdió vigencia al ser reemplazada por una nueva y que se conserva únicamente con fines de trazabilidad.', 'Gestor Documental']
];

// Parámetros del sistema. Solo los que lee este módulo.
const PARAMETROS = [
  ['diasAlertaRevision', 30, 'Días de anticipación con que el listado maestro alerta una revisión próxima'],
  ['mesesRevisionPorDefecto', 12, 'Meses hasta la próxima revisión cuando el documento no especifica otro valor'],
  ['diasMaximoPermisoDocumento', 90, 'Vigencia máxima (días) de un permiso excepcional de DESCARGA que otorga el líder del proceso; el administrador del módulo puede darlo indefinido'],
  ['sufijoGlobal', 'GLO', 'Último segmento del código para documentos de alcance global'],
  ['sufijoRegional', 'REG', 'Último segmento del código para documentos de alcance regional (varias sedes)'],
  ['exigirArchivoOriginal', true, 'Exige cargar el archivo editable (Word/Excel) además del PDF'],
  ['exigirSegregacionFunciones', true, 'Impide que quien elabora un documento figure como su revisor o aprobador'],
  ['extensionesOriginal', ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.vsd', '.vsdx', '.bpm', '.bpmn'], 'Extensiones aceptadas como archivo original editable (Office, Visio y modelos de proceso Bizagi .bpm / BPMN)'],
  ['diasPlazoDecision', 5, 'Días calendario que tiene un revisor o aprobador para decidir desde que se le convoca; al vencer se escala al elaborador'],
  ['diasFrecuenciaRecordatorio', 2, 'Cada cuántos días se recuerda a un revisor o aprobador su decisión pendiente'],
  ['modoPruebasModulos', '', 'MODO DE PRUEBAS: ids de módulo separados por coma cuyos correos salen SOLO a los correos autorizados. Vacío: ninguno en pruebas'],
  ['modoPruebasCorreos', '', 'MODO DE PRUEBAS: correos separados por coma a los que SÍ se les envía correo mientras su módulo está en pruebas'],
  ['modulosProximamente', [], 'Módulos que se muestran como «Próximamente» y cuya API queda cerrada. Vacío: todos abiertos']
];

// USUARIOS DE DEMOSTRACIÓN. No hay login: en la pantalla de ingreso se elige
// con quién entrar. Los permisos van abajo, en ACCESOS, por correo.
//
//   · Cristian y Hernando: administradores de la plataforma (todo), como en el
//     SGC original.
//   · Elue: administradora del módulo documental: revisa y aprueba documentos
//     de todos los procesos, documentos externos y glosario.
//   · Cualquier otra persona entra como visitante con su nombre, con los
//     permisos de un colaborador: consulta la documentación vigente.
//
// `clave` (opcional) obliga a escribirla para entrar como esa persona. Se
// edita desde Configuración › Usuarios.
const USUARIOS = [
  {
    correo: 'cristian.moreno@osctopsolutionsgroup.com', nombre: 'Cristian Moreno',
    cargo: 'Administrador de la plataforma', area: 'Tecnología', sedeId: 'ecu',
    descripcion: 'Administrador: configura catálogos, reparte accesos y elabora documentos.'
  },
  {
    correo: 'hernando.castellanos@osctopsolutionsgroup.com', nombre: 'Hernando Castellanos',
    cargo: 'Administrador de la plataforma', area: 'Calidad', sedeId: 'ecu',
    descripcion: 'Administrador: configura catálogos, reparte accesos y elabora documentos.'
  },
  {
    correo: 'elue.delahoz@osctopsolutionsgroup.com', nombre: 'Elue De La Hoz',
    cargo: 'Líder de Calidad', area: 'Calidad', sedeId: 'ecu',
    descripcion: 'Administra el módulo documental: revisa y aprueba los documentos de todos los procesos.'
  }
];

const ADMINISTRADORES = ['cristian.moreno@osctopsolutionsgroup.com', 'hernando.castellanos@osctopsolutionsgroup.com'];
const ADMIN_DOCUMENTAL = ['elue.delahoz@osctopsolutionsgroup.com'];

// Accesos de arranque. Se administran después desde /accesos sin tocar código;
// sembrar de nuevo no pisa un recurso que ya exista.
const ACCESOS = {
  'sgc.administrador': { emails: ADMINISTRADORES },
  'sgc.accesos': { emails: ADMINISTRADORES },
  'sgc.configuracion': { emails: ADMINISTRADORES },
  // Consulta abierta a cualquier persona que entre (visitantes incluidos).
  'modulo.documental': { abierto: true },
  // Dueña del módulo: todos los recursos de Gestión Documental, todos los procesos.
  'documental.administrar': { emails: ADMIN_DOCUMENTAL },
  'documental.crear': { emails: [], scopes: {} },
  'documental.externos': { emails: ADMINISTRADORES },
  'documental.glosario': { emails: ADMINISTRADORES },
  'documental.ver-todas-sedes': { emails: ADMINISTRADORES }
};

// Inserta solo si no existe un registro con ese id.
async function sembrar(coleccion, id, datos) {
  if (await col(coleccion).get(id)) return false;
  await col(coleccion).insert({ id, ...datos, activo: true });
  return true;
}

async function sembrarCatalogos() {
  const cuenta = {};
  const sumar = (k, ok) => { if (ok) cuenta[k] = (cuenta[k] || 0) + 1; };

  for (const [id, codigo, nombre, etiqueta, orden] of TIPOS_PROCESO) {
    sumar('tipos_proceso', await sembrar('tipos_proceso', id, { codigo, nombre, etiqueta, orden }));
  }
  for (const p of PROCESOS) sumar('procesos', await sembrar('procesos', p.id, p));
  // Migración: antes la cadena de valor era fija (estratégico, misional, apoyo)
  // y vivía en código. «Misional» pasa a «operativo» en los procesos ya sembrados.
  for (const p of await col('procesos').list((x) => x.tipo === 'misional')) {
    await col('procesos').update(p.id, { tipo: 'operativo' });
    console.log(`  migrado → proceso ${p.codigo}: misional → operativo`);
  }
  for (const [codigo, nombre, permiteOriginal] of TIPOS) {
    sumar('tipos_documento', await sembrar('tipos_documento', codigo.toLowerCase(), { codigo, nombre, permiteOriginal }));
  }
  for (const [id, codigo, nombre] of SEDES) {
    sumar('sedes', await sembrar('sedes', id, { codigo, nombre, pais: nombre, zonaHoraria: ZONA_POR_SEDE[id] || 'America/Guayaquil', moneda: 'USD' }));
  }
  for (const [id, nombre, descripcion] of NORMAS) sumar('normas', await sembrar('normas', id, { nombre, descripcion }));
  for (const g of GRUPOS) sumar('grupos', await sembrar('grupos', g.id, { nombre: g.nombre, regla: g.regla }));
  for (const [id, nombre, tipoId] of PLANTILLAS) {
    sumar('plantillas', await sembrar('plantillas', id, { nombre, tipoId, archivo: null }));
  }
  for (const [id, termino, definicion, fuente] of DEFINICIONES) {
    sumar('definiciones', await sembrar('definiciones', id, { termino, definicion, fuente }));
  }
  for (const [id, valor, descripcion] of PARAMETROS) {
    sumar('parametros', await sembrar('parametros', id, { valor, descripcion }));
  }
  for (const u of USUARIOS) sumar('usuarios', await sembrar('usuarios', u.correo, u));

  for (const r of REGISTRY.RECURSOS) {
    if (await col('accesos').get(r.id)) continue;
    const semilla = ACCESOS[r.id] || {};
    await col('accesos').insert({
      id: r.id,
      emails: semilla.emails || [],
      scopes: semilla.scopes || {},
      roles: semilla.roles || {},
      abierto: semilla.abierto === true,
      updatedAt: new Date().toISOString(),
      updatedBy: 'seed'
    });
    sumar('accesos', true);
  }

  const resumen = Object.entries(cuenta).map(([k, v]) => `${k}: ${v}`).join(' · ');
  console.log(resumen ? `  nuevos → ${resumen}` : '  todos los catálogos ya existían');

  const admins = await col('accesos').get('sgc.administrador');
  console.log(`\n  Administradores: ${(admins && admins.emails || []).join(', ') || 'NINGUNO'}`);
  const docu = await col('accesos').get('documental.administrar');
  console.log(`  Administran Gestión Documental: ${(docu && docu.emails || []).join(', ') || 'NINGUNO'}`);
  console.log('  Para cambiarlos: Gestión de Accesos en la aplicación.');
}

async function main() {
  console.log(`Seed del Gestor Documental · proyecto ${PROJECT_ID} · raíz Firestore "${RAIZ}"`);
  const existentes = await col('documentos').contar({});
  if (existentes > 0 && !FORZAR) {
    console.log(`\nYa hay ${existentes} documentos en "${RAIZ}": se completan solo los catálogos que falten.`);
  }
  await sembrarCatalogos();
  console.log('\nListo.');
}

main().catch((e) => {
  console.error('Seed falló:', e);
  process.exit(1);
});
