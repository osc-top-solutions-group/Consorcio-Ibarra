// Capa de datos sobre Firestore (Native, us-central1, base `(default)`).
//
// Todo vive namespaced bajo una raíz propia (patrón heredado del SGC, donde la
// base era compartida con otra aplicación; aquí la base es propia pero la raíz
// sigue permitiendo separar desarrollo de producción sin tocar código):
//
//   {raiz}/{ambito}/{coleccion}/{docId}
//
//   sgc/core/procesos/{id}            sgc/documental/documentos/{id}
//   sgc/core/usuarios/{id}            sgc/documental/documentos_externos/{id}
//   sgc/core/pendientes/{id}          sgc/documental/solicitudes/{id}
//
// `SGC_ROOT` permite aislar el desarrollo local de producción (p. ej. `sgc_dev`)
// sin tocar código. En Cloud Run no se define y la raíz es `sgc`.
//
// Interfaz estable que consumen los módulos de negocio — no cambia si mañana
// se sustituye el motor:
//   col(nombre).get(id)      | .query(filtros)  | .page(opciones)  | .contar(filtros)
//              .insert(data) | .update(id, patch) | .removeHard(id)
//              .list(filterFn?)   ← RESTRINGIDO, ver abajo
//              .porPrefijo(campo, prefijo, opciones?)  ← consecutivos sugeridos
//              .recorrer(fn, filtros?)  ← exportaciones
//
// Regla de negocio: los documentos NO se borran físicamente (trazabilidad ISO);
// `removeHard` existe solo para catálogos de configuración.
//
// ═════════════════════════════════════════════════════════════════════════════
// POLÍTICA DE COSTO — LÉASE ANTES DE AGREGAR UNA CONSULTA
// ═════════════════════════════════════════════════════════════════════════════
// Firestore cobra POR DOCUMENTO LEÍDO ($0.06 / 100.000), no por documento
// devuelto. Un endpoint que trae la colección completa para mostrar 50 filas
// paga por la colección completa, y su costo crece para siempre con el volumen.
// A 7 millones de registros, un solo clic a un listado así cuesta USD 4,20.
//
// Por eso:
//   · `page()`    → todo listado que el usuario ve en pantalla. Cursor + límite.
//   · `contar()`  → todo total o contador de tarjeta. Usa agregación del servidor:
//                   1 read por cada 1.000 entradas de índice, no 1 por documento.
//   · `query()`   → filtros de igualdad que Firestore resuelve, resultado acotado.
//   · `recorrer()`→ exportaciones (CSV) y migraciones. Es la ÚNICA lectura
//                   completa legítima, porque el usuario pidió todo el conjunto.
//   · `list()`    → SOLO catálogos de configuración (procesos, tipos, sedes...),
//                   que son decenas de documentos y viven detrás de caché.
//
// `list()` está instrumentado: si una llamada supera SGC_MAX_LIST documentos
// avisa por consola con la traza, y con SGC_ESTRICTO=1 (activo en las pruebas)
// lanza. Es deliberado: el scan accidental se detecta en desarrollo, cuando la
// colección tiene 50 documentos y todavía no cuesta nada, no en producción con
// medio millón. Ver docs/POLITICA-COSTOS.md.
// ═════════════════════════════════════════════════════════════════════════════
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gad-ibarra-documental';
// Sin SGC_ROOT la raíz por defecto solo es la de producción EN Cloud Run. En una
// máquina local se cae a sgc_dev: un `node -e` o un script que carga db.js antes
// que dotenv no debe terminar leyendo (ni escribiendo) los datos reales.
const RAIZ = process.env.SGC_ROOT || (process.env.K_SERVICE ? 'sgc' : 'sgc_dev');

// COLECCIONES QUE list() PUEDE LEER COMPLETAS.
//
// Son los catálogos de configuración: decenas de documentos, cambian una vez al
// mes y viven detrás de caché. Leerlos enteros es correcto y barato.
//
// El control es por COLECCIÓN y no por tamaño a propósito. Un umbral de "avisa a
// partir de N documentos" no sirve de guardarraíl: en desarrollo la colección
// tiene tres registros, el aviso no aparece nunca, y el scan llega a producción
// intacto para empezar a costar cuando ya hay medio millón. Declarar qué es
// catálogo y qué no falla el mismo día en que alguien escribe la consulta.
//
// Al agregar un módulo se agregan aquí SOLO sus catálogos. Sus datos
// transaccionales (registros, hallazgos, acciones, mediciones, evidencias) no
// entran nunca: esos se leen con page(), contar(), query() o recorrer().
const CATALOGOS_LISTABLES = new Set([
  'procesos', 'tipos_documento', 'sedes', 'normas', 'cargos', 'grupos',
  'plantillas', 'definiciones', 'parametros', 'accesos', 'formularios',
  // Personas de esta instalación (reemplaza al directorio corporativo): decenas de filas.
  'usuarios'
]);

// Segunda red, para el catálogo que se desmadre: ninguno debería acercarse.
const MAX_LIST = Number(process.env.SGC_MAX_LIST || 500);

// Con SGC_ESTRICTO=1 la violación de la política lanza en lugar de avisar.
// Activo en `npm test`, para que un scan nuevo rompa la suite y no se discuta.
const ESTRICTO = process.env.SGC_ESTRICTO === '1';

// Tope para acotar una consulta «empieza por»: U+F8FF, el último punto de
// código del área de uso privado del plano básico, que es el truco estándar
// para cerrar el rango de un prefijo en Firestore. Se construye por código y no
// se escribe literal porque el carácter es INVISIBLE en el editor: pegado en el
// fuente parece que no hay nada y el primer copiar y pegar se lo lleva.
const TOPE_DE_PREFIJO = String.fromCharCode(0xf8ff);

// Tamaño de página por defecto y techo. El techo existe para que un cliente no
// pueda pedir `?limite=999999` y reintroducir el scan por la puerta de atrás.
const PAGINA_DEFECTO = 50;
const PAGINA_MAXIMA = 200;

// Contador de lecturas del proceso, expuesto en /api/health. Sirve para ver el
// costo de una pantalla concreta sin abrir la consola de facturación:
// se mira el contador, se navega, y se vuelve a mirar.
const lecturas = { total: 0, porColeccion: {} };

function contabilizar(coleccion, cantidad) {
  lecturas.total += cantidad;
  lecturas.porColeccion[coleccion] = (lecturas.porColeccion[coleccion] || 0) + cantidad;
}

// Ámbito (subcolección de primer nivel) al que pertenece cada colección.
// Al agregar un módulo nuevo se registran aquí sus colecciones.
const AMBITOS = {
  // Transversales del SGC
  procesos: 'core',
  tipos_documento: 'core',
  sedes: 'core',
  normas: 'core',
  cargos: 'core',
  usuarios: 'core',
  grupos: 'core',
  usuarios: 'core',
  plantillas: 'core',
  definiciones: 'core',
  parametros: 'core',
  pendientes: 'core',
  notificaciones: 'core',
  auditoria: 'core',
  contadores: 'core',
  accesos: 'core',        // titulares de cada recurso protegido
  // Solicitudes de acceso a recursos con datos personales (2026-11-12): el
  // otorgamiento no aplica hasta que lo aprueba el director de Talento Humano.
  // Transaccional (una por solicitud, para siempre): query por estado; nunca list().
  solicitudes_acceso: 'core',
  formularios: 'core',    // definición de los campos parametrizables
  // Calendario de días no hábiles por país. Es `core` y no de equipos: hoy lo
  // consume el cronograma de mantenimiento, y cualquier módulo con fechas
  // comprometidas (capacitaciones, inspecciones, plazos de firma) lo necesita
  // igual. Decenas de filas por país y por año: catálogo, no transaccional.
  festivos: 'core',
  tipos_hallazgo: 'core',   // catálogo compartido: mejoramiento hoy; auditorías, SST mañana
  fuentes_hallazgo: 'core', // ídem: de dónde puede salir un hallazgo
  // Índice origen ↔ acción de mejoramiento (core/acciones). Una fila por acción
  // abierta desde otro módulo (un hallazgo de auditoría, mañana un indicador
  // fuera de meta): es lo que permite que auditorías muestre «MC-118 · en
  // ejecución» al lado de su hallazgo sin leer `hallazgos`, que es de
  // mejoramiento. Transaccional: se lee por igualdad (refId), nunca entero.
  acciones_origen: 'core',
  // Índice de CUSTODIOS PROVISIONALES (core/custodios). Soporte TI entrega el
  // equipo el día 1 y Talento Humano crea el perfil oficial días después; entre
  // los dos momentos el equipo ya está en manos de alguien que todavía no
  // existe en el sistema. Una fila por custodio provisional, con el correo
  // corporativo como punto de cruce.
  //
  // Vive en `core` y no en equipos porque es justo el dato que los DOS módulos
  // necesitan y ninguno puede leerle al otro: equipos lo escribe al entregar,
  // Talento Humano lo resuelve al crear el perfil, y equipos aplica el
  // resultado sobre su propia colección. Transaccional: se lee por igualdad
  // (correo, estado), nunca entero.
  custodios_provisionales: 'core',
  // Índice riesgo ↔ control del Anexo A (lo escribe forms/riesgos, lo lee la
  // SoA de seguridad): una fila por par, con `vigente` en lugar de borrado. Es
  // el mismo diseño que acciones_origen y por la misma razón: ninguno de los
  // dos módulos puede leer las colecciones del otro. Se lee por igualdad.
  riesgos_controles: 'core',
  // Módulo de gestión de riesgos (matriz del SIG, GPNE-PRO-7-GLO). Un riesgo
  // lleva EMBEBIDOS su historial de evaluaciones y su control de cambios
  // (pocas entradas al año; la ficha se lee con 1 lectura). Transaccional:
  // page(), query() por proceso y contar(); NUNCA entra a CATALOGOS_LISTABLES.
  riesgos: 'riesgos',
  clasificaciones_riesgo: 'riesgos',
  guia_vulnerabilidades: 'riesgos',
  guia_amenazas: 'riesgos',
  // Módulo documental
  documentos: 'documental',
  documentos_externos: 'documental',
  solicitudes: 'documental',
  // Módulo de mejoramiento continuo. Las causas, actividades y avances viven
  // EMBEBIDOS en el hallazgo (mismo patrón que versiones[] del documental): el
  // ciclo completo de una acción es un solo documento y se lee con 1 lectura.
  hallazgos: 'mejoramiento',
  // Módulo de seguridad de la información. La Declaración de Aplicabilidad es
  // UN documento por norma con los 93 controles embebidos (siempre se leen
  // juntos: 1 lectura por render); `soa_versiones` son sus snapshots
  // congelados, inmutables y de solo inserción. Ninguna es catálogo.
  soa: 'seguridad',
  soa_versiones: 'seguridad',
  // Inventario de activos de información (ISO 27001 5.9). Es transaccional
  // —crece con cada plataforma que la compañía adopte— así que NUNCA entra a
  // CATALOGOS_LISTABLES: se lista con page() y se exporta con recorrer().
  // Sus dos catálogos de clasificación sí son listables (arriba).
  activos_informacion: 'seguridad',
  tipos_activo: 'seguridad',
  alojamientos_activo: 'seguridad',
  // Matriz de roles y perfiles (ISO 27001 A.5.15/A.5.18). Las importaciones son
  // la evidencia de cada levantamiento (metadatos, no filas); las asignaciones
  // son UN documento por persona × aplicación (~1.500 hoy y crece con cada
  // recertificación): transaccionales, se leen con page() y contar(), nunca
  // entran a CATALOGOS_LISTABLES. La matriz cargo × aplicación es UN documento
  // vivo con las celdas embebidas (mismo patrón que la SoA) y sus versiones son
  // snapshots congelados de solo inserción.
  accesos_importaciones: 'seguridad',
  asignaciones_acceso: 'seguridad',
  // Estado de cada aplicación DENTRO de la matriz (retirada / en uso): un
  // documento por app retirada, con motivo y autor. La app y sus datos crudos
  // siguen viviendo en la fuente (dim_apps es de TICS); aquí solo se registra
  // la decisión de sacarla del ciclo de validación. Pocas filas, pero es
  // decisión transaccional con trazabilidad: no es catálogo listable.
  apps_estado: 'seguridad',
  matriz_roles: 'seguridad',
  matriz_roles_versiones: 'seguridad',
  // Catálogo de perfiles por aplicación: qué permite cada perfil (Manager,
  // Administrator…) documentado por el dueño de la app. Decenas de filas que
  // cambian poco: sí es listable.
  perfiles_aplicacion: 'seguridad',
  // Matriz de roles y perfiles v2 (docs/ANALISIS-MATRIZ-ROLES-V2.md): catálogo
  // de aplicaciones con dueño y administradores (catálogo), reglas SoD
  // (catálogo), observaciones de líderes sobre perfiles (transaccional) y la
  // BITÁCORA inmutable de eventos de acceso (append-only; además se copia a un
  // bucket de Cloud Logging con retención bloqueada, ver lib/audit.js).
  apps: 'seguridad',
  reglas_sod: 'seguridad',
  perfiles_observaciones: 'seguridad',
  accesos_eventos: 'seguridad',
  // Fases 2b–5 de la matriz v2: licencias por aplicación (catálogo), casos de
  // ajuste del cargo, campañas e ítems de recertificación, fotos diarias del
  // directorio para el ciclo laboral y resultados de conciliación con las
  // aplicaciones. Todos transaccionales salvo las licencias.
  licencias_aplicacion: 'seguridad',
  casos_cargo: 'seguridad',
  recertificaciones: 'seguridad',
  recertificacion_items: 'seguridad',
  directorio_fotos: 'seguridad',
  conciliaciones: 'seguridad',
  // Registro autorizado de accesos (fase 2 v2): un documento por persona ×
  // aplicación × perfil con su ciclo (propuesto → aprobado → vigente →
  // retirado). Transaccional, miles de filas: page(), contar(), query() por
  // igualdad (appId, correo, estado, etapa, area, jefeCorreo); nunca list().
  // Se llama `accesos_registro` porque `accesos` ya es la colección del panel
  // de permisos (core/accesos). `seguridad_config` guarda UN documento con
  // quién aprueba (líder de área o jefe directo); se lee por id.
  accesos_registro: 'seguridad',
  seguridad_config: 'seguridad',
  // Matrices RACI: UN documento vivo por especialidad (roles, fases, tareas y
  // celdas embebidos) + snapshots congelados. Las especialidades (Data y BI,
  // Desarrollo…) son un catálogo listable que agrupa áreas del directorio.
  raci: 'seguridad',
  raci_versiones: 'seguridad',
  especialidades: 'seguridad',
  // Módulo de indicadores. La ficha (con variables, fórmula y el historial de
  // metas embebidos) y las MEDICIONES por periodo son transaccionales: crecen
  // para siempre (una fila por indicador y mes) y NUNCA entran a
  // CATALOGOS_LISTABLES. Las mediciones se consultan por igualdad de
  // `indicadorId` (acotado por naturaleza) y su id es determinístico
  // ({indicadorId}_{fechaCorte}) para que alimentar dos veces no duplique.
  // Sus dos catálogos de clasificación sí son listables (arriba).
  indicadores: 'indicadores',
  mediciones: 'indicadores',
  tipos_indicador: 'indicadores',
  unidades_medida: 'indicadores',
  // Módulo de equipos. El equipo y su mantenimiento viven en COLECCIONES
  // SEPARADAS, al revés que las causas de un hallazgo o las versiones de un
  // documento: el cronograma se consulta POR FECHA sin saber de qué equipo es, y
  // embebido obligaría a leer el inventario completo para pintar un mes. Ninguna
  // de las dos es catálogo —crecen con cada equipo y con cada semestre—, así que
  // se listan con page() y se exportan con recorrer(). Las oficinas físicas sí.
  equipos: 'equipos',
  mantenimientos: 'equipos',
  ubicaciones_equipo: 'equipos',
  organizaciones_externas: 'equipos',
  // Módulo de expedientes y contratación (reconstrucción de los flujos de
  // Alfresco). Radicados, contratos, pólizas y vinculados son transaccionales
  // —crecen para siempre— y NUNCA entran a CATALOGOS_LISTABLES: se leen con
  // page(), query() por radicadoId (acotado por expediente) y contar(). El
  // visado, los anexos y la traza viven EMBEBIDOS en el contrato (patrón
  // versiones[]/actividades[]): la ficha completa se lee con pocas lecturas.
  // `tipos_expediente` (los flujos configurables), las categorías de radicado,
  // las cláusulas y las plantillas de contrato sí son catálogos listables.
  radicados: 'expedientes',
  // Oportunidades comerciales: transaccionales (crecen con cada Deal de Zoho),
  // nunca listables. Se consultan con page(), por zohoId (igualdad) en el sync,
  // y sus anexos/traza viven embebidos. Las secciones de anexos sí son catálogo.
  oportunidades: 'expedientes',
  secciones_oportunidad: 'expedientes',
  contratos: 'expedientes',
  polizas: 'expedientes',
  vinculados: 'expedientes',
  tipos_expediente: 'expedientes',
  categorias_radicado: 'expedientes',
  clausulas: 'expedientes',
  plantillas_contrato: 'expedientes',
  // Módulo de auditorías e inspecciones. La auditoría es UN documento con el
  // itinerario, los hallazgos y el informe final embebidos (patrón versiones[]):
  // el informe es un todo y se lee con una lectura. Los auditores son UN
  // documento por persona con id = correo (la hoja de vida: certificados,
  // competencias, horas), y las evaluaciones UN documento por auditoría ×
  // auditor, porque se consultan desde los dos lados. Las tres son
  // transaccionales y NUNCA entran a CATALOGOS_LISTABLES; los cuatro catálogos
  // de clasificación sí (arriba).
  auditorias: 'auditorias',
  auditores: 'auditorias',
  evaluaciones_auditor: 'auditorias',
  tipos_auditoria: 'auditorias',
  tipos_auditor: 'auditorias',
  competencias_auditor: 'auditorias',
  criterios_evaluacion_auditor: 'auditorias',
  // Módulo HSE (SST + ambiente). La investigación de un accidente es UN
  // documento con las diez secciones del formato de la Resolución 1401
  // embebidas: es el artefacto que se remite a la ARL y se lee entero cada vez
  // que se abre la ficha. Transaccional —una fila por evento, para siempre— y
  // NUNCA entra a CATALOGOS_LISTABLES: se lista con page(), se cuenta con
  // contar() y se exporta con recorrer().
  //
  // Las colecciones de las fases siguientes (elementos_hseq, kits_hseq,
  // inspecciones_hseq, matrices_peligro/peligros, matrices_ambiental/
  // aspectos_ambientales, requisitos_legales, profesiogramas, capacitaciones)
  // se registran aquí cuando entren; las CABECERAS de matriz serán las únicas
  // listables. Ver docs/ANALISIS-HSEQ.md §11.
  investigaciones: 'hseq',
  // EPS, ARL y AFP con su código de la Superintendencia. Sí es catálogo: son
  // decenas, cambian poco y son distintas por país. Lo que NO es catálogo son
  // las tablas codificadas de la Resolución 1401 (tipo de lesión, parte del
  // cuerpo, agente, mecanismo): viven en forms/hseq/tablas-1401.js porque son
  // listas cerradas de la norma y un valor inventado invalidaría el reporte.
  entidades_seguridad_social: 'hseq',
  // Inventario de equipos HSE (protección contra caídas y rescate), fase 2.
  //
  // El ELEMENTO y el KIT viven en colecciones separadas, no embebido uno en el
  // otro, y por una razón de negocio antes que de costo: un elemento cambia de
  // maleta —el Excel ya registra a mano «se cambia de la maleta 1153 a la
  // 1135»— y su historial de inspecciones lo sigue a él, no a la maleta donde
  // esté hoy. Embebido, mover un arnés significaría reescribir dos kits y
  // perder de vista al arnés.
  //
  // La INSPECCIÓN es una fila por inspección, nunca el último valor. Es el
  // requisito que Marcela formuló como mejora sobre su propio Excel: «acá
  // solamente tenemos la fecha de la última inspección, pero sí deberíamos
  // saber todas las que se le han hecho a ese equipo».
  //
  // Las tres son transaccionales (~1.000 elementos hoy, una inspección por
  // elemento por año) y NUNCA entran a CATALOGOS_LISTABLES. Sus tres catálogos
  // de clasificación sí (arriba).
  elementos_hseq: 'hseq',
  kits_hseq: 'hseq',
  inspecciones_hseq: 'hseq',
  tipos_elemento_hseq: 'hseq',
  marcas_elemento: 'hseq',
  tipos_kit: 'hseq',
  // Módulo de Talento Humano (fase 1). La carpeta del colaborador es UN
  // documento por persona con sus archivos embebidos por sección (decenas, no
  // miles): la ficha se lee con 1 lectura. Existe aunque haya directorio en
  // BigQuery porque este solo tiene a los activos y no trae cédula ni fechas de
  // contrato, y el paz y salvo se consulta años después del retiro. El paz y
  // salvo lleva el visado del motor core/flujos embebido y congelado. Ambos son
  // transaccionales: page(), contar(), query() por igualdad; nunca list().
  // Las firmas son UN documento por persona (id = correo) con la clave de la
  // imagen; el flujo del paz y salvo es UN documento de configuración (listable).
  colaboradores: 'talento-humano',
  paz_y_salvos: 'talento-humano',
  firmas_tthh: 'talento-humano',
  flujos_tthh: 'talento-humano',
  motivos_retiro: 'talento-humano',
  secciones_carpeta: 'talento-humano',
  reglas_vacaciones: 'talento-humano',
  ciudades: 'talento-humano',
  razones_sociales: 'talento-humano',
  // Fase 2 (programa de capacitación). Una sesión es UN documento con sus
  // participantes embebidos (decenas) y las cifras derivadas escritas: el
  // calendario y los indicadores leen el documento, no recorren participantes.
  // Se consulta por periodo denormalizado (anio / anioMes / anioSemana), nunca
  // por rango de fechas. El plan anual es un documento por año (listable).
  capacitaciones: 'talento-humano',
  tipos_capacitacion: 'talento-humano',
  planes_capacitacion: 'talento-humano',
  // Autorregistro de asistencia y evaluación: UN documento por persona y sesión
  // (id = capacitacionId_participanteId), fuera del arreglo embebido porque
  // cientos de personas escriben a la vez. Se consulta por igualdad de
  // capacitacionId; transaccional, nunca listable.
  registros_capacitacion: 'talento-humano',
  // Fase 4 (evaluación de desempeño, 2026-11-18). Una EVALUACIÓN es un documento
  // por (ciclo, evaluado, evaluador, tipo) con las competencias congeladas del
  // catálogo; se consulta por igualdad de cicloId + evaluadorCorreo (bandeja) y
  // cicloId + evaluadoId (consolidación). El RESULTADO es uno por (ciclo,
  // evaluado). Ambos transaccionales. El modelo vigente es UN documento de
  // configuración en flujos_tthh (como la política de jefes).
  competencias_desempeno: 'talento-humano',
  indicadores_desempeno: 'talento-humano',
  ciclos_desempeno: 'talento-humano',
  evaluaciones_desempeno: 'talento-humano',
  resultados_desempeno: 'talento-humano',
  // Fase 2: el PLAN DE ACCIÓN post evaluación (formato de TTHH), uno por
  // resultado que lo requiera, con sus acciones y seguimientos embebidos.
  // Privado (jefe y TTHH); transaccional.
  planes_desempeno: 'talento-humano',
  // Costos y nómina por colaborador (2026-11-12). UN documento por colaborador
  // (id = colaboradorId) con sus valores vigentes CIFRADOS (lib/cifrado.js) y su
  // historial de cambios embebido. Va aparte de `colaboradores` a propósito: la
  // carpeta la leen varios (la propia persona, su jefe, la búsqueda de personas
  // de TI) y un descuido en cualquiera de esas rutas no debe arrastrar el
  // salario. Transaccional: se lee por id; la exportación recorre por país.
  costos_colaborador: 'talento-humano',
  // Conceptos de nómina (salario, auxilios, bonos…) con su marca prestacional:
  // decenas de filas que administra Talento Humano. Catálogo.
  conceptos_nomina: 'talento-humano',
  // Módulo de planeación estratégica. La PLANEACIÓN es UN documento con sus
  // objetivos y su diagnóstico DOFA embebidos: una decena de objetivos y unas
  // decenas de ítems que siempre se leen juntos (la vista es una sola), y el
  // peso de un objetivo solo tiene sentido dentro de su planeación. La
  // INICIATIVA es UN documento con sus actividades y subactividades (con sus
  // periodos) embebidas —en OSC, 4 actividades y 9 subactividades por
  // iniciativa— porque el avance se recalcula sobre el árbol entero. Los
  // SEGUIMIENTOS van aparte: crecen sin techo (uno por registro de avance) y se
  // consultan por igualdad de iniciativaId. Las tres son transaccionales y
  // NUNCA entran a CATALOGOS_LISTABLES: page(), contar(), query(). El catálogo
  // de perspectivas sí (arriba). Ver docs/ANALISIS-PLANEACION.md §4.
  planeaciones: 'planeacion',
  iniciativas: 'planeacion',
  seguimientos_planeacion: 'planeacion',
  perspectivas: 'planeacion',
  // Módulo de control de visitantes (política GDCN-HSE-POL-2-REG).
  //
  // La VISITA (cabecera: anfitrión, oficina, fecha, motivo) y la PERSONA (cada
  // visitante con su pre-registro, su validación y sus horas) viven en
  // colecciones SEPARADAS, y por una razón operativa: el formulario del QR en
  // recepción busca a UNA persona por identificación para hoy en esa oficina,
  // y embebida en la visita obligaría a leer todas las visitas del día para
  // encontrarla. Además llega un equipo de tres técnicos y uno no trae la
  // planilla: la validación es por persona, no por visita.
  //
  // Las dos son transaccionales —una fila por visitante, para siempre— y NUNCA
  // entran a CATALOGOS_LISTABLES: page() por anfitrión u oficina, query() por
  // igualdad, contar() para los tableros. La persona lleva desnormalizados
  // oficinaId, paisId y fechaPrevista para que esa búsqueda sea una igualdad.
  //
  // Los soportes (planilla, afiliaciones) son datos de salud y salario de un
  // tercero: solo los ve quien valida (visitantes.validar) y se suprimen por
  // retención. El token del pre-registro se guarda SOLO como hash SHA-256
  // (mismo patrón que las invitaciones del Portal de Proveedores).
  visitas: 'visitantes',
  visitas_personas: 'visitantes',
  // Requisitos documentales por país y tipo de visitante: lo que HSE pide en el
  // pre-registro (planilla en Colombia, IESS en Ecuador, cédula jurídica en
  // Costa Rica…). Es catálogo: decenas de filas que HSE ajusta sin despliegue.
  visitantes_requisitos: 'visitantes',
  // Tipos de documento de identidad por país (cédula, DNI, INE, RUN…): catálogo
  // editable que reemplaza la tabla en código cuando el país tiene filas.
  visitantes_identificaciones: 'visitantes',
  // Evidencia de aceptación de políticas por terceros (lib/evidencias.js): los
  // registros sellados (uno por acto de aceptación, para siempre) y el estado
  // de la cadena de hashes (UN documento). Transversal: hoy la escribe el
  // control de visitantes.
  aceptaciones: 'core',
  evidencias_cadena: 'core'
};

let db = null;

// Inicialización tolerante: si Firestore no arranca, la app sigue viva y los
// endpoints afectados responden 500 explícito (doc 02 §2).
function getDb() {
  if (db) return db;
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
  // Los objetos de negocio traen campos opcionales sin definir; Firestore
  // lanza si recibe `undefined`, así que se ignoran en lugar de romper.
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

function rutaDe(nombre) {
  const ambito = AMBITOS[nombre];
  if (!ambito) throw new Error(`[db] colección no registrada: ${nombre} (agréguela a AMBITOS en lib/db.js)`);
  return `${RAIZ}/${ambito}/${nombre}`;
}

// El id vive en la clave del documento, no dentro del payload.
function conId(snap) {
  return { id: snap.id, ...snap.data() };
}

function sinId(data) {
  const { id, ...resto } = data;
  return resto;
}

class Collection {
  constructor(nombre) {
    this.nombre = nombre;
    this.ref = getDb().collection(rutaDe(nombre));
  }

  // LECTURA COMPLETA — solo catálogos de configuración (CATALOGOS_LISTABLES).
  //
  // Se paga un read por documento de la colección, así que el costo de llamarla
  // crece con el volumen aunque el filtro devuelva una sola fila.
  //
  // `motivo` es la puerta de salida para las lecturas completas legítimas que no
  // son catálogos: exportaciones, migraciones y reíndices. Es obligatorio y se
  // imprime, así que cada excepción queda justificada en el código y contada en
  // el log; no hay forma de saltarse la política en silencio.
  //
  //   col('documentos').list(null, { motivo: 'exportación CSV pedida por el usuario' })
  async list(filterFn, { motivo = null } = {}) {
    if (!CATALOGOS_LISTABLES.has(this.nombre) && !motivo) {
      const aviso =
        `[db] list() sobre "${this.nombre}", que NO es un catálogo de configuración.\n` +
        `      Lee la colección completa y se paga un read por documento, así que el\n` +
        `      costo de este endpoint crece para siempre con el volumen de datos.\n` +
        `      Use en su lugar:  page() para un listado en pantalla · contar() para un\n` +
        `      total · query({campo: valor}) para un filtro · recorrer() para exportar.\n` +
        `      Si la lectura completa es deliberada, decláREla:\n` +
        `         col('${this.nombre}').list(fn, { motivo: 'por qué' })\n` +
        `      Política: docs/POLITICA-COSTOS.md`;
      if (ESTRICTO) throw new Error(aviso);
      console.warn(`${aviso}\n${new Error().stack.split('\n').slice(2, 5).join('\n')}`);
    }

    const snap = await this.ref.get();
    contabilizar(this.nombre, snap.size);

    if (snap.size > MAX_LIST) {
      const caro =
        `[db] ${snap.size} documentos leídos de "${this.nombre}" en una sola llamada ` +
        `(umbral ${MAX_LIST})${motivo ? ` — motivo declarado: ${motivo}` : ''}. ` +
        `Costo de esta llamada: USD ${(snap.size * 0.0000006).toFixed(6)}.`;
      // Un motivo declarado explica la lectura, no la abarata: se avisa igual,
      // porque una exportación que crece hasta 500.000 filas hay que replantearla.
      console.warn(caro);
    }

    const rows = snap.docs.map(conId);
    return filterFn ? rows.filter(filterFn) : rows;
  }

  // Filtros de igualdad resueltos por Firestore (no trae la colección entera).
  // `filtros` = { campo: valor }; los valores undefined/null/'' se ignoran.
  //
  // Sin `limite` el resultado es tan grande como el filtro permita: úsela cuando
  // el filtro ya acota por naturaleza (los pendientes de UNA persona, los
  // documentos de UN proceso). Para lo que se pinta en pantalla, page().
  async query(filtros = {}, { limite = null, orden = null, desc = false } = {}) {
    let q = this.ref;
    for (const [campo, valor] of Object.entries(filtros)) {
      if (valor === undefined || valor === null || valor === '') continue;
      q = q.where(campo, '==', valor);
    }
    if (orden) q = q.orderBy(orden, desc ? 'desc' : 'asc');
    if (limite) q = q.limit(Math.min(Number(limite), PAGINA_MAXIMA));
    const snap = await q.get();
    contabilizar(this.nombre, snap.size);
    return snap.docs.map(conId);
  }

  // Documentos cuyo `campo` EMPIEZA por `prefijo`, ordenados por ese campo.
  //
  // Es un rango sobre un solo campo —de `prefijo` a `prefijo + TOPE_DE_PREFIJO`—,
  // así que lo resuelve el índice automático
  // de ese campo: no hace falta índice compuesto y no hay scan. Con `desc` y
  // `limite: 1` responde «¿cuál es el mayor que empieza por esto?» en UNA
  // lectura, que es lo que necesita un consecutivo sugerido.
  //
  // DISTINGUE MAYÚSCULAS, porque Firestore ordena por bytes. Quien lo use sobre
  // un campo escrito a mano tiene que decidir qué hace con eso: el módulo de
  // equipos consulta la raíz tal como se teclea y también en mayúsculas, que es
  // la nomenclatura real de sus hostnames.
  //
  // Prefijo vacío NO se admite: sería la colección entera por la puerta de
  // atrás, justo lo que la política de costo prohíbe.
  async porPrefijo(campo, prefijo, { limite = PAGINA_DEFECTO, desc = false } = {}) {
    const inicio = String(prefijo || '');
    if (!inicio) throw new Error(`[db] porPrefijo(${this.nombre}.${campo}) exige un prefijo: sin él sería un scan`);
    const snap = await this.ref
      .where(campo, '>=', inicio)
      .where(campo, '<', inicio + TOPE_DE_PREFIJO)
      .orderBy(campo, desc ? 'desc' : 'asc')
      .limit(Math.min(Number(limite) || PAGINA_DEFECTO, PAGINA_MAXIMA))
      .get();
    contabilizar(this.nombre, snap.size);
    return snap.docs.map(conId);
  }

  // Documentos cuyo arreglo `campo` contiene `valor`.
  //
  // Firestore indexa los arreglos de primer nivel automáticamente, así que esto
  // cuesta lo que ocupe el resultado y no la colección. Es la forma de resolver
  // "¿quién tiene esta etiqueta / este código / esta norma?" sin scan, y la razón
  // por la que vale la pena denormalizar un arreglo de strings planos cuando el
  // dato real vive dentro de objetos (Firestore no indexa subcampos de objetos
  // dentro de arreglos).
  async contiene(campo, valor, { limite = PAGINA_MAXIMA } = {}) {
    const snap = await this.ref
      .where(campo, 'array-contains', valor)
      .limit(Math.min(Number(limite) || PAGINA_MAXIMA, PAGINA_MAXIMA))
      .get();
    contabilizar(this.nombre, snap.size);
    return snap.docs.map(conId);
  }

  // PÁGINA con cursor — la forma correcta de alimentar un listado en pantalla.
  //
  // Cursor opaco (el id del último documento de la página anterior) en lugar de
  // `offset`: Firestore cobra los documentos saltados por offset, así que
  // paginar con offset hace que la página 20 cueste 20 veces la página 1.
  //
  // Devuelve { filas, cursor, hayMas }. `cursor` null significa fin del conjunto.
  //
  // `contiene` filtra por pertenencia a un ARREGLO del documento
  // (`{ sedes: 'col' }` → los que aplican a Colombia). Sigue siendo una consulta
  // del servidor, no un filtro en memoria: traer la colección para descartar
  // filas es justo lo que la política de costo prohíbe.
  //
  // Firestore admite UNA sola cláusula array-contains por consulta, así que se
  // rechaza más de una en lugar de dejar que falle en tiempo de ejecución con un
  // mensaje del SDK que no dice qué consulta la provocó.
  async page({ filtros = {}, contiene = {}, orden = '__name__', desc = false, limite = PAGINA_DEFECTO, cursor = null } = {}) {
    const tope = Math.max(1, Math.min(Number(limite) || PAGINA_DEFECTO, PAGINA_MAXIMA));

    let q = this.ref;
    for (const [campo, valor] of Object.entries(filtros)) {
      if (valor === undefined || valor === null || valor === '') continue;
      q = q.where(campo, '==', valor);
    }

    const enArreglo = Object.entries(contiene)
      .filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (enArreglo.length > 1) {
      throw new Error(
        `[db] page() sobre "${this.nombre}" recibió ${enArreglo.length} filtros de arreglo ` +
        `(${enArreglo.map(([c]) => c).join(', ')}). Firestore admite uno solo por consulta.`);
    }
    for (const [campo, valor] of enArreglo) q = q.where(campo, 'array-contains', valor);

    q = q.orderBy(orden, desc ? 'desc' : 'asc');

    if (cursor) {
      // Se reancla en el documento del cursor. Cuesta 1 read, no N.
      const ancla = await this.ref.doc(String(cursor)).get();
      contabilizar(this.nombre, 1);
      if (ancla.exists) q = q.startAfter(ancla);
    }

    // Se pide una fila extra para saber si hay página siguiente sin contar todo.
    const snap = await q.limit(tope + 1).get();
    contabilizar(this.nombre, snap.size);

    const docs = snap.docs.slice(0, tope);
    const hayMas = snap.size > tope;
    return {
      filas: docs.map(conId),
      cursor: hayMas && docs.length ? docs[docs.length - 1].id : null,
      hayMas
    };
  }

  // TOTAL por agregación en el servidor. Firestore cobra 1 read por cada 1.000
  // entradas de índice escaneadas (mínimo 1), así que contar 50.000 documentos
  // cuesta 50 reads en lugar de 50.000. Para tarjetas, badges y totales.
  async contar(filtros = {}) {
    let q = this.ref;
    for (const [campo, valor] of Object.entries(filtros)) {
      if (valor === undefined || valor === null || valor === '') continue;
      q = q.where(campo, '==', valor);
    }
    const snap = await q.count().get();
    const total = snap.data().count;
    contabilizar(this.nombre, Math.max(1, Math.ceil(total / 1000)));
    return total;
  }

  // RECORRIDO por lotes — exportaciones CSV y migraciones.
  //
  // Lee la colección completa (no hay forma de exportar sin leerla), pero por
  // lotes y sin acumularla en memoria: una exportación de 200.000 documentos no
  // debe tumbar un contenedor de 512 MiB. `fn` recibe cada fila.
  //
  // Es la única lectura completa que la política admite en una ruta de usuario,
  // porque el usuario pidió explícitamente todo el conjunto.
  async recorrer(fn, { filtros = {}, lote = 500 } = {}) {
    let q = this.ref;
    for (const [campo, valor] of Object.entries(filtros)) {
      if (valor === undefined || valor === null || valor === '') continue;
      q = q.where(campo, '==', valor);
    }
    q = q.orderBy('__name__');

    let ultimo = null;
    let leidos = 0;
    for (;;) {
      let pagina = q.limit(lote);
      if (ultimo) pagina = pagina.startAfter(ultimo);
      const snap = await pagina.get();
      if (snap.empty) break;
      contabilizar(this.nombre, snap.size);
      for (const d of snap.docs) await fn(conId(d));
      leidos += snap.size;
      ultimo = snap.docs[snap.docs.length - 1];
      if (snap.size < lote) break;
    }
    return leidos;
  }

  async get(id) {
    if (!id) return null;
    const snap = await this.ref.doc(String(id)).get();
    contabilizar(this.nombre, snap.exists ? 1 : 0);
    return snap.exists ? conId(snap) : null;
  }

  // Un solo resultado por filtro de igualdad: 1 read, no la colección.
  // `findOne(fn)` con predicado sigue existiendo para catálogos, pero preferir
  // `findOne({campo: valor})` siempre que el criterio sea una igualdad.
  async findOne(criterio) {
    if (typeof criterio === 'function') {
      const rows = await this.list(criterio);
      return rows[0] || null;
    }
    const rows = await this.query(criterio || {}, { limite: 1 });
    return rows[0] || null;
  }

  async insert(data) {
    const id = data.id ? String(data.id) : crypto.randomUUID();
    const payload = { ...sinId(data), createdAt: data.createdAt || new Date().toISOString() };
    await this.ref.doc(id).set(payload);
    return { id, ...payload };
  }

  async update(id, patch) {
    const ref = this.ref.doc(String(id));
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`[db] ${this.nombre}/${id} no existe`);
    const payload = { ...sinId(patch), updatedAt: new Date().toISOString() };
    await ref.set(payload, { merge: true });
    return { id: String(id), ...snap.data(), ...payload };
  }

  // Escritura directa para trabajos de conciliación (recalcular un campo
  // denormalizado sobre miles de filas): set con merge SIN verificar
  // existencia. update() lee antes de escribir —correcto para una edición de
  // usuario—, pero duplica los viajes cuando el documento acaba de leerse en
  // el mismo recorrido. Úsese solo cuando el llamador ya tiene el documento.
  async fusionar(id, patch) {
    const payload = { ...sinId(patch), updatedAt: new Date().toISOString() };
    await this.ref.doc(String(id)).set(payload, { merge: true });
  }

  async removeHard(id) {
    const ref = this.ref.doc(String(id));
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }
}

function col(nombre) {
  return new Collection(nombre);
}

// Consecutivos por clave de codificación (p. ej. "GETI-DSS-MAN-REG" -> 4).
// Transaccional: dos documentos creados simultáneamente nunca reciben el mismo
// consecutivo (el adaptador anterior sobre archivos JSON sí lo permitía).
async function nextConsecutivo(clave) {
  const ref = getDb().collection(rutaDe('contadores')).doc(String(clave));
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const valor = (snap.exists ? snap.data().valor : 0) + 1;
    tx.set(ref, { valor, updatedAt: new Date().toISOString() }, { merge: true });
    return valor;
  });
}

// Deja el contador al menos en `minimo` (usado por el seed al importar
// documentos históricos, para que los nuevos códigos no colisionen).
async function asegurarConsecutivo(clave, minimo) {
  const ref = getDb().collection(rutaDe('contadores')).doc(String(clave));
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists ? snap.data().valor : 0;
    if (actual >= minimo) return actual;
    tx.set(ref, { valor: minimo, updatedAt: new Date().toISOString() }, { merge: true });
    return minimo;
  });
}

// Lecturas acumuladas del proceso. `/api/health` las publica para poder medir
// el costo de una pantalla: se mira el contador, se navega, se vuelve a mirar.
function lecturasAcumuladas() {
  return {
    total: lecturas.total,
    costoEstimadoUsd: Number((lecturas.total * 0.0000006).toFixed(6)),
    porColeccion: { ...lecturas.porColeccion }
  };
}

module.exports = {
  col, nextConsecutivo, asegurarConsecutivo, RAIZ, PROJECT_ID,
  lecturasAcumuladas, PAGINA_DEFECTO, PAGINA_MAXIMA
};
