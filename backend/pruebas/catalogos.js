// Catálogos y parámetros del panel de configuración:
//
//   · inactivar NO borra, así que el id sigue ocupado; volver a crearlo debe
//     REACTIVAR el registro en lugar de responder "ya existe" sobre una fila que
//     la interfaz no muestra (era el camino sin salida reportado por el negocio).
//   · el panel tiene que poder ver lo inactivo para reactivarlo.
//   · todo catálogo se puede editar, no solo crear y borrar.
const BASE = process.env.SGC_API_BASE || 'http://localhost:8080/api';

const ADMIN = 'cristian.moreno@ejemplo.com';   // tiene sgc.configuracion
const COMUN = 'juan.beleno@ejemplo.com';       // colaborador sin rol

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
  const id = `norma-prueba-${sello}`;

  console.log('\n=== 1. Crear ===');
  const creada = await pedir('/config/normas', {
    metodo: 'POST', body: { id, nombre: `Norma de prueba ${sello}`, descripcion: 'Original' }
  });
  afirmar('se crea la norma', creada.status === 201, JSON.stringify(creada.datos));

  const duplicada = await pedir('/config/normas', {
    metodo: 'POST', body: { id, nombre: 'Intento duplicado' }
  });
  afirmar('no admite duplicar un id activo', duplicada.status === 409, JSON.stringify(duplicada.datos));

  console.log('\n=== 2. Editar ===');
  const editada = await pedir(`/config/normas/${id}`, {
    metodo: 'PUT', body: { nombre: `Norma corregida ${sello}`, descripcion: 'Corregida' }
  });
  afirmar('se edita el nombre', editada.status === 200 && /corregida/i.test(editada.datos.nombre),
    JSON.stringify(editada.datos));

  const vigentes = await pedir('/config/normas');
  afirmar('el catálogo devuelve la versión corregida',
    vigentes.datos.some((n) => n.id === id && /corregida/i.test(n.nombre)));

  console.log('\n=== 3. Inactivar: desaparece del catálogo vigente ===');
  const borrada = await pedir(`/config/normas/${id}`, { metodo: 'DELETE' });
  afirmar('la inactivación responde 200', borrada.status === 200, `status ${borrada.status}`);

  const trasBorrar = await pedir('/config/normas');
  afirmar('ya no está en el catálogo vigente', !trasBorrar.datos.some((n) => n.id === id));

  const conInactivos = await pedir('/config/normas?inactivos=1');
  const inactiva = conInactivos.datos.find((n) => n.id === id);
  afirmar('el panel sí la ve, marcada como inactiva', inactiva && inactiva.activo === false,
    JSON.stringify(inactiva));

  const espiando = await pedir('/config/normas?inactivos=1', { como: COMUN });
  afirmar('ver inactivos exige el acceso de configuración', espiando.status === 403,
    `status ${espiando.status}`);

  console.log('\n=== 4. Volver a crearla: se reactiva, no choca ===');
  const revivida = await pedir('/config/normas', {
    metodo: 'POST', body: { id, nombre: `Norma revivida ${sello}`, descripcion: 'Reactivada' }
  });
  afirmar('volver a crear un id inactivo NO da 409', revivida.status === 200, JSON.stringify(revivida.datos));
  afirmar('la respuesta avisa que se reactivó', revivida.datos.reactivado === true, JSON.stringify(revivida.datos));
  afirmar('queda activa', revivida.datos.activo === true, JSON.stringify(revivida.datos.activo));
  afirmar('se guardaron los datos indicados al recrearla',
    /revivida/i.test(revivida.datos.nombre), revivida.datos.nombre);

  const finales = await pedir('/config/normas');
  afirmar('vuelve a aparecer en el catálogo vigente', finales.datos.some((n) => n.id === id));

  console.log('\n=== 5. Los tipos de documento se pueden corregir ===');
  const idTipo = `tp${String(sello).slice(-4)}`;
  const tipo = await pedir('/config/tipos_documento', {
    metodo: 'POST', body: { id: idTipo, codigo: idTipo.toUpperCase(), nombre: 'Tipo de prueba', permiteOriginal: false }
  });
  afirmar('se crea el tipo', tipo.status === 201, JSON.stringify(tipo.datos));

  // Era el hueco funcional: `permiteOriginal` se guardaba siempre en false y no
  // había forma de activarlo, aunque la ayuda de la pantalla dijera que se marcara.
  const marcado = await pedir(`/config/tipos_documento/${idTipo}`, {
    metodo: 'PUT', body: { permiteOriginal: true }
  });
  afirmar('se puede marcar que permite el editable', marcado.datos.permiteOriginal === true,
    JSON.stringify(marcado.datos.permiteOriginal));

  console.log('\n=== 6. Los grupos también se editan ===');
  const idGrupo = `grupo-prueba-${sello}`;
  await pedir('/config/grupos', {
    metodo: 'POST', body: { id: idGrupo, nombre: 'Grupo original', regla: { tipo: 'area', valor: 'TICS' } }
  });
  const grupoEditado = await pedir(`/config/grupos/${idGrupo}`, {
    metodo: 'PUT', body: { nombre: 'Grupo renombrado', regla: { tipo: 'manual', correos: [COMUN] } }
  });
  afirmar('se renombra y se le cambia la regla',
    grupoEditado.datos.nombre === 'Grupo renombrado' && grupoEditado.datos.regla.tipo === 'manual',
    JSON.stringify(grupoEditado.datos.regla));
  // La regla se reescribe completa: si el merge conservara el `valor` del área
  // anterior, quedaría un criterio fantasma dentro de un grupo manual.
  afirmar('la regla anterior no deja residuos', !grupoEditado.datos.regla.valor,
    JSON.stringify(grupoEditado.datos.regla));

  console.log('\n=== 7. Parámetros: se edita conservando el tipo ===');
  const antes = (await pedir('/config/parametros')).datos.find((p) => p.id === 'diasAlertaRevision');
  const cambiado = await pedir('/config/parametros/diasAlertaRevision', {
    metodo: 'PUT', body: { valor: 45 }
  });
  afirmar('el parámetro numérico se guarda como número', cambiado.datos.valor === 45,
    JSON.stringify(cambiado.datos.valor));
  // Se deja como estaba: es un parámetro real del entorno de desarrollo.
  await pedir('/config/parametros/diasAlertaRevision', {
    metodo: 'PUT', body: { valor: antes ? antes.valor : 30 }
  });

  console.log('\n=== 8. Registro de configuración por módulo ===');
  //
  // El panel arma sus pestañas con esto. Lo que se verifica es la propiedad que
  // falló en producción: que TODO catálogo servido por la API esté asignado a un
  // módulo, porque el que no lo esté no aparece en ninguna pestaña y se descubre
  // como un desplegable vacío en un formulario (fue el caso de tipos_hallazgo).
  const reg = await pedir('/config/_registro');
  afirmar('el registro se publica', reg.status === 200 && Array.isArray(reg.datos.catalogos),
    JSON.stringify(reg.datos).slice(0, 120));

  const modulos = new Set(reg.datos.modulos.map((m) => m.id));
  // Global + los once módulos del SGC. El número sube cuando se declara uno
  // nuevo en core/config/registro.js: al entrar Talento Humano quedó en 12 y la
  // cuenta de aquí no se actualizó, lo que rompía la cadena de `npm test` y
  // dejaba sin correr todas las suites siguientes.
  // 2026-10-05: entró Control de Visitantes → 13. 2026-10-29: Gestión de Riesgos → 14.
  afirmar('declara el módulo Global y los trece del SGC', modulos.has('global') && modulos.size === 14,
    String(modulos.size));

  const huerfanos = reg.datos.catalogos.filter((c) => !modulos.has(c.modulo));
  afirmar('ningún catálogo queda sin módulo', huerfanos.length === 0,
    huerfanos.map((c) => c.id).join(', '));

  // Un catálogo global tiene que declarar a quién afecta: es de donde sale el
  // aviso "este cambio también afecta a…" que el panel muestra.
  const globalesSinUso = reg.datos.catalogos
    .filter((c) => c.modulo === 'global' && (c.usadoPor || []).length === 0);
  afirmar('todo catálogo global declara qué módulos lo usan', globalesSinUso.length === 0,
    globalesSinUso.map((c) => c.id).join(', '));

  const usoInexistente = reg.datos.catalogos
    .flatMap((c) => (c.usadoPor || []).filter((m) => !modulos.has(m)).map((m) => `${c.id}→${m}`));
  afirmar('no apunta a módulos que no existen', usoInexistente.length === 0, usoInexistente.join(', '));

  // Los dos catálogos que el módulo de mejoramiento necesita para poder registrar
  // una acción. Su ausencia del panel es el fallo que originó todo esto.
  for (const cat of ['tipos_hallazgo', 'fuentes_hallazgo']) {
    const entrada = reg.datos.catalogos.find((c) => c.id === cat);
    afirmar(`${cat} es global y lo usa mejoramiento`,
      entrada?.modulo === 'global' && entrada.usadoPor.includes('mejoramiento'),
      JSON.stringify(entrada));
    const filas = await pedir(`/config/${cat}`);
    afirmar(`${cat} tiene opciones para elegir`, filas.status === 200 && filas.datos.length > 0,
      `${filas.status} · ${filas.datos.length ?? 0} filas — si está vacío, corra: npm run seed`);
  }

  // Cada catálogo del registro tiene que responder de verdad: una entrada que el
  // panel dibuja pero la API no sirve da una pestaña que falla al abrirse.
  for (const c of reg.datos.catalogos) {
    const r = await pedir(`/config/${c.id}`);
    afirmar(`el catálogo ${c.id} responde`, r.status === 200, `status ${r.status}`);
  }

  console.log('\n=== 9. El país de una sede lo deriva el servidor ===');
  // Antes lo derivaba el panel, así que una sede creada por otra vía quedaba sin
  // país y el filtro por país devolvía menos de lo que hay.
  // El id es fijo porque el código de sede son 3 letras: no cabe un sello de
  // tiempo. Al inactivarse al final, la corrida siguiente lo REACTIVA (200 en
  // lugar de 201), y ahí lo que importa sigue siendo que el país venga derivado.
  const idSede = 'zzt';
  const sede = await pedir('/config/sedes', {
    metodo: 'POST', body: { id: idSede, codigo: 'ZZT', nombre: `Paisdeprueba ${sello}` }
  });
  afirmar('la sede se crea con el país derivado del nombre',
    [200, 201].includes(sede.status) && sede.datos.pais === sede.datos.nombre, JSON.stringify(sede.datos));
  await pedir(`/config/sedes/${idSede}`, { metodo: 'DELETE' });

  console.log('\n=== 10. La sigla de un proceso se recorta y no se repite ===');
  // Origen: el panel dejó crear "GETI" y "GETI " (espacio final). En pantalla eran
  // idénticos; por dentro, dos procesos con documentos y contadores propios.
  const siglaPrb = 'ZQP';
  const conEspacio = await pedir('/config/procesos', {
    metodo: 'POST', body: { id: `${siglaPrb.toLowerCase()} `, codigo: `${siglaPrb} `, nombre: `  Proceso de prueba ${sello} `, tipo: 'apoyo', orden: 99,
      subprocesos: [{ id: 'zs1 ', codigo: 'zs1 ', nombre: ' Sub uno ' }] }
  });
  afirmar('crea el proceso con la sigla recortada y en mayúsculas',
    [200, 201].includes(conEspacio.status) && conEspacio.datos.codigo === siglaPrb && conEspacio.datos.id === siglaPrb.toLowerCase(),
    JSON.stringify(conEspacio.datos));
  afirmar('el nombre y los subprocesos también quedan recortados',
    conEspacio.datos.nombre === `Proceso de prueba ${sello}` && conEspacio.datos.subprocesos?.[0]?.codigo === 'ZS1'
      && conEspacio.datos.subprocesos?.[0]?.id === 'zs1' && conEspacio.datos.subprocesos?.[0]?.nombre === 'Sub uno',
    JSON.stringify(conEspacio.datos.subprocesos));

  const repetidoEspacio = await pedir('/config/procesos', {
    metodo: 'POST', body: { id: `${siglaPrb.toLowerCase()} `, codigo: ` ${siglaPrb.toLowerCase()} `, nombre: 'Intento repetido', tipo: 'apoyo', orden: 98 }
  });
  afirmar('rechaza la misma sigla con espacios o minúsculas (409)', repetidoEspacio.status === 409, JSON.stringify(repetidoEspacio.datos));

  const conEspacioDentro = await pedir('/config/procesos', {
    metodo: 'POST', body: { id: 'zq p', codigo: 'ZQ P', nombre: 'Sigla con espacio interno', tipo: 'apoyo', orden: 98 }
  });
  afirmar('rechaza una sigla con espacio interno (400)', conEspacioDentro.status === 400, JSON.stringify(conEspacioDentro.datos));

  const subRepetido = await pedir('/config/procesos', {
    metodo: 'POST', body: { id: 'zqr', codigo: 'ZQR', nombre: 'Subprocesos repetidos', tipo: 'apoyo', orden: 98,
      subprocesos: [{ codigo: 'AA', nombre: 'Uno' }, { codigo: 'aa ', nombre: 'Dos' }] }
  });
  afirmar('rechaza subprocesos con la misma sigla (400)', subRepetido.status === 400, JSON.stringify(subRepetido.datos));

  const editado = await pedir(`/config/procesos/${siglaPrb.toLowerCase()}`, { metodo: 'PUT', body: { orden: 97 } });
  afirmar('editar solo el orden conserva la sigla y el nombre',
    editado.status === 200 && editado.datos.codigo === siglaPrb && editado.datos.nombre === `Proceso de prueba ${sello}` && editado.datos.orden === 97,
    JSON.stringify(editado.datos));

  // Cambiarle la sigla a la de otro proceso activo también se rechaza.
  const otroActivo = (await pedir('/config/procesos')).datos.find((p) => p.id !== siglaPrb.toLowerCase());
  if (otroActivo) {
    const choque = await pedir(`/config/procesos/${siglaPrb.toLowerCase()}`, { metodo: 'PUT', body: { codigo: `${otroActivo.codigo.toLowerCase()} ` } });
    afirmar('no deja renombrar un proceso con la sigla de otro (409)', choque.status === 409, JSON.stringify(choque.datos));
  }
  await pedir(`/config/procesos/${siglaPrb.toLowerCase()}`, { metodo: 'DELETE' });

  console.log('\n=== Festivos: calcular un año por norma ===');
  const anioLejano = 2041;
  let calc = await pedir('/config/festivos/calcular', { como: COMUN, metodo: 'POST', body: { anio: anioLejano, paisId: 'ecu' } });
  afirmar('calcular festivos exige configuración (403)', calc.status === 403, JSON.stringify(calc.datos));
  calc = await pedir('/config/festivos/calcular', { metodo: 'POST', body: { anio: anioLejano, paisId: 'usa' } });
  afirmar('un país sin calendario calculado se rechaza (400) y dice cuáles sí', calc.status === 400 && Array.isArray(calc.datos.paises), JSON.stringify(calc.datos));
  calc = await pedir('/config/festivos/calcular', { metodo: 'POST', body: { anio: anioLejano, paisId: 'ecu' } });
  afirmar('calcula Ecuador de un año lejano (creados > 0)', calc.status === 200 && calc.datos.creados > 0 && calc.datos.paises[0] === 'ecu', JSON.stringify(calc.datos));
  const otraVez = await pedir('/config/festivos/calcular', { metodo: 'POST', body: { anio: anioLejano, paisId: 'ecu' } });
  afirmar('repetirlo no duplica (creados = 0)', otraVez.status === 200 && otraVez.datos.creados === 0, JSON.stringify(otraVez.datos));
  const festivosEcu = (await pedir('/config/festivos')).datos.filter((f) => f.paisId === 'ecu' && String(f.fecha).startsWith(String(anioLejano)));
  afirmar('los festivos calculados quedan en el catálogo con id país-fecha', festivosEcu.length === calc.datos.creados && festivosEcu.every((f) => f.id === `ecu-${f.fecha}`), String(festivosEcu.length));
  for (const f of festivosEcu) await pedir(`/config/festivos/${f.id}`, { metodo: 'DELETE' });

  // Limpieza de lo que esta prueba creó.
  for (const [cat, registro] of [['normas', id], ['tipos_documento', idTipo], ['grupos', idGrupo]]) {
    await pedir(`/config/${cat}/${registro}`, { metodo: 'DELETE' });
  }

  console.log(`\n${'='.repeat(46)}\n${ok} pruebas OK · ${fallos} fallos\n`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR DE LA PRUEBA:', e); process.exit(1); });
