// JSON Schemas (AJV) del módulo documental. Toda entrada se valida antes de
// tocar la base de datos (estándar OSC, doc 08 §4).
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true });
addFormats(ajv);

// Asignación de un participante del flujo: un usuario concreto, o todos los que
// ocupan un cargo / pertenecen a un grupo / trabajan en una sede.
const asignacion = {
  anyOf: [
    { type: 'string', format: 'email' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['tipo', 'valor'],
      properties: {
        // Debe coincidir con TIPOS de core/config/destinatarios.js.
        tipo: { type: 'string', enum: ['usuario', 'cargo', 'area', 'grupo', 'sede'] },
        valor: { type: 'string', minLength: 1 }
      }
    }
  ]
};

const camposDocumento = {
  nombre: { type: 'string', minLength: 3, maxLength: 300 },
  tipoId: { type: 'string', minLength: 1 },
  procesoId: { type: 'string', minLength: 1 },
  subprocesoId: { type: ['string', 'null'], default: null },
  // global = toda la compañía · regional = varios países · especifico = una sede
  alcance: { type: 'string', enum: ['global', 'regional', 'especifico'], default: 'global' },
  sedes: { type: 'array', items: { type: 'string' }, default: [] },
  normas: { type: 'array', items: { type: 'string' }, default: [] },
  palabrasClave: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 30, default: [] },
  confidencialidad: { type: 'string', enum: ['publico', 'interno', 'confidencial'], default: 'interno' },
  accesoConfidencial: { type: 'array', items: { type: 'string', format: 'email' }, default: [] },
  // AUDIENCIA del documento, con la misma gramática de asignación que los flujos:
  // por usuario, cargo, área, grupo o sede. Vacía = sin restricción adicional
  // (manda el alcance por sede y la confidencialidad, como hasta ahora).
  audienciaVisualizacion: { type: 'array', items: asignacion, maxItems: 100, default: [] },
  audienciaDescarga: { type: 'array', items: asignacion, maxItems: 100, default: [] },
  permitirDescargaOriginal: { type: 'boolean', default: false },
  // Por defecto un documento nuevo es de CONSULTA EN LÍNEA (sin descarga ni
  // impresión): quien lo crea habilita la descarga si el documento lo amerita.
  // Decisión del 2026-09-16: la documentación del SGC se consulta dentro de la
  // herramienta, no se reparte en PDF.
  permitirImpresion: { type: 'boolean', default: false },
  mesesRevision: { type: 'integer', minimum: 1, maximum: 60, default: 12 },
  descripcion: { type: 'string', maxLength: 2000, default: '' },
  // Campos personalizados que el administrador definió en /api/formularios.
  // Su forma no se conoce aquí: se validan aparte contra esa definición.
  datos: { type: 'object', default: {} }
};

const documentoNuevo = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'tipoId', 'procesoId'],
  properties: camposDocumento
};

// En edición todo es opcional (se aplica solo lo que llega) y no se admiten
// cambios de proceso/tipo: eso alteraría el código ya asignado.
//
// SIN los `default` de la creación: AJV corre con `useDefaults`, y con ellos un
// PUT que solo traía las audiencias llegaba a la ruta con alcance 'global',
// confidencialidad 'interno', mesesRevision 12, descripción vacía… y la ruta,
// que aplica todo lo que no sea undefined, sobrescribía el documento entero.
const documentoEditar = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: Object.fromEntries(
    Object.entries(camposDocumento)
      .filter(([k]) => !['tipoId', 'procesoId', 'subprocesoId'].includes(k))
      .map(([k, def]) => { const { default: _omitido, ...sinDefecto } = def; return [k, sinDefecto]; })
  )
};

const previsualizarCodigo = {
  type: 'object',
  additionalProperties: false,
  required: ['procesoId', 'tipoId'],
  properties: {
    procesoId: { type: 'string', minLength: 1 },
    tipoId: { type: 'string', minLength: 1 },
    subprocesoId: { type: ['string', 'null'], default: null },
    alcance: { type: 'string', enum: ['global', 'regional', 'especifico'], default: 'global' },
    sedes: { type: 'array', items: { type: 'string' }, default: [] }
  }
};

const enviarFlujo = {
  type: 'object',
  additionalProperties: false,
  required: ['aprobadores'],
  properties: {
    revisores: { type: 'array', items: asignacion, default: [] },
    aprobadores: { type: 'array', items: asignacion, minItems: 1 }
  }
};

const decisionFlujo = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    // 'devuelto' = devolver para ajustes: la versión pasa a en_ajustes SIN anular
    // la ronda (a diferencia del rechazo, que regresa todo a borrador).
    decision: { type: 'string', enum: ['aprobado', 'rechazado', 'devuelto'] },
    comentario: { type: 'string', maxLength: 2000, default: '' }
  }
};

// Gestión de participantes con el flujo EN CURSO: agregar a alguien que faltó o
// retirar a un pendiente (nunca a quien ya decidió: su decisión es un registro).
const participantesFlujo = {
  type: 'object',
  additionalProperties: false,
  required: ['accion', 'etapa'],
  properties: {
    accion: { type: 'string', enum: ['agregar', 'retirar'] },
    etapa: { type: 'string', enum: ['revisores', 'aprobadores'] },
    asignacion,                                            // requerida al agregar
    correo: { type: 'string', format: 'email' },           // requerido al retirar
    motivo: { type: 'string', maxLength: 500, default: '' } // obligatorio al retirar
  }
};

// Equipo elaborador de la versión en curso: co-elaboradores además del autor.
const elaboradoresFlujo = {
  type: 'object',
  additionalProperties: false,
  required: ['accion'],
  properties: {
    accion: { type: 'string', enum: ['agregar', 'retirar'] },
    asignacion,                                  // requerida al agregar
    correo: { type: 'string', format: 'email' }  // requerido al retirar
  }
};

// Reanudar un flujo devuelto para ajustes. La respuesta del elaborador queda en
// el hilo del participante que devolvió: es la evidencia del cierre del ciclo.
const reanudarFlujo = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    respuesta: { type: 'string', maxLength: 2000, default: '' }
  }
};

// Respuesta del elaborador/gestor al comentario de un participante del flujo.
const respuestaComentario = {
  type: 'object',
  additionalProperties: false,
  required: ['correo', 'texto'],
  properties: {
    correo: { type: 'string', format: 'email' },
    texto: { type: 'string', minLength: 1, maxLength: 2000 }
  }
};

// Recordatorio manual a quien tiene la decisión pendiente. Sin correo se
// recuerda a todos los pendientes de la etapa activa.
const recordatorioFlujo = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    correo: { type: 'string', format: 'email' },
    mensaje: { type: 'string', maxLength: 1000, default: '' }
  }
};

const nuevaVersion = {
  type: 'object',
  additionalProperties: false,
  required: ['controlCambios'],
  properties: {
    controlCambios: { type: 'string', minLength: 5, maxLength: 4000 }
  }
};

const obsoletizar = {
  type: 'object',
  additionalProperties: false,
  required: ['motivo'],
  properties: {
    motivo: { type: 'string', minLength: 5, maxLength: 2000 }
  }
};

// PERMISO EXCEPCIONAL por persona sobre un documento (consultar o descargar),
// con motivo obligatorio y vigencia. Ver docs/ANALISIS-PERMISOS-EXCEPCIONALES-DOCUMENTAL.md.
// `hasta` null = indefinido (el servicio decide si ese tipo lo admite para quien otorga).
const permisoDocumento = {
  type: 'object',
  additionalProperties: false,
  required: ['correo', 'tipo', 'motivo'],
  properties: {
    correo: { type: 'string', format: 'email' },
    tipo: { type: 'string', enum: ['consultar', 'descargar'] },
    motivo: { type: 'string', minLength: 10, maxLength: 1000 },
    hasta: { type: ['string', 'null'], format: 'date', default: null }
  }
};

const motivoPermiso = {
  type: 'object',
  additionalProperties: false,
  required: ['motivo'],
  properties: {
    motivo: { type: 'string', minLength: 5, maxLength: 1000 }
  }
};

const externo = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'tipo'],
  properties: {
    codigoExterno: { type: 'string', maxLength: 100, default: '' },
    nombre: { type: 'string', minLength: 3, maxLength: 300 },
    tipo: { type: 'string', minLength: 1, maxLength: 100 },
    version: { type: 'string', maxLength: 50, default: '' },
    origen: { type: 'string', maxLength: 200, default: '' },
    url: { type: 'string', maxLength: 1000, default: '' },
    procesoId: { type: ['string', 'null'], default: null },
    fechaImplementacion: { type: ['string', 'null'], default: null },
    notas: { type: 'string', maxLength: 2000, default: '' }
  }
};

// Una solicitud tiene que decir DE QUÉ documento habla y a qué proceso pertenece:
// sin eso, quien la atiende no sabe si le corresponde ni puede buscarla después.
const solicitud = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo', 'nombreDocumento', 'procesoId', 'descripcion', 'responsable'],
  properties: {
    tipo: { type: 'string', enum: ['creacion', 'modificacion', 'eliminacion'] },
    nombreDocumento: { type: 'string', minLength: 3, maxLength: 300 },
    procesoId: { type: 'string', minLength: 1 },
    documentoId: { type: ['string', 'null'], default: null },
    descripcion: { type: 'string', minLength: 5, maxLength: 4000 },
    responsable: { type: 'string', format: 'email' }
  }
};

const respuestaSolicitud = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', enum: ['atendida', 'rechazada'] },
    respuesta: { type: 'string', maxLength: 4000, default: '' }
  }
};

const validadores = {
  documentoNuevo: ajv.compile(documentoNuevo),
  documentoEditar: ajv.compile(documentoEditar),
  previsualizarCodigo: ajv.compile(previsualizarCodigo),
  enviarFlujo: ajv.compile(enviarFlujo),
  decisionFlujo: ajv.compile(decisionFlujo),
  participantesFlujo: ajv.compile(participantesFlujo),
  elaboradoresFlujo: ajv.compile(elaboradoresFlujo),
  reanudarFlujo: ajv.compile(reanudarFlujo),
  respuestaComentario: ajv.compile(respuestaComentario),
  recordatorioFlujo: ajv.compile(recordatorioFlujo),
  nuevaVersion: ajv.compile(nuevaVersion),
  obsoletizar: ajv.compile(obsoletizar),
  permisoDocumento: ajv.compile(permisoDocumento),
  motivoPermiso: ajv.compile(motivoPermiso),
  externo: ajv.compile(externo),
  solicitud: ajv.compile(solicitud),
  respuestaSolicitud: ajv.compile(respuestaSolicitud)
};

// Middleware de validación: responde 400 con el detalle si el body no cumple.
function validar(nombre) {
  const fn = validadores[nombre];
  return (req, res, next) => {
    if (!fn(req.body)) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: fn.errors.map((e) => `${e.instancePath || 'body'} ${e.message}`)
      });
    }
    next();
  };
}

module.exports = { validar };
