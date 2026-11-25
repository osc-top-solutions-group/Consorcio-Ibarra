// Parámetros del panel de configuración general, con caché de corta vida para
// no consultar Firestore en cada petición. Cualquier módulo del SGC los lee de
// aquí en lugar de hardcodear constantes de negocio.
const { col } = require('../../lib/db');

// Valores por defecto: garantizan que el sistema funcione aunque el catálogo
// `parametros` esté vacío (primer arranque o seed no ejecutado).
const DEFECTOS = {
  // Planeación estratégica: días que tienen los responsables del diagnóstico
  // para registrar la matriz DOFA desde que se crea la planeación (Kawak: 14).
  diasDiagnosticoPlaneacion: 14,
  diasAlertaRevision: 30,
  // Permisos excepcionales por documento (ver docs/ANALISIS-PERMISOS-EXCEPCIONALES-DOCUMENTAL.md
  // D4): vigencia máxima en días de un permiso de DESCARGA otorgado por el líder
  // del proceso. El administrador del módulo puede dar descarga indefinida.
  diasMaximoPermisoDocumento: 90,
  mesesRevisionPorDefecto: 12,
  // Plazo (días calendario) que tiene un revisor/aprobador para decidir desde
  // que se le convoca, y cada cuántos días el cron le recuerda la tarea. Al
  // vencer el plazo se escala UNA vez al elaborador del documento.
  diasPlazoDecision: 5,
  diasFrecuenciaRecordatorio: 2,
  diasLimiteActualizacionIndicadores: 5,
  // Mantenimiento preventivo de equipos de cómputo. Un equipo NUEVO aguanta el
  // primer año; uno usado entra al ciclo semestral de una vez. Son parámetros y
  // no constantes porque el criterio lo fija Tecnología y puede cambiar sin que
  // cambie nada más; el aviso de 21 días es el que da margen a reprogramar.
  mesesPrimerPreventivoEquipoNuevo: 12,
  mesesEntrePreventivosEquipo: 6,
  diasAvisoMantenimiento: 21,
  diasVentanaReprogramacion: 7,
  // CUPO SEMANAL DE MANTENIMIENTOS PREVENTIVOS.
  //
  // La fecha teórica (12 meses / 6 meses) dice CUÁNDO le toca a un equipo, pero
  // no cuántos equipos le tocan a la misma semana: al importar un inventario
  // histórico, decenas comparten fecha de puesta en servicio y el cronograma
  // amontona treinta mantenimientos en un lunes que nadie va a poder atender.
  // El cupo es lo que convierte la fecha teórica en una agenda ejecutable: el
  // equipo se corre a la primera semana con espacio. Ver mantenimiento.js.
  equiposPorSemanaMantenimiento: 10,
  // Plazo legal para investigar un incidente, un accidente de trabajo o una
  // enfermedad laboral, en días calendario CONTADOS DESDE EL EVENTO (no desde
  // que se abre el registro: reportar tarde no amplía el plazo). Colombia:
  // Resolución 1401 de 2007, art. 4 y 14 → 15 días. Es parámetro y no constante
  // porque el término lo fija cada país y el módulo opera también en Perú,
  // México y Costa Rica.
  diasInvestigacionAccidente: 15,
  // Vigencia de la inspección de un equipo de protección contra caídas y días
  // de anticipación del aviso. «La inspección solo dura un año» (HSE,
  // 00:24:29); los 30 días de aviso son el margen para solicitarla al proveedor
  // externo, que es quien la hace y tiene sus propios tiempos.
  mesesVigenciaInspeccionHseq: 12,
  diasAvisoInspeccionHseq: 30,
  // Paz y salvo: días que tienen las áreas para firmar desde que se abre («yo
  // doy 4 días para la firma», Andrea, 16-sep) y cada cuántos días el barrido
  // recuerda a quien no ha firmado una vez vencido el plazo.
  diasFirmaPazYSalvo: 4,
  diasRecordatorioPazYSalvo: 2,
  // Evaluación de desempeño: cada cuántos días el barrido recuerda a los
  // evaluadores con tareas pendientes mientras el ciclo está abierto (y siempre
  // a dos días del cierre).
  diasRecordatorioDesempeno: 5,
  // Google Calendar para las capacitaciones. Vacío: el evento nace en el
  // calendario del facilitador interno (o de quien programó, si es externo).
  // Con el id de un calendario corporativo (p. ej. c_abc123@group.calendar.google.com),
  // nacen allí; ese calendario debe compartirse con el buzón remitente del SGC
  // con permiso de «hacer cambios en eventos».
  calendarioCapacitacionesId: '',
  zonaHorariaCapacitaciones: 'America/Bogota',
  // Tope de personas que un solo cargue de participantes puede convocar. Es el
  // freno de emergencia: «toda la sede» son cientos de correos y de invitaciones.
  maximoConvocadosPorCargue: 100,
  // CANDADO DE PRUEBAS de la convocatoria. Mientras el flujo de capacitaciones
  // se experimenta (autorregistro, Calendar), convocar SOLO persona por persona:
  // nada de «toda el área», «toda la sede», cargo ni grupo. El 24-sep una prueba
  // le escribió a 244 personas. Cuando el flujo esté estable se pone en false.
  convocatoriaSoloPersonas: true,
  // Autorregistro de asistencia: horas que permanece abierto el registro desde
  // que el facilitador lo abre (se puede cerrar antes a mano), y si el
  // participante debe digitar el PIN que el facilitador proyecta en la sala.
  horasVentanaAsistencia: 24,
  // Apagado: RRHH y HSE pidieron que la persona solo entre y marque (2026-10-30).
  // Encenderlo pide el PIN que el facilitador proyecta, como control de presencia.
  exigirPinAsistencia: false,
  // «Mi perfil»: pestañas que RRHH decide ocultar a la propia persona (ids:
  // personales, documentos, certificados, vacaciones, historial). El equipo de
  // Talento Humano las ve todas siempre. Vacío = la persona ve todo.
  pestanasOcultasMiCarpeta: [],
  // Certificado laboral a demanda (PDF): quién lo firma (nombre y cargo, p. ej.
  // «Andrea Camelo · Coordinadora de Talento Humano») y la ciudad de
  // expedición. Vacío: se imprime «Talento Humano» y la ciudad del perfil.
  certificadoLaboralFirmante: '',
  certificadoLaboralCiudad: '',
  // Control de visitantes (política GDCN-HSE-POL-2-REG 6.1.I): horas HÁBILES
  // de preaviso que el anfitrión debe dar. Con menos, la visita se registra
  // igual pero queda marcada «sin preaviso» y exige justificación: bloquear
  // rompería la visita urgente del cliente; dejar pasar sin marca vacía la
  // política. Meses que se conservan los soportes del visitante antes de que
  // el cron los suprima y anonimice la persona (ciclo de auditoría ISO 27001).
  horasHabilesPreavisoVisita: 24,
  mesesRetencionVisitas: 24,
  // Destinatarios por país de los avisos de visitantes, en la gramática de
  // core/config/destinatarios.js, como JSON: {"col":[{"tipo":"area","valor":"HSE"}],
  // "*":[{"tipo":"usuario","valor":"hse@…"}]}. La clave "*" es el respaldo
  // regional cuando el país no tiene fila. Vacío = nadie (se avisa en el log).
  destinatariosVisitantesHse: '',
  destinatariosVisitantesTthh: '',
  destinatariosVisitantesAdministrativa: '',
  // Base de las URL públicas (pre-registro y QR). Vacía usa APP_BASE_URL. Se
  // separa para poder mover el formulario a un subdominio sin tocar código.
  urlPublicaVisitantes: '',
  // Código del documento (módulo documental) que el visitante lee antes de
  // aceptar el tratamiento de sus datos. Solo se muestra si está aprobado,
  // vigente y clasificado como público; la aceptación guarda su versión y hash.
  codigoPoliticaDatosVisitantes: 'GLEG-POL-4-GLO',
  // Términos y condiciones de uso de portales web: se leen y aceptan en el QR de
  // recepción (junto a la política de seguridad). Misma regla: público y vigente.
  codigoTerminosPortalVisitantes: 'GETI-EST-1-GLO',
  // Política de Visitantes: la que el visitante acepta en el QR junto a la
  // política de seguridad (casilla «He leído y acepto…»). Misma regla.
  codigoPoliticaVisitantes: 'GETI-POL-2-GLO',
  // Modo de pruebas (ver lib/mailer.js): módulos cuyos correos salen solo a los
  // correos autorizados. Vacío = ningún módulo en pruebas.
  modoPruebasModulos: '',
  modoPruebasCorreos: '',
  // Módulos desplegados pero todavía no lanzados: se muestran como «Próximamente»
  // y su API cierra, salvo para administradores (ver core/config/modulos.js).
  // Ids de src/app/menu.js: expedientes, visitantes… Vacío = todo abierto.
  modulosProximamente: [],
  // Gestión de riesgos: meses hasta la próxima revisión de un riesgo según su
  // zona (residual si ya se valoró, inherente si no) y días de aviso. El
  // procedimiento GPNE-PRO-7-GLO no fija la periodicidad; la sesión del
  // 2026-10-20 habló de «6 meses o anualmente» (decisión D5).
  mesesRevisionRiesgoCritico: 6,
  mesesRevisionRiesgoAlto: 6,
  mesesRevisionRiesgoMedio: 12,
  mesesRevisionRiesgoBajo: 12,
  diasAvisoRevisionRiesgo: 30,
  sufijoGlobal: 'GLO',
  sufijoRegional: 'REG',
  exigirArchivoOriginal: true,
  exigirSegregacionFunciones: true,
  // Extensiones del archivo ORIGINAL editable. `.bpm` es el modelo de Bizagi
  // Modeler y `.bpmn` el estándar OMG (lo exportan Bizagi, Camunda, draw.io):
  // los flujos de proceso se diseñan ahí y el editable es ese modelo, no un
  // Word (pedido de Calidad, 2026-11-04). El archivo de PUBLICACIÓN sigue siendo
  // PDF siempre: es lo que el visor de la herramienta sabe mostrar.
  extensionesOriginal: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.vsd', '.vsdx', '.bpm', '.bpmn']
};

const TTL_MS = 60_000;

let cache = null;
let expiraEn = 0;

async function parametros() {
  if (cache && Date.now() < expiraEn) return cache;
  let valores = {};
  try {
    const filas = await col('parametros').list((p) => p.activo !== false);
    valores = Object.fromEntries(filas.map((f) => [f.id, f.valor]));
  } catch (e) {
    // Si el catálogo no está disponible se opera con los valores por defecto.
    console.warn('[parametros] usando valores por defecto:', e.message);
  }
  cache = { ...DEFECTOS, ...valores };
  expiraEn = Date.now() + TTL_MS;
  return cache;
}

async function param(clave) {
  const todos = await parametros();
  return todos[clave];
}

function invalidar() {
  cache = null;
  expiraEn = 0;
}

module.exports = { parametros, param, invalidar, DEFECTOS };
