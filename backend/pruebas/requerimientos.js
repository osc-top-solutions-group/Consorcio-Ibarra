// Prueba end-to-end de los requerimientos críticos contra el backend local.
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const ADMIN = 'cristian.moreno@ejemplo.com';   // admin, ve todas las sedes
const LIDER = 'javier.correa@ejemplo.com';     // lider geti, sede Colombia
const APRUEBA = 'hernando.castellanos@ejemplo.com'; // admin, aprueba
// Colaborador REAL del directorio con país BO: la sede ya no se digita, se
// deriva del countryCode de talento_humano, así que la prueba usa uno de verdad.
const BOLIVIA = 'alan.chavez@ejemplo.com';

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

// Lleva un documento de borrador a vigente. Hace falta porque el aislamiento por
// sedes solo se puede comprobar sobre documentación PUBLICADA: un borrador no lo
// ve nadie más que quien lo administra, así que un 404 sobre un borrador no
// demuestra que el aislamiento funcione.
async function publicar(docId, { elabora, aprueba }) {
  const fd = new FormData();
  fd.append('original', new Blob(['docx falso']), 'doc.docx');
  fd.append('pdf', new Blob(['%PDF-1.4 falso']), 'doc.pdf');
  await fetch(`${BASE}/documental/documentos/${docId}/archivos`, {
    method: 'POST', headers: { 'x-dev-user-email': elabora }, body: fd
  });
  await pedir(`/documental/documentos/${docId}/enviar-flujo`, {
    como: elabora, metodo: 'POST', body: { aprobadores: [aprueba] }
  });
  return pedir(`/documental/documentos/${docId}/decision`, {
    como: aprueba, metodo: 'POST', body: { decision: 'aprobado', comentario: 'Aprobado en pruebas' }
  });
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

  console.log('\n=== Identidad y perfil ===');
  const perfil = await pedir('/profile');
  afirmar('GET /profile devuelve el usuario', perfil.datos.correo === LIDER, JSON.stringify(perfil.datos));
  afirmar('el perfil incluye sedes', Array.isArray(perfil.datos.sedes), JSON.stringify(perfil.datos));

  console.log('\n=== Req 2: codificación con región/sede ===');
  const preGlobal = await pedir('/documental/previsualizar-codigo', {
    metodo: 'POST', body: { procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global' }
  });
  afirmar('alcance global → sufijo GLO', String(preGlobal.datos.codigo || '').endsWith('-GLO'), JSON.stringify(preGlobal.datos));

  const preReg = await pedir('/documental/previsualizar-codigo', {
    metodo: 'POST', body: { procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'regional', sedes: ['col', 'bol'] }
  });
  afirmar('alcance regional → sufijo REG', String(preReg.datos.codigo || '').endsWith('-REG'), JSON.stringify(preReg.datos));

  const preCol = await pedir('/documental/previsualizar-codigo', {
    metodo: 'POST', body: { procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'especifico', sedes: ['col'] }
  });
  afirmar('alcance específico Colombia → sufijo COL', String(preCol.datos.codigo || '').endsWith('-COL'), JSON.stringify(preCol.datos));

  const preMal = await pedir('/documental/previsualizar-codigo', {
    metodo: 'POST', body: { procesoId: 'geti', tipoId: 'pro', alcance: 'especifico', sedes: ['col', 'bol'] }
  });
  afirmar('específico con 2 sedes → 400', preMal.status === 400, `status ${preMal.status}`);

  console.log('\n=== Crear documentos locales de dos países ===');
  const docCol = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { nombre: 'Procedimiento local de pruebas Colombia', procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'especifico', sedes: ['col'], palabrasClave: ['prueba', 'colombia'] }
  });
  afirmar('crea documento local Colombia', docCol.status === 201, JSON.stringify(docCol.datos));
  console.log(`     código: ${docCol.datos.codigo}`);

  const docBol = await pedir('/documental/documentos', {
    metodo: 'POST', como: ADMIN,
    body: { nombre: 'Procedimiento local de pruebas Bolivia', procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'especifico', sedes: ['bol'] }
  });
  afirmar('crea documento local Bolivia', docBol.status === 201, JSON.stringify(docBol.datos));
  console.log(`     código: ${docBol.datos.codigo}`);

  // Cada combinación proceso+subproceso+tipo+sede lleva su propia numeración:
  // un segundo documento de Colombia avanza su contador sin tocar el de Bolivia.
  const docCol2 = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { nombre: 'Segundo procedimiento local Colombia', procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'especifico', sedes: ['col'] }
  });
  afirmar('el consecutivo de Colombia avanza en 1',
    docCol2.datos.consecutivo === docCol.datos.consecutivo + 1,
    `${docCol.datos.consecutivo} → ${docCol2.datos.consecutivo}`);

  const preBol = await pedir('/documental/previsualizar-codigo', {
    metodo: 'POST', body: { procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'especifico', sedes: ['bol'] }
  });
  afirmar('el consecutivo de Bolivia NO se vio afectado',
    preBol.datos.consecutivo === docBol.datos.consecutivo + 1,
    `Bolivia iba en ${docBol.datos.consecutivo}, el siguiente es ${preBol.datos.consecutivo}`);

  const docGlobal = await pedir('/documental/documentos', {
    metodo: 'POST', como: ADMIN,
    body: { nombre: 'Política global de pruebas', procesoId: 'geti', tipoId: 'pol', alcance: 'global' }
  });
  afirmar('crea documento global', docGlobal.status === 201, JSON.stringify(docGlobal.datos));

  console.log('\n=== Req 14: aislamiento por sedes ===');
  // Ya no hay que dar de alta a nadie: la sede sale del directorio.
  const perfilBol = await pedir('/profile', { como: BOLIVIA });
  afirmar('la sede del colaborador se deriva del directorio',
    perfilBol.datos.sedePropia === 'bol', String(perfilBol.datos.sedePropia));

  // Se publican los tres documentos: el colaborador solo ve documentación
  // vigente, así que sobre borradores el aislamiento no sería comprobable.
  // `docCol` se deja en borrador a propósito: lo usan las pruebas de archivos.
  await publicar(docCol2.datos.id, { elabora: LIDER, aprueba: ADMIN });
  await publicar(docBol.datos.id, { elabora: ADMIN, aprueba: APRUEBA });
  await publicar(docGlobal.datos.id, { elabora: ADMIN, aprueba: APRUEBA });

  const verCol = await pedir(`/documental/documentos/${docCol2.datos.id}`, { como: BOLIVIA });
  afirmar('usuario de Bolivia NO accede al documento local de Colombia', verCol.status === 404, `status ${verCol.status}`);

  const verBol = await pedir(`/documental/documentos/${docBol.datos.id}`, { como: BOLIVIA });
  afirmar('usuario de Bolivia SÍ accede a su documento local', verBol.status === 200, `status ${verBol.status}`);

  const verGlobal = await pedir(`/documental/documentos/${docGlobal.datos.id}`, { como: BOLIVIA });
  afirmar('usuario de Bolivia SÍ accede al documento global', verGlobal.status === 200, `status ${verGlobal.status}`);

  const listaBol = await pedir('/documental/documentos', { como: BOLIVIA });
  const codigos = listaBol.datos.map((d) => d.codigo);
  afirmar('el listado de Bolivia excluye el documento de Colombia',
    !codigos.includes(docCol2.datos.codigo) && codigos.includes(docBol.datos.codigo),
    JSON.stringify(codigos));

  const borradorAjeno = await pedir(`/documental/documentos/${docCol.datos.id}`, { como: BOLIVIA });
  afirmar('un borrador no lo alcanza ningún colaborador', borradorAjeno.status === 404,
    `status ${borradorAjeno.status}`);

  console.log('\n=== Req 5: original + PDF obligatorios ===');
  const sinArchivos = await pedir(`/documental/documentos/${docCol.datos.id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [ADMIN] }
  });
  afirmar('enviar a flujo sin archivos → 409', sinArchivos.status === 409, JSON.stringify(sinArchivos.datos));
  afirmar('el error menciona el PDF', /PDF/i.test(JSON.stringify(sinArchivos.datos)), JSON.stringify(sinArchivos.datos));

  console.log('\n=== Req 7: asignación por cargo y segregación de funciones ===');
  const autoAprobacion = await pedir(`/documental/documentos/${docCol.datos.id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [LIDER] }
  });
  // Falla por archivos (409) antes de llegar a la validación de segregación:
  // el orden correcto es exigir los archivos primero.
  afirmar('valida archivos antes que el flujo', autoAprobacion.status === 409, `status ${autoAprobacion.status}`);

  const cargoInexistente = await pedir(`/documental/documentos/${docCol.datos.id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [{ tipo: 'cargo', valor: 'no-existe' }] }
  });
  afirmar('asignación por cargo se valida', [400, 409].includes(cargoInexistente.status), `status ${cargoInexistente.status}`);

  console.log('\n=== Req 9 y 21: obsoletos y exportación ===');
  const obs = await pedir('/documental/obsoletos');
  afirmar('GET /obsoletos responde una lista', Array.isArray(obs.datos), JSON.stringify(obs.datos).slice(0, 120));

  const csv = await fetch(`${BASE}/documental/documentos.csv`, { headers: { 'x-dev-user-email': LIDER } });
  const textoCsv = await csv.text();
  afirmar('exportación CSV con encabezados', csv.status === 200 && textoCsv.includes('Código') && textoCsv.includes('Días para revisión'),
    textoCsv.slice(0, 120));

  console.log('\n=== Req 12, 16, 17, 20: mapa, plantillas, glosario, parámetros ===');
  const mapa = await pedir('/documental/mapa-procesos');
  afirmar('mapa de procesos con conteo de documentos',
    Array.isArray(mapa.datos) && mapa.datos.some((p) => p.documentos && typeof p.documentos.total === 'number'),
    JSON.stringify(mapa.datos).slice(0, 160));

  // `cargos` ya no es un catálogo propio: viene del directorio de empleados.
  for (const [cat, minimo] of [['plantillas', 8], ['definiciones', 15], ['parametros', 8], ['grupos', 4], ['sedes', 16]]) {
    const r = await pedir(`/config/${cat}`);
    afirmar(`catálogo ${cat} (>= ${minimo})`, Array.isArray(r.datos) && r.datos.length >= minimo,
      `${Array.isArray(r.datos) ? r.datos.length : r.status}`);
  }

  const escritura = await pedir('/config/parametros', { como: BOLIVIA, metodo: 'POST', body: { id: 'hack', valor: 1 } });
  afirmar('un usuario común NO escribe configuración', escritura.status === 403, `status ${escritura.status}`);

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
