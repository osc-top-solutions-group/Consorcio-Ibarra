// Ajustes pedidos por el líder funcional del SGC sobre el módulo documental:
//
//   1. El colaborador ve ÚNICAMENTE documentación vigente (ni borradores, ni
//      versiones en curso, ni obsoletos).
//   2. Los permisos de visualización y de descarga se pueden establecer por
//      usuarios, cargos o grupos.
//   3. Los grupos se crean y se editan (agregar y quitar integrantes), y eso
//      cambia en caliente lo que cada persona ve.
//   4. Las solicitudes documentales exigen nombre del documento y proceso.
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const ADMIN = 'cristian.moreno@ejemplo.com';       // admin del SGC
const LIDER = 'javier.correa@ejemplo.com';         // líder de geti
const APRUEBA = 'hernando.castellanos@ejemplo.com'; // admin, aprueba
const COMUN = 'juan.beleno@ejemplo.com';           // colaborador sin rol
const OTRO = 'alan.chavez@ejemplo.com';            // colaborador de Bolivia

let ok = 0, fallos = 0;
const afirmar = (n, c, d = '') => {
  if (c) { ok++; console.log(`  ✓ ${n}`); }
  else { fallos++; console.log(`  ✗ ${n} ${d}`); }
};

async function pedir(ruta, { como = ADMIN, metodo = 'GET', body } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'x-dev-user-email': como,
      'X-Requested-With': 'XMLHttpRequest',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await res.text();
  let datos; try { datos = JSON.parse(t); } catch { datos = t; }
  return { status: res.status, datos };
}

async function subir(docId, { como = ADMIN } = {}) {
  const fd = new FormData();
  fd.append('original', new Blob(['docx falso']), 'doc.docx');
  fd.append('pdf', new Blob(['%PDF-1.4 falso']), 'doc.pdf');
  const res = await fetch(`${BASE}/documental/documentos/${docId}/archivos`, {
    method: 'POST', headers: { 'x-dev-user-email': como }, body: fd
  });
  return res.status;
}

// Crea un documento y lo lleva hasta vigente. `extra` inyecta los permisos de
// acceso que se quieran probar.
async function publicar(nombre, extra = {}) {
  const creado = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { nombre, procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global', ...extra }
  });
  if (creado.status !== 201) throw new Error(`no se pudo crear "${nombre}": ${JSON.stringify(creado.datos)}`);
  const id = creado.datos.id;
  await subir(id);
  await pedir(`/documental/documentos/${id}/enviar-flujo`, { metodo: 'POST', body: { aprobadores: [APRUEBA] } });
  await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'aprobado', comentario: 'Ok' }
  });
  return id;
}

// Las pruebas crean documentos: nunca deben correr contra la raíz de producción.
async function verificarEntorno() {
  const salud = await (await fetch(`${BASE}/health`)).json();
  if (salud.raiz === 'sgc') {
    console.error('\nABORTADO: el backend apunta a la raíz de producción "sgc".');
    console.error('Defina SGC_ROOT=sgc_dev en backend/.env y reinícielo.\n');
    process.exit(1);
  }
  console.log(`Raíz Firestore en uso: ${salud.raiz}`);
}

(async () => {
  await verificarEntorno();
  const sello = Date.now();

  console.log('\n=== 1. Solo documentación vigente para el colaborador ===');
  const borrador = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { nombre: `Procedimiento en borrador ${sello}`, procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global' }
  });
  afirmar('se crea el documento en borrador', borrador.status === 201, JSON.stringify(borrador.datos));
  const idBorrador = borrador.datos.id;

  const verBorrador = await pedir(`/documental/documentos/${idBorrador}`, { como: COMUN });
  afirmar('el colaborador NO alcanza un borrador (404)', verBorrador.status === 404, `status ${verBorrador.status}`);

  const verBorradorAdmin = await pedir(`/documental/documentos/${idBorrador}`);
  afirmar('quien administra SÍ ve el borrador', verBorradorAdmin.status === 200, `status ${verBorradorAdmin.status}`);

  const listaComun = await pedir('/documental/documentos', { como: COMUN });
  afirmar('el borrador no aparece en su listado maestro',
    !listaComun.datos.some((d) => d.id === idBorrador));
  // Acotada a los documentos DE ESTA CORRIDA (llevan el sello en el nombre).
  // Afirmarlo sobre el listado completo era frágil por una razón legítima: el
  // colaborador de esta prueba figura como elaborador de documentos que otras
  // suites dejaron en el entorno de desarrollo, y quien elabora SÍ ve su propio
  // borrador —si no, no podría trabajarlo—. Esa fuga no existe: la verificación
  // de arriba ya prueba la regla con un borrador ajeno, que es el caso que
  // importa.
  const deEstaCorrida = listaComun.datos.filter((d) => (d.nombre || '').includes(String(sello)));
  afirmar('todo lo que ve el colaborador está vigente',
    deEstaCorrida.every((d) => d.estado === 'vigente'),
    JSON.stringify([...new Set(deEstaCorrida.map((d) => d.estado))]));

  console.log('\n=== 2. Publicado: se ve, y solo su versión vigente ===');
  const idPublico = await publicar(`Procedimiento publicado ${sello}`);
  const verPublico = await pedir(`/documental/documentos/${idPublico}`, { como: COMUN });
  afirmar('el colaborador ve el documento vigente', verPublico.status === 200, `status ${verPublico.status}`);
  afirmar('no recibe el ciclo completo', verPublico.datos.permisos.verCicloCompleto === false,
    JSON.stringify(verPublico.datos.permisos));

  // Se abre una v2: para quien administra el documento pasa a "en actualización",
  // pero el colaborador tiene que seguir viendo la v1, que es la aplicable.
  await pedir(`/documental/documentos/${idPublico}/versiones`, {
    metodo: 'POST', body: { controlCambios: 'Segunda versión para probar la visibilidad.' }
  });
  const enCurso = await pedir(`/documental/documentos/${idPublico}`, { como: COMUN });
  afirmar('con una v2 en curso, el colaborador sigue viendo v1 vigente',
    enCurso.datos.versiones.length === 1 && enCurso.datos.versiones[0].numero === 1,
    JSON.stringify(enCurso.datos.versiones.map((v) => v.numero)));
  afirmar('el estado que se le muestra es vigente', enCurso.datos.estado === 'vigente', enCurso.datos.estado);

  const listaEnCurso = await pedir('/documental/documentos', { como: COMUN });
  const fila = listaEnCurso.datos.find((d) => d.id === idPublico);
  afirmar('en el listado ve la versión vigente, no la que está en curso',
    fila && fila.version === 1 && fila.estado === 'vigente', JSON.stringify(fila));

  const pdfV2 = await fetch(`${BASE}/documental/documentos/${idPublico}/archivo/2/pdf`,
    { headers: { 'x-dev-user-email': COMUN, 'X-Requested-With': 'XMLHttpRequest' } });
  afirmar('no alcanza los archivos de la versión en curso', pdfV2.status === 404, `status ${pdfV2.status}`);

  const pdfV1 = await fetch(`${BASE}/documental/documentos/${idPublico}/archivo/1/pdf`,
    { headers: { 'x-dev-user-email': COMUN, 'X-Requested-With': 'XMLHttpRequest' } });
  afirmar('sí consulta el PDF vigente', pdfV1.status === 200, `status ${pdfV1.status}`);

  const enCursoAdmin = await pedir(`/documental/documentos/${idPublico}`);
  afirmar('quien administra ve las dos versiones', enCursoAdmin.datos.versiones.length === 2,
    JSON.stringify(enCursoAdmin.datos.versiones.map((v) => v.numero)));

  console.log('\n=== 3. Permisos de visualización por grupo ===');
  // Id fijo: aquí nada se borra físicamente, así que un id nuevo por corrida
  // dejaría un grupo inactivo en el catálogo cada vez que se ejecutan las pruebas.
  const grupoId = 'prueba-audiencia-sgc';
  const grupo = await pedir('/config/grupos', {
    metodo: 'POST',
    body: { id: grupoId, nombre: `Equipo de prueba ${sello}`, regla: { tipo: 'manual', correos: [COMUN] } }
  });
  afirmar('se crea un grupo de usuarios seleccionados', [200, 201].includes(grupo.status),
    JSON.stringify(grupo.datos));

  const integrantes = await pedir(`/config/grupos/${grupoId}/integrantes`);
  afirmar('el grupo resuelve a su integrante',
    integrantes.datos.integrantes?.some((p) => p.correo === COMUN), JSON.stringify(integrantes.datos));

  const idRestringido = await publicar(`Procedimiento restringido ${sello}`, {
    audienciaVisualizacion: [{ tipo: 'grupo', valor: grupoId }]
  });

  const dentro = await pedir(`/documental/documentos/${idRestringido}`, { como: COMUN });
  afirmar('quien está en el grupo ve el documento', dentro.status === 200, `status ${dentro.status}`);

  const fuera = await pedir(`/documental/documentos/${idRestringido}`, { como: OTRO });
  afirmar('quien NO está en el grupo no lo ve (404)', fuera.status === 404, `status ${fuera.status}`);

  const listaFuera = await pedir('/documental/documentos', { como: OTRO });
  afirmar('tampoco aparece en su listado', !listaFuera.datos.some((d) => d.id === idRestringido));

  // Quitar a alguien del grupo le quita el acceso, sin tocar el documento.
  const quitado = await pedir(`/config/grupos/${grupoId}`, {
    metodo: 'PUT', body: { regla: { tipo: 'manual', correos: [] } }
  });
  afirmar('se puede vaciar el grupo', quitado.status === 200, JSON.stringify(quitado.datos));

  const yaNo = await pedir(`/documental/documentos/${idRestringido}`, { como: COMUN });
  afirmar('al salir del grupo pierde el acceso', yaNo.status === 404, `status ${yaNo.status}`);

  console.log('\n=== 4. Descarga: solo administradores, sin excepciones por documento ===');
  // Regla de 2026-09-25: el PDF solo lo baja el administrador global de la
  // plataforma o el administrador del módulo documental. Ya no hay modos por
  // documento. Lo que se prueba aquí es justamente que las antiguas vías de
  // apertura —audiencia de descarga, `permitirImpresion`— ya no abren nada.
  const idSoloConsulta = await publicar(`Procedimiento de consulta ${sello}`, {
    audienciaDescarga: [{ tipo: 'usuario', valor: COMUN }]
  });

  const consulta = await pedir(`/documental/documentos/${idSoloConsulta}`, { como: COMUN });
  afirmar('el colaborador sí puede verlo', consulta.status === 200, `status ${consulta.status}`);
  afirmar('pero no puede descargar el PDF', consulta.datos.permisos.descargarPdf === false,
    JSON.stringify(consulta.datos.permisos));
  // La vía vieja: estar en la audiencia de descarga del documento.
  afirmar('estar en la audiencia de descarga ya NO abre la descarga',
    consulta.datos.permisos.descargarPdf === false);

  const inline = await fetch(`${BASE}/documental/documentos/${idSoloConsulta}/archivo/1/pdf`,
    { headers: { 'x-dev-user-email': COMUN, 'X-Requested-With': 'XMLHttpRequest' } });
  afirmar('la consulta en línea funciona', inline.status === 200, `status ${inline.status}`);

  const bajar = await fetch(`${BASE}/documental/documentos/${idSoloConsulta}/archivo/1/pdf?descargar=1`,
    { headers: { 'x-dev-user-email': COMUN } });
  afirmar('la descarga se bloquea (403)', bajar.status === 403, `status ${bajar.status}`);

  // La otra vía vieja: el interruptor «permitir impresión» del documento.
  const reabierto = await pedir(`/documental/documentos/${idSoloConsulta}`, {
    metodo: 'PUT', body: { permitirImpresion: true }
  });
  afirmar('el campo antiguo se sigue aceptando (no rompe documentos existentes)',
    reabierto.status === 200, `status ${reabierto.status}`);
  const trasCambio = await pedir(`/documental/documentos/${idSoloConsulta}`, { como: COMUN });
  afirmar('pero "permitir impresión" ya NO abre la descarga',
    trasCambio.datos.permisos.descargarPdf === false, JSON.stringify(trasCambio.datos.permisos));
  const bajarTras = await fetch(`${BASE}/documental/documentos/${idSoloConsulta}/archivo/1/pdf?descargar=1`,
    { headers: { 'x-dev-user-email': COMUN } });
  afirmar('y el endpoint también lo rechaza (403)', bajarTras.status === 403, `status ${bajarTras.status}`);

  // El líder del proceso administra el documento, pero tampoco se lo lleva: la
  // regla es por rol de módulo, no por dueño del proceso.
  const comoLider = await pedir(`/documental/documentos/${idSoloConsulta}`, { como: LIDER });
  afirmar('el líder del proceso administra el documento pero no lo descarga',
    comoLider.status === 200 && comoLider.datos.permisos.descargarPdf === false,
    JSON.stringify(comoLider.datos.permisos));

  // Y el administrador sí.
  const comoAdmin = await pedir(`/documental/documentos/${idSoloConsulta}`, { como: ADMIN });
  afirmar('el administrador de la plataforma sí descarga',
    comoAdmin.datos.permisos.descargarPdf === true, JSON.stringify(comoAdmin.datos.permisos));
  const bajaAdmin = await fetch(`${BASE}/documental/documentos/${idSoloConsulta}/archivo/1/pdf?descargar=1`,
    { headers: { 'x-dev-user-email': ADMIN } });
  afirmar('y el endpoint se lo entrega', bajaAdmin.status === 200, `status ${bajaAdmin.status}`);

  console.log('\n=== 5. Obsoletos: no existen para el colaborador ===');
  await pedir(`/documental/documentos/${idPublico}/obsoletizar`, {
    metodo: 'POST', body: { motivo: 'Prueba de visibilidad del repositorio de obsoletos.' }
  });
  const obsAdmin = await pedir('/documental/obsoletos');
  afirmar('quien administra ve el obsoleto', obsAdmin.datos.some((d) => d.id === idPublico));
  const obsComun = await pedir('/documental/obsoletos', { como: COMUN });
  afirmar('el colaborador no ve obsoletos', !obsComun.datos.some((d) => d.id === idPublico),
    JSON.stringify(obsComun.datos.map((d) => d.codigo)));
  const verObsoleto = await pedir(`/documental/documentos/${idPublico}`, { como: COMUN });
  afirmar('ni entra al obsoleto por su enlace', verObsoleto.status === 404, `status ${verObsoleto.status}`);

  console.log('\n=== 6. Solicitudes documentales con documento y proceso ===');
  const incompleta = await pedir('/documental/solicitudes', {
    metodo: 'POST', como: COMUN,
    body: { tipo: 'creacion', descripcion: 'Necesito un formato nuevo', responsable: LIDER }
  });
  afirmar('sin nombre de documento ni proceso → 400', incompleta.status === 400, JSON.stringify(incompleta.datos));

  const completa = await pedir('/documental/solicitudes', {
    metodo: 'POST', como: COMUN,
    body: {
      tipo: 'creacion', nombreDocumento: `Formato de inspección ${sello}`, procesoId: 'geti',
      descripcion: 'Se requiere para las inspecciones mensuales de la sede.', responsable: LIDER
    }
  });
  afirmar('con documento y proceso → 201', completa.status === 201, JSON.stringify(completa.datos));
  afirmar('la solicitud guarda el documento solicitado',
    completa.datos.nombreDocumento?.includes('Formato de inspección'), JSON.stringify(completa.datos));
  afirmar('la solicitud guarda el proceso', completa.datos.procesoId === 'geti', String(completa.datos.procesoId));

  const pendiente = await pedir('/pendientes', { como: LIDER });
  afirmar('el pendiente del responsable nombra el documento',
    pendiente.datos.some((p) => p.refId === completa.datos.id && /Formato de inspección/.test(p.titulo)),
    JSON.stringify(pendiente.datos.filter((p) => p.refId === completa.datos.id).map((p) => p.titulo)));

  // El grupo de prueba se inactiva: si no, cada corrida deja uno en el catálogo
  // y termina ensuciando los selectores de audiencia del entorno de desarrollo.
  await pedir(`/config/grupos/${grupoId}`, { metodo: 'DELETE' });

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
