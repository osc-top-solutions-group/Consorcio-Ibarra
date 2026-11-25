// Pruebas de los tres frentes cerrados antes del despliegue:
//   · almacenamiento de archivos (adaptador de storage y control de descarga)
//   · notificaciones y plantillas de correo
//   · recodificación con trazabilidad de códigos anteriores
const path = require('path');
const plantillas = require('../lib/plantillasCorreo');
const storage = require('../lib/storage');

const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';
const ADMIN = 'cristian.moreno@ejemplo.com';   // administrador del SGC
const LIDER = 'javier.correa@ejemplo.com';     // líder de proceso, no administrador

let ok = 0;
let fallos = 0;

function afirmar(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.log(`  ✗ ${nombre} ${detalle}`);
  }
}

async function pedir(ruta, { como = ADMIN, metodo = 'GET', body, cruda = false } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'x-dev-user-email': como,
      'X-Requested-With': 'XMLHttpRequest',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (cruda) return res;
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { status: res.status, datos };
}

// Sube archivos a la versión en borrador de un documento.
async function subirArchivos(docId, { pdf, original } = {}, como = ADMIN) {
  const form = new FormData();
  if (pdf) form.append('pdf', new Blob([pdf.contenido], { type: 'application/pdf' }), pdf.nombre);
  if (original) {
    form.append('original', new Blob([original.contenido], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }), original.nombre);
  }
  const res = await fetch(`${BASE}/documental/documentos/${docId}/archivos`, {
    method: 'POST',
    headers: { 'x-dev-user-email': como, 'X-Requested-With': 'XMLHttpRequest' },
    body: form
  });
  return { status: res.status, datos: await res.json().catch(() => null) };
}

async function verificarEntorno() {
  const salud = await (await fetch(`${BASE}/health`)).json();
  if (salud.raiz === 'sgc') {
    console.error('\nABORTADO: el backend apunta a la raíz de producción "sgc".');
    process.exit(1);
  }
  console.log(`Raíz Firestore: ${salud.raiz}`);
  console.log(`Almacenamiento: ${salud.almacenamiento}`);
  console.log(`Correo: ${salud.correo}`);
  return salud;
}

// Sufijo estable por corrida para no chocar con datos de corridas anteriores.
const marca = String(process.hrtime.bigint()).slice(-6);

(async () => {
  const salud = await verificarEntorno();

  console.log('\n=== Almacenamiento: adaptador y salud ===');
  afirmar('/health informa dónde quedan los archivos',
    typeof salud.almacenamiento === 'string' && salud.almacenamiento.length > 0, salud.almacenamiento);
  afirmar('/health informa el estado del correo',
    typeof salud.correo === 'string' && salud.correo.length > 0, salud.correo);
  afirmar('la clave del objeto agrupa por módulo, documento y versión',
    storage.buildKey('documental', 'abc', 3, 'Política de Calidad.pdf')
      .startsWith('documental/abc/v3/'),
    storage.buildKey('documental', 'abc', 3, 'Política de Calidad.pdf'));
  // Lo que importa no es que desaparezcan los puntos, sino que un nombre
  // hostil no pueda salirse del prefijo previsto ni añadir segmentos de ruta.
  const claveHostil = storage.buildKey('documental', 'abc', 1, '../../etc/passwd');
  afirmar('un nombre con recorrido de directorios no escapa del prefijo',
    claveHostil.startsWith('documental/abc/v1/') &&
    claveHostil.split('/').length === 4 &&
    !claveHostil.includes('..'),
    claveHostil);
  afirmar('un nombre que es solo puntos no produce un segmento de recorrido',
    !storage.buildKey('documental', 'abc', 1, '..').split('/').includes('..'),
    storage.buildKey('documental', 'abc', 1, '..'));
  afirmar('el tipo MIME se deduce de la extensión',
    storage.tipoMime('a.pdf') === 'application/pdf' &&
    storage.tipoMime('a.docx').includes('wordprocessingml'),
    storage.tipoMime('a.docx'));

  console.log('\n=== Almacenamiento: subir y recuperar un archivo ===');
  const doc = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: {
      nombre: `Procedimiento de prueba de archivos ${marca}`,
      procesoId: 'geti', tipoId: 'pro', alcance: 'global'
    }
  });
  afirmar('crea el documento de prueba', doc.status === 201, JSON.stringify(doc.datos));

  const contenidoPdf = `%PDF-1.4 contenido de prueba ${marca}`;
  const subida = await subirArchivos(doc.datos.id, {
    pdf: { nombre: 'Política de Calidad.pdf', contenido: contenidoPdf },
    original: { nombre: 'Política de Calidad.docx', contenido: 'contenido editable' }
  });
  afirmar('sube el PDF y el original', subida.status === 200, JSON.stringify(subida.datos).slice(0, 200));

  const guardado = (subida.datos.versiones || [])[0];
  afirmar('la versión quedó con la clave del PDF',
    Boolean(guardado && guardado.archivos && guardado.archivos.pdf && guardado.archivos.pdf.key),
    JSON.stringify(guardado && guardado.archivos));

  const descarga = await pedir(`/documental/documentos/${doc.datos.id}/archivo/1/pdf`, { cruda: true });
  const recuperado = await descarga.text();
  afirmar('el archivo recuperado es idéntico al subido', recuperado === contenidoPdf,
    `${recuperado.slice(0, 40)} (status ${descarga.status})`);
  afirmar('se sirve con el tipo de contenido correcto',
    (descarga.headers.get('content-type') || '').includes('application/pdf'),
    descarga.headers.get('content-type'));
  afirmar('se sirve en línea por defecto (consulta, no descarga)',
    (descarga.headers.get('content-disposition') || '').startsWith('inline'),
    descarga.headers.get('content-disposition'));
  afirmar('el nombre con tildes viaja codificado en UTF-8',
    (descarga.headers.get('content-disposition') || '').includes("filename*=UTF-8''"),
    descarga.headers.get('content-disposition'));

  afirmar('no se cachea en el navegador (Cache-Control: no-store)',
    descarga.headers.get('cache-control') === 'no-store', descarga.headers.get('cache-control'));

  // Consulta en línea SOLO dentro de la herramienta: abrir el enlace en una
  // pestaña (sin el header que pone el frontend) responde 403. Antes eso daba el
  // visor nativo del navegador con botón de descarga.
  const enPestana = await fetch(`${BASE}/documental/documentos/${doc.datos.id}/archivo/1/pdf`, {
    headers: { 'x-dev-user-email': ADMIN }
  });
  afirmar('la consulta en línea fuera de la app (sin X-Requested-With) → 403', enPestana.status === 403,
    `status ${enPestana.status}`);

  const comoDescarga = await pedir(`/documental/documentos/${doc.datos.id}/archivo/1/pdf?descargar=1`, { cruda: true });
  afirmar('con ?descargar=1 se entrega como adjunto',
    (comoDescarga.headers.get('content-disposition') || '').startsWith('attachment'),
    comoDescarga.headers.get('content-disposition'));

  const inexistente = await pedir(`/documental/documentos/${doc.datos.id}/archivo/9/pdf`);
  afirmar('una versión sin archivo responde 404', inexistente.status === 404, `status ${inexistente.status}`);

  // Multer decodifica el nombre multipart como latin1: sin corregirlo,
  // "Política.pdf" se guardaba y se devolvía como "PolÃ­tica.pdf".
  afirmar('el nombre subido conserva las tildes',
    guardado.archivos.pdf.nombre === 'Política de Calidad.pdf', guardado.archivos.pdf.nombre);
  afirmar('nombreCliente revierte la decodificación latin1 de multer',
    storage.nombreCliente('PolÃ­tica Ã±andÃº.pdf') === 'Política ñandú.pdf',
    storage.nombreCliente('PolÃ­tica Ã±andÃº.pdf'));
  // Bytes que no forman UTF-8 válido: se respeta el nombre tal como llegó en
  // vez de reemplazar los caracteres por rombos.
  afirmar('nombreCliente no destruye un nombre latin1 genuino',
    storage.nombreCliente('AnexoÌ.pdf') === 'AnexoÌ.pdf',
    storage.nombreCliente('AnexoÌ.pdf'));
  afirmar('nombreCliente deja intacto un nombre ASCII',
    storage.nombreCliente('Report 2026.pdf') === 'Report 2026.pdf');
  afirmar('nombreCliente respeta un nombre que ya venía correcto',
    storage.nombreCliente('Política.pdf') === 'Política.pdf',
    storage.nombreCliente('Política.pdf'));

  console.log('\n=== Correo: registro del envío ===');
  // Enviar a flujo dispara la notificación obligatoria de tarea asignada.
  const flujo = await pedir(`/documental/documentos/${doc.datos.id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [LIDER] }
  });
  afirmar('envía el documento a flujo', flujo.status === 200, JSON.stringify(flujo.datos).slice(0, 200));

  const pendientes = await pedir('/pendientes', { como: LIDER });
  afirmar('el aprobador ve la tarea en su bandeja',
    Array.isArray(pendientes.datos) && pendientes.datos.some((p) => p.refId === doc.datos.id),
    JSON.stringify(pendientes.datos).slice(0, 160));

  console.log('\n=== Correo: plantilla HTML ===');
  const html = plantillas.envolver({
    etiqueta: 'Tarea asignada',
    titulo: 'Tiene un documento pendiente de aprobación',
    parrafos: ['Se le asignó la <strong>aprobación</strong> de un documento.'],
    datos: [{ campo: 'Código', valor: 'GETI-PRO-1-GLO' }, { campo: 'Vacío', valor: null }],
    accion: { texto: 'Aprobar documento', url: plantillas.enlace('/documental/documentos/abc') },
    nota: 'Mientras no registre su decisión, el documento no avanza.'
  });
  afirmar('la plantilla incluye el título y el dato', html.includes('pendiente de aprobación') && html.includes('GETI-PRO-1-GLO'));
  afirmar('omite las filas sin valor', !html.includes('Vacío'));
  afirmar('el botón apunta al dominio de producción',
    html.includes('https://sgc.ejemplo.com/documental/documentos/abc'));
  afirmar('usa el color primario de la identidad OSC', html.includes('#20248a'));
  afirmar('los estilos van en línea (los clientes descartan las hojas de estilo)',
    !html.includes('<style') && html.includes('style="'));

  const inyeccion = plantillas.generico({
    asunto: 'la plataforma: prueba',
    cuerpo: '<script>alert(1)</script> texto & "citado"',
    ruta: '/documental'
  });
  afirmar('escapa el HTML del contenido recibido',
    !inyeccion.includes('<script>') && inyeccion.includes('&lt;script&gt;'));
  afirmar('el asunto pierde el prefijo técnico en el título', !inyeccion.includes('>la plataforma: prueba<'));

  console.log('\n=== Recodificación: un documento ===');
  const doc2 = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { nombre: `Documento a recodificar ${marca}`, procesoId: 'geti', tipoId: 'pro', alcance: 'global' }
  });
  afirmar('crea el documento a recodificar', doc2.status === 201, JSON.stringify(doc2.datos));
  const codigoOriginal = doc2.datos.codigo;
  const consecutivoOriginal = doc2.datos.consecutivo;

  const sinMotivo = await pedir(`/documental/documentos/${doc2.datos.id}/recodificar`, {
    metodo: 'POST', body: { codigo: `ZZZ-PRO-${marca}-GLO` }
  });
  afirmar('recodificar sin motivo → 400', sinMotivo.status === 400, JSON.stringify(sinMotivo.datos));

  const comoLider = await pedir(`/documental/documentos/${doc2.datos.id}/recodificar`, {
    como: LIDER, metodo: 'POST', body: { codigo: `ZZZ-PRO-${marca}-GLO`, motivo: 'intento sin permiso' }
  });
  afirmar('un líder de proceso NO puede recodificar', comoLider.status === 403, `status ${comoLider.status}`);

  const codigoNuevo = `ZZZ-PRO-${marca}-GLO`;
  const recod = await pedir(`/documental/documentos/${doc2.datos.id}/recodificar`, {
    metodo: 'POST', body: { codigo: codigoNuevo, motivo: 'La sigla del proceso estaba mal definida' }
  });
  afirmar('el administrador recodifica', recod.status === 200, JSON.stringify(recod.datos).slice(0, 200));
  afirmar('el código quedó actualizado', recod.datos.codigo === codigoNuevo, recod.datos.codigo);
  afirmar('el código anterior quedó archivado con motivo y responsable',
    (recod.datos.codigosAnteriores || []).some((c) =>
      c.codigo === codigoOriginal && c.motivo && c.por === ADMIN),
    JSON.stringify(recod.datos.codigosAnteriores));
  afirmar('el consecutivo NO cambió (sigue siendo el mismo de su serie)',
    recod.datos.consecutivo === consecutivoOriginal,
    `${consecutivoOriginal} → ${recod.datos.consecutivo}`);

  const mismo = await pedir(`/documental/documentos/${doc2.datos.id}/recodificar`, {
    metodo: 'POST', body: { codigo: codigoNuevo, motivo: 'otra vez' }
  });
  afirmar('recodificar al mismo código → 409', mismo.status === 409, JSON.stringify(mismo.datos));

  const choque = await pedir(`/documental/documentos/${doc.datos.id}/recodificar`, {
    metodo: 'POST', body: { codigo: codigoNuevo, motivo: 'robar el código de otro' }
  });
  afirmar('un código ya usado por otro documento → 409', choque.status === 409, JSON.stringify(choque.datos));

  const choqueHistorico = await pedir(`/documental/documentos/${doc.datos.id}/recodificar`, {
    metodo: 'POST', body: { codigo: codigoOriginal, motivo: 'reusar un código retirado' }
  });
  afirmar('un código retirado tampoco se reutiliza', choqueHistorico.status === 409,
    JSON.stringify(choqueHistorico.datos));

  console.log('\n=== Trazabilidad: el código viejo sigue llevando al documento ===');
  const porViejo = await pedir(`/documental/documentos/por-codigo/${encodeURIComponent(codigoOriginal)}`);
  afirmar('resuelve el documento por su código retirado',
    porViejo.status === 200 && porViejo.datos.id === doc2.datos.id, JSON.stringify(porViejo.datos));
  afirmar('avisa que el código consultado es histórico',
    porViejo.datos.codigoConsultadoEsHistorico === true, JSON.stringify(porViejo.datos));
  afirmar('informa el código vigente que lo reemplazó',
    porViejo.datos.codigo === codigoNuevo, porViejo.datos.codigo);
  afirmar('expone el motivo del cambio',
    Boolean(porViejo.datos.cambio && porViejo.datos.cambio.motivo), JSON.stringify(porViejo.datos.cambio));

  const porVigente = await pedir(`/documental/documentos/por-codigo/${encodeURIComponent(codigoNuevo)}`);
  afirmar('resuelve también por el código vigente',
    porVigente.status === 200 && porVigente.datos.codigoConsultadoEsHistorico === false,
    JSON.stringify(porVigente.datos));

  const noExiste = await pedir('/documental/documentos/por-codigo/NO-EXISTE-1-GLO');
  afirmar('un código inexistente → 404', noExiste.status === 404, `status ${noExiste.status}`);

  const busqueda = await pedir(`/documental/documentos?q=${encodeURIComponent(codigoOriginal)}`);
  afirmar('el listado encuentra el documento buscando por el código viejo',
    Array.isArray(busqueda.datos) && busqueda.datos.some((d) => d.id === doc2.datos.id),
    JSON.stringify((busqueda.datos || []).map((d) => d.codigo)));
  afirmar('el listado expone los códigos anteriores',
    (busqueda.datos.find((d) => d.id === doc2.datos.id) || {}).codigosAnteriores
      .includes(codigoOriginal),
    JSON.stringify(busqueda.datos.find((d) => d.id === doc2.datos.id)));

  console.log('\n=== Recodificación masiva al corregir la sigla de un proceso ===');
  // Proceso de prueba con id FIJO. Un id por corrida iba dejando un proceso más
  // en el catálogo del entorno de desarrollo cada vez que se ejecutaban las
  // pruebas, y el panel de configuración terminaba lleno de "Proceso de prueba".
  // Se inactiva antes de crearlo para partir de un estado conocido: el POST sobre
  // un id inactivo lo reactiva con la sigla de partida.
  //
  // EL ID LO DECIDE EL SERVIDOR, no este cuerpo: desde la corrección de siglas
  // (config/index.js) el id de un proceso SALE de su sigla en minúsculas. Por
  // eso se limpian los dos ids que esta prueba ha usado a lo largo del tiempo
  // —el heredado y el que genera cada una de las dos siglas— y después se
  // trabaja con el id que devuelve la creación. Cuando la prueba asumía el id,
  // dejaba vivo el proceso real y la corrida siguiente chocaba por sigla
  // repetida: pasaba en limpio y fallaba al repetirse.
  for (const viejo of ['zrec-prueba', 'zrprb', 'zqprb']) {
    await pedir(`/config/procesos/${viejo}`, { metodo: 'DELETE' });
  }
  const crearProceso = await pedir('/config/procesos', {
    metodo: 'POST',
    body: { codigo: 'ZRPRB', nombre: 'Proceso de prueba (recodificación)', tipo: 'apoyo', orden: 98 }
  });
  afirmar('crea el proceso de prueba', [200, 201].includes(crearProceso.status), JSON.stringify(crearProceso.datos));
  afirmar('parte de la sigla equivocada', crearProceso.datos.codigo === 'ZRPRB', crearProceso.datos.codigo);
  const procesoId = crearProceso.datos.id;

  const docsProceso = [];
  for (const n of [1, 2]) {
    const d = await pedir('/documental/documentos', {
      metodo: 'POST',
      body: { nombre: `Documento ${n} del proceso nuevo ${marca}`, procesoId, tipoId: 'pro', alcance: 'global' }
    });
    docsProceso.push(d.datos);
  }
  afirmar('crea 2 documentos en el proceso nuevo',
    docsProceso.every((d) => d && d.codigo), JSON.stringify(docsProceso.map((d) => d && d.codigo)));

  // El administrador se da cuenta de que la sigla estaba mal y la corrige.
  const siglaCorregida = 'ZQPRB';
  const editar = await pedir(`/config/procesos/${procesoId}`, {
    metodo: 'PUT', body: { codigo: siglaCorregida }
  });
  afirmar('corrige la sigla del proceso en el catálogo',
    editar.status === 200 && editar.datos.codigo === siglaCorregida, JSON.stringify(editar.datos));

  const simulacro = await pedir('/documental/recodificar-proceso?simulacro=1', {
    metodo: 'POST', body: { procesoId }
  });
  afirmar('el simulacro lista los 2 cambios',
    simulacro.status === 200 && simulacro.datos.cambios.length === 2,
    JSON.stringify(simulacro.datos).slice(0, 240));
  afirmar('el simulacro NO aplicó nada',
    (await pedir(`/documental/documentos/${docsProceso[0].id}`)).datos.codigo === docsProceso[0].codigo,
    'el código cambió pese al simulacro');

  const masiva = await pedir('/documental/recodificar-proceso', {
    metodo: 'POST', body: { procesoId, motivo: 'La sigla del proceso se definió mal al inicio' }
  });
  afirmar('la recodificación masiva aplica los 2 cambios',
    masiva.status === 200 && masiva.datos.cambios.length === 2 && masiva.datos.errores.length === 0,
    JSON.stringify(masiva.datos).slice(0, 240));

  const revisado = await pedir(`/documental/documentos/${docsProceso[0].id}`);
  afirmar('el código nuevo usa la sigla corregida',
    revisado.datos.codigo.startsWith(`${siglaCorregida}-PRO-`), revisado.datos.codigo);
  afirmar('conserva su consecutivo tras la recodificación masiva',
    revisado.datos.consecutivo === docsProceso[0].consecutivo,
    `${docsProceso[0].consecutivo} → ${revisado.datos.consecutivo}`);
  afirmar('archivó el código anterior',
    (revisado.datos.codigosAnteriores || []).some((c) => c.codigo === docsProceso[0].codigo),
    JSON.stringify(revisado.datos.codigosAnteriores));

  const segundaCorrida = await pedir('/documental/recodificar-proceso', {
    metodo: 'POST', body: { procesoId, motivo: 'repetir sin cambios pendientes' }
  });
  // Se verifica por CONTENIDO y no por cantidad: el proceso de prueba se reutiliza
  // entre corridas, así que puede arrastrar documentos de ejecuciones anteriores
  // —ya con la sigla corregida— y contarlos haría fallar la prueba sin que nada
  // esté mal.
  afirmar('repetirla no vuelve a tocar nada (idempotente)',
    segundaCorrida.datos.cambios.length === 0 &&
    segundaCorrida.datos.errores.length === 0 &&
    segundaCorrida.datos.sinCambio.includes(revisado.datos.codigo),
    JSON.stringify(segundaCorrida.datos).slice(0, 200));

  const masivaSinPermiso = await pedir('/documental/recodificar-proceso', {
    como: LIDER, metodo: 'POST', body: { procesoId, motivo: 'sin permiso' }
  });
  afirmar('un líder de proceso NO recodifica en masa', masivaSinPermiso.status === 403,
    `status ${masivaSinPermiso.status}`);

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
