// REGISTRO DE LA CONFIGURACIÓN DEL SGC, AGRUPADA POR MÓDULO.
//
// Mismo principio que `core/accesos/registry.js`: el catálogo de lo que se puede
// configurar vive en CÓDIGO. Desde la interfaz se administra el contenido de cada
// catálogo, nunca la lista de catálogos: así nadie puede inventar una pestaña que
// escriba en una colección que la política de costo no declaró.
//
// Por qué existe este archivo y no una lista de pestañas en el frontend:
//
//   · Antes el panel tenía siete pestañas planas —todas del módulo documental— y
//     los catálogos de mejoramiento (`tipos_hallazgo`, `fuentes_hallazgo`) no
//     aparecían en ninguna parte aunque el backend ya los servía. El síntoma en
//     pantalla fue un select vacío en "Nueva acción", que es el peor de los
//     fallos: no dice qué falta, solo no ofrece nada.
//   · Con la agrupación por módulo el hueco se ve. Un módulo declarado sin
//     catálogos aparece igual, con su lista de lo que le falta configurar.
//
// CATÁLOGOS GLOBALES: los que usan varios módulos (`modulo: 'global'`). Se
// administran una sola vez, y se muestran además dentro de cada módulo de
// `usadoPor` con el aviso de a quién más afecta el cambio. Ese aviso es el punto:
// quien retira una sede porque el módulo documental ya no la necesita tiene que
// enterarse de que también desaparece de los hallazgos y de las inspecciones.

// Los ocho módulos pendientes están declarados desde ya, con `pendiente`
// describiendo qué se configurará ahí. No es documentación decorativa: es lo que
// evita que el módulo se desarrolle y su parametrización se descubra después,
// cuando ya hay registros creados sin ella.
const MODULOS = [
  {
    id: 'global',
    nombre: 'Global',
    estado: 'activo',
    descripcion: 'Catálogos y parámetros que comparten varios módulos. ' +
      'Se administran aquí una sola vez y cada módulo los hereda.'
  },
  {
    id: 'documental',
    nombre: 'Gestión Documental',
    estado: 'activo',
    descripcion: 'Tipos de documento, plantillas institucionales, glosario y reglas del ciclo de vida.'
  },
];

// Todos los módulos que hoy consumen un catálogo transversal. Se escribe la lista
// completa —incluidos los que están por desarrollar— porque el aviso "esto también
// afecta a…" tiene que ser cierto el día que el módulo entre en producción, no
// después de que alguien recuerde volver a este archivo.
const TODOS_LOS_MODULOS = MODULOS.filter((m) => m.id !== 'global').map((m) => m.id);

// `editor` dice qué componente del panel dibuja el catálogo. 'simple' se resuelve
// genéricamente a partir de `campos`: un catálogo nuevo de nombre y descripción
// solo necesita su entrada aquí, sin código de interfaz.
//
// `idDeNegocio`: el id lo define el negocio (un código legible) y no un UUID.
// `idDesde`: de qué campo se deriva ese id al crear la fila.
const CATALOGOS = [
  // ---------- Global ----------
  {
    id: 'procesos',
    etiqueta: 'Procesos',
    singular: 'proceso',
    modulo: 'global',
    usadoPor: TODOS_LOS_MODULOS,
    editor: 'procesos',
    idDeNegocio: true,
    descripcion: 'Mapa de procesos y subprocesos de la compañía.',
    avisos: [{
      tono: 'alerta',
      texto: 'La sigla del proceso va embebida en el código de cada documento suyo. ' +
        'Corregirla aquí no reescribe los códigos ya emitidos: para eso está «Actualizar códigos», ' +
        'que muestra qué cambiaría y conserva el código anterior en el histórico.'
    }]
  },
  {
    id: 'tipos_proceso',
    etiqueta: 'Cadena de valor',
    singular: 'tipo de proceso',
    modulo: 'global',
    usadoPor: TODOS_LOS_MODULOS,
    editor: 'simple',
    idDeNegocio: true,
    idDesde: 'codigo',
    descripcion: 'Los grupos de la cadena de valor en que se clasifica cada proceso (estratégicos, operativos, de apoyo, de asesoría…).',
    campos: [
      { clave: 'codigo', etiqueta: 'Código', requerido: true, maxLength: 12, mayusculas: true, tamano: 'corto' },
      { clave: 'nombre', etiqueta: 'Nombre', requerido: true, tamano: 'largo' },
      { clave: 'etiqueta', etiqueta: 'Etiqueta en el mapa (corta)', tamano: 'medio' },
      { clave: 'orden', etiqueta: 'Orden', maxLength: 3, tamano: 'corto' }
    ],
    avisos: [
      {
        tono: 'info',
        texto: 'Cada proceso se clasifica en uno de estos grupos (catálogo de Procesos › Cadena de valor). ' +
          'El mapa de procesos dibuja un sector del anillo por cada grupo, en este orden, con la etiqueta corta.'
      },
      {
        tono: 'alerta',
        texto: 'Antes de inactivar un grupo, reclasifique los procesos que lo usan: si no, quedan fuera del mapa.'
      }
    ]
  },
  {
    id: 'sedes',
    etiqueta: 'Sedes / países',
    singular: 'sede',
    modulo: 'global',
    usadoPor: ['documental'],
    editor: 'simple',
    idDeNegocio: true,
    idDesde: 'codigo',
    descripcion: 'Países y sedes donde opera la compañía.',
    campos: [
      { clave: 'codigo', etiqueta: 'Código (3 letras)', requerido: true, maxLength: 3, mayusculas: true, tamano: 'corto' },
      { clave: 'nombre', etiqueta: 'Nombre', requerido: true, tamano: 'largo' },
      // Zona horaria IANA (America/Mexico_City). Las capacitaciones la usan para
      // mostrar la hora equivalente en cada país y para crear el evento de
      // Google Calendar en la hora local de la sede. Vacía: lib/zonasHorarias.js
      // trae la de cada país sembrado.
      { clave: 'zonaHoraria', etiqueta: 'Zona horaria (IANA, p. ej. America/Lima)', requerido: false, maxLength: 60, tamano: 'largo' },
      // Moneda local ISO 4217 (COP, MXN, USD…). Talento Humano registra los
      // costos de nómina de cada persona en la moneda de su sede y muestra el
      // equivalente en dólares con la tasa PRESUPUESTAL de finanzas
      // (core/tasasPresupuesto). Vacía: la pestaña «Costos y nómina» avisa que
      // la sede no tiene moneda y no convierte.
      { clave: 'moneda', etiqueta: 'Moneda local (ISO 4217, p. ej. COP)', requerido: false, maxLength: 3, mayusculas: true, tamano: 'corto' }
    ],
    avisos: [
      {
        tono: 'info',
        texto: 'El código de la sede (3 letras) es el que aparece al final de los documentos ' +
          'con alcance específico, por ejemplo GETI-DSS-PRO-7-COL.'
      },
      {
        tono: 'alerta',
        texto: 'El código va embebido en el de cada documento. Corregirlo aquí no reescribe los ' +
          'códigos ya emitidos: use «Actualizar códigos» en el catálogo de Procesos.'
      }
    ]
  },
  {
    id: 'normas',
    etiqueta: 'Normas',
    singular: 'norma',
    modulo: 'global',
    usadoPor: ['documental'],
    editor: 'simple',
    idDeNegocio: true,
    idDesde: 'nombre',
    descripcion: 'Normas y requisitos que el sistema de gestión debe cumplir.',
    campos: [
      { clave: 'nombre', etiqueta: 'Nombre', requerido: true, tamano: 'largo' },
      { clave: 'descripcion', etiqueta: 'Descripción', tamano: 'largo', secundario: true }
    ]
  },
  {
    id: 'grupos',
    etiqueta: 'Grupos',
    singular: 'grupo',
    modulo: 'global',
    usadoPor: TODOS_LOS_MODULOS,
    editor: 'grupos',
    idDeNegocio: true,
    descripcion: 'Conjuntos de personas con nombre de negocio, para asignar de una sola vez.',
    avisos: [{
      tono: 'info',
      texto: 'Los grupos permiten asignar de una sola vez a varias personas: revisión y aprobación ' +
        'de documentos, visualización y descarga, y los responsables de los demás módulos. ' +
        'Definidos por área, cargo o sede se resuelven contra el directorio de Talento Humano, así ' +
        'que un cambio de personal no rompe lo configurado; definidos por usuarios seleccionados, ' +
        'la lista se mantiene aquí.'
    }]
  },
  {
    id: 'usuarios',
    etiqueta: 'Usuarios',
    singular: 'usuario',
    modulo: 'global',
    usadoPor: TODOS_LOS_MODULOS,
    editor: 'simple',
    idDeNegocio: false,
    descripcion: 'Las personas que pueden entrar: nombre, cargo, área y sede. Es el directorio de esta instalación.',
    campos: [
      { clave: 'nombre', etiqueta: 'Nombre completo', requerido: true, tamano: 'largo' },
      { clave: 'correo', etiqueta: 'Correo (es el identificador)', requerido: true, tamano: 'medio' },
      { clave: 'cargo', etiqueta: 'Cargo', tamano: 'medio' },
      { clave: 'area', etiqueta: 'Área', tamano: 'medio' },
      { clave: 'sedeId', etiqueta: 'Sede (id del catálogo de sedes: ecu)', maxLength: 3, tamano: 'corto' },
      { clave: 'descripcion', etiqueta: 'Descripción en la pantalla de ingreso', tamano: 'largo', secundario: true },
      { clave: 'clave', etiqueta: 'Clave de ingreso (vacía: no cambia · «-»: quitarla)', tamano: 'medio', secundario: true }
    ],
    avisos: [
      {
        tono: 'info',
        texto: 'Esta instalación no tiene login: en la pantalla de ingreso cada persona elige con quién entra. ' +
          'Quien tenga una clave aquí tendrá que escribirla; quien no, entra con solo elegirse. ' +
          'La clave se guarda cifrada y no se vuelve a mostrar: «••••» indica que la persona tiene una. ' +
          'Los permisos (administrador, líder de proceso, aprobador) se reparten en Gestión de Accesos con el correo.'
      },
      {
        tono: 'alerta',
        texto: 'El cargo, el área y la sede alimentan los flujos y las audiencias «por cargo», «por área» y «por sede», ' +
          'y los grupos definidos por esas reglas. Cámbielos aquí y se reflejan en todo.'
      }
    ]
  },
  {
    id: 'parametros',
    etiqueta: 'Parámetros',
    singular: 'parámetro',
    modulo: 'global',
    usadoPor: TODOS_LOS_MODULOS,
    editor: 'parametros',
    idDeNegocio: true,
    // No se crean ni se inactivan desde la interfaz: cada parámetro existe porque
    // hay código que lo lee. Solo se cambia su valor.
    soloEdicion: true,
    descripcion: 'Valores que cambian el comportamiento del sistema para todos los usuarios.',
    avisos: [{
      tono: 'info',
      texto: 'Estos valores aplican a todos los usuarios. Los sufijos de código solo afectan ' +
        'a los documentos que se creen de aquí en adelante.'
    }]
  },

  // ---------- Gestión Documental ----------
  {
    id: 'tipos_documento',
    etiqueta: 'Tipos de documento',
    singular: 'tipo de documento',
    modulo: 'documental',
    usadoPor: ['documental'],
    editor: 'simple',
    idDeNegocio: true,
    idDesde: 'codigo',
    descripcion: 'Política, procedimiento, formato, instructivo…',
    campos: [
      { clave: 'codigo', etiqueta: 'Código', requerido: true, maxLength: 5, mayusculas: true, tamano: 'corto' },
      { clave: 'nombre', etiqueta: 'Nombre', requerido: true, tamano: 'largo' },
      {
        clave: 'permiteOriginal',
        etiqueta: 'Permite descargar el editable',
        etiquetaCorta: 'Permite editable',
        tipo: 'booleano',
        textoSi: 'Permite editable',
        textoNo: 'Solo PDF'
      }
    ],
    avisos: [
      {
        tono: 'info',
        texto: 'Marque «permite descargar el editable» en los tipos que se diligencian (formatos): ' +
          'esos son los únicos que permiten descargar el archivo original.'
      },
      {
        tono: 'alerta',
        texto: 'El código va embebido en el de cada documento. Corregirlo aquí no reescribe los ' +
          'códigos ya emitidos: use «Actualizar códigos» en el catálogo de Procesos.'
      }
    ]
  },
  {
    id: 'plantillas',
    etiqueta: 'Plantillas',
    singular: 'plantilla',
    modulo: 'documental',
    usadoPor: ['documental'],
    editor: 'plantillas',
    idDeNegocio: false,
    descripcion: 'Archivos institucionales base para crear un documento sin partir de cero.',
    avisos: [{
      tono: 'info',
      texto: 'Cargue aquí los archivos institucionales base. Al crear un documento, quien lo elabora ' +
        'podrá descargar la plantilla del tipo correspondiente y trabajar sobre ella.'
    }]
  },
  {
    id: 'definiciones',
    etiqueta: 'Glosario',
    singular: 'término',
    modulo: 'documental',
    usadoPor: ['documental'],
    editor: 'simple',
    idDeNegocio: false,
    idDesde: 'termino',
    descripcion: 'Términos del sistema de gestión y su definición.',
    campos: [
      { clave: 'termino', etiqueta: 'Término', requerido: true, tamano: 'medio' },
      { clave: 'definicion', etiqueta: 'Definición', requerido: true, tamano: 'largo' },
      { clave: 'fuente', etiqueta: 'Fuente', tamano: 'medio', secundario: true }
    ],
    avisos: [{
      tono: 'info',
      texto: 'Los mismos términos se consultan desde Gestión Documental › Glosario, que además ' +
        'permite crearlos. Aquí se corrigen y se retiran, que es lo que esa pantalla no ofrece.'
    }]
  },

];

// Módulo al que pertenece cada PARÁMETRO. La colección es una sola, pero sus
// filas no son todas del mismo módulo: `sufijoGlobal` es del documental y
// `diasLimiteActualizacionIndicadores` es de indicadores. Sin esta tabla la
// pestaña de un módulo mostraría los parámetros de todos, que es exactamente el
// desorden que la agrupación viene a resolver.
//
// Un parámetro que no esté aquí se considera global y aparece en todas partes:
// preferible mostrarlo de más que esconderlo.
const MODULO_DE_PARAMETRO = {
  diasAlertaRevision: 'documental',
  mesesRevisionPorDefecto: 'documental',
  diasPlazoDecision: 'documental',
  diasFrecuenciaRecordatorio: 'documental',
  sufijoGlobal: 'documental',
  sufijoRegional: 'documental',
  exigirArchivoOriginal: 'documental',
  exigirSegregacionFunciones: 'documental',
  extensionesOriginal: 'documental',
  diasMaximoPermisoDocumento: 'documental',
  // modoPruebasModulos y modoPruebasCorreos son globales a propósito: aplican a
  // cualquier módulo y se ven desde la pestaña Global.
};

const IDS = CATALOGOS.map((c) => c.id);
const IDS_DE_NEGOCIO = CATALOGOS.filter((c) => c.idDeNegocio).map((c) => c.id);

function catalogo(id) {
  return CATALOGOS.find((c) => c.id === id) || null;
}

// Catálogos que un campo de formulario parametrizable puede consumir. Se derivan
// del registro y no de una segunda lista: un catálogo nuevo queda disponible como
// origen de opciones sin que haya que recordar otro archivo. `cargos` no está en
// el registro porque no se administra aquí (viene del directorio de Talento
// Humano), pero sí se puede consumir.
const CATALOGOS_PARA_CAMPOS = [...IDS.filter((id) => !['parametros', 'usuarios'].includes(id)), 'cargos'];

// Lo que consume el panel: los módulos, y para cada catálogo qué módulos comparte.
// Se envía el registro completo y el panel decide qué pestaña dibuja; así el
// frontend no mantiene su propia copia de la lista, que es cómo aparecieron los
// dos catálogos huérfanos.
function paraPanel() {
  return {
    modulos: MODULOS,
    catalogos: CATALOGOS,
    moduloDeParametro: MODULO_DE_PARAMETRO
  };
}

module.exports = {
  MODULOS, CATALOGOS, IDS, IDS_DE_NEGOCIO, MODULO_DE_PARAMETRO,
  TODOS_LOS_MODULOS, CATALOGOS_PARA_CAMPOS, catalogo, paraPanel
};
