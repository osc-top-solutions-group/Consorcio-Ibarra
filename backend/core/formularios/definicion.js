// MOTOR DE FORMULARIOS PARAMETRIZABLES.
//
// Principio de diseño, el mismo del catálogo de accesos:
//   **el esqueleto vive en código, el contenido vive en Firestore.**
//
//   · CAMPOS DE SISTEMA: declarados aquí. Mueven lógica de negocio (el código
//     documental, el aislamiento por sedes, el ciclo de vida), así que no se
//     pueden eliminar ni cambiar de tipo desde el panel. Sí se puede cambiar su
//     etiqueta, su ayuda, su orden y si aparece en el listado maestro.
//     Los marcados `bloqueado` tampoco pueden dejar de ser obligatorios.
//
//   · CAMPOS PERSONALIZADOS: los crea el administrador sin tocar código. Se
//     guardan en `documento.datos.{clave}` y se validan dinámicamente.
//
// Así el administrador tiene control real sin poder romper el módulo.
//
// HAY UN FORMULARIO POR MÓDULO, no uno solo. El motor nació con `documento`
// cableado —secciones y campos como constantes de archivo— y eso dejó al módulo
// de mejoramiento sin forma de parametrizar su hallazgo. Ahora cada formulario
// declara su esqueleto en `FORMULARIOS` y el resto del motor es genérico: agregar
// el formulario de un módulo nuevo es agregar una entrada ahí.
const { col } = require('../../lib/db');
const registro = require('../config/registro');

const TIPOS = [
  'texto', 'textoLargo', 'numero', 'fecha', 'booleano',
  'seleccion', 'seleccionMultiple', 'catalogo', 'catalogoMultiple', 'etiquetas'
];

// `lista`: grupo REPETIBLE de subcampos (beneficiarios, mascotas, contactos de
// emergencia: varias filas con nombre, parentesco, teléfono…). Solo lo declaran
// los campos de sistema: el panel no lo ofrece para los personalizados porque
// definir subcampos desde la interfaz necesita su propio editor y validación,
// y ningún módulo lo ha pedido todavía. Sus subcampos admiten los tipos simples.
const TIPOS_SUBCAMPO = ['texto', 'numero', 'fecha', 'seleccion'];

// Un campo de sistema con `enDatos: true` se declara en código (sale en el
// panel con su etiqueta, ayuda, orden y si es obligatorio) pero su VALOR vive
// en `{registro}.datos` y lo valida y pinta el mismo motor que los
// personalizados. Es la forma de agregar un campo «de negocio» que no mueve
// lógica sin cablearlo a mano en el esquema, el servicio y las dos pantallas.
// La diferencia con un personalizado: no se puede borrar ni cambiar de tipo.

// Catálogos que un campo de tipo `catalogo` puede consumir. Se derivan del
// registro de configuración: un catálogo nuevo queda disponible como origen de
// opciones sin tener que acordarse de este archivo.
const CATALOGOS_DISPONIBLES = registro.CATALOGOS_PARA_CAMPOS;

const SECCIONES_DOCUMENTO = [
  { id: 'identificacion', nombre: 'Identificación', orden: 1 },
  { id: 'alcance', nombre: 'Alcance y sedes', orden: 2 },
  { id: 'clasificacion', nombre: 'Clasificación y control', orden: 3 },
  { id: 'adicional', nombre: 'Información adicional', orden: 4 }
];

// `bloqueado`: no puede dejar de ser obligatorio ni desactivarse.
const CAMPOS_DOCUMENTO = [
  { clave: 'nombre', etiqueta: 'Nombre del documento', tipo: 'texto', seccion: 'identificacion', orden: 10, requerido: true, bloqueado: true, minLongitud: 3, maxLongitud: 300, enListado: true, ayuda: '' },
  { clave: 'procesoId', etiqueta: 'Proceso', tipo: 'catalogo', catalogo: 'procesos', seccion: 'identificacion', orden: 20, requerido: true, bloqueado: true, enListado: true, ayuda: 'Determina las iniciales del código documental.' },
  { clave: 'subprocesoId', etiqueta: 'Subproceso', tipo: 'catalogo', catalogo: 'subprocesos', seccion: 'identificacion', orden: 30, requerido: false, enListado: false, ayuda: '' },
  { clave: 'tipoId', etiqueta: 'Tipo de documento', tipo: 'catalogo', catalogo: 'tipos_documento', seccion: 'identificacion', orden: 40, requerido: true, bloqueado: true, enListado: true, ayuda: '' },
  { clave: 'mesesRevision', etiqueta: 'Meses para la próxima revisión', tipo: 'numero', seccion: 'identificacion', orden: 50, requerido: false, minimo: 1, maximo: 60, enListado: false, ayuda: '' },
  { clave: 'descripcion', etiqueta: 'Objetivo / descripción', tipo: 'textoLargo', seccion: 'identificacion', orden: 60, requerido: false, maxLongitud: 2000, enListado: false, ayuda: '' },

  { clave: 'alcance', etiqueta: 'Alcance', tipo: 'seleccion', seccion: 'alcance', orden: 10, requerido: true, bloqueado: true, enListado: true, ayuda: 'Define el último segmento del código y quién puede ver el documento.',
    opciones: [
      { valor: 'global', etiqueta: 'Global (toda la compañía)' },
      { valor: 'regional', etiqueta: 'Regional (varios países)' },
      { valor: 'especifico', etiqueta: 'Específico de una sede' }
    ] },
  { clave: 'sedes', etiqueta: 'Sedes', tipo: 'catalogoMultiple', catalogo: 'sedes', seccion: 'alcance', orden: 20, requerido: false, bloqueado: true, enListado: true, ayuda: '' },

  { clave: 'confidencialidad', etiqueta: 'Confidencialidad', tipo: 'seleccion', seccion: 'clasificacion', orden: 10, requerido: true, bloqueado: true, enListado: true, ayuda: 'Clasificación ISO 27001.',
    opciones: [
      { valor: 'publico', etiqueta: 'Público' },
      { valor: 'interno', etiqueta: 'Interno' },
      { valor: 'confidencial', etiqueta: 'Confidencial' }
    ] },
  { clave: 'normas', etiqueta: 'Normas que impacta', tipo: 'catalogoMultiple', catalogo: 'normas', seccion: 'clasificacion', orden: 20, requerido: false, enListado: false, ayuda: '' },
  { clave: 'palabrasClave', etiqueta: 'Palabras clave', tipo: 'etiquetas', seccion: 'clasificacion', orden: 30, requerido: false, maxItems: 30, enListado: false, ayuda: 'Se usan para buscar el documento en el listado maestro.' },
  // `permitirDescargaOriginal` y `permitirImpresion` se retiraron del formulario
  // el 2026-09-25: desde entonces la descarga no se decide por documento, sino
  // por rol —administrador global o administrador del módulo documental—, y
  // dejar un interruptor que ya no hace nada es peor que no tenerlo. Los valores
  // guardados en los documentos antiguos se conservan como historia; ver
  // DocumentosService.puedeDescargarPdf.
];

const FORMULARIOS = {
  documento: {
    id: 'documento',
    nombre: 'Documento',
    modulo: 'documental',
    descripcion: 'Qué se registra al crear un documento del listado maestro.',
    secciones: SECCIONES_DOCUMENTO,
    campos: CAMPOS_DOCUMENTO,
    nota: 'El nombre, el proceso, el tipo, el alcance y la confidencialidad determinan el código ' +
      'documental, quién puede ver el documento y su ciclo de vida. Se les puede cambiar la etiqueta ' +
      'y la ayuda, pero no dejar de pedirlos: hacerlo rompería la codificación y el aislamiento por sedes.'
  },
};

const IDS_FORMULARIO = Object.keys(FORMULARIOS);

// Esqueleto del formulario pedido. Lanza 404 en lugar de caer con un `undefined`
// varias líneas más abajo, donde el mensaje no diría nada.
function esqueleto(formularioId) {
  const f = FORMULARIOS[formularioId];
  if (!f) throw httpError(404, `Formulario desconocido: "${formularioId}"`);
  return f;
}

// Solo estos atributos de un campo de sistema son editables desde el panel.
const EDITABLES_SISTEMA = ['etiqueta', 'ayuda', 'orden', 'seccion', 'enListado', 'filtrable'];
// Y estos además, si el campo no está bloqueado.
const EDITABLES_SI_NO_BLOQUEADO = ['requerido', 'activo'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CLAVE_VALIDA = /^[a-z][a-zA-Z0-9]{1,39}$/;

// Definición efectiva: campos de sistema + ajustes guardados + personalizados.
async function obtener(formularioId = 'documento') {
  const forma = esqueleto(formularioId);
  let guardado = null;
  try {
    guardado = await col('formularios').get(formularioId);
  } catch (e) {
    console.warn('[formularios] no se pudo leer la definición:', e.message);
  }

  const ajustes = new Map(((guardado && guardado.ajustes) || []).map((a) => [a.clave, a]));
  const personalizados = ((guardado && guardado.personalizados) || []).filter((c) => c && c.clave);

  const sistema = forma.campos.map((base) => {
    const a = ajustes.get(base.clave) || {};
    const campo = { ...base, sistema: true, activo: base.activo !== false };
    for (const k of EDITABLES_SISTEMA) if (a[k] !== undefined) campo[k] = a[k];
    if (!base.bloqueado) {
      for (const k of EDITABLES_SI_NO_BLOQUEADO) if (a[k] !== undefined) campo[k] = a[k];
    }
    return campo;
  });

  const propios = personalizados.map((c) => ({
    ...c,
    sistema: false,
    bloqueado: false,
    activo: c.activo !== false,
    seccion: c.seccion || 'adicional'
  }));

  const campos = [...sistema, ...propios].sort((a, b) =>
    (forma.secciones.findIndex((s) => s.id === a.seccion) - forma.secciones.findIndex((s) => s.id === b.seccion)) ||
    ((a.orden ?? 999) - (b.orden ?? 999)) ||
    a.etiqueta.localeCompare(b.etiqueta, 'es'));

  return {
    formularioId,
    nombre: forma.nombre,
    modulo: forma.modulo,
    descripcion: forma.descripcion,
    nota: forma.nota,
    secciones: forma.secciones,
    campos,
    actualizadoEn: (guardado && guardado.updatedAt) || null,
    actualizadoPor: (guardado && guardado.updatedBy) || null
  };
}

// Valida la DEFINICIÓN que envía el administrador (no los valores).
function validarDefinicion(cuerpo, formularioId = 'documento') {
  const forma = esqueleto(formularioId);
  const errores = [];
  const ajustes = [];
  const personalizados = [];

  const clavesSistema = new Set(forma.campos.map((c) => c.clave));
  const bloqueados = new Set(forma.campos.filter((c) => c.bloqueado).map((c) => c.clave));

  for (const a of cuerpo.ajustes || []) {
    if (!clavesSistema.has(a.clave)) {
      errores.push(`Ajuste sobre un campo de sistema inexistente: "${a.clave}".`);
      continue;
    }
    const limpio = { clave: a.clave };
    for (const k of EDITABLES_SISTEMA) if (a[k] !== undefined) limpio[k] = a[k];
    if (!bloqueados.has(a.clave)) {
      for (const k of EDITABLES_SI_NO_BLOQUEADO) if (a[k] !== undefined) limpio[k] = a[k];
    } else if (a.requerido === false || a.activo === false) {
      errores.push(`El campo "${a.clave}" es indispensable para el funcionamiento del módulo: ` +
        'no puede dejar de ser obligatorio ni desactivarse.');
    }
    if (limpio.etiqueta !== undefined && String(limpio.etiqueta).trim().length < 2) {
      errores.push(`La etiqueta de "${a.clave}" es demasiado corta.`);
    }
    ajustes.push(limpio);
  }

  const vistas = new Set();
  for (const c of cuerpo.personalizados || []) {
    const clave = String(c.clave || '').trim();
    if (!CLAVE_VALIDA.test(clave)) {
      errores.push(`Clave inválida: "${clave}". Use minúsculas y números, sin espacios (ej. responsableTecnico).`);
      continue;
    }
    if (clavesSistema.has(clave)) {
      errores.push(`La clave "${clave}" está reservada por un campo de sistema.`);
      continue;
    }
    if (vistas.has(clave)) { errores.push(`Clave duplicada: "${clave}".`); continue; }
    vistas.add(clave);

    if (!TIPOS.includes(c.tipo)) {
      errores.push(`El campo "${clave}" declara un tipo inválido: "${c.tipo}".`);
      continue;
    }
    if (!String(c.etiqueta || '').trim()) {
      errores.push(`El campo "${clave}" necesita una etiqueta.`);
      continue;
    }
    if (['seleccion', 'seleccionMultiple'].includes(c.tipo)) {
      const ops = (c.opciones || []).filter((o) => o && String(o.valor || '').trim());
      if (ops.length < 2) {
        errores.push(`El campo "${clave}" es de selección y necesita al menos dos opciones.`);
        continue;
      }
      c.opciones = ops.map((o) => ({ valor: String(o.valor).trim(), etiqueta: String(o.etiqueta || o.valor).trim() }));
    }
    if (['catalogo', 'catalogoMultiple'].includes(c.tipo) && !CATALOGOS_DISPONIBLES.includes(c.catalogo)) {
      errores.push(`El campo "${clave}" apunta a un catálogo no disponible: "${c.catalogo}".`);
      continue;
    }

    personalizados.push({
      clave,
      etiqueta: String(c.etiqueta).trim(),
      tipo: c.tipo,
      seccion: forma.secciones.some((s) => s.id === c.seccion) ? c.seccion : 'adicional',
      orden: Number(c.orden) || 100,
      requerido: c.requerido === true,
      activo: c.activo !== false,
      ayuda: String(c.ayuda || '').slice(0, 300),
      enListado: c.enListado === true,
      filtrable: c.filtrable === true,
      opciones: c.opciones || null,
      catalogo: c.catalogo || null,
      minimo: c.minimo ?? null,
      maximo: c.maximo ?? null,
      maxLongitud: c.maxLongitud ?? null
    });
  }

  return { ok: errores.length === 0, errores, ajustes, personalizados };
}

async function guardar(formularioId, definicion, actor) {
  const payload = {
    ajustes: definicion.ajustes,
    personalizados: definicion.personalizados,
    updatedAt: new Date().toISOString(),
    updatedBy: actor
  };
  const existe = await col('formularios').get(formularioId);
  if (existe) await col('formularios').update(formularioId, payload);
  else await col('formularios').insert({ id: formularioId, ...payload });
  return payload;
}

// ---------- Validación de VALORES de los campos personalizados ----------

// Valida `datos` contra los campos personalizados activos. Devuelve el objeto
// saneado (solo claves declaradas) o lanza 400 con el detalle.
async function validarValores(datos, formularioId = 'documento') {
  const { campos } = await obtener(formularioId);
  // Personalizados y campos de sistema `enDatos`: los dos viven en `datos`.
  const propios = campos.filter((c) => (!c.sistema || c.enDatos) && c.activo);
  const entrada = datos && typeof datos === 'object' ? datos : {};
  const errores = [];
  const salida = {};

  const desconocidas = Object.keys(entrada).filter((k) => !propios.some((c) => c.clave === k));
  if (desconocidas.length) errores.push(`Campos no declarados: ${desconocidas.join(', ')}.`);

  for (const campo of propios) {
    const valor = entrada[campo.clave];
    const vacio = valor === undefined || valor === null || valor === '' ||
      (Array.isArray(valor) && valor.length === 0);

    if (vacio) {
      if (campo.requerido) errores.push(`"${campo.etiqueta}" es obligatorio.`);
      continue;
    }

    switch (campo.tipo) {
      case 'texto':
      case 'textoLargo': {
        const s = String(valor);
        const tope = campo.maxLongitud || (campo.tipo === 'texto' ? 300 : 4000);
        if (s.length > tope) errores.push(`"${campo.etiqueta}" supera ${tope} caracteres.`);
        else salida[campo.clave] = s;
        break;
      }
      case 'numero': {
        const n = Number(valor);
        if (Number.isNaN(n)) { errores.push(`"${campo.etiqueta}" debe ser un número.`); break; }
        if (campo.minimo !== null && campo.minimo !== undefined && n < campo.minimo) {
          errores.push(`"${campo.etiqueta}" debe ser al menos ${campo.minimo}.`); break;
        }
        if (campo.maximo !== null && campo.maximo !== undefined && n > campo.maximo) {
          errores.push(`"${campo.etiqueta}" no puede superar ${campo.maximo}.`); break;
        }
        salida[campo.clave] = n;
        break;
      }
      case 'fecha': {
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) errores.push(`"${campo.etiqueta}" no es una fecha válida.`);
        else salida[campo.clave] = String(valor).slice(0, 10);
        break;
      }
      case 'booleano':
        salida[campo.clave] = valor === true || valor === 'true';
        break;
      case 'seleccion': {
        const validas = (campo.opciones || []).map((o) => o.valor);
        if (!validas.includes(valor)) errores.push(`"${campo.etiqueta}": opción inválida.`);
        else salida[campo.clave] = valor;
        break;
      }
      case 'seleccionMultiple': {
        const validas = (campo.opciones || []).map((o) => o.valor);
        const lista = Array.isArray(valor) ? valor : [valor];
        if (lista.some((v) => !validas.includes(v))) errores.push(`"${campo.etiqueta}": alguna opción es inválida.`);
        else salida[campo.clave] = [...new Set(lista)];
        break;
      }
      case 'catalogo':
      case 'catalogoMultiple': {
        const filas = await col(campo.catalogo).list((r) => r.activo !== false);
        const ids = new Set(filas.map((r) => r.id));
        const lista = Array.isArray(valor) ? valor : [valor];
        const malos = lista.filter((v) => !ids.has(v));
        if (malos.length) errores.push(`"${campo.etiqueta}": valores inexistentes (${malos.join(', ')}).`);
        else salida[campo.clave] = campo.tipo === 'catalogo' ? lista[0] : [...new Set(lista)];
        break;
      }
      case 'etiquetas': {
        const lista = (Array.isArray(valor) ? valor : [valor]).map((v) => String(v).trim()).filter(Boolean);
        const tope = campo.maxItems || 30;
        if (lista.length > tope) errores.push(`"${campo.etiqueta}": máximo ${tope} elementos.`);
        else salida[campo.clave] = [...new Set(lista)];
        break;
      }
      case 'lista': {
        // Filas de subcampos. Cada fila se sanea a las claves declaradas y se
        // valida con las mismas reglas simples; una fila totalmente vacía se
        // descarta en lugar de rechazarse (es lo que deja un «+ Agregar» sin llenar).
        if (!Array.isArray(valor)) { errores.push(`"${campo.etiqueta}" debe ser una lista.`); break; }
        const tope = campo.maxItems || 20;
        if (valor.length > tope) { errores.push(`"${campo.etiqueta}": máximo ${tope} filas.`); break; }
        const filas = [];
        valor.forEach((fila, i) => {
          if (!fila || typeof fila !== 'object') return;
          const limpia = {};
          let conDato = false;
          for (const sub of campo.subcampos || []) {
            const v = fila[sub.clave];
            const vacioSub = v === undefined || v === null || String(v).trim() === '';
            if (vacioSub) continue;
            conDato = true;
            const rotulo = `"${campo.etiqueta}" fila ${i + 1}, ${sub.etiqueta}`;
            if (sub.tipo === 'numero') {
              const n = Number(v);
              if (Number.isNaN(n)) errores.push(`${rotulo}: debe ser un número.`); else limpia[sub.clave] = n;
            } else if (sub.tipo === 'fecha') {
              if (Number.isNaN(new Date(v).getTime())) errores.push(`${rotulo}: fecha inválida.`); else limpia[sub.clave] = String(v).slice(0, 10);
            } else if (sub.tipo === 'seleccion') {
              if (!(sub.opciones || []).some((o) => o.valor === v)) errores.push(`${rotulo}: opción inválida.`); else limpia[sub.clave] = v;
            } else {
              const s = String(v).trim();
              if (s.length > (sub.maxLongitud || 300)) errores.push(`${rotulo}: supera ${sub.maxLongitud || 300} caracteres.`); else limpia[sub.clave] = s;
            }
          }
          if (!conDato) return;
          for (const sub of campo.subcampos || []) {
            if (sub.requerido && limpia[sub.clave] === undefined) errores.push(`"${campo.etiqueta}" fila ${i + 1}: falta ${sub.etiqueta}.`);
          }
          filas.push(limpia);
        });
        salida[campo.clave] = filas;
        break;
      }
      default:
        errores.push(`"${campo.etiqueta}": tipo no soportado.`);
    }
  }

  if (errores.length) {
    const err = httpError(400, 'Los datos adicionales no son válidos');
    err.details = errores;
    throw err;
  }
  return salida;
}

// Columnas personalizadas que el administrador marcó para el listado maestro.
async function columnasDeListado(formularioId = 'documento') {
  const { campos } = await obtener(formularioId);
  return campos.filter((c) => !c.sistema && c.activo && c.enListado)
    .map((c) => ({ clave: c.clave, etiqueta: c.etiqueta, tipo: c.tipo }));
}

module.exports = {
  TIPOS, CATALOGOS_DISPONIBLES, FORMULARIOS, IDS_FORMULARIO, esqueleto,
  obtener, validarDefinicion, guardar, validarValores, columnasDeListado, httpError
};
