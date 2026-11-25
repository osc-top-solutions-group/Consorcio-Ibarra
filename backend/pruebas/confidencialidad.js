// Prueba end-to-end de la CONFIDENCIALIDAD de un documento (ISO 27001) y de su
// lista de acceso, contra el backend local.
//
// Lo que se verifica:
//   · un documento confidencial solo lo alcanza quien esté en su lista (además
//     de quienes lo administran o participan en el flujo);
//   · la clasificación y la lista las cambia quien ADMINISTRA el documento
//     —aquí el líder del proceso, que no es administrador global— desde la
//     misma ruta que el resto de los permisos de acceso;
//   · la lista se guarda normalizada (minúsculas) y se vacía al bajar de
//     confidencial, para que no quede una restricción invisible.
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const LIDER = 'javier.correa@ejemplo.com';         // líder de geti, no admin global
const APRUEBA = 'hernando.castellanos@ejemplo.com'; // aprueba el flujo
const COMUN = 'juan.beleno@ejemplo.com';           // colaborador sin rol
const OTRO = 'alan.chavez@ejemplo.com';            // colaborador sin rol

let ok = 0;
let fallos = 0;

function afirmar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`  ✓ ${nombre}`); } else { fallos++; console.log(`  ✗ ${nombre} ${detalle}`); }
}

async function pedir(ruta, { como = LIDER, metodo = 'GET', body } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'x-dev-user-email': como,
      'X-Requested-With': 'XMLHttpRequest',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { status: res.status, datos };
}

async function subir(docId, como = LIDER) {
  const fd = new FormData();
  fd.append('original', new Blob(['docx falso']), 'doc.docx');
  fd.append('pdf', new Blob(['%PDF-1.4 falso']), 'doc.pdf');
  const res = await fetch(`${BASE}/documental/documentos/${docId}/archivos`, {
    method: 'POST', headers: { 'x-dev-user-email': como, 'X-Requested-With': 'XMLHttpRequest' }, body: fd
  });
  return res.status;
}

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

  console.log('\n=== Documento confidencial con lista de acceso ===');
  const creado = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: {
      nombre: `Prueba confidencial ${sello}`, procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global',
      confidencialidad: 'confidencial',
      // En mayúsculas a propósito: debe guardarse normalizado.
      accesoConfidencial: [COMUN.toUpperCase()],
      // Metadatos que un PUT parcial NO debe tocar (ver documentoEditar).
      descripcion: 'Descripción que debe sobrevivir a la edición de permisos',
      mesesRevision: 6,
      normas: ['ISO 27001']
    }
  });
  afirmar('el líder del proceso crea el documento confidencial', creado.status === 201, JSON.stringify(creado.datos).slice(0, 200));
  afirmar('la lista de acceso se guarda en minúsculas',
    JSON.stringify(creado.datos.accesoConfidencial) === JSON.stringify([COMUN]), JSON.stringify(creado.datos.accesoConfidencial));
  const id = creado.datos.id;

  await subir(id);
  await pedir(`/documental/documentos/${id}/enviar-flujo`, { metodo: 'POST', body: { aprobadores: [APRUEBA] } });
  const aprobado = await pedir(`/documental/documentos/${id}/decision`, {
    metodo: 'POST', como: APRUEBA, body: { decision: 'aprobado', comentario: 'Ok' }
  });
  afirmar('el documento queda vigente', aprobado.status === 200, JSON.stringify(aprobado.datos).slice(0, 200));

  const enLista = await pedir(`/documental/documentos/${id}`, { como: COMUN });
  afirmar('quien está en la lista lo consulta', enLista.status === 200, `status ${enLista.status}`);
  afirmar('pero no recibe la lista de acceso (dato de administración)', enLista.datos.accesoConfidencial === undefined);
  const fuera = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('quien no está en la lista no lo alcanza (404)', fuera.status === 404, `status ${fuera.status}`);
  const listaFuera = await pedir('/documental/documentos?procesoId=geti', { como: OTRO });
  afirmar('tampoco aparece en su listado maestro', !listaFuera.datos.some((d) => d.id === id));

  console.log('\n=== La clasificación la cambia quien administra el documento ===');
  const comunEdita = await pedir(`/documental/documentos/${id}`, {
    como: COMUN, metodo: 'PUT', body: { accesoConfidencial: [COMUN, OTRO] }
  });
  afirmar('un colaborador no cambia la lista → 403', comunEdita.status === 403, `status ${comunEdita.status}`);

  const amplia = await pedir(`/documental/documentos/${id}`, {
    metodo: 'PUT', body: { accesoConfidencial: [COMUN, OTRO] }
  });
  afirmar('el líder del proceso (no admin global) amplía la lista', amplia.status === 200 &&
    amplia.datos.accesoConfidencial.length === 2, JSON.stringify(amplia.datos).slice(0, 200));
  // Regresión: el esquema de edición aplicaba los defaults de la creación y un
  // PUT parcial reescribía alcance, confidencialidad, meses de revisión, etc.
  afirmar('un PUT parcial no altera los demás campos del documento',
    amplia.datos.confidencialidad === 'confidencial' && amplia.datos.alcance === 'global' &&
    amplia.datos.mesesRevision === 6 && amplia.datos.normas.length === 1 &&
    amplia.datos.descripcion.startsWith('Descripción que debe sobrevivir'),
    JSON.stringify([amplia.datos.confidencialidad, amplia.datos.mesesRevision, amplia.datos.normas, amplia.datos.descripcion]));
  const ahoraDentro = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('el agregado ya lo consulta', ahoraDentro.status === 200, `status ${ahoraDentro.status}`);

  const bajaNivel = await pedir(`/documental/documentos/${id}`, {
    metodo: 'PUT', body: { confidencialidad: 'interno' }
  });
  afirmar('bajar a interno vacía la lista de acceso',
    bajaNivel.status === 200 && bajaNivel.datos.confidencialidad === 'interno' &&
    bajaNivel.datos.accesoConfidencial.length === 0, JSON.stringify(bajaNivel.datos.accesoConfidencial));
  const listaInterno = await pedir('/documental/documentos?procesoId=geti', { como: OTRO });
  afirmar('como interno lo ve cualquier colaborador del alcance', listaInterno.datos.some((d) => d.id === id));

  const subeNivel = await pedir(`/documental/documentos/${id}`, {
    metodo: 'PUT', body: { confidencialidad: 'confidencial' }
  });
  afirmar('volver a confidencial arranca con la lista vacía',
    subeNivel.status === 200 && subeNivel.datos.accesoConfidencial.length === 0);
  const otraVezFuera = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('y el colaborador vuelve a quedar fuera (404)', otraVezFuera.status === 404, `status ${otraVezFuera.status}`);
  const liderSigue = await pedir(`/documental/documentos/${id}`);
  afirmar('el líder del proceso lo sigue viendo sin estar en la lista', liderSigue.status === 200, `status ${liderSigue.status}`);

  console.log('\n=== Permisos excepcionales por persona (consultar / descargar) ===');
  // Partimos del documento confidencial con la lista vacía: OTRO no lo alcanza.
  const sinPermiso = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('(preparación) la persona fuera de la lista no alcanza el documento', sinPermiso.status === 404);

  const sinMotivo = await pedir(`/documental/documentos/${id}/permisos`, {
    metodo: 'POST', body: { correo: OTRO, tipo: 'consultar', motivo: 'corto' }
  });
  afirmar('otorgar sin motivo suficiente → 400', sinMotivo.status === 400, `status ${sinMotivo.status}`);
  const liderDescargaIndefinida = await pedir(`/documental/documentos/${id}/permisos`, {
    metodo: 'POST', body: { correo: OTRO, tipo: 'descargar', motivo: 'Licitación sin fecha de cierre' }
  });
  afirmar('el líder del proceso no da descarga indefinida → 400', liderDescargaIndefinida.status === 400,
    `status ${liderDescargaIndefinida.status}`);
  const retro = await pedir(`/documental/documentos/${id}/permisos`, {
    metodo: 'POST', body: { correo: OTRO, tipo: 'consultar', motivo: 'Permiso con fecha vencida', hasta: '2020-01-01' }
  });
  afirmar('una vigencia anterior a hoy se rechaza → 400', retro.status === 400, `status ${retro.status}`);

  const consulta = await pedir(`/documental/documentos/${id}/permisos`, {
    metodo: 'POST', body: { correo: OTRO.toUpperCase(), tipo: 'consultar', motivo: 'Apoya la auditoría interna del proceso GETI' }
  });
  afirmar('el líder otorga consulta indefinida (201) y el correo se guarda normalizado',
    consulta.status === 201 && consulta.datos.permisosExcepcionales.length === 1 &&
    consulta.datos.permisosExcepcionales[0].correo === OTRO && consulta.datos.permisosCorreos.includes(OTRO),
    JSON.stringify(consulta.datos).slice(0, 300));
  const permisoConsulta = consulta.datos.permisosExcepcionales[0];

  const conPermiso = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('con permiso de consulta alcanza el documento confidencial sin estar en la lista', conPermiso.status === 200, `status ${conPermiso.status}`);
  afirmar('la ficha le cuenta SU permiso (motivo y vigencia) pero no la lista completa',
    conPermiso.status === 200 && conPermiso.datos.permisosExcepcionales === undefined &&
    Array.isArray(conPermiso.datos.misPermisosExcepcionales) && conPermiso.datos.misPermisosExcepcionales[0].motivo.startsWith('Apoya'),
    JSON.stringify(conPermiso.datos.misPermisosExcepcionales));
  afirmar('pero no descarga: el permiso es de consulta', conPermiso.datos.permisos.descargarPdf === false);
  const comunOtorga = await pedir(`/documental/documentos/${id}/permisos`, {
    como: OTRO, metodo: 'POST', body: { correo: COMUN, tipo: 'consultar', motivo: 'Un colaborador no otorga permisos' }
  });
  afirmar('quien ve por permiso (sin ser gestor) no otorga permisos → 403', comunOtorga.status === 403, `status ${comunOtorga.status}`);
  const listaConPermiso = await pedir('/documental/documentos?procesoId=geti', { como: OTRO });
  afirmar('y aparece en su listado maestro', listaConPermiso.datos.some((d) => d.id === id));
  const bajaSinPermiso = await fetch(`${BASE}/documental/documentos/${id}/archivo/1/pdf?descargar=1`, {
    headers: { 'x-dev-user-email': OTRO }
  });
  afirmar('la descarga del PDF con permiso de solo consulta → 403', bajaSinPermiso.status === 403, `status ${bajaSinPermiso.status}`);

  const manana = new Date(Date.now() + 86400000 * 15).toISOString().slice(0, 10);
  const descarga = await pedir(`/documental/documentos/${id}/permisos`, {
    metodo: 'POST', body: { correo: OTRO, tipo: 'descargar', motivo: 'Licitación 2026-11: debe adjuntar el PDF al pliego', hasta: manana }
  });
  afirmar('el líder otorga descarga con fecha (201)', descarga.status === 201, JSON.stringify(descarga.datos).slice(0, 300));
  const fichaDescarga = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('la ficha habilita la descarga y dice que es por permiso',
    fichaDescarga.datos.permisos.descargarPdf === true && fichaDescarga.datos.permisos.descargaPorPermiso?.hasta === manana,
    JSON.stringify(fichaDescarga.datos.permisos));
  const baja = await fetch(`${BASE}/documental/documentos/${id}/archivo/1/pdf?descargar=1`, {
    headers: { 'x-dev-user-email': OTRO }
  });
  afirmar('y la descarga del PDF ya pasa (200)', baja.status === 200, `status ${baja.status}`);

  // Prórroga: volver a otorgar el mismo tipo revoca el anterior como «prorrogado».
  const prorroga = await pedir(`/documental/documentos/${id}/permisos`, {
    metodo: 'POST', body: { correo: OTRO, tipo: 'descargar', motivo: 'Prórroga: la licitación se extendió dos semanas', hasta: manana }
  });
  const activosDescarga = prorroga.datos.permisosExcepcionales.filter((p) => p.tipo === 'descargar' && !p.revocado);
  afirmar('otorgar de nuevo el mismo tipo deja UN solo permiso activo (el anterior queda prorrogado)',
    prorroga.status === 201 && activosDescarga.length === 1 && activosDescarga[0].prorrogaDe &&
    prorroga.datos.permisosExcepcionales.some((p) => p.revocado && p.revocado.motivo.startsWith('Prorrogado')),
    JSON.stringify(prorroga.datos.permisosExcepcionales.map((p) => [p.tipo, !!p.revocado])));

  const revocar = await pedir(`/documental/documentos/${id}/permisos/${activosDescarga[0].id}/revocar`, {
    metodo: 'POST', body: { motivo: 'La licitación cerró' }
  });
  afirmar('el líder revoca la descarga con motivo', revocar.status === 200 &&
    revocar.datos.permisosExcepcionales.find((p) => p.id === activosDescarga[0].id).revocado.motivo === 'La licitación cerró');
  const trasRevocar = await pedir(`/documental/documentos/${id}`, { como: OTRO });
  afirmar('sin descarga pero todavía con consulta', trasRevocar.status === 200 && trasRevocar.datos.permisos.descargarPdf === false);
  const revocarConsulta = await pedir(`/documental/documentos/${id}/permisos/${permisoConsulta.id}/revocar`, {
    metodo: 'POST', body: { motivo: 'Terminó la auditoría' }
  });
  afirmar('revocada la consulta, vuelve a quedar fuera (404)', revocarConsulta.status === 200 &&
    (await pedir(`/documental/documentos/${id}`, { como: OTRO })).status === 404);
  afirmar('los permisos revocados siguen en el historial (nada se borra)',
    revocarConsulta.datos.permisosExcepcionales.length === 3 && revocarConsulta.datos.permisosCorreos.length === 0);
  const putPermisos = await pedir(`/documental/documentos/${id}`, { metodo: 'PUT', body: { permisosExcepcionales: [] } });
  afirmar('el PUT de metadatos no acepta tocar los permisos → 400', putPermisos.status === 400, `status ${putPermisos.status}`);

  console.log(`\n${ok} correctas, ${fallos} fallidas`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
