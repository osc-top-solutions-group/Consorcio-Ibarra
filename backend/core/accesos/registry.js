// CATÁLOGO DE RECURSOS PROTEGIDOS DEL SGC.
//
// Principio de diseño (el mismo del panel de accesos de la Intranet):
//   **el catálogo vive en código, los titulares viven en Firestore.**
// El panel reparte accesos únicamente sobre los recursos declarados aquí; no
// puede inventar recursos nuevos ni cambiar el TIPO de control de uno existente.
// Eso hace imposible romper un módulo desde la interfaz.
//
// TIPOS DE CONTROL
//  - 'allowlist'       → binario: estás en la lista o no entras. Admite `abierto`.
//  - 'scope-sedes'     → los de `emails` ven TODAS las sedes; los de `scopes`
//                        solo las suyas. Quien no esté en ninguno ve su propia sede.
//  - 'scope-procesos'  → los de `emails` administran TODOS los procesos; los de
//                        `scopes` solo los que se les asignen.
//  - 'scope-areas'     → los de `emails` cubren TODAS las áreas del directorio;
//                        los de `scopes` solo las que se les asignen. Las áreas
//                        no son un catálogo propio: vienen del directorio de
//                        Talento Humano (BigQuery).
//  - 'scope-apps'      → los de `emails` cubren TODAS las aplicaciones; los de
//                        `scopes` solo las suyas. Las apps tampoco son catálogo
//                        propio: sus ids vienen de la fuente importada
//                        (dim_apps); el panel valida la forma (enteros) y las
//                        opciones las ofrece el módulo de seguridad.
//  - 'roles'           → mapa rol → correos.
//
// CAMPO `abrible`
//  Si es true, el recurso admite el interruptor "abierto a cualquier colaborador
//  autenticado". Se usa en lo que hoy es de consulta general.

const RECURSOS = [
  // ── Rol global ──────────────────────────────────────────────────────────
  {
    id: 'sgc.administrador',
    nombre: 'Administrador de la plataforma',
    grupo: 'Global',
    tipo: 'allowlist',
    abrible: false,
    sensible: true,
    advertencia: 'Un administrador de la plataforma ve y edita TODO: cualquier documento de cualquier ' +
      'sede, la configuración y los catálogos. Asigne este acceso con cuidado.',
    descripcion: 'Control total del sistema: todos los módulos, todos los procesos, todas las sedes.',
    origen: 'lib/permisos.js · esAdmin()'
  },
  {
    id: 'sgc.accesos',
    nombre: 'Administradores del panel de accesos',
    grupo: 'Global',
    tipo: 'allowlist',
    abrible: false,
    sensible: true,
    advertencia: 'Quien esté aquí puede repartir cualquier acceso de la plataforma, incluido el suyo.',
    descripcion: 'Quién puede entrar a este panel y repartir accesos.',
    origen: 'core/accesos'
  },
  {
    id: 'sgc.configuracion',
    nombre: 'Configuración y parametrización',
    grupo: 'Global',
    tipo: 'allowlist',
    abrible: false,
    descripcion: 'Catálogos (procesos, sedes, cargos, tipos), parámetros del sistema y ' +
      'definición de los campos de los formularios.',
    ruta: '/admin',
    origen: 'core/config · core/formularios'
  },

  // ── Módulo documental ───────────────────────────────────────────────────
  {
    id: 'modulo.documental',
    nombre: 'Gestión Documental · entrar al módulo',
    grupo: 'Gestión Documental',
    tipo: 'allowlist',
    abrible: true,
    descripcion: 'Quién puede consultar el listado maestro, el mapa de procesos y los documentos.',
    ruta: '/documental',
    origen: 'forms/documental'
  },
  {
    id: 'documental.crear',
    nombre: 'Gestión Documental · crear y elaborar documentos',
    grupo: 'Gestión Documental',
    tipo: 'scope-procesos',
    descripcion: 'Quién crea documentos, carga archivos y los envía a revisión o aprobación. ' +
      'Puede limitarse a procesos específicos (el rol de líder de proceso).',
    ruta: '/documental/documentos/nuevo',
    origen: 'lib/permisos.js · esLiderDe()'
  },
  {
    id: 'documental.ver-todas-sedes',
    nombre: 'Gestión Documental · visibilidad entre sedes',
    grupo: 'Gestión Documental',
    tipo: 'scope-sedes',
    descripcion: 'Por defecto cada colaborador solo ve los documentos locales de SU país. ' +
      'Aquí se define quién ve los de otras sedes: todas, o una lista específica.',
    origen: 'forms/documental · visiblePorSede()'
  },
  {
    id: 'documental.externos',
    nombre: 'Gestión Documental · documentos externos',
    grupo: 'Gestión Documental',
    tipo: 'allowlist',
    abrible: false,
    descripcion: 'Quién registra y actualiza los documentos de clientes, proveedores y entes externos.',
    ruta: '/documental/externos',
    origen: 'forms/documental/externos.js'
  },
  {
    id: 'documental.glosario',
    nombre: 'Gestión Documental · editar el glosario',
    grupo: 'Gestión Documental',
    tipo: 'allowlist',
    abrible: false,
    descripcion: 'Quién agrega o modifica las definiciones del glosario.',
    ruta: '/documental/glosario',
    origen: 'core/config · definiciones'
  },
  {
    id: 'documental.administrar',
    nombre: 'Gestión Documental · administrar el módulo (acceso total)',
    grupo: 'Gestión Documental',
    tipo: 'allowlist',
    abrible: false,
    sensible: true,
    administraGrupo: true,
    advertencia: 'Quien esté aquí tiene TODOS los permisos del módulo de Gestión Documental, incluidos ' +
      'los que se agreguen en el futuro, sin necesidad de repartirlos uno a uno. Administra los documentos de TODOS los procesos y ve los de todas las sedes.',
    descripcion: 'Dueño del proceso / administrador del módulo: equivale a tener todos los recursos ' +
      'de este grupo. No da acceso a otros módulos ni a la configuración global.',
    origen: 'core/accesos/engine.js · ADMIN_DE_MODULO'
  },
];

// ADMINISTRADORES POR MÓDULO.
//
// Regla del SGC (2026-09-16): cada módulo tiene exactamente UN recurso con
// `administraGrupo: true`. Quien esté en él tiene todos los recursos del mismo
// `grupo` —los de hoy y los que se declaren después— sin repartirlos uno a uno.
// Es el "dueño del proceso": acceso total a su módulo, sin darle el SGC entero.
// El panel de accesos los muestra en su propia pestaña.
//
// La verificación de abajo hace imposible olvidarlo: un grupo nuevo sin su
// administrador (o con dos) no arranca. Los grupos globales quedan fuera porque
// su dueño es `sgc.administrador`.
const GRUPOS_SIN_ADMINISTRADOR = ['Global'];
const ADMINISTRADORES = RECURSOS.filter((r) => r.administraGrupo);

const POR_ID = new Map(RECURSOS.map((r) => [r.id, r]));

const getRecurso = (id) => POR_ID.get(id) || null;

// Verificación de integridad al cargar: un error aquí es un bug, no un dato malo.
const TIPOS = ['allowlist', 'scope-sedes', 'scope-procesos', 'scope-areas', 'scope-apps', 'roles'];
for (const r of RECURSOS) {
  if (!TIPOS.includes(r.tipo)) {
    throw new Error(`[accesos/registry] "${r.id}" declara un tipo inválido: ${r.tipo}`);
  }
  if (r.abrible && !['allowlist', 'scope-sedes'].includes(r.tipo)) {
    throw new Error(`[accesos/registry] "${r.id}" no puede ser abrible siendo de tipo ${r.tipo}`);
  }
}

const GRUPOS = [...new Set(RECURSOS.map((r) => r.grupo))];

for (const grupo of GRUPOS) {
  if (GRUPOS_SIN_ADMINISTRADOR.includes(grupo)) continue;
  const admins = ADMINISTRADORES.filter((r) => r.grupo === grupo);
  if (admins.length !== 1) {
    throw new Error(`[accesos/registry] el grupo "${grupo}" debe tener exactamente un recurso con ` +
      `administraGrupo: true (tiene ${admins.length}). Todo módulo lleva su "{modulo}.administrar".`);
  }
  if (admins[0].tipo !== 'allowlist' || admins[0].abrible) {
    throw new Error(`[accesos/registry] "${admins[0].id}" debe ser allowlist y no abrible`);
  }
}

// El administrador de un grupo cubre este recurso?
function administradorDe(recursoId) {
  const r = getRecurso(recursoId);
  if (!r || r.administraGrupo) return null;
  return ADMINISTRADORES.find((a) => a.grupo === r.grupo) || null;
}

module.exports = { RECURSOS, GRUPOS, TIPOS, ADMINISTRADORES, getRecurso, administradorDe };
