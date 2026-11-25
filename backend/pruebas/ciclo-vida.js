// Ciclo de vida completo: borrador → revisión → aprobación → vigente →
// nueva versión → la anterior queda obsoleta automáticamente.
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const ELABORA = 'cristian.moreno@ejemplo.com';   // admin
const REVISA = 'javier.correa@ejemplo.com';      // lider geti
const APRUEBA = 'hernando.castellanos@ejemplo.com'; // admin
const COMUN = 'juan.beleno@ejemplo.com';         // usuario básico

let ok = 0, fallos = 0;
const afirmar = (n, c, d = '') => {
  if (c) { ok++; console.log(`  ✓ ${n}`); }
  else { fallos++; console.log(`  ✗ ${n} ${d}`); }
};

async function pedir(ruta, { como = ELABORA, metodo = 'GET', body } = {}) {
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

async function subir(docId, { original, pdf, como = ELABORA }) {
  const fd = new FormData();
  if (original) fd.append('original', new Blob([original.contenido]), original.nombre);
  if (pdf) fd.append('pdf', new Blob([pdf.contenido]), pdf.nombre);
  const res = await fetch(`${BASE}/documental/documentos/${docId}/archivos`, {
    method: 'POST', headers: { 'x-dev-user-email': como }, body: fd
  });
  const t = await res.text();
  let datos; try { datos = JSON.parse(t); } catch { datos = t; }
  return { status: res.status, datos };
}

const ultima = (d) => d.versiones[d.versiones.length - 1];

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

  console.log('\n=== 1. Crear documento en borrador ===');
  const creado = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: {
      nombre: `Procedimiento de prueba de ciclo ${sello}`,
      procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global',
      normas: ['ISO 9001:2015'], palabrasClave: ['ciclo', 'prueba'], mesesRevision: 6
    }
  });
  afirmar('documento creado', creado.status === 201, JSON.stringify(creado.datos));
  const id = creado.datos.id;
  console.log(`     ${creado.datos.codigo}`);

  console.log('\n=== 2. Validación de archivos ===');
  const soloPdf = await subir(id, { pdf: { contenido: '%PDF-1.4 falso', nombre: 'doc.pdf' } });
  afirmar('acepta el PDF', soloPdf.status === 200, JSON.stringify(soloPdf.datos));

  const extMala = await subir(id, { original: { contenido: 'texto', nombre: 'doc.txt' } });
  afirmar('rechaza un original .txt', extMala.status === 400, JSON.stringify(extMala.datos));

  const sinOriginal = await pedir(`/documental/documentos/${id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [APRUEBA] }
  });
  afirmar('no deja enviar a flujo sin el editable', sinOriginal.status === 409, JSON.stringify(sinOriginal.datos));
  afirmar('el mensaje pide el archivo editable', /editable/i.test(JSON.stringify(sinOriginal.datos)));

  const conOriginal = await subir(id, { original: { contenido: 'docx falso', nombre: 'doc.docx' } });
  afirmar('acepta el original .docx', conOriginal.status === 200, JSON.stringify(conOriginal.datos));

  console.log('\n=== 3. Segregación de funciones ===');
  const autoAprueba = await pedir(`/documental/documentos/${id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [ELABORA] }
  });
  afirmar('quien elabora no puede aprobarse', autoAprueba.status === 400, JSON.stringify(autoAprueba.datos));

  console.log('\n=== 4. Enviar a revisión y aprobar ===');
  const enviado = await pedir(`/documental/documentos/${id}/enviar-flujo`, {
    metodo: 'POST', body: { revisores: [REVISA], aprobadores: [{ tipo: 'usuario', valor: APRUEBA }] }
  });
  afirmar('enviado a flujo', enviado.status === 200, JSON.stringify(enviado.datos).slice(0, 200));
  afirmar('estado en_revision', ultima(enviado.datos).estado === 'en_revision', ultima(enviado.datos).estado);

  const pendRevisor = await pedir('/pendientes', { como: REVISA });
  afirmar('el revisor recibió el pendiente',
    pendRevisor.datos.some((p) => p.refId === id && p.tipo === 'revision'),
    JSON.stringify(pendRevisor.datos.map((p) => p.tipo)));

  // Para un colaborador ajeno el documento no existe todavía: aún no tiene
  // versión vigente, así que ni lo ve ni puede opinar sobre él (404, no 403 —
  // decirle "no autorizado" ya revelaría que hay un documento en curso).
  const noPuede = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: COMUN, body: { decision: 'aprobado' }
  });
  afirmar('un colaborador ajeno no alcanza el documento en flujo', noPuede.status === 404, `status ${noPuede.status}`);

  // Quien sí lo ve pero no tiene tarea pendiente en la etapa: ese es el 403.
  const sinTarea = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: ELABORA, body: { decision: 'aprobado' }
  });
  afirmar('quien no tiene decisión pendiente recibe 403', sinTarea.status === 403, `status ${sinTarea.status}`);

  const revisado = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: REVISA, body: { decision: 'aprobado', comentario: 'Revisado' }
  });
  afirmar('revisión registrada → en_aprobacion', ultima(revisado.datos).estado === 'en_aprobacion',
    ultima(revisado.datos).estado);

  const cerrado = await pedir('/pendientes', { como: REVISA });
  afirmar('el pendiente del revisor se cerró',
    !cerrado.datos.some((p) => p.refId === id && p.tipo === 'revision'));

  const rechazoSinComentario = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'rechazado' }
  });
  afirmar('rechazar exige comentario', rechazoSinComentario.status === 400, JSON.stringify(rechazoSinComentario.datos));

  const aprobado = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'aprobado', comentario: 'Aprobado' }
  });
  afirmar('aprobación completa → vigente', ultima(aprobado.datos).estado === 'vigente', ultima(aprobado.datos).estado);
  afirmar('se fijó la próxima revisión', !!aprobado.datos.proximaRevision, String(aprobado.datos.proximaRevision));

  const detalle = await pedir(`/documental/documentos/${id}`);
  afirmar('estado del documento es vigente', detalle.datos.estado === 'vigente', detalle.datos.estado);
  afirmar('reporta días para revisión', typeof detalle.datos.diasParaRevision === 'number',
    String(detalle.datos.diasParaRevision));

  console.log('\n=== 5. Req 8: descarga del editable ===');
  const comoComun = await pedir(`/documental/documentos/${id}`, { como: COMUN });
  afirmar('un usuario común NO descarga el editable de un procedimiento',
    comoComun.datos.permisos.descargarOriginal === false,
    JSON.stringify(comoComun.datos.permisos));

  const bajarOriginal = await fetch(`${BASE}/documental/documentos/${id}/archivo/1/original?descargar=1`,
    { headers: { 'x-dev-user-email': COMUN } });
  afirmar('el backend bloquea la descarga del editable', bajarOriginal.status === 403, `status ${bajarOriginal.status}`);

  const bajarPdf = await fetch(`${BASE}/documental/documentos/${id}/archivo/1/pdf`,
    { headers: { 'x-dev-user-email': COMUN, 'X-Requested-With': 'XMLHttpRequest' } });
  afirmar('el PDF sí se consulta', bajarPdf.status === 200, `status ${bajarPdf.status}`);

  console.log('\n=== 6. Req 9: nueva versión y obsolescencia automática ===');
  const sinControl = await pedir(`/documental/documentos/${id}/versiones`, {
    metodo: 'POST', body: { controlCambios: 'no' }
  });
  afirmar('exige control de cambios', sinControl.status === 400, `status ${sinControl.status}`);

  const v2 = await pedir(`/documental/documentos/${id}/versiones`, {
    metodo: 'POST', body: { controlCambios: 'Se actualiza el numeral 5 por cambio de proveedor.' }
  });
  afirmar('v2 creada en borrador', ultima(v2.datos).numero === 2 && ultima(v2.datos).estado === 'borrador',
    JSON.stringify(ultima(v2.datos)).slice(0, 120));
  afirmar('v1 sigue vigente mientras v2 es borrador',
    v2.datos.versiones[0].estado === 'vigente', v2.datos.versiones[0].estado);

  const enActualizacion = await pedir(`/documental/documentos/${id}`);
  afirmar('el documento se muestra en actualización', enActualizacion.datos.estado === 'en_actualizacion',
    enActualizacion.datos.estado);

  await subir(id, {
    original: { contenido: 'docx v2', nombre: 'doc-v2.docx' },
    pdf: { contenido: '%PDF-1.4 v2', nombre: 'doc-v2.pdf' }
  });
  await pedir(`/documental/documentos/${id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [APRUEBA] }
  });
  const v2Aprobada = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'aprobado', comentario: 'Ok v2' }
  });

  afirmar('v2 quedó vigente', v2Aprobada.datos.versiones[1].estado === 'vigente',
    v2Aprobada.datos.versiones[1].estado);
  afirmar('v1 pasó a obsoleta AUTOMÁTICAMENTE', v2Aprobada.datos.versiones[0].estado === 'obsoleta',
    v2Aprobada.datos.versiones[0].estado);
  afirmar('el control de cambios de v2 quedó registrado',
    /numeral 5/.test(v2Aprobada.datos.versiones[1].controlCambios));

  console.log('\n=== 7. Rechazo devuelve a borrador ===');
  const v3 = await pedir(`/documental/documentos/${id}/versiones`, {
    metodo: 'POST', body: { controlCambios: 'Tercera versión para probar el rechazo.' }
  });
  await subir(id, {
    original: { contenido: 'docx v3', nombre: 'doc-v3.docx' },
    pdf: { contenido: '%PDF-1.4 v3', nombre: 'doc-v3.pdf' }
  });
  await pedir(`/documental/documentos/${id}/enviar-flujo`, { metodo: 'POST', body: { aprobadores: [APRUEBA] } });
  const rechazada = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'rechazado', comentario: 'Falta el anexo 2' }
  });
  afirmar('el rechazo devuelve v3 a borrador', ultima(rechazada.datos).estado === 'borrador',
    ultima(rechazada.datos).estado);
  afirmar('v2 sigue siendo la vigente', rechazada.datos.versiones[1].estado === 'vigente',
    rechazada.datos.versiones[1].estado);

  console.log('\n=== 8. Obsoletizar el documento completo ===');
  const obsoletizado = await pedir(`/documental/documentos/${id}/obsoletizar`, {
    metodo: 'POST', body: { motivo: 'Reemplazado por el procedimiento corporativo unificado.' }
  });
  afirmar('documento obsoletizado', obsoletizado.datos.obsoleto === true, JSON.stringify(obsoletizado.datos.obsoleto));
  afirmar('quedó registrado el motivo', /corporativo unificado/.test(obsoletizado.datos.motivoObsolescencia || ''));

  const enMaestro = await pedir('/documental/documentos');
  afirmar('sale del listado maestro', !enMaestro.datos.some((d) => d.id === id));
  const enObsoletos = await pedir('/documental/obsoletos');
  afirmar('aparece en el repositorio de obsoletos', enObsoletos.datos.some((d) => d.id === id));

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
