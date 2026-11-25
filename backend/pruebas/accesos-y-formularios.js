// Pruebas de los módulos de accesos y de parametrización de formularios.
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const ADMIN = 'cristian.moreno@ejemplo.com';   // sgc.administrador + sgc.accesos
// Líder de geti que NO administra el panel de accesos. Lo que se comprueba con
// él es el ROL —un líder de proceso no reparte accesos—, no la persona, así que
// sirve cualquier líder que no sea titular de `sgc.accesos`.
//
// Es fidel y no javier a propósito: javier es el DEV_USER_EMAIL de desarrollo
// local (backend/.env), y darle el panel de accesos en `sgc_dev` para poder
// trabajar hacía fallar esta prueba. Atar el caso a la identidad de quien
// desarrolla convierte una configuración legítima del entorno en un fallo.
const LIDER = 'fidel.urrea@ejemplo.com';
const COMUN = 'juan.beleno@ejemplo.com';       // sin accesos especiales

let ok = 0, fallos = 0;
const afirmar = (n, c, d = '') => {
  if (c) { ok++; console.log(`  ✓ ${n}`); } else { fallos++; console.log(`  ✗ ${n} ${d}`); }
};

async function pedir(ruta, { como = ADMIN, metodo = 'GET', body } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'x-dev-user-email': como, 'X-Requested-With': 'XMLHttpRequest',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await res.text();
  let datos; try { datos = JSON.parse(t); } catch { datos = t; }
  return { status: res.status, datos };
}

(async () => {
  const salud = await (await fetch(`${BASE}/health`)).json();
  if (salud.raiz === 'sgc') { console.error('ABORTADO: raíz de producción.'); process.exit(1); }
  console.log(`Raíz Firestore: ${salud.raiz}`);

  console.log('\n=== Directorio de empleados ===');
  const dir = await pedir('/empleados?q=moreno&limite=5');
  afirmar('busca en el directorio', dir.status === 200 && dir.datos.empleados.length > 0,
    JSON.stringify(dir.datos).slice(0, 120));
  afirmar('trae cargo, área y sede del directorio',
    dir.datos.empleados.every((e) => 'cargo' in e && 'area' in e && 'sedeId' in e));

  const dim = await pedir('/empleados/dimensiones');
  afirmar('expone áreas, sedes y cargos reales',
    dim.datos.areas.length > 5 && dim.datos.cargos.length > 50 && dim.datos.total > 300,
    `areas=${dim.datos.areas.length} cargos=${dim.datos.cargos.length} total=${dim.datos.total}`);

  console.log('\n=== Identidad compuesta: directorio + accesos ===');
  const perfil = await pedir('/profile');
  afirmar('el nombre viene del directorio', perfil.datos.nombre.includes('Cristian'), perfil.datos.nombre);
  afirmar('el cargo viene del directorio', !!perfil.datos.cargo, String(perfil.datos.cargo));
  afirmar('la sede se deriva del país del directorio', perfil.datos.sedePropia === 'col',
    String(perfil.datos.sedePropia));
  afirmar('rol admin derivado del recurso sgc.administrador', perfil.datos.rol === 'admin', perfil.datos.rol);

  const perfilLider = await pedir('/profile', { como: LIDER });
  afirmar('el líder resuelve rol lider', perfilLider.datos.rol === 'lider', perfilLider.datos.rol);
  afirmar('el líder solo administra sus procesos',
    perfilLider.datos.procesos.includes('geti') && !perfilLider.datos.administraTodosLosProcesos,
    JSON.stringify(perfilLider.datos.procesos));

  const perfilComun = await pedir('/profile', { como: COMUN });
  afirmar('el usuario común resuelve rol usuario', perfilComun.datos.rol === 'usuario', perfilComun.datos.rol);
  afirmar('el usuario común NO puede configurar',
    perfilComun.datos.permisos['sgc.configuracion'] === false);

  console.log('\n=== Panel de accesos: autorización ===');
  const catAdmin = await pedir('/accesos/catalogo');
  afirmar('el admin del panel ve el catálogo', catAdmin.status === 200, `status ${catAdmin.status}`);
  afirmar('el catálogo trae los recursos del registry', catAdmin.datos.recursos.length >= 16,
    String(catAdmin.datos.recursos?.length));

  const catLider = await pedir('/accesos/catalogo', { como: LIDER });
  afirmar('un líder NO administra accesos', catLider.status === 403, `status ${catLider.status}`);
  afirmar('el 403 informa la identidad detectada', catLider.datos.correoDetectado === LIDER);

  console.log('\n=== Salvaguardas del panel ===');
  const sinNadie = await pedir('/accesos/recurso/sgc.accesos', { metodo: 'PUT', body: { emails: [] } });
  afirmar('no deja el panel sin administradores', sinNadie.status === 400, JSON.stringify(sinNadie.datos));

  const autoQuitar = await pedir('/accesos/recurso/sgc.accesos', {
    metodo: 'PUT', body: { emails: ['hernando.castellanos@ejemplo.com'] }
  });
  afirmar('nadie se quita a sí mismo del panel', autoQuitar.status === 400, JSON.stringify(autoQuitar.datos));

  const sinAdmin = await pedir('/accesos/recurso/sgc.administrador', { metodo: 'PUT', body: { emails: [] } });
  afirmar('no deja el SGC sin administrador', sinAdmin.status === 400, JSON.stringify(sinAdmin.datos));

  const tipoMalo = await pedir('/accesos/recurso/sgc.administrador', {
    metodo: 'PUT', body: { emails: [ADMIN], abierto: true }
  });
  afirmar('rechaza abrir un recurso no abrible', tipoMalo.status === 400, JSON.stringify(tipoMalo.datos));

  const ambitoMalo = await pedir('/accesos/recurso/documental.crear', {
    metodo: 'PUT', body: { emails: [], scopes: { [LIDER]: { procesos: ['no-existe'] } } }
  });
  afirmar('valida que el proceso del ámbito exista', ambitoMalo.status === 400, JSON.stringify(ambitoMalo.datos));

  const inventado = await pedir('/accesos/recurso/modulo.inventado', { metodo: 'PUT', body: { emails: [] } });
  afirmar('no se puede inventar un recurso', inventado.status === 404, `status ${inventado.status}`);

  console.log('\n=== El panel decide de verdad ===');
  // Se le da a un usuario común el acceso de documentos externos y se comprueba
  // que el módulo lo respeta de inmediato (la caché se invalida al guardar).
  const antes = await pedir('/documental/externos', {
    como: COMUN, metodo: 'POST', body: { nombre: 'Norma externa de prueba', tipo: 'Norma' }
  });
  afirmar('sin acceso no puede crear externos', antes.status === 403, `status ${antes.status}`);

  await pedir('/accesos/recurso/documental.externos', {
    metodo: 'PUT', body: { emails: [ADMIN, 'hernando.castellanos@ejemplo.com', COMUN] }
  });
  const despues = await pedir('/documental/externos', {
    como: COMUN, metodo: 'POST', body: { nombre: `Norma externa ${Date.now()}`, tipo: 'Norma' }
  });
  afirmar('al concederle el acceso, ya puede crear', despues.status === 201, JSON.stringify(despues.datos));

  console.log('\n=== Administradores por módulo (dueño del proceso) ===');
  // Regla: cada grupo del catálogo tiene exactamente un recurso administrador y
  // quien esté en él tiene todos los recursos del grupo, incluidos los futuros.
  const cat = await pedir('/accesos/catalogo');
  const admins = cat.datos.recursos.filter((r) => r.administraGrupo);
  const gruposConModulo = cat.datos.grupos.filter((g) => g !== 'Global');
  afirmar('cada módulo tiene su recurso "administrar el módulo"',
    gruposConModulo.every((g) => admins.filter((a) => a.grupo === g).length === 1),
    JSON.stringify(gruposConModulo.map((g) => [g, admins.filter((a) => a.grupo === g).length])));

  const antesAdmin = await pedir('/profile', { como: COMUN });
  afirmar('el usuario común no administra ningún módulo',
    (antesAdmin.datos.administraModulos || []).length === 0 && antesAdmin.datos.permisos['documental.glosario'] === false,
    JSON.stringify(antesAdmin.datos.administraModulos));

  const darAdminDoc = await pedir('/accesos/recurso/documental.administrar', {
    metodo: 'PUT', body: { emails: [COMUN] }
  });
  afirmar('se asigna el administrador del módulo documental', darAdminDoc.status === 200, JSON.stringify(darAdminDoc.datos));
  const comoAdminDoc = await pedir('/profile', { como: COMUN });
  afirmar('el administrador del módulo tiene TODOS los recursos del grupo',
    comoAdminDoc.datos.permisos['documental.glosario'] === true &&
    comoAdminDoc.datos.permisos['documental.externos'] === true &&
    comoAdminDoc.datos.permisos['modulo.documental'] === true,
    JSON.stringify(comoAdminDoc.datos.permisos));
  afirmar('administra todos los procesos y ve todas las sedes (ámbitos del módulo)',
    comoAdminDoc.datos.administraTodosLosProcesos === true && comoAdminDoc.datos.verTodasLasSedes === true &&
    comoAdminDoc.datos.rol === 'lider',
    JSON.stringify({ p: comoAdminDoc.datos.administraTodosLosProcesos, s: comoAdminDoc.datos.verTodasLasSedes }));
  afirmar('el perfil declara el módulo que administra',
    (comoAdminDoc.datos.administraModulos || []).includes('Gestión Documental'),
    JSON.stringify(comoAdminDoc.datos.administraModulos));
  afirmar('pero NO administra otros módulos ni el SGC',
    comoAdminDoc.datos.permisos['mejoramiento.anular'] === false &&
    comoAdminDoc.datos.permisos['seguridad.soa-editar'] === false &&
    comoAdminDoc.datos.permisos['sgc.configuracion'] === false && comoAdminDoc.datos.rol !== 'admin',
    JSON.stringify(comoAdminDoc.datos.permisos));
  const docComoAdminDoc = await pedir('/documental/documentos', {
    como: COMUN, metodo: 'POST',
    body: { nombre: `Documento del administrador de módulo ${Date.now()}`, procesoId: 'geti', tipoId: 'pro', alcance: 'global' }
  });
  afirmar('el módulo respeta al administrador (crea documentos sin ser líder del proceso)',
    docComoAdminDoc.status === 201, `status ${docComoAdminDoc.status} ${JSON.stringify(docComoAdminDoc.datos).slice(0, 120)}`);
  const glosarioComoAdminDoc = await pedir('/config/definiciones', {
    como: COMUN, metodo: 'POST', body: { termino: `Término admin módulo ${Date.now()}`, definicion: 'Prueba del administrador por módulo.' }
  });
  afirmar('edita el glosario (recurso documental.glosario cubierto por el administrador del módulo)',
    [200, 201].includes(glosarioComoAdminDoc.status), `status ${glosarioComoAdminDoc.status} ${JSON.stringify(glosarioComoAdminDoc.datos).slice(0, 120)}`);

  await pedir('/accesos/recurso/documental.administrar', { metodo: 'PUT', body: { emails: [] } });
  const sinAdminDoc = await pedir('/profile', { como: COMUN });
  afirmar('al quitarlo, pierde los recursos del grupo de inmediato',
    sinAdminDoc.datos.permisos['documental.glosario'] === false && (sinAdminDoc.datos.administraModulos || []).length === 0,
    JSON.stringify(sinAdminDoc.datos.administraModulos));

  // Se revierte para no dejar el entorno alterado.
  await pedir('/accesos/recurso/documental.externos', {
    metodo: 'PUT', body: { emails: [ADMIN, 'hernando.castellanos@ejemplo.com'] }
  });
  const revertido = await pedir('/documental/externos', {
    como: COMUN, metodo: 'POST', body: { nombre: 'Otra norma', tipo: 'Norma' }
  });
  afirmar('al revocarlo, vuelve a quedar sin acceso', revertido.status === 403, `status ${revertido.status}`);

  console.log('\n=== Simulador y auditoría ===');
  const sim = await pedir(`/accesos/simular?correo=${encodeURIComponent(COMUN)}`);
  afirmar('simula a otro colaborador', sim.status === 200 && sim.datos.detalle.length >= 16);
  afirmar('el simulado no tiene acceso a configuración',
    sim.datos.detalle.find((d) => d.id === 'sgc.configuracion')?.permitido === false);

  const aud = await pedir('/accesos/auditoria');
  afirmar('la auditoría registró los cambios de acceso',
    aud.status === 200 && aud.datos.registros.length > 0, String(aud.datos.registros?.length));

  console.log('\n=== Parametrización de formularios ===');
  const meta = await pedir('/formularios/metadatos');
  afirmar('expone tipos y catálogos disponibles',
    meta.datos.tipos.length >= 10 && meta.datos.catalogos.includes('tipos_hallazgo'),
    JSON.stringify(meta.datos.catalogos));

  // Hay un formulario POR MÓDULO, cada uno con SUS secciones. Antes el motor
  // servía uno solo con las secciones del documento cableadas, y el módulo de
  // mejoramiento no tenía forma de parametrizar su hallazgo.
  const formDocumento = meta.datos.formularios.find((f) => f.id === 'documento');
  const formHallazgo = meta.datos.formularios.find((f) => f.id === 'hallazgo');
  afirmar('declara el formulario del documento con sus 4 secciones',
    formDocumento?.modulo === 'documental' && formDocumento.secciones.length === 4,
    JSON.stringify(formDocumento));
  afirmar('declara el formulario del hallazgo con sus propias secciones',
    formHallazgo?.modulo === 'mejoramiento' && formHallazgo.secciones.length === 4 &&
    formHallazgo.secciones.some((s) => s.id === 'origen'),
    JSON.stringify(formHallazgo));
  afirmar('cada módulo activo tiene su formulario', meta.datos.modulos.length >= 9);

  const def = await pedir('/formularios/documento');
  // Eran 13 hasta el 2026-09-25: se retiraron `permitirDescargaOriginal` y
  // `permitirImpresion` cuando la descarga dejó de decidirse por documento.
  afirmar('trae los 11 campos de sistema', def.datos.campos.length === 11, String(def.datos.campos.length));
  afirmar('los interruptores de descarga por documento ya no existen',
    !def.datos.campos.some((c) => ['permitirImpresion', 'permitirDescargaOriginal'].includes(c.clave)));
  // Bloqueados: nombre, procesoId, tipoId, alcance, sedes, confidencialidad.
  afirmar('marca como bloqueados los que mueven lógica',
    def.datos.campos.filter((c) => c.bloqueado).length === 6,
    String(def.datos.campos.filter((c) => c.bloqueado).length));

  const defHallazgo = await pedir('/formularios/hallazgo');
  afirmar('el formulario del hallazgo trae sus 13 campos de sistema',
    defHallazgo.datos.campos.length === 13, String(defHallazgo.datos.campos.length));
  // Bloqueados: fecha, procesos, alcance, sedes, descripción, tipo, fuente,
  // tipoAccion y metodología. Alcance y sedes lo están porque se validan como una
  // unidad y el filtro del listado consulta `sedes`.
  afirmar('bloquea los campos del hallazgo que deciden el flujo',
    defHallazgo.datos.campos.filter((c) => c.bloqueado).length === 9,
    String(defHallazgo.datos.campos.filter((c) => c.bloqueado).length));
  afirmar('el hallazgo usa la misma gramática de alcance que el documento',
    defHallazgo.datos.campos.find((c) => c.clave === 'alcance')?.opciones?.length === 3 &&
    defHallazgo.datos.campos.find((c) => c.clave === 'sedes')?.tipo === 'catalogoMultiple');
  afirmar('el tipo de hallazgo se alimenta del catálogo global',
    defHallazgo.datos.campos.find((c) => c.clave === 'tipoHallazgoId')?.catalogo === 'tipos_hallazgo');

  const inexistente = await pedir('/formularios/inventarios');
  afirmar('un formulario no declarado responde 404', inexistente.status === 404,
    `status ${inexistente.status}`);

  // Un ajuste solo vale sobre un campo DE ESE formulario: sin esta comprobación
  // se podría guardar un ajuste de `alcance` (del documento) en el hallazgo, y
  // quedaría almacenado sin efecto y sin aviso.
  const campoAjeno = await pedir('/formularios/hallazgo', {
    metodo: 'PUT', body: { ajustes: [{ clave: 'alcance', etiqueta: 'X' }], personalizados: [] }
  });
  afirmar('rechaza ajustar un campo de otro formulario', campoAjeno.status === 400,
    JSON.stringify(campoAjeno.datos));

  const noPuede = await pedir('/formularios/documento', {
    como: COMUN, metodo: 'PUT', body: { ajustes: [], personalizados: [] }
  });
  afirmar('un usuario común no edita la definición', noPuede.status === 403, `status ${noPuede.status}`);

  const bloqueado = await pedir('/formularios/documento', {
    metodo: 'PUT', body: { ajustes: [{ clave: 'procesoId', requerido: false }], personalizados: [] }
  });
  afirmar('no deja volver opcional un campo indispensable', bloqueado.status === 400,
    JSON.stringify(bloqueado.datos));

  const claveMala = await pedir('/formularios/documento', {
    metodo: 'PUT', body: { ajustes: [], personalizados: [{ clave: 'nombre', etiqueta: 'X', tipo: 'texto' }] }
  });
  afirmar('no deja pisar la clave de un campo de sistema', claveMala.status === 400,
    JSON.stringify(claveMala.datos));

  console.log('\n=== Un campo personalizado de punta a punta ===');
  const guardado = await pedir('/formularios/documento', {
    metodo: 'PUT',
    body: {
      ajustes: [{ clave: 'descripcion', etiqueta: 'Objetivo del documento', ayuda: 'Para qué existe' }],
      personalizados: [
        { clave: 'criticidad', etiqueta: 'Criticidad', tipo: 'seleccion', requerido: true, enListado: true,
          opciones: [{ valor: 'alta', etiqueta: 'Alta' }, { valor: 'baja', etiqueta: 'Baja' }] },
        { clave: 'responsableTecnico', etiqueta: 'Responsable técnico', tipo: 'texto', requerido: false }
      ]
    }
  });
  afirmar('guarda la definición', guardado.status === 200, JSON.stringify(guardado.datos).slice(0, 160));
  afirmar('aplicó el ajuste de etiqueta',
    guardado.datos.campos.find((c) => c.clave === 'descripcion')?.etiqueta === 'Objetivo del documento');
  afirmar('agregó los 2 campos personalizados',
    guardado.datos.campos.filter((c) => !c.sistema).length === 2);

  // Crear un documento SIN el campo obligatorio nuevo debe fallar.
  const base = {
    nombre: `Documento con campos nuevos ${Date.now()}`,
    procesoId: 'geti', subprocesoId: 'dss', tipoId: 'pro', alcance: 'global'
  };
  const sinCampo = await pedir('/documental/documentos', { metodo: 'POST', body: base });
  afirmar('exige el campo personalizado obligatorio', sinCampo.status === 400,
    JSON.stringify(sinCampo.datos));

  const valorMalo = await pedir('/documental/documentos', {
    metodo: 'POST', body: { ...base, datos: { criticidad: 'inventada' } }
  });
  afirmar('valida las opciones del campo', valorMalo.status === 400, JSON.stringify(valorMalo.datos));

  const conCampo = await pedir('/documental/documentos', {
    metodo: 'POST',
    body: { ...base, datos: { criticidad: 'alta', responsableTecnico: 'Área de TICS' } }
  });
  afirmar('crea el documento con los campos nuevos', conCampo.status === 201,
    JSON.stringify(conCampo.datos).slice(0, 160));
  afirmar('los valores quedaron guardados',
    conCampo.datos.datos?.criticidad === 'alta' && conCampo.datos.datos?.responsableTecnico === 'Área de TICS',
    JSON.stringify(conCampo.datos.datos));

  const listado = await pedir('/documental/documentos?q=campos nuevos');
  afirmar('el listado expone los datos personalizados',
    listado.datos.some((d) => d.datos?.criticidad === 'alta'));

  // Restablecer para no dejar el formulario alterado.
  const reset = await pedir('/formularios/documento/restablecer', { metodo: 'POST' });
  afirmar('restablece a la definición de fábrica',
    reset.status === 200 && reset.datos.campos.filter((c) => !c.sistema).length === 0);

  console.log('\n=== Asignación de flujo por área del directorio ===');
  // La validación de archivos corre ANTES de resolver las asignaciones, así que
  // hay que cargarlos para poder probar la resolución por área.
  const fd = new FormData();
  fd.append('original', new Blob(['docx']), 'doc.docx');
  fd.append('pdf', new Blob(['%PDF-1.4']), 'doc.pdf');
  await fetch(`${BASE}/documental/documentos/${conCampo.datos.id}/archivos`, {
    method: 'POST', headers: { 'x-dev-user-email': ADMIN }, body: fd
  });

  const areaMala = await pedir(`/documental/documentos/${conCampo.datos.id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [{ tipo: 'area', valor: 'AREA QUE NO EXISTE' }] }
  });
  afirmar('un área inexistente se rechaza', areaMala.status === 400, JSON.stringify(areaMala.datos));

  // HSEQ existe en el directorio y no incluye a quien elaboró: debe resolver.
  const porArea = await pedir(`/documental/documentos/${conCampo.datos.id}/enviar-flujo`, {
    metodo: 'POST', body: { aprobadores: [{ tipo: 'area', valor: 'HSEQ' }] }
  });
  afirmar('un área real se expande a sus integrantes', porArea.status === 200,
    JSON.stringify(porArea.datos).slice(0, 200));

  if (porArea.status === 200) {
    const ver = porArea.datos.versiones[porArea.datos.versiones.length - 1];
    afirmar('cada aprobador queda con su origen registrado',
      ver.flujo.aprobadores.length >= 2 &&
      ver.flujo.aprobadores.every((a) => a.asignadoPor?.tipo === 'area' && a.asignadoPor?.valor === 'HSEQ'),
      JSON.stringify(ver.flujo.aprobadores.map((a) => a.asignadoPor)));
  }

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
