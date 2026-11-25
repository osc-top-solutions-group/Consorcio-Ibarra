// Resolución de destinatarios: convierte una asignación declarativa en la lista
// concreta de correos. Servicio TRANSVERSAL — los flujos de aprobación del
// módulo documental, las acciones de auditorías, la alimentación de indicadores
// y cualquier módulo futuro asignan tareas con esta misma gramática.
//
//   { tipo: 'usuario', valor: 'correo@osc...' }        un colaborador concreto
//   { tipo: 'cargo',   valor: 'ANALISTA BI' }          todos los que ocupan el cargo
//   { tipo: 'area',    valor: 'TICS' }                 todos los de un área
//   { tipo: 'sede',    valor: 'col' }                  todos los de una sede
//   { tipo: 'grupo',   valor: 'comite-calidad' }       los integrantes del grupo
//   { tipo: 'correo',  valor: 'contabilidad.tsg@osc...' } un buzón que NO está en el directorio
//
// Cargo, área y sede se resuelven contra el DIRECTORIO DE EMPLEADOS (BigQuery),
// que es la fuente de verdad de la organización: no hay que mantener a mano
// quién ocupa qué cargo, y un cambio en Talento Humano se refleja solo.
//
// `correo` existe porque hay firmantes que no son empleados: el bloque de
// Contabilidad del paz y salvo lo aprueban contadores EXTERNOS desde el buzón
// contabilidad.tsg (2026-10-14). Un `usuario` que no está en el directorio se
// rechaza a propósito —casi siempre es un correo mal escrito—, así que el buzón
// se declara con su propio tipo para que la excepción sea deliberada y visible.
// Quien entra con ese correo opera con identidad mínima (`enDirectorio: false`
// en accesos): puede firmar porque está en `etapa.responsables`, no porque
// tenga cargo o área.
//
// Se conserva el origen de cada asignación (`asignadoPor`) para trazabilidad:
// en el historial del documento queda registrado que alguien firmó porque ocupa
// un cargo, no porque se lo asignaran a mano.
const { col } = require('../../lib/db');
const empleados = require('../empleados');
const catalogos = require('./catalogos');

const TIPOS = ['usuario', 'cargo', 'area', 'sede', 'grupo', 'correo'];

// Lo mínimo para que un buzón declarado a mano reciba correo y pueda entrar.
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Acepta strings sueltos (compatibilidad) y los normaliza a { tipo, valor }.
function normalizar(entrada) {
  if (typeof entrada === 'string') return { tipo: 'usuario', valor: entrada };
  if (entrada && typeof entrada === 'object' && entrada.valor) {
    return { tipo: entrada.tipo || 'usuario', valor: entrada.valor };
  }
  throw httpError(400, 'Asignación inválida: se esperaba un correo o { tipo, valor }');
}

// Integrantes de un grupo según su regla. Los grupos existen para dar nombre de
// negocio ("Comité de Calidad") a un criterio del directorio.
async function integrantesDeGrupo(grupoId, directorio) {
  const grupo = await col('grupos').get(grupoId);
  if (!grupo || grupo.activo === false) throw httpError(400, `El grupo "${grupoId}" no existe`);
  const regla = grupo.regla || {};
  switch (regla.tipo) {
    case 'cargo':
      return directorio.filter((e) => e.cargo === regla.valor);
    case 'area':
      return directorio.filter((e) => e.area === regla.valor);
    case 'sede':
      return directorio.filter((e) => e.sedeId === regla.valor);
    case 'manual': {
      const correos = new Set((regla.correos || []).map((c) => String(c).toLowerCase()));
      return directorio.filter((e) => correos.has(e.correo));
    }
    default:
      throw httpError(400, `El grupo "${grupo.nombre}" tiene una regla no soportada: ${regla.tipo}`);
  }
}

// Expande las asignaciones a participantes únicos.
// Devuelve [{ correo, asignadoPor: { tipo, valor, etiqueta } }]
async function resolver(asignaciones) {
  const entradas = (asignaciones || []).map(normalizar);
  for (const e of entradas) {
    if (!TIPOS.includes(e.tipo)) throw httpError(400, `Tipo de asignación inválido: ${e.tipo}`);
  }
  if (!entradas.length) return [];

  let directorio = [];
  try {
    directorio = await empleados.listar();
  } catch (e) {
    throw httpError(503, `El directorio de empleados no está disponible: ${e.message}`);
  }
  const porCorreo = new Map(directorio.map((e) => [e.correo, e]));
  const resultado = new Map();

  for (const entrada of entradas) {
    let encontrados = [];
    let etiqueta = entrada.valor;

    switch (entrada.tipo) {
      case 'usuario': {
        const correo = String(entrada.valor).trim().toLowerCase();
        const e = porCorreo.get(correo);
        if (!e) throw httpError(400, `"${entrada.valor}" no está en el directorio de empleados`);
        encontrados = [e];
        etiqueta = e.nombre;
        break;
      }
      case 'cargo':
        encontrados = directorio.filter((e) => e.cargo === entrada.valor);
        break;
      case 'area':
        encontrados = directorio.filter((e) => e.area === entrada.valor);
        break;
      case 'sede': {
        const sede = await col('sedes').get(entrada.valor);
        if (!sede) throw httpError(400, `La sede "${entrada.valor}" no existe`);
        etiqueta = sede.nombre;
        encontrados = directorio.filter((e) => e.sedeId === entrada.valor);
        break;
      }
      case 'grupo': {
        const grupo = await col('grupos').get(entrada.valor);
        etiqueta = grupo ? grupo.nombre : entrada.valor;
        encontrados = await integrantesDeGrupo(entrada.valor, directorio);
        break;
      }
      case 'correo': {
        // Sin pasar por el directorio: si el buzón sí resulta ser un empleado
        // se toma su nombre, pero no es condición.
        const correo = String(entrada.valor).trim().toLowerCase();
        if (!CORREO_VALIDO.test(correo)) throw httpError(400, `"${entrada.valor}" no es un correo válido`);
        const e = porCorreo.get(correo);
        etiqueta = e ? e.nombre : correo;
        encontrados = [e || { correo }];
        break;
      }
    }

    if (!encontrados.length) {
      throw httpError(400, `La asignación "${etiqueta}" no resolvió ningún colaborador`);
    }
    // Si un correo llega por varias vías, gana la primera asignación registrada.
    for (const e of encontrados) {
      if (!resultado.has(e.correo)) {
        resultado.set(e.correo, { correo: e.correo, asignadoPor: { ...entrada, etiqueta } });
      }
    }
  }

  return [...resultado.values()];
}

// ---------- Pertenencia: la operación INVERSA de resolver() ----------
//
// `resolver()` expande una asignación a la lista de correos, y sirve para
// convocar (flujos, notificaciones). Los filtros de visibilidad preguntan al
// revés —"¿este usuario está en esa audiencia?"— y lo preguntan una vez POR
// DOCUMENTO del listado maestro, así que no puede costar ni una consulta ni una
// lectura del directorio cada vez.
//
// Por eso son dos pasos:
//   1. `contextoDe(usuario)` arma UNA vez las identidades de quien pregunta:
//      correo, cargo, área, sede y los grupos a los que pertenece.
//   2. `perteneceA(asignaciones, contexto)` compara en memoria, sin E/S.
//
// El cargo y el área salen del perfil, que ya los trae del directorio; los
// grupos se calculan contra el catálogo, que es pequeño y está cacheado.
async function contextoDe(usuario) {
  const correo = String(usuario?.correo || '').trim().toLowerCase();
  const contexto = {
    correo,
    cargo: usuario?.cargo || null,
    area: usuario?.area || null,
    // La sede que cuenta es la PROPIA (la que da el directorio), no las que se
    // le hayan habilitado para consultar: un grupo "sede: Colombia" son quienes
    // trabajan en Colombia, no quienes pueden ver sus documentos.
    sede: usuario?.sedePropia || null,
    grupos: new Set()
  };

  let grupos = [];
  try {
    grupos = await catalogos.leer('grupos');
  } catch (e) {
    // Sin catálogo de grupos se sigue operando: la pertenencia por grupo no
    // aplica, pero las audiencias por usuario, cargo, área o sede siguen
    // funcionando. Lanzar aquí dejaría el listado maestro en blanco.
    console.warn('[destinatarios] no se pudo leer el catálogo de grupos:', e.message);
  }

  for (const g of grupos) {
    const regla = g.regla || {};
    const pertenece =
      (regla.tipo === 'cargo' && contexto.cargo === regla.valor) ||
      (regla.tipo === 'area' && contexto.area === regla.valor) ||
      (regla.tipo === 'sede' && contexto.sede === regla.valor) ||
      (regla.tipo === 'manual' &&
        (regla.correos || []).some((c) => String(c).trim().toLowerCase() === correo));
    if (pertenece) contexto.grupos.add(g.id);
  }

  return contexto;
}

// ¿El usuario del contexto está en alguna de estas asignaciones?
//
// Una lista VACÍA no la interpreta esta función: devuelve false, y es quien
// llama el que decide qué significa (en las audiencias de un documento, vacía
// significa "sin restricción adicional", no "nadie").
//
// Sin contexto niega: falla cerrado. Es deliberado — si un llamador nuevo olvida
// resolver el contexto, el resultado es que no ve un documento restringido, no
// que lo ve indebidamente.
function perteneceA(asignaciones, contexto) {
  if (!contexto) return false;
  return (asignaciones || []).some((entrada) => {
    let a;
    try { a = normalizar(entrada); } catch { return false; }
    const valor = String(a.valor);
    switch (a.tipo) {
      case 'usuario':
      case 'correo': return valor.trim().toLowerCase() === contexto.correo;
      case 'cargo': return contexto.cargo === valor;
      case 'area': return contexto.area === valor;
      case 'sede': return contexto.sede === valor;
      case 'grupo': return contexto.grupos.has(valor);
      default: return false;
    }
  });
}

module.exports = { resolver, normalizar, contextoDe, perteneceA, TIPOS };
