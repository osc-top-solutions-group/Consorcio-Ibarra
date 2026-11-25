// Flujo avanzado del módulo documental:
//   · devolver para ajustes (en_ajustes) sin anular la ronda, responder y reanudar
//   · agregar/retirar participantes con el flujo en curso
//   · retiro del último pendiente dispara la transición de etapa
//   · corrección editorial sobre la versión vigente (sin nueva versión)
//   · recordatorio manual con límite diario y fecha límite al convocar
//   · rondas anteriores archivadas al reenviar tras un rechazo
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const ELABORA = 'cristian.moreno@ejemplo.com';      // admin
const REVISA = 'javier.correa@ejemplo.com';         // lider geti
const APRUEBA = 'hernando.castellanos@ejemplo.com'; // admin
const COMUN = 'juan.beleno@ejemplo.com';            // usuario básico

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

async function subir(docId, { original, pdf, como = ELABORA, ruta = 'archivos', extra = {} }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  if (original) fd.append('original', new Blob([original.contenido]), original.nombre);
  if (pdf) fd.append('pdf', new Blob([pdf.contenido]), pdf.nombre);
  const res = await fetch(`${BASE}/documental/documentos/${docId}/${ruta}`, {
    method: 'POST', headers: { 'x-dev-user-email': como }, body: fd
  });
  const t = await res.text();
  let datos; try { datos = JSON.parse(t); } catch { datos = t; }
  return { status: res.status, datos };
}

const ultima = (d) => d.versiones[d.versiones.length - 1];

async function verificarEntorno() {
  const salud = await (await fetch(`${BASE}/health`)).json();
  if (salud.raiz === 'sgc') {
    console.error('\nABORTADO: el backend apunta a la raíz de producción "sgc".');
    process.exit(1);
  }
  console.log(`Raíz Firestore en uso: ${salud.raiz}`);
}

(async () => {
  await verificarEntorno();
  const sello = Date.now();

  console.log('\n=== 1. Convocatoria con fecha límite ===');
  const creado = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: {
      nombre: `Procedimiento de flujo avanzado ${sello}`,
      procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global'
    }
  });
  afirmar('documento creado', creado.status === 201, JSON.stringify(creado.datos));
  const id = creado.datos.id;

  await subir(id, {
    original: { contenido: 'docx', nombre: 'doc.docx' },
    pdf: { contenido: '%PDF-1.4', nombre: 'doc.pdf' }
  });
  const enviado = await pedir(`/documental/documentos/${id}/enviar-flujo`, {
    metodo: 'POST', body: { revisores: [REVISA], aprobadores: [APRUEBA, COMUN] }
  });
  afirmar('enviado a revisión', ultima(enviado.datos).estado === 'en_revision', JSON.stringify(enviado.datos).slice(0, 200));
  afirmar('el revisor quedó con fecha límite', !!ultima(enviado.datos).flujo.revisores[0].fechaLimite,
    JSON.stringify(ultima(enviado.datos).flujo.revisores[0]));

  const pendRevisor = await pedir('/pendientes', { como: REVISA });
  const tarea = pendRevisor.datos.find((p) => p.refId === id && p.tipo === 'revision');
  afirmar('el pendiente lleva la fecha límite', !!(tarea && tarea.fechaLimite), JSON.stringify(tarea));

  console.log('\n=== 2. Recordatorio manual con límite diario ===');
  const rec1 = await pedir(`/documental/documentos/${id}/flujo/recordar`, {
    metodo: 'POST', body: { correo: REVISA, mensaje: 'Lo necesitamos para la auditoría del viernes' }
  });
  afirmar('el elaborador envía un recordatorio', rec1.status === 200, JSON.stringify(rec1.datos).slice(0, 150));
  const rec2 = await pedir(`/documental/documentos/${id}/flujo/recordar`, {
    metodo: 'POST', body: { correo: REVISA }
  });
  afirmar('un segundo recordatorio el mismo día se rechaza (429)', rec2.status === 429, `status ${rec2.status}`);
  const recAjeno = await pedir(`/documental/documentos/${id}/flujo/recordar`, {
    metodo: 'POST', como: COMUN, body: {}
  });
  afirmar('un participante sin gestión no puede recordar', [403, 404].includes(recAjeno.status), `status ${recAjeno.status}`);

  console.log('\n=== 3. Revisión aprobada → aprobación; devolución para ajustes ===');
  await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: REVISA, body: { decision: 'aprobado', comentario: 'Revisado sin observaciones' }
  });
  const aprueba1 = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'aprobado', comentario: 'De acuerdo' }
  });
  afirmar('primer aprobador registrado, sigue en aprobación', ultima(aprueba1.datos).estado === 'en_aprobacion',
    ultima(aprueba1.datos).estado);

  const sinComentario = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: COMUN, body: { decision: 'devuelto' }
  });
  afirmar('devolver exige comentario', sinComentario.status === 400, `status ${sinComentario.status}`);

  const devuelto = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: COMUN, body: { decision: 'devuelto', comentario: 'La sigla OSC debe ir con el nombre completo' }
  });
  afirmar('la versión pasa a en_ajustes', ultima(devuelto.datos).estado === 'en_ajustes', ultima(devuelto.datos).estado);
  afirmar('la aprobación previa se conserva',
    ultima(devuelto.datos).flujo.aprobadores.find((p) => p.correo === APRUEBA).estado === 'aprobado');
  afirmar('el documento se filtra como en_ajustes / en tránsito',
    ['en_ajustes', 'en_actualizacion'].includes((await pedir(`/documental/documentos/${id}`)).datos.estado));

  const decidirEnAjustes = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'aprobado' }
  });
  afirmar('nadie decide mientras está en ajustes', decidirEnAjustes.status === 409, `status ${decidirEnAjustes.status}`);

  console.log('\n=== 4. Corregir, responder y reanudar ===');
  const archivosEnAjustes = await subir(id, { pdf: { contenido: '%PDF-1.4 corregido', nombre: 'doc-corr.pdf' } });
  afirmar('en ajustes sí se cargan archivos', archivosEnAjustes.status === 200, JSON.stringify(archivosEnAjustes.datos).slice(0, 150));

  const respuesta = await pedir(`/documental/documentos/${id}/flujo/comentarios`, {
    metodo: 'POST', body: { correo: COMUN, texto: 'Se corrigió: ahora figura el nombre completo de la empresa.' }
  });
  afirmar('el responsable responde el comentario', respuesta.status === 200, JSON.stringify(respuesta.datos).slice(0, 150));
  const conRespuesta = ultima(respuesta.datos).flujo.aprobadores.find((p) => p.correo === COMUN);
  afirmar('la respuesta queda en el hilo del participante',
    (conRespuesta.respuestas || []).some((r) => /nombre completo/.test(r.texto)), JSON.stringify(conRespuesta.respuestas));

  const reanudado = await pedir(`/documental/documentos/${id}/reanudar-flujo`, {
    metodo: 'POST', body: { respuesta: 'Ajustes aplicados en el PDF.' }
  });
  afirmar('reanuda en aprobación', ultima(reanudado.datos).estado === 'en_aprobacion', ultima(reanudado.datos).estado);
  const reconvocado = ultima(reanudado.datos).flujo.aprobadores.find((p) => p.correo === COMUN);
  afirmar('quien devolvió vuelve a pendiente', reconvocado.estado === 'pendiente', reconvocado.estado);
  afirmar('su devolución quedó en el historial',
    (reconvocado.historial || []).some((h) => h.estado === 'devuelto'), JSON.stringify(reconvocado.historial));
  afirmar('quien ya aprobó NO fue reconvocado',
    ultima(reanudado.datos).flujo.aprobadores.find((p) => p.correo === APRUEBA).estado === 'aprobado');

  console.log('\n=== 5. Participantes en caliente: agregar y retirar ===');
  // Los revisores solo se agregan mientras la revisión sigue abierta: el
  // proceso no se devuelve una vez la etapa cerró.
  const revTarde = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'agregar', etapa: 'revisores', asignacion: APRUEBA }
  });
  afirmar('no se agregan revisores con la revisión cerrada', revTarde.status === 409, `status ${revTarde.status}`);

  const agregado = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'agregar', etapa: 'aprobadores', asignacion: REVISA }
  });
  afirmar('se agrega un aprobador en caliente', agregado.status === 200 &&
    ultima(agregado.datos).flujo.aprobadores.some((p) => p.correo === REVISA && p.estado === 'pendiente'),
    JSON.stringify(agregado.datos).slice(0, 200));

  const duplicado = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'agregar', etapa: 'aprobadores', asignacion: REVISA }
  });
  afirmar('no se duplica un participante', duplicado.status === 409, `status ${duplicado.status}`);

  const retiraDecidido = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'retirar', etapa: 'aprobadores', correo: APRUEBA, motivo: 'Prueba inválida' }
  });
  afirmar('no se retira a quien ya decidió', retiraDecidido.status === 409, `status ${retiraDecidido.status}`);

  const sinMotivo = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'retirar', etapa: 'aprobadores', correo: REVISA }
  });
  afirmar('retirar exige motivo', sinMotivo.status === 400, `status ${sinMotivo.status}`);

  const retirado = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'retirar', etapa: 'aprobadores', correo: REVISA, motivo: 'Cambio de responsabilidades' }
  });
  const pRetirado = ultima(retirado.datos).flujo.aprobadores.find((p) => p.correo === REVISA);
  afirmar('el retirado queda marcado, no borrado', pRetirado && pRetirado.estado === 'retirado' &&
    pRetirado.retiro.motivo === 'Cambio de responsabilidades', JSON.stringify(pRetirado));

  // COMUN sigue pendiente: retirarlo debe cerrar la etapa y dejar el documento
  // vigente sin que nadie más "decida" (transición evaluada tras el retiro).
  const retiroFinal = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'retirar', etapa: 'aprobadores', correo: COMUN, motivo: 'Salió de la compañía' }
  });
  afirmar('retirar al último pendiente cierra la etapa → vigente',
    ultima(retiroFinal.datos).estado === 'vigente', ultima(retiroFinal.datos).estado);

  const unicoAprobador = await pedir(`/documental/documentos/${id}/flujo/participantes`, {
    metodo: 'POST', body: { accion: 'retirar', etapa: 'aprobadores', correo: APRUEBA, motivo: 'No debería poder' }
  });
  afirmar('el flujo cerrado ya no admite cambios de participantes', unicoAprobador.status === 409,
    `status ${unicoAprobador.status}`);

  console.log('\n=== 6. Corrección editorial sobre la versión vigente ===');
  const sinArchivos = await subir(id, { ruta: 'correccion', extra: { motivo: 'Motivo válido de corrección' } });
  afirmar('corrección sin archivos se rechaza', sinArchivos.status === 400, `status ${sinArchivos.status}`);

  const sinMotivoCorr = await subir(id, {
    ruta: 'correccion', pdf: { contenido: '%PDF-1.4 v1 corregido', nombre: 'doc-corr2.pdf' }
  });
  afirmar('corrección sin motivo se rechaza', sinMotivoCorr.status === 400, `status ${sinMotivoCorr.status}`);

  const corregido = await subir(id, {
    ruta: 'correccion',
    pdf: { contenido: '%PDF-1.4 nombre completo', nombre: 'doc-corr2.pdf' },
    extra: { motivo: 'Se corrige la sigla OSC por el nombre completo de la empresa (error de forma)' }
  });
  afirmar('corrección aplicada sobre la vigente', corregido.status === 200, JSON.stringify(corregido.datos).slice(0, 200));
  const vigente = corregido.datos.versiones.find((v) => v.estado === 'vigente');
  afirmar('la versión NO cambió de número', vigente.numero === 1, `v${vigente.numero}`);
  afirmar('la corrección quedó registrada con el archivo anterior',
    vigente.correcciones.length === 1 && !!vigente.correcciones[0].anteriores.pdf,
    JSON.stringify(vigente.correcciones));
  afirmar('el PDF vigente es el corregido', vigente.archivos.pdf.nombre === 'doc-corr2.pdf', vigente.archivos.pdf.nombre);

  const pdfAnterior = await fetch(`${BASE}/documental/documentos/${id}/archivo/1/pdf?correccion=1`,
    { headers: { 'x-dev-user-email': ELABORA, 'X-Requested-With': 'XMLHttpRequest' } });
  afirmar('el gestor recupera el PDF anterior a la corrección', pdfAnterior.status === 200, `status ${pdfAnterior.status}`);
  const pdfAnteriorComun = await fetch(`${BASE}/documental/documentos/${id}/archivo/1/pdf?correccion=1`,
    { headers: { 'x-dev-user-email': COMUN, 'X-Requested-With': 'XMLHttpRequest' } });
  afirmar('un usuario común no alcanza el archivo previo', pdfAnteriorComun.status === 404, `status ${pdfAnteriorComun.status}`);

  const correccionComun = await subir(id, {
    ruta: 'correccion', como: COMUN,
    pdf: { contenido: '%PDF-1.4 x', nombre: 'x.pdf' }, extra: { motivo: 'No debería poder' }
  });
  afirmar('solo gestores corrigen', [403, 404].includes(correccionComun.status), `status ${correccionComun.status}`);

  console.log('\n=== 7. Reenvío tras rechazo archiva la ronda anterior ===');
  const v2 = await pedir(`/documental/documentos/${id}/versiones`, {
    metodo: 'POST', body: { controlCambios: 'Segunda versión para probar el archivo de rondas.' }
  });
  afirmar('v2 en borrador', ultima(v2.datos).estado === 'borrador', ultima(v2.datos).estado);
  await subir(id, {
    original: { contenido: 'docx v2', nombre: 'doc-v2.docx' },
    pdf: { contenido: '%PDF-1.4 v2', nombre: 'doc-v2.pdf' }
  });
  await pedir(`/documental/documentos/${id}/enviar-flujo`, { metodo: 'POST', body: { aprobadores: [APRUEBA] } });
  await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'rechazado', comentario: 'Falta el anexo 1' }
  });
  const reenviado = await pedir(`/documental/documentos/${id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [APRUEBA] }
  });
  const rondas = ultima(reenviado.datos).rondasAnteriores || [];
  afirmar('la ronda rechazada quedó archivada en la versión',
    rondas.length === 1 && rondas[0].aprobadores.some((p) => p.estado === 'rechazado'),
    JSON.stringify(rondas).slice(0, 200));

  console.log('\n=== 8. Cron de recordatorios (corrida manual) ===');
  const cron = await pedir('/documental/recordatorios/procesar', { metodo: 'POST' });
  afirmar('la corrida manual responde con el resumen', cron.status === 200 &&
    typeof cron.datos.revisados === 'number', JSON.stringify(cron.datos).slice(0, 200));
  const cronComun = await pedir('/documental/recordatorios/procesar', { metodo: 'POST', como: COMUN });
  afirmar('la corrida manual exige administrador', cronComun.status === 403, `status ${cronComun.status}`);

  console.log('\n=== 9. Equipo elaborador (varios elaboradores) ===');
  const creado2 = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { nombre: `Procedimiento con equipo elaborador ${sello}`, procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro' }
  });
  const id2 = creado2.datos.id;

  const coElab = await pedir(`/documental/documentos/${id2}/elaboradores`, {
    metodo: 'POST', body: { accion: 'agregar', asignacion: COMUN }
  });
  afirmar('se agrega un co-elaborador', coElab.status === 200 &&
    ultima(coElab.datos).flujo.elaboradores.some((e) => e.correo === COMUN), JSON.stringify(coElab.datos).slice(0, 200));

  const dupElab = await pedir(`/documental/documentos/${id2}/elaboradores`, {
    metodo: 'POST', body: { accion: 'agregar', asignacion: COMUN }
  });
  afirmar('no se duplica un elaborador', dupElab.status === 409, `status ${dupElab.status}`);

  const quitarAutor = await pedir(`/documental/documentos/${id2}/elaboradores`, {
    metodo: 'POST', body: { accion: 'retirar', correo: ELABORA }
  });
  afirmar('el autor de la versión no se puede retirar', quitarAutor.status === 409, `status ${quitarAutor.status}`);

  // El co-elaborador (usuario básico, no gestor) trabaja el borrador.
  const subeComun = await subir(id2, {
    original: { contenido: 'docx equipo', nombre: 'doc.docx' },
    pdf: { contenido: '%PDF-1.4 equipo', nombre: 'doc.pdf' },
    como: COMUN
  });
  afirmar('el co-elaborador puede cargar archivos', subeComun.status === 200, JSON.stringify(subeComun.datos).slice(0, 150));

  const segrega = await pedir(`/documental/documentos/${id2}/enviar-flujo`, {
    metodo: 'POST', como: COMUN, body: { aprobadores: [COMUN] }
  });
  afirmar('un co-elaborador no puede ser aprobador (segregación)', segrega.status === 400, `status ${segrega.status}`);

  const enviaComun = await pedir(`/documental/documentos/${id2}/enviar-flujo`, {
    metodo: 'POST', como: COMUN, body: { aprobadores: [APRUEBA] }
  });
  afirmar('el co-elaborador puede enviar el flujo', enviaComun.status === 200 &&
    ultima(enviaComun.datos).estado === 'en_aprobacion', `status ${enviaComun.status}`);

  const aprobadorAElaborador = await pedir(`/documental/documentos/${id2}/elaboradores`, {
    metodo: 'POST', body: { accion: 'agregar', asignacion: APRUEBA }
  });
  afirmar('un aprobador activo no puede pasar al equipo elaborador', aprobadorAElaborador.status === 400,
    `status ${aprobadorAElaborador.status}`);

  const devuelto2 = await pedir(`/documental/documentos/${id2}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'devuelto', comentario: 'Ajustar numeral 3' }
  });
  afirmar('devuelto para ajustes', ultima(devuelto2.datos).estado === 'en_ajustes', ultima(devuelto2.datos).estado);
  const reanudaComun = await pedir(`/documental/documentos/${id2}/reanudar-flujo`, {
    metodo: 'POST', como: COMUN, body: { respuesta: 'Numeral 3 ajustado.' }
  });
  afirmar('el co-elaborador puede reanudar el flujo', reanudaComun.status === 200 &&
    ultima(reanudaComun.datos).estado === 'en_aprobacion', `status ${reanudaComun.status}`);

  const retiraElab = await pedir(`/documental/documentos/${id2}/elaboradores`, {
    metodo: 'POST', body: { accion: 'retirar', correo: COMUN }
  });
  afirmar('el co-elaborador se retira', retiraElab.status === 200 &&
    !ultima(retiraElab.datos).flujo.elaboradores.some((e) => e.correo === COMUN), `status ${retiraElab.status}`);

  const yaSinAcceso = await subir(id2, { pdf: { contenido: '%PDF-1.4 x', nombre: 'x.pdf' }, como: COMUN });
  afirmar('retirado del equipo pierde el acceso de trabajo', [403, 404, 409].includes(yaSinAcceso.status),
    `status ${yaSinAcceso.status}`);

  // Limpieza: obsoletizar para no ensuciar el listado del entorno de desarrollo.
  await pedir(`/documental/documentos/${id}/obsoletizar`, {
    metodo: 'POST', como: APRUEBA, body: { motivo: 'Documento de prueba del flujo avanzado.' }
  });
  await pedir(`/documental/documentos/${id2}/obsoletizar`, {
    metodo: 'POST', como: APRUEBA, body: { motivo: 'Documento de prueba del equipo elaborador.' }
  });

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
