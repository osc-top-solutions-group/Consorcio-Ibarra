import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Trash2, Upload, FileDown, Settings, Users, ChevronDown, ChevronUp,
  Pencil, Check, X, RotateCcw, Globe, Loader2, Construction, AlertTriangle,
  Info, ChevronLeft
} from 'lucide-react';
import { api, catalogo, invalidarCatalogo } from '@/shared/api';
import SelectorEmpleados from '@/shared/components/SelectorEmpleados.jsx';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import {
  PanelConNavegacion, Buscador, GrupoModulo, ItemNav, Plegable, Linea,
  iconoDeModulo, listar
} from '../components/NavegacionConfig.jsx';

// Panel de configuración general: parametriza todo lo base del SGC. No es
// visible para el usuario final (solo rol admin, y el backend lo exige también).
// Usuarios y cargos ya no se administran aquí: los usuarios se gestionan en
// Gestión de Accesos y los cargos vienen del catálogo de Usuarios.
//
// AGRUPADO POR MÓDULO, y la lista de módulos y catálogos la manda el BACKEND
// (`/config/_registro`, ver core/config/registro.js). Antes esta pantalla tenía
// siete pestañas escritas a mano —todas del módulo documental— y el resultado fue
// que los catálogos de mejoramiento existían en la API pero no en ninguna
// pestaña: el síntoma en pantalla era un desplegable vacío en "Nueva acción".
// Con la lista viniendo del registro, un catálogo nuevo aparece aquí solo.
//
// Un catálogo GLOBAL (procesos, sedes, tipos de hallazgo…) se muestra en su
// módulo "Global" y también dentro de cada módulo que lo usa, con el aviso de a
// quién más afecta el cambio.
//
// La navegación es un árbol lateral (ver components/NavegacionConfig.jsx). Sin
// catálogo elegido se muestra el RESUMEN del módulo, que hace de índice: todo lo
// que se configura ahí, con cuántos registros tiene cada cosa.

export default function Admin() {
  const { usuario } = useAuth();
  const [params] = useSearchParams();
  const [registroCompleto, setRegistro] = useState(null);
  const [conteos, setConteos] = useState({});
  // `?modulo=` abre directamente un módulo: el menú de Talento Humano enlaza
  // aquí para que su administrador edite sus catálogos con permiso propio.
  const [moduloId, setModuloId] = useState(params.get('modulo') || 'global');

  // QUIÉN ESCRIBE CADA CATÁLOGO (2026-11-13). Por defecto `sgc.configuracion`;
  // un catálogo que declara `exige` (p. ej. las secciones de la carpeta de
  // Talento Humano) lo escribe SOLO quien tenga ese recurso, y el backend lo
  // exige igual. Quien no tiene el panel general pero sí uno de esos recursos
  // entra viendo únicamente los catálogos que le tocan.
  const permisos = usuario?.permisos || {};
  const general = !!permisos['sgc.configuracion'];
  const puedeEscribir = (c) => (c?.exige ? !!permisos[c.exige] : general) && !c?.soloDesdeModulo;
  const registro = useMemo(() => {
    if (!registroCompleto || general) return registroCompleto;
    const catalogos = registroCompleto.catalogos.filter((c) => c.exige && permisos[c.exige]);
    const modulos = registroCompleto.modulos.filter((m) => catalogos.some((c) => c.modulo === m.id));
    return { ...registroCompleto, catalogos, modulos };
  }, [registroCompleto, general, usuario]);
  // Sin el panel general el módulo «Global» no existe para esta persona: se
  // aterriza en el primero de los suyos.
  useEffect(() => {
    if (!general && registro?.modulos.length && !registro.modulos.some((m) => m.id === moduloId)) {
      setModuloId(registro.modulos[0].id);
    }
  }, [registro, general, moduloId]);
  // `null` = resumen del módulo. Es el aterrizaje: se ve qué hay antes de entrar.
  const [pestana, setPestana] = useState(null);
  const [filas, setFilas] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    api('/config/_registro?conteos=1')
      .then((r) => { setRegistro(r); setConteos(r.conteos || {}); })
      .catch((e) => setError(e.message));
  }, []);

  // Catálogos que se administran desde un módulo: primero los propios, después
  // los globales que hereda. El orden importa porque lo específico del módulo es
  // lo que se viene a configurar; lo global ya se administró una vez.
  const catalogosDe = useMemo(() => (id) => {
    if (!registro) return { propios: [], globales: [] };
    const propios = registro.catalogos.filter((c) => c.modulo === id);
    const globales = id === 'global'
      ? []
      : registro.catalogos.filter((c) => c.modulo === 'global' && c.usadoPor.includes(id));
    return { propios, globales };
  }, [registro]);

  const delModulo = useMemo(() => {
    const { propios, globales } = catalogosDe(moduloId);
    return [...propios, ...globales];
  }, [catalogosDe, moduloId]);

  // Al cambiar de módulo la selección anterior puede no existir en el nuevo: se
  // vuelve al resumen en lugar de quedarse apuntando a un catálogo que no está.
  useEffect(() => {
    if (registro && pestana && !delModulo.some((c) => c.id === pestana)) setPestana(null);
  }, [registro, delModulo, pestana]);

  const config = delModulo.find((c) => c.id === pestana) || null;
  const modulo = registro?.modulos.find((m) => m.id === moduloId) || null;

  function abrir(idModulo, idCatalogo = null) {
    setModuloId(idModulo);
    setPestana(idCatalogo);
  }

  // El panel pide el catálogo COMPLETO (`?inactivos=1`), no el vigente: quien
  // administra tiene que ver lo que inactivó para poder reactivarlo. El resto de
  // la aplicación sigue recibiendo solo lo activo, y por eso se invalida la caché
  // del cliente: si aquí se cambia una sigla, los formularios deben verla.
  function cargar(cat = pestana) {
    if (!cat) return;
    invalidarCatalogo(cat);
    api(`/config/${cat}?inactivos=1`)
      .then((rows) => {
        setFilas(rows);
        // El contador del árbol se recalcula con lo que acaba de llegar, en lugar
        // de volver a pedir el registro entero: crear o inactivar tiene que verse
        // en la barra lateral en el acto.
        setConteos((c) => ({ ...c, [cat]: rows.filter((r) => r.activo !== false).length }));
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    setError(null);
    setMensaje(null);
    setFilas([]);
    cargar(pestana);
  }, [pestana]);

  // Sin el panel general, se espera al registro para saber si administra algún
  // catálogo con permiso propio antes de negar la entrada.
  if (!general && (!registro || !registro.catalogos.length)) {
    if (!registro && !error) return <div className="flex justify-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    return <div className="card max-w-xl border-rose-200 bg-rose-50 text-sm text-rose-600">
      Esta sección requiere el acceso de configuración. Solicítelo a un administrador de la plataforma.
    </div>;
  }

  // Envuelve cada escritura: limpia los avisos previos, recarga y devuelve el
  // error a quien llamó para que la fila sepa que no debe cerrar su edición.
  async function escribir(fn) {
    setError(null);
    setMensaje(null);
    try {
      const resultado = await fn();
      cargar();
      return resultado;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }

  // Devuelve la fila creada, o null si falló. No propaga el error —a diferencia de
  // `actualizar`— porque quien llama es un formulario que solo necesita saber si
  // puede limpiarse; el mensaje ya se muestra arriba.
  async function crear(body) {
    let row = null;
    try {
      row = await escribir(() => api(`/config/${pestana}`, { method: 'POST', body }));
    } catch {
      return null;
    }
    // El backend reactiva en lugar de duplicar cuando el id ya existía inactivo.
    // Se avisa, porque no es lo que la persona creía estar haciendo.
    if (row && row.reactivado) {
      setMensaje(`"${row.nombre || row.id}" ya existía inactivo: se reactivó con los datos indicados.`);
    }
    return row;
  }

  // El id va codificado: un id con espacio final (pasó con "gfin ") o con
  // caracteres especiales, puesto crudo en la URL, lo recorta el navegador y la
  // petición termina en otro registro o en un 404.
  const actualizar = (id, body) => escribir(() => api(`/config/${pestana}/${encodeURIComponent(id)}`, { method: 'PUT', body }));

  async function inactivar(id) {
    if (!confirm('¿Inactivar este registro? No se borra: deja de estar disponible y podrá reactivarlo desde esta misma pantalla.')) return;
    await escribir(() => api(`/config/${pestana}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }

  // Reactivar es volver a crear con el mismo id: el backend reconoce el registro
  // inactivo y lo revive conservando su historia.
  async function reactivar(fila) {
    const { reactivado, ...datos } = fila;
    await escribir(() => api(`/config/${pestana}`, { method: 'POST', body: datos }));
    setMensaje(`"${fila.nombre || fila.id}" volvió a estar disponible.`);
  }

  const props = {
    filas, onCrear: crear, onActualizar: actualizar, onInactivar: inactivar,
    onReactivar: reactivar, onError: setError, recargar: cargar
  };

  if (!registro) {
    return error
      ? <div className="card max-w-xl border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>
      : <div className="flex justify-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div>
        <h1 className="titulo-pagina flex items-center gap-2"><Settings className="h-6 w-6" /> Configuración</h1>
        <p className="subtitulo-pagina">
          Catálogos y parámetros, agrupados por el módulo que los usa. Lo que comparten varios
          módulos vive en <strong>Global</strong>.
        </p>
      </div>

      <PanelConNavegacion
        navegacion={
          <ArbolCatalogos
            registro={registro} conteos={conteos} catalogosDe={catalogosDe}
            moduloId={moduloId} pestana={pestana} onAbrir={abrir}
            busqueda={busqueda} onBuscar={setBusqueda} />
        }>
        {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}
        {mensaje && <div className="card border-emerald-200 bg-emerald-50 text-sm text-emerald-700">{mensaje}</div>}

        {config ? (
          <>
            <CabeceraCatalogo config={config} modulo={modulo} modulos={registro.modulos}
              onVolver={() => setPestana(null)} />

            {config.editor === 'procesos' && <TablaProcesos {...props} />}
            {config.editor === 'grupos' && <TablaGrupos {...props} />}
            {config.editor === 'plantillas' && <TablaPlantillas {...props} />}
            {config.editor === 'parametros' && (
              <TablaParametros {...props} moduloId={moduloId}
                moduloDeParametro={registro.moduloDeParametro} modulos={registro.modulos} />
            )}
            {!puedeEscribir(config) && (
              <Linea tono="alerta" icono={Info}>
                {config.soloDesdeModulo
                  ? <>Este catálogo se administra desde {config.soloDesdeModulo}. Aquí se muestra en solo lectura.</>
                  : <>Este catálogo lo administra únicamente quien tenga el recurso <code>{config.exige}</code>. Aquí se muestra en solo lectura.</>}
              </Linea>
            )}
            {config.editor === 'simple' && <TablaSimple config={config} {...props} soloLectura={!puedeEscribir(config)} />}
          </>
        ) : (
          <ResumenModulo modulo={modulo} catalogos={catalogosDe(moduloId)} conteos={conteos}
            onAbrir={(id) => setPestana(id)} />
        )}
      </PanelConNavegacion>
    </div>
  );
}

// ---------- Árbol lateral: módulo → catálogos ----------
//
// Los globales que un módulo hereda van en su propio grupo plegado, no mezclados
// con los propios: dentro de "Gestión Documental" lo que se viene a configurar
// son los tipos de documento, no los procesos, que ya se administraron en Global.
// Plegados por defecto cuando el módulo tiene catálogos propios, y abiertos
// cuando no los tiene —si no, el módulo se vería vacío.
function ArbolCatalogos({ registro, conteos, catalogosDe, moduloId, pestana, onAbrir, busqueda, onBuscar }) {
  const [abiertos, setAbiertos] = useState({});
  const [verPendientes, setVerPendientes] = useState(false);

  const activos = registro.modulos.filter((m) => m.estado !== 'proximamente');
  const pendientes = registro.modulos.filter((m) => m.estado === 'proximamente');

  const alternar = (clave) => setAbiertos((a) => ({ ...a, [clave]: !a[clave] }));
  // Los globales heredados se despliegan solos únicamente en el módulo donde se
  // está trabajando. Abrirlos en todos alargaba el árbol con las mismas siete
  // entradas repetidas por módulo, que es justo el ruido que se vino a quitar.
  const estaAbierto = (m) => abiertos[m.id] ?? moduloId === m.id;

  // Buscar devuelve una lista PLANA: quien escribe "hallazgo" quiere el catálogo,
  // no averiguar bajo qué módulo estaba archivado.
  const termino = busqueda.trim().toLowerCase();
  if (termino) {
    const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const coincide = (c) => sinTilde(`${c.etiqueta} ${c.descripcion || ''}`.toLowerCase()).includes(sinTilde(termino));
    const hallados = registro.catalogos.filter(coincide);
    return (
      <>
        <Buscador valor={busqueda} onChange={onBuscar} placeholder="Buscar ajuste…" />
        {hallados.length === 0
          ? <p className="px-2 py-4 text-xs text-slate-400">Ningún catálogo coincide con «{busqueda}».</p>
          : hallados.map((c) => (
            <ItemNav key={c.id} texto={c.etiqueta} conteo={conteos[c.id]}
              global={c.modulo === 'global'} activo={pestana === c.id}
              onClick={() => { onAbrir(c.modulo, c.id); onBuscar(''); }} />
          ))}
      </>
    );
  }

  return (
    <>
      <Buscador valor={busqueda} onChange={onBuscar} placeholder="Buscar ajuste…" />

      {activos.map((m) => {
        const { propios, globales } = catalogosDe(m.id);
        return (
          <GrupoModulo key={m.id} modulo={m} activo={moduloId === m.id && !pestana}
            onClick={() => onAbrir(m.id)}>
            {propios.map((c) => (
              <ItemNav key={c.id} texto={c.etiqueta} conteo={conteos[c.id]}
                global={c.modulo === 'global' && m.id !== 'global'}
                activo={moduloId === m.id && pestana === c.id}
                onClick={() => onAbrir(m.id, c.id)} />
            ))}
            {globales.length > 0 && (
              <Plegable texto={`${globales.length} globales que usa`}
                abierto={estaAbierto(m)} onAlternar={() => alternar(m.id)}>
                {globales.map((c) => (
                  <ItemNav key={c.id} texto={c.etiqueta} conteo={conteos[c.id]} global
                    activo={moduloId === m.id && pestana === c.id}
                    onClick={() => onAbrir(m.id, c.id)} />
                ))}
              </Plegable>
            )}
          </GrupoModulo>
        );
      })}

      {/* Los módulos por desarrollar están, pero plegados: hay que poder ver que
          existen sin que ocupen la mitad de la navegación. */}
      <div className="mt-2 border-t border-slate-200 pt-2">
        <Plegable texto={`Por desarrollar (${pendientes.length})`} sangria
          abierto={verPendientes || pendientes.some((m) => m.id === moduloId)}
          onAlternar={() => setVerPendientes((v) => !v)}>
          {pendientes.map((m) => (
            <ItemNav key={m.id} texto={m.nombre} activo={moduloId === m.id && !pestana}
              onClick={() => onAbrir(m.id)} />
          ))}
        </Plegable>
      </div>
    </>
  );
}

// ---------- Resumen de un módulo (la pantalla de aterrizaje) ----------
//
// Hace de índice: todo lo que se configura en el módulo, con cuántos registros
// tiene cada cosa. Un catálogo en cero se ve en cero desde aquí, que es la señal
// que faltaba cuando un desplegable salía vacío sin explicación.
function ResumenModulo({ modulo, catalogos, conteos, onAbrir }) {
  if (!modulo) return null;
  const { propios, globales } = catalogos;
  const vacios = [...propios, ...globales].filter((c) => conteos[c.id] === 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          {(() => { const I = iconoDeModulo(modulo.id); return I ? <I className="h-5 w-5 text-primary" /> : null; })()}
          {modulo.nombre}
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">{modulo.descripcion}</p>
      </div>

      {vacios.length > 0 && (
        <Linea tono="alerta" icono={AlertTriangle}>
          {vacios.length === 1
            ? <>«{vacios[0].etiqueta}» no tiene registros activos: los campos que lo usan aparecerán sin opciones.</>
            : <>{vacios.length} catálogos sin registros activos ({listar(vacios.map((c) => c.etiqueta))}):
                los campos que los usan aparecerán sin opciones.</>}
        </Linea>
      )}

      {modulo.estado === 'proximamente' && (
        <div className="card space-y-2 border-amber-200 bg-amber-50/60 text-amber-900">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Construction className="h-4 w-4" /> Módulo por desarrollar
          </div>
          <p className="text-xs leading-relaxed">Cuando entre en producción se configurará aquí:</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {(modulo.pendiente || []).map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {propios.length > 0 && (
        <ListaCatalogos titulo={modulo.id === 'global' ? 'Catálogos globales' : 'Catálogos propios'}
          items={propios} conteos={conteos} onAbrir={onAbrir}
          // Dentro de Global todos lo son: repetir el globo en las siete tarjetas
          // no distingue nada.
          marcarGlobales={modulo.id !== 'global'} />
      )}

      {globales.length > 0 && (
        <ListaCatalogos
          titulo="Globales que usa este módulo"
          nota="Se administran una sola vez desde Global. Cambiarlos afecta también a los demás módulos que los usan."
          items={globales} conteos={conteos} onAbrir={onAbrir} marcarGlobales />
      )}

      {propios.length === 0 && globales.length === 0 && (
        <div className="card text-sm text-slate-500">
          Este módulo todavía no tiene catálogos propios ni hereda ninguno global.
        </div>
      )}
    </div>
  );
}

function ListaCatalogos({ titulo, nota, items, conteos, onAbrir, marcarGlobales }) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{titulo}</h3>
        {nota && <p className="mt-0.5 text-xs text-slate-500">{nota}</p>}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((c) => (
          <button key={c.id} onClick={() => onAbrir(c.id)}
            className="card flex items-start gap-3 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/20">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                {marcarGlobales && c.modulo === 'global' && <Globe className="h-3.5 w-3.5 shrink-0 text-violet-500" />}
                {c.etiqueta}
              </div>
              <p className="mt-0.5 text-xs leading-snug text-slate-500">{c.descripcion}</p>
            </div>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
              conteos[c.id] === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {conteos[c.id] ?? '—'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Cabecera del catálogo abierto ----------
//
// Sustituye a la pila de tarjetas que había antes. Mismo contenido, pero el
// alcance compartido y las alertas caben en una línea cada uno, y la información
// de contexto se pliega: quien ya la leyó no tiene que volver a saltársela para
// llegar al formulario.
function CabeceraCatalogo({ config, modulo, modulos, onVolver }) {
  const [verInfo, setVerInfo] = useState(false);
  const nombre = (id) => (modulos.find((m) => m.id === id) || {}).nombre || id;
  const otros = (config.usadoPor || []).filter((m) => m !== modulo?.id);
  const esCompartido = config.modulo === 'global' && otros.length > 0;

  const avisos = config.avisos || [];
  const alertas = avisos.filter((a) => a.tono === 'alerta');
  const informativos = avisos.filter((a) => a.tono !== 'alerta');

  return (
    <div className="space-y-2">
      <button onClick={onVolver}
        className="-ml-1 flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-primary">
        <ChevronLeft className="h-3.5 w-3.5" /> {modulo?.nombre}
      </button>

      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          {esCompartido && <Globe className="h-4 w-4 text-violet-500" />}
          {config.etiqueta}
        </h2>
        {config.descripcion && <p className="mt-0.5 text-sm text-slate-500">{config.descripcion}</p>}
      </div>

      {/* El alcance compartido nunca se pliega: es la advertencia que evita que
          alguien retire una sede del documental y la borre de los hallazgos. */}
      {esCompartido && (
        <Linea tono="global" icono={Globe}>
          {modulo?.id === 'global'
            // En Global ya se sabe que es global: enumerar los nueve módulos
            // ocupaba tres renglones, así que se dice cuántos son.
            ? (otros.length === modulos.length - 1
              ? `Catálogo global: lo usan los ${otros.length} módulos de la plataforma.`
              : `Catálogo global: lo usan ${listar(otros.map(nombre))}.`)
            : <>Cambiarlo afectará también a <strong>{listar(otros.map(nombre))}</strong>. Se administra una sola vez desde Global.</>}
        </Linea>
      )}

      {alertas.map((a) => (
        <Linea key={a.texto} tono="alerta" icono={AlertTriangle}>{a.texto}</Linea>
      ))}

      {informativos.length > 0 && (
        verInfo ? (
          <div className="space-y-2">
            {informativos.map((a) => <Linea key={a.texto} tono="info" icono={Info}>{a.texto}</Linea>)}
            <button className="text-xs font-semibold text-slate-400 hover:text-primary"
              onClick={() => setVerInfo(false)}>
              Ocultar
            </button>
          </div>
        ) : (
          <button className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent"
            onClick={() => setVerInfo(true)}>
            <Info className="h-3.5 w-3.5" /> Qué debo saber de este catálogo
          </button>
        )
      )}
    </div>
  );
}

// ---------- Piezas compartidas por todas las tablas ----------
//
// Toda fila de un catálogo se comporta igual: se edita, se inactiva y —si está
// inactiva— se reactiva. Tenerlo en un solo componente evita que cada pestaña
// invente su propia versión de los mismos tres botones, que es cómo terminan
// algunas tablas sin edición y otras con ella.

// `onInactivar` es opcional: los parámetros del sistema no se inactivan desde la
// interfaz —hacerlo los devuelve a su valor por defecto sin que se vea— así que
// esa fila solo ofrece edición.
function AccionesFila({ fila, editando, onEditar, onGuardar, onCancelar, onInactivar, onReactivar, ocupado, extra }) {
  if (fila.activo === false) {
    return (
      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
        <span className="badge bg-slate-100 text-slate-500">Inactivo</span>
        {onReactivar && (
          <button className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent"
            disabled={ocupado} onClick={() => onReactivar(fila)} title="Volver a habilitarlo">
            <RotateCcw className="h-3.5 w-3.5" /> Reactivar
          </button>
        )}
      </div>
    );
  }

  if (editando) {
    return (
      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
        <button className="btn-primary !px-2 !py-1 text-xs" disabled={ocupado} onClick={onGuardar}>
          <Check className="h-3.5 w-3.5" /> {ocupado ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={ocupado} onClick={onCancelar}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
      {extra}
      <button className="text-slate-400 hover:text-primary" onClick={onEditar} title="Editar" aria-label="Editar">
        <Pencil className="h-4 w-4" />
      </button>
      {onInactivar && (
        <button className="text-rose-500 hover:text-rose-700" onClick={() => onInactivar(fila.id)}
          title="Inactivar" aria-label="Inactivar">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Estado de edición de una fila. Devuelve el borrador, y `guardar` solo cierra la
// edición si la escritura salió bien: si el backend rechaza el cambio, lo que se
// escribió sigue en pantalla en lugar de perderse.
function useEdicionFila(fila, guardarEnBackend) {
  const [borrador, setBorrador] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setOcupado(true);
    try {
      await guardarEnBackend(borrador);
      setBorrador(null);
    } catch {
      // El error ya se muestra arriba; la edición se mantiene abierta.
    } finally {
      setOcupado(false);
    }
  }

  return {
    borrador,
    editando: borrador !== null,
    ocupado,
    editar: (inicial) => setBorrador(inicial ?? { ...fila }),
    cambiar: (cambios) => setBorrador((b) => ({ ...b, ...cambios })),
    cancelar: () => setBorrador(null),
    guardar
  };
}

// Una fila inactiva se atenúa: sigue estando, pero no está disponible para nadie
// más que para quien administra el catálogo.
const claseFila = (fila) => (fila.activo === false ? 'opacity-50' : '');

// ---------- Procesos y subprocesos (alimentan el mapa de procesos) ----------

function TablaProcesos({ filas, onCrear, onActualizar, onInactivar, onReactivar, onError }) {
  const [form, setForm] = useState({ codigo: '', nombre: '', tipo: 'apoyo', orden: 1, subprocesos: [] });
  const [sub, setSub] = useState({ codigo: '', nombre: '' });

  return (
    <div className="space-y-3">
      <form className="card grid gap-3 md:grid-cols-5" onSubmit={(e) => {
        e.preventDefault();
        onCrear({ ...form, id: form.codigo.trim().toLowerCase(), codigo: form.codigo.trim().toUpperCase(), nombre: form.nombre.trim(), orden: Number(form.orden) })
          .then((row) => { if (row) setForm({ codigo: '', nombre: '', tipo: 'apoyo', orden: 1, subprocesos: [] }); });
      }}>
        <div>
          <label className="label">Código *</label>
          <input required className="input uppercase" maxLength={6} value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Nombre *</label>
          <input required className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <label className="label">Cadena de valor</label>
          <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            <option value="estrategico">Estratégico</option>
            <option value="misional">Misional</option>
            <option value="apoyo">Soporte</option>
          </select>
        </div>
        <div>
          <label className="label">Orden</label>
          <input type="number" min="1" className="input" value={form.orden}
            onChange={(e) => setForm({ ...form, orden: e.target.value })} />
        </div>

        <div className="md:col-span-5">
          <label className="label">Subprocesos (agregue antes de guardar)</label>
          <div className="flex flex-wrap gap-2">
            <input className="input !w-28 uppercase" placeholder="COD" maxLength={6} value={sub.codigo}
              onChange={(e) => setSub({ ...sub, codigo: e.target.value })} />
            <input className="input flex-1" placeholder="Nombre del subproceso" value={sub.nombre}
              onChange={(e) => setSub({ ...sub, nombre: e.target.value })} />
            <button type="button" className="btn-secondary" disabled={!sub.codigo || !sub.nombre} onClick={() => {
              setForm({
                ...form,
                subprocesos: [...form.subprocesos, { id: sub.codigo.trim().toLowerCase(), codigo: sub.codigo.trim().toUpperCase(), nombre: sub.nombre.trim() }]
              });
              setSub({ codigo: '', nombre: '' });
            }}>Añadir</button>
          </div>
          {form.subprocesos.length > 0 && (
            <div className="mt-2 text-xs text-slate-500">{form.subprocesos.map((s) => s.codigo).join(', ')}</div>
          )}
        </div>

        <div className="md:col-span-5">
          <button className="btn-accent"><Plus className="h-4 w-4" /> Agregar proceso</button>
        </div>
      </form>

      <div className="card-plano overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Código</th><th>Nombre</th><th>Cadena de valor</th><th>Orden</th><th>Subprocesos</th><th />
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <FilaProceso key={p.id} proceso={p} onActualizar={onActualizar}
                onInactivar={onInactivar} onReactivar={onReactivar} onError={onError} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// La sigla del proceso es editable porque queda embebida en el código de cada
// documento suyo. Cambiarla aquí NO reescribe los códigos ya emitidos: eso se
// hace explícitamente con "Actualizar códigos", que primero muestra qué
// cambiaría y conserva cada código anterior en el histórico del documento.
function FilaProceso({ proceso, onActualizar, onInactivar, onReactivar, onError }) {
  const [previo, setPrevio] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [sub, setSub] = useState({ codigo: '', nombre: '' });

  const edicion = useEdicionFila(proceso, (b) => onActualizar(proceso.id, {
    codigo: String(b.codigo || '').trim().toUpperCase(),
    nombre: b.nombre,
    tipo: b.tipo,
    orden: Number(b.orden) || 99,
    subprocesos: b.subprocesos || []
  }));
  const b = edicion.borrador;

  function agregarSub() {
    edicion.cambiar({
      subprocesos: [
        ...(b.subprocesos || []),
        { id: sub.codigo.trim().toLowerCase(), codigo: sub.codigo.trim().toUpperCase(), nombre: sub.nombre.trim() }
      ]
    });
    setSub({ codigo: '', nombre: '' });
  }

  async function simular() {
    setOcupado(true);
    try {
      setPrevio(await api('/documental/recodificar-proceso?simulacro=1', {
        method: 'POST', body: { procesoId: proceso.id }
      }));
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    setOcupado(true);
    try {
      await api('/documental/recodificar-proceso', {
        method: 'POST',
        body: { procesoId: proceso.id, motivo: `Se corrigió la sigla del proceso a ${proceso.codigo}` }
      });
      setPrevio(null);
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <tr className={claseFila(proceso)}>
        <td>
          {edicion.editando ? (
            <input className="input !w-24 font-mono text-xs font-bold uppercase" maxLength={6}
              value={b.codigo || ''} onChange={(e) => edicion.cambiar({ codigo: e.target.value })} />
          ) : <span className="font-mono text-xs font-bold">{proceso.codigo}</span>}
        </td>
        <td>
          {edicion.editando ? (
            <input className="input" value={b.nombre || ''}
              onChange={(e) => edicion.cambiar({ nombre: e.target.value })} />
          ) : proceso.nombre}
        </td>
        <td className="text-xs">
          {edicion.editando ? (
            <select className="input" value={b.tipo || 'apoyo'} onChange={(e) => edicion.cambiar({ tipo: e.target.value })}>
              <option value="estrategico">Estratégico</option>
              <option value="misional">Misional</option>
              <option value="apoyo">Soporte</option>
            </select>
          ) : proceso.tipo}
        </td>
        <td className="text-xs">
          {edicion.editando ? (
            <input type="number" min="1" className="input !w-20" value={b.orden ?? 99}
              onChange={(e) => edicion.cambiar({ orden: e.target.value })} />
          ) : (proceso.orden ?? '—')}
        </td>
        <td className="text-xs">
          {((edicion.editando ? b.subprocesos : proceso.subprocesos) || []).map((s) => s.codigo).join(', ') || '—'}
        </td>
        <td>
          <AccionesFila
            fila={proceso}
            editando={edicion.editando}
            ocupado={edicion.ocupado || ocupado}
            onEditar={() => edicion.editar({ ...proceso, subprocesos: [...(proceso.subprocesos || [])] })}
            onGuardar={edicion.guardar}
            onCancelar={edicion.cancelar}
            onInactivar={onInactivar}
            onReactivar={onReactivar}
            extra={
              <button className="text-xs font-semibold text-primary hover:text-accent"
                disabled={ocupado} onClick={simular}>
                Actualizar códigos
              </button>
            } />
        </td>
      </tr>

      {/* Subprocesos: se editan aparte porque son una lista, no un campo. Su
          sigla también viaja dentro del código de los documentos, así que
          quitar uno que ya se usó exige después "Actualizar códigos". */}
      {edicion.editando && (
        <tr>
          <td colSpan={6} className="bg-slate-50">
            <div className="space-y-2 py-2">
              <label className="label">Subprocesos</label>
              {(b.subprocesos || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(b.subprocesos || []).map((s) => (
                    <span key={s.id} className="chip chip-activo">
                      {s.codigo} · {s.nombre}
                      <button type="button" aria-label={`Quitar ${s.codigo}`}
                        onClick={() => edicion.cambiar({ subprocesos: b.subprocesos.filter((x) => x.id !== s.id) })}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input className="input !w-28 uppercase" placeholder="COD" maxLength={6} value={sub.codigo}
                  onChange={(e) => setSub({ ...sub, codigo: e.target.value })} />
                <input className="input max-w-sm flex-1" placeholder="Nombre del subproceso" value={sub.nombre}
                  onChange={(e) => setSub({ ...sub, nombre: e.target.value })} />
                <button type="button" className="btn-secondary"
                  disabled={!sub.codigo.trim() || !sub.nombre.trim()} onClick={agregarSub}>
                  Añadir
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {previo && (
        <tr>
          <td colSpan={6} className="bg-amber-50">
            {previo.cambios.length === 0 ? (
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                <span>
                  Los {previo.sinCambio.length} documento(s) de este proceso ya usan la sigla vigente.
                  No hay nada que actualizar.
                </span>
                <button className="btn-secondary !py-1 text-xs" onClick={() => setPrevio(null)}>Cerrar</button>
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="font-semibold text-amber-800">
                  Se recodificarán {previo.cambios.length} documento(s). El código anterior queda en el
                  histórico y seguirá encontrando el documento.
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {previo.cambios.map((c) => (
                    <li key={c.id}>
                      <span className="text-slate-400 line-through">{c.anterior}</span>
                      {' → '}
                      <span className="font-bold text-primary">{c.nuevo}</span>
                      <span className="ml-2 font-sans text-slate-500">{c.nombre}</span>
                    </li>
                  ))}
                </ul>
                {previo.errores.length > 0 && (
                  <p className="text-rose-600">
                    {previo.errores.length} documento(s) no se pueden recodificar: {previo.errores[0].error}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button className="btn-accent !py-1 text-xs" disabled={ocupado} onClick={aplicar}>
                    {ocupado ? 'Aplicando…' : `Confirmar ${previo.cambios.length} cambio(s)`}
                  </button>
                  <button className="btn-secondary !py-1 text-xs" onClick={() => setPrevio(null)}>Cancelar</button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Grupos de asignación ----------
//
// Un grupo le pone nombre de negocio ("Equipo TICS Regional") a un conjunto de
// personas, y ese nombre lo consumen todos los módulos: los flujos de revisión y
// aprobación, los permisos de visualización y descarga de un documento, y mañana
// los responsables de un plan de acción de Mejoramiento Continuo.
//
// Hay dos maneras de definir quién está dentro, y la diferencia importa:
//   · por área, cargo o sede → la regla se resuelve contra el directorio de
//     Talento Humano cada vez que se usa, así que un ingreso o un cambio de cargo
//     se refleja solo y nadie tiene que mantener nada.
//   · por usuarios seleccionados → lista explícita, para los equipos que no
//     coinciden con ninguna casilla del organigrama (un comité, un proyecto).
//     Esa sí hay que mantenerla a mano, y por eso se puede editar aquí.
const REGLAS = [
  ['area', 'Área'],
  ['cargo', 'Cargo'],
  ['sede', 'Sede'],
  ['manual', 'Usuarios seleccionados']
];

function TablaGrupos({ filas, onCrear, onInactivar, onReactivar, onActualizar, onError }) {
  const [form, setForm] = useState({ id: '', nombre: '', tipo: 'area', valor: '', correos: [] });
  const [cat, setCat] = useState({ areas: [], cargos: [], sedes: [] });

  // Las áreas y los cargos son los REALES del catálogo de Usuarios,
  // no una lista digitada aparte: así un grupo nunca apunta a un cargo que no
  // existe en la organización.
  useEffect(() => {
    Promise.all([api('/empleados/dimensiones'), catalogo('sedes')])
      .then(([dim, sedes]) => setCat({
        areas: dim.areas.map((a) => ({ id: a.valor, nombre: `${a.valor} (${a.total})` })),
        cargos: dim.cargos.map((c) => ({ id: c.valor, nombre: `${c.valor} (${c.total})` })),
        sedes
      }))
      .catch(() => {});
  }, []);

  const OPCIONES = { area: cat.areas, cargo: cat.cargos, sede: cat.sedes };
  const esManual = form.tipo === 'manual';

  function enviar(e) {
    e.preventDefault();
    onCrear({
      id: form.id.trim().toLowerCase(),
      nombre: form.nombre,
      regla: esManual ? { tipo: 'manual', correos: form.correos } : { tipo: form.tipo, valor: form.valor }
    }).then((row) => { if (row) setForm({ id: '', nombre: '', tipo: 'area', valor: '', correos: [] }); });
  }

  return (
    <div className="space-y-3">
      <form className="card grid gap-3 md:grid-cols-5" onSubmit={enviar}>
        <div>
          <label className="label">Id *</label>
          <input required className="input" placeholder="comite-hseq" value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Nombre *</label>
          <input required className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <label className="label">Integrantes por</label>
          <select className="input" value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value, valor: '', correos: [] })}>
            {REGLAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        {!esManual && (
          <div>
            <label className="label">Valor *</label>
            <select required className="input" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })}>
              <option value="">Seleccione…</option>
              {(OPCIONES[form.tipo] || []).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        )}
        {esManual && (
          <div className="md:col-span-5">
            <label className="label">Integrantes *</label>
            <SelectorEmpleados seleccion={form.correos}
              onChange={(correos) => setForm({ ...form, correos })} />
          </div>
        )}
        <div className="md:col-span-5">
          <button className="btn-accent" disabled={esManual && form.correos.length === 0}>
            <Plus className="h-4 w-4" /> Agregar grupo
          </button>
        </div>
      </form>

      <div className="card-plano overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Id</th><th>Nombre</th><th>Integrantes por</th><th /></tr></thead>
          <tbody>
            {filas.map((g) => (
              <FilaGrupo key={g.id} grupo={g} cat={cat} onActualizar={onActualizar}
                onInactivar={onInactivar} onReactivar={onReactivar} onError={onError} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Un grupo guarda una REGLA, no una lista de personas: hay que poder ver a quién
// alcanza hoy antes de usarlo en un permiso o en un flujo. Los integrantes los
// resuelve el backend contra el directorio en el momento de la consulta.
function FilaGrupo({ grupo, cat, onActualizar, onInactivar, onReactivar, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const regla = grupo.regla || {};
  const esManual = regla.tipo === 'manual';
  const etiquetaRegla = (REGLAS.find(([v]) => v === regla.tipo) || [null, regla.tipo || '—'])[1];
  const nombreValor = () => {
    const lista = { area: cat.areas, cargo: cat.cargos, sede: cat.sedes }[regla.tipo] || [];
    return (lista.find((x) => x.id === regla.valor) || {}).nombre || regla.valor;
  };

  // El nombre y la regla se editan con el mismo botón que el resto de los
  // catálogos; los integrantes de un grupo manual siguen teniendo su propio panel,
  // porque quitar a alguien de un equipo es una tarea distinta de renombrarlo.
  const edicion = useEdicionFila(grupo, (b) => onActualizar(grupo.id, {
    nombre: b.nombre,
    regla: b.regla.tipo === 'manual'
      ? { tipo: 'manual', correos: b.regla.correos || [] }
      : { tipo: b.regla.tipo, valor: b.regla.valor }
  }));
  const b = edicion.borrador;
  const OPCIONES = { area: cat.areas, cargo: cat.cargos, sede: cat.sedes };

  // Al convertir un grupo por área/cargo/sede en "usuarios seleccionados", la
  // lista arranca con los integrantes que la regla resuelve HOY: convertir no
  // debe significar rearmar el equipo de memoria, sino congelar la nómina
  // actual y ajustarla. Si el directorio no responde, se arranca en vacío.
  async function cambiarTipo(tipo) {
    edicion.cambiar({ regla: { tipo, valor: '', correos: tipo === 'manual' ? (regla.correos || []) : [] } });
    if (tipo === 'manual' && regla.tipo !== 'manual') {
      try {
        const d = detalle || await api(`/config/grupos/${grupo.id}/integrantes`);
        edicion.cambiar({ regla: { tipo: 'manual', valor: '', correos: d.integrantes.map((p) => p.correo) } });
      } catch { /* sin prellenado: la persona elige desde cero */ }
    }
  }

  async function cargarIntegrantes() {
    setOcupado(true);
    try {
      setDetalle(await api(`/config/grupos/${grupo.id}/integrantes`));
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  function alternar() {
    const siguiente = !abierto;
    setAbierto(siguiente);
    if (siguiente) cargarIntegrantes();
  }

  // Al cambiar la lista se guarda de inmediato: el flujo real es "quitar a
  // alguien que ya no está en el equipo", y un botón Guardar aparte solo agrega
  // un paso donde se olvida el cambio.
  async function guardarCorreos(correos) {
    setOcupado(true);
    try {
      await onActualizar(grupo.id, { nombre: grupo.nombre, regla: { tipo: 'manual', correos } });
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <tr className={claseFila(grupo)}>
        <td className="font-mono text-xs">{grupo.id}</td>
        <td>
          {edicion.editando ? (
            <input className="input" value={b.nombre || ''}
              onChange={(e) => edicion.cambiar({ nombre: e.target.value })} />
          ) : grupo.nombre}
        </td>
        <td className="text-xs text-slate-500">
          {edicion.editando ? (
            <div className="flex flex-wrap gap-2">
              <select className="input !w-44" value={b.regla.tipo}
                onChange={(e) => cambiarTipo(e.target.value)}>
                {REGLAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
              {b.regla.tipo !== 'manual' && (
                <select className="input !w-56" value={b.regla.valor || ''}
                  onChange={(e) => edicion.cambiar({ regla: { ...b.regla, valor: e.target.value } })}>
                  <option value="">Seleccione…</option>
                  {(OPCIONES[b.regla.tipo] || []).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              )}
              {b.regla.tipo === 'manual' && (
                <span className="self-center text-slate-400">
                  {(b.regla.correos || []).length} persona(s) — elíjalas en el panel de abajo.
                </span>
              )}
            </div>
          ) : (
            <>
              {etiquetaRegla}
              {!esManual && regla.valor && <span className="ml-1 text-slate-400">· {nombreValor()}</span>}
              {esManual && <span className="ml-1 text-slate-400">· {(regla.correos || []).length} persona(s)</span>}
            </>
          )}
        </td>
        <td>
          <AccionesFila
            fila={grupo}
            editando={edicion.editando}
            ocupado={edicion.ocupado || ocupado}
            onEditar={() => edicion.editar({ ...grupo, regla: { tipo: 'area', valor: '', correos: [], ...regla } })}
            onGuardar={edicion.guardar}
            onCancelar={edicion.cancelar}
            onInactivar={onInactivar}
            onReactivar={onReactivar}
            extra={
              <button className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent"
                onClick={alternar}>
                <Users className="h-3.5 w-3.5" />
                {esManual ? 'Editar integrantes' : 'Ver integrantes'}
                {abierto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            } />
        </td>
      </tr>

      {/* El buscador de integrantes NUNCA va dentro de la celda: con varias
          personas seleccionadas reventaba el ancho de la tabla. Vive en una
          fila expandida de ancho completo, el mismo patrón de "Ver integrantes". */}
      {edicion.editando && b.regla.tipo === 'manual' && (
        <tr>
          <td colSpan={4} className="bg-slate-50">
            <div className="max-w-xl py-3">
              <p className="mb-2 text-xs text-slate-500">
                {regla.tipo !== 'manual'
                  ? 'La lista arranca con los integrantes actuales de la regla: ajústela y use «Guardar» en la fila. Desde entonces se mantiene a mano.'
                  : 'Agregue o quite colaboradores y use «Guardar» en la fila.'}
              </p>
              <SelectorEmpleados seleccion={b.regla.correos || []}
                onChange={(correos) => edicion.cambiar({ regla: { ...b.regla, correos } })} />
            </div>
          </td>
        </tr>
      )}

      {abierto && !edicion.editando && (
        <tr>
          <td colSpan={4} className="bg-slate-50">
            {esManual ? (
              <div className="max-w-xl py-2">
                <p className="mb-2 text-xs text-slate-500">
                  Agregue o quite colaboradores. El cambio aplica de inmediato a los documentos y
                  flujos que usan este grupo.
                </p>
                <SelectorEmpleados seleccion={regla.correos || []} onChange={guardarCorreos} />
                {ocupado && <p className="mt-1 text-xs text-slate-400">Guardando…</p>}
              </div>
            ) : (
              <div className="py-2 text-xs">
                {ocupado && <span className="text-slate-400">Consultando el directorio…</span>}
                {detalle && (
                  <>
                    <p className="mb-1 font-semibold text-slate-600">
                      {detalle.total} integrante(s) según el directorio
                    </p>
                    {detalle.advertencia && <p className="mb-1 text-amber-700">{detalle.advertencia}</p>}
                    <ol className="max-h-48 list-decimal space-y-0.5 overflow-y-auto pl-5 text-slate-600">
                      {detalle.integrantes.map((p) => (
                        <li key={p.correo}>
                          {p.nombre}
                          <span className="ml-1 text-slate-400">{p.cargo || 's/cargo'}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Plantillas institucionales ----------

function TablaPlantillas({ filas, onCrear, onActualizar, onInactivar, onReactivar, onError, recargar }) {
  const [form, setForm] = useState({ nombre: '', tipoId: '' });
  const [tipos, setTipos] = useState([]);

  useEffect(() => { catalogo('tipos_documento').then(setTipos).catch(() => {}); }, []);

  async function subir(id, archivo) {
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      await api(`/config/plantillas/${id}/archivo`, { method: 'POST', body: fd });
      recargar('plantillas');
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div className="space-y-3">
      <form className="card grid gap-3 md:grid-cols-4" onSubmit={(e) => {
        e.preventDefault();
        onCrear(form).then((row) => { if (row) setForm({ nombre: '', tipoId: '' }); });
      }}>
        <div className="md:col-span-2">
          <label className="label">Nombre *</label>
          <input required className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <label className="label">Tipo de documento *</label>
          <select required className="input" value={form.tipoId} onChange={(e) => setForm({ ...form, tipoId: e.target.value })}>
            <option value="">Seleccione…</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-accent"><Plus className="h-4 w-4" /> Agregar</button>
        </div>
      </form>

      <div className="card-plano overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Archivo</th><th /></tr></thead>
          <tbody>
            {filas.map((p) => (
              <FilaPlantilla key={p.id} plantilla={p} tipos={tipos} onSubir={subir}
                onActualizar={onActualizar} onInactivar={onInactivar} onReactivar={onReactivar} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Nombre y tipo de la plantilla son editables: el archivo se reemplaza subiendo
// otro, que es la operación habitual (versión nueva del formato institucional).
function FilaPlantilla({ plantilla, tipos, onSubir, onActualizar, onInactivar, onReactivar }) {
  const edicion = useEdicionFila(plantilla, (b) => onActualizar(plantilla.id, {
    nombre: b.nombre, tipoId: b.tipoId
  }));
  const b = edicion.borrador;

  return (
    <tr className={claseFila(plantilla)}>
      <td>
        {edicion.editando
          ? <input className="input" value={b.nombre || ''} onChange={(e) => edicion.cambiar({ nombre: e.target.value })} />
          : plantilla.nombre}
      </td>
      <td className="text-xs text-slate-500">
        {edicion.editando ? (
          <select className="input" value={b.tipoId || ''} onChange={(e) => edicion.cambiar({ tipoId: e.target.value })}>
            <option value="">Seleccione…</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        ) : ((tipos.find((t) => t.id === plantilla.tipoId) || {}).nombre || plantilla.tipoId)}
      </td>
      <td>
        <div className="flex items-center gap-2">
          {plantilla.archivo ? (
            <a className="btn-secondary !px-2 !py-1" href={`/api/config/plantillas/${plantilla.id}/archivo`}>
              <FileDown className="h-4 w-4" /> {plantilla.archivo.nombre}
            </a>
          ) : <span className="text-xs text-amber-600">Sin archivo</span>}
          <label className="btn-secondary !px-2 !py-1 cursor-pointer" title="Cargar o reemplazar el archivo">
            <Upload className="h-4 w-4" />
            <input type="file" className="hidden"
              onChange={(e) => e.target.files[0] && onSubir(plantilla.id, e.target.files[0])} />
          </label>
        </div>
      </td>
      <td>
        <AccionesFila fila={plantilla} editando={edicion.editando} ocupado={edicion.ocupado}
          onEditar={() => edicion.editar()} onGuardar={edicion.guardar} onCancelar={edicion.cancelar}
          onInactivar={onInactivar} onReactivar={onReactivar} />
      </td>
    </tr>
  );
}

// ---------- Parámetros del sistema ----------

// La colección de parámetros es UNA, pero sus filas no son todas del mismo
// módulo: `sufijoGlobal` es del documental y `diasLimiteActualizacionIndicadores`
// es de indicadores. Dentro de un módulo se muestran solo los suyos —mostrarle
// todos es el desorden que la agrupación viene a resolver— y en Global se ven
// todos con la columna que dice de quién es cada uno.
function TablaParametros({ filas, onActualizar, onReactivar, moduloId, moduloDeParametro, modulos }) {
  const nombreModulo = (id) => (modulos.find((m) => m.id === id) || {}).nombre || 'Global';
  const enGlobal = moduloId === 'global';
  const visibles = enGlobal ? filas : filas.filter((p) => moduloDeParametro[p.id] === moduloId);

  return (
    <div className="space-y-3">
      <div className="card-plano overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Parámetro</th>
              {enGlobal && <th className="w-48">Módulo</th>}
              <th>Descripción</th><th className="w-72">Valor</th><th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <FilaParametro key={p.id} parametro={p} onActualizar={onActualizar} onReactivar={onReactivar}
                modulo={enGlobal ? nombreModulo(moduloDeParametro[p.id]) : null} />
            ))}
          </tbody>
        </table>
      </div>

      {visibles.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">
          Este módulo todavía no tiene parámetros propios.
        </p>
      )}
    </div>
  );
}

function FilaParametro({ parametro, onActualizar, onReactivar, modulo }) {
  const edicion = useEdicionFila(parametro, (b) => onActualizar(parametro.id, {
    valor: convertirValor(parametro.valor, b.valor),
    descripcion: b.descripcion
  }));
  const b = edicion.borrador;

  return (
    <tr className={claseFila(parametro)}>
      <td className="font-mono text-xs font-semibold">{parametro.id}</td>
      {modulo !== null && <td className="text-xs text-slate-500">{modulo}</td>}
      <td className="text-xs text-slate-500">
        {edicion.editando
          ? <input className="input" value={b.descripcion || ''}
              onChange={(e) => edicion.cambiar({ descripcion: e.target.value })} />
          : (parametro.descripcion || '—')}
      </td>
      <td>
        {edicion.editando ? (
          typeof parametro.valor === 'boolean' ? (
            <select className="input" value={String(b.valor)} onChange={(e) => edicion.cambiar({ valor: e.target.value })}>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input className="input" value={b.valor}
              onChange={(e) => edicion.cambiar({ valor: e.target.value })} />
          )
        ) : (
          // Los booleanos se leen como Sí/No; el borrador sigue trabajando con
          // 'true'/'false' porque es lo que devuelve el <select>.
          <span className="text-sm">
            {typeof parametro.valor === 'boolean'
              ? (parametro.valor ? 'Sí' : 'No')
              : textoValor(parametro.valor)}
          </span>
        )}
      </td>
      <td>
        <AccionesFila fila={parametro} editando={edicion.editando} ocupado={edicion.ocupado}
          onEditar={() => edicion.editar({ ...parametro, valor: textoValor(parametro.valor) })}
          onGuardar={edicion.guardar} onCancelar={edicion.cancelar} onReactivar={onReactivar} />
      </td>
    </tr>
  );
}

function textoValor(valor) {
  if (typeof valor === 'boolean') return String(valor);
  return Array.isArray(valor) ? valor.join(', ') : String(valor);
}

// Se conserva el TIPO del valor original: booleano, número, lista o texto. Un
// parámetro que era número y se guarda como texto rompe el cálculo que lo usa
// (los días de alerta, los meses de revisión), y el fallo aparece lejos de aquí.
function convertirValor(original, texto) {
  if (typeof original === 'boolean') return texto === 'true' || texto === true;
  if (typeof original === 'number') return Number(texto);
  if (Array.isArray(original)) return String(texto).split(',').map((s) => s.trim()).filter(Boolean);
  return texto;
}

// ---------- Catálogos simples ----------
//
// Un catálogo simple es el que se describe con una lista de campos, y se dibuja
// entero a partir del registro del backend: código + nombre, nombre +
// descripción, término + definición + fuente… Agregar uno (los tipos de hallazgo
// y las fuentes de identificación llegaron así) no necesita código de interfaz.
//
// Los campos se declaran UNA vez y los usan el formulario de creación y el editor
// de cada fila. Es lo que garantiza que no divergan: un campo nuevo aparece en los
// dos sitios o en ninguno, y no vuelve a pasar que algo se pueda crear pero no
// corregir (el caso de `permiteOriginal`, que se guardaba siempre en false y no
// había forma de activarlo desde la interfaz).

// El registro describe el tamaño en términos de negocio ("es un código", "es un
// nombre largo") y aquí se traduce a Tailwind: la declaración vive en el backend
// y no debería saber de clases de CSS.
const ANCHO = {
  corto: '!w-28',
  medio: 'min-w-40',
  largo: 'min-w-56 flex-1'
};

const anchoDe = (campo) => ANCHO[campo.tamano] || 'min-w-56 flex-1';

// id legible derivado del código o del nombre (sin tildes ni espacios).
function idLegible(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Un campo del catálogo, en modo formulario (con etiqueta) o compacto (en la fila).
function CampoCatalogo({ campo, valor, onChange, compacto }) {
  if (campo.tipo === 'booleano') {
    const control = (
      <label className="flex items-center gap-2 whitespace-nowrap text-sm">
        <input type="checkbox" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />
        {compacto ? (campo.etiquetaCorta || campo.etiqueta) : campo.etiqueta}
      </label>
    );
    return compacto ? control : <div className="self-end pb-2">{control}</div>;
  }

  const ancho = anchoDe(campo);
  const entrada = (
    <input
      className={`input ${ancho}${campo.mayusculas ? ' uppercase' : ''}`}
      required={campo.requerido && !compacto}
      maxLength={campo.maxLength}
      value={valor ?? ''}
      onChange={(e) => onChange(campo.mayusculas ? e.target.value.toUpperCase() : e.target.value)} />
  );

  if (compacto) return entrada;
  return (
    <div className={ancho.includes('flex-1') ? 'min-w-56 flex-1' : ''}>
      <label className="label">{campo.etiqueta}{campo.requerido ? ' *' : ''}</label>
      {entrada}
    </div>
  );
}

const SIN_FILTROS = [];

// FILTROS DECLARADOS EN EL REGISTRO (2026-11-17). Un catálogo puede traer
// `filtros` (clave, etiqueta, `catalogo` para mostrar nombres en vez de ids y
// `prefijo` para filtrar por los primeros caracteres, como el año de una fecha)
// y `orden`. Nació con los festivos: 18 por país y por año son cientos de filas
// de corrido, y lo que se quiere ver es «Colombia 2027». Las opciones salen de
// las filas que hay, no de una lista aparte: lo que no está cargado no aparece.
function valorDeFiltro(fila, f) {
  const v = String(fila[f.clave] ?? '');
  return f.prefijo ? v.slice(0, f.prefijo) : v;
}

function TablaSimple({ config, filas, onCrear, onActualizar, onInactivar, onReactivar, recargar, onError, soloLectura = false }) {
  const campos = config.campos || [];
  const filtrosDef = config.filtros || SIN_FILTROS;
  const VACIO = Object.fromEntries(campos.map((c) => [c.clave, c.tipo === 'booleano' ? false : '']));
  const [form, setForm] = useState(VACIO);
  const [filtro, setFiltro] = useState({});
  const [nombres, setNombres] = useState({});
  const [anioCalculo, setAnioCalculo] = useState(String(new Date().getFullYear() + 1));
  const [calculando, setCalculando] = useState(false);
  const [resultadoCalculo, setResultadoCalculo] = useState(null);

  // Al cambiar de catálogo hay que soltar el borrador: sus claves son las del
  // catálogo anterior y se enviarían campos que este no tiene. Los filtros
  // también arrancan de cero (el año actual si el registro lo pide).
  useEffect(() => {
    setForm(VACIO);
    setResultadoCalculo(null);
    const inicial = {};
    for (const f of filtrosDef) if (f.defecto === 'anioActual') inicial[f.clave] = String(new Date().getFullYear());
    setFiltro(inicial);
    Promise.all(filtrosDef.filter((f) => f.catalogo).map((f) =>
      catalogo(f.catalogo).then((rows) => [f.clave, Object.fromEntries(rows.map((r) => [r.id, r.nombre]))]).catch(() => [f.clave, {}])))
      .then((pares) => setNombres(Object.fromEntries(pares)));
  }, [config.id]);

  const opciones = useMemo(() => Object.fromEntries(filtrosDef.map((f) => {
    const valores = new Set(filas.map((x) => valorDeFiltro(x, f)).filter(Boolean));
    if (filtro[f.clave]) valores.add(filtro[f.clave]);
    return [f.clave, [...valores].sort()];
  })), [filas, filtrosDef, filtro]);

  const visibles = useMemo(() => {
    let lista = filas.filter((x) => filtrosDef.every((f) => !filtro[f.clave] || valorDeFiltro(x, f) === filtro[f.clave]));
    if (config.orden) {
      lista = [...lista].sort((a, b) => {
        for (const k of config.orden) {
          const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''));
          if (c) return c;
        }
        return 0;
      });
    }
    return lista;
  }, [filas, filtro, filtrosDef, config.orden]);

  // «Calcular año»: el backend genera por norma los festivos del año pedido
  // (del país filtrado, o de todos los calculables) y solo agrega los que faltan.
  async function calcularAnio() {
    setCalculando(true);
    setResultadoCalculo(null);
    try {
      const r = await api(`/config/${config.id}/calcular`, { method: 'POST', body: { anio: Number(anioCalculo), paisId: filtro.paisId || undefined } });
      setResultadoCalculo(r.creados
        ? `Se agregaron ${r.creados} festivos de ${r.anio} (${r.paises.map((p) => nombres.paisId?.[p] || p).join(', ')}).`
        : `${r.anio} ya estaba completo para ${r.paises.map((p) => nombres.paisId?.[p] || p).join(', ')}.`);
      recargar?.();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setCalculando(false);
    }
  }

  function enviar(e) {
    e.preventDefault();
    // El id solo se deriva en los catálogos con id de negocio (un código
    // legible). En los demás lo asigna el backend, y mandarlo desde aquí
    // convertiría el término del glosario en su clave de por vida.
    const body = { ...form };
    if (config.idDeNegocio) body.id = idLegible(form[config.idDesde]);
    onCrear(body).then((row) => { if (row) setForm(VACIO); });
  }

  return (
    <div className="space-y-3">
      {!soloLectura && (
        <form className="card flex flex-wrap items-end gap-3" onSubmit={enviar}>
          {campos.map((campo) => (
            <CampoCatalogo key={campo.clave} campo={campo} valor={form[campo.clave]}
              onChange={(v) => setForm({ ...form, [campo.clave]: v })} />
          ))}
          <button className="btn-accent"><Plus className="h-4 w-4" /> Agregar {config.singular}</button>
        </form>
      )}

      {(filtrosDef.length > 0 || config.calculable) && (
        <div className="card flex flex-wrap items-end gap-3">
          {filtrosDef.map((f) => (
            <div key={f.clave}>
              <label className="label">{f.etiqueta}</label>
              <select className="input min-w-40" value={filtro[f.clave] || ''} onChange={(e) => setFiltro({ ...filtro, [f.clave]: e.target.value })}>
                <option value="">Todos</option>
                {(opciones[f.clave] || []).map((v) => <option key={v} value={v}>{nombres[f.clave]?.[v] || v}</option>)}
              </select>
            </div>
          ))}
          {filtrosDef.length > 0 && (
            <div className="self-center pb-1 text-xs text-slate-400">{visibles.length} de {filas.length} registros</div>
          )}
          {config.calculable && !soloLectura && (
            <div className="ml-auto flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Calcular por norma el año</label>
                <input className="input !w-24" type="number" min="2020" max="2100" value={anioCalculo} onChange={(e) => setAnioCalculo(e.target.value)} />
              </div>
              <button type="button" className="btn-secondary" disabled={calculando} onClick={calcularAnio}>
                {calculando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Calcular {filtro.paisId ? (nombres.paisId?.[filtro.paisId] || filtro.paisId) : 'todos los países'}
              </button>
            </div>
          )}
          {resultadoCalculo && <div className="w-full text-xs text-emerald-700">{resultadoCalculo}</div>}
        </div>
      )}

      {filas.length === 0 ? (
        <div className="card text-sm text-slate-500">
          Este catálogo está vacío. Mientras no tenga registros activos, los campos que lo consumen
          aparecen sin opciones para elegir.
        </div>
      ) : visibles.length === 0 ? (
        <div className="card text-sm text-slate-500">
          Ningún registro coincide con el filtro.{config.calculable && !soloLectura ? ' Si falta un año, calcúlalo con el botón de arriba.' : ''}
        </div>
      ) : (
        <div className="card-plano overflow-x-auto">
          <table className="tabla">
            <tbody>
              {visibles.map((f) => (
                <FilaSimple key={f.id} fila={f} campos={campos} soloLectura={soloLectura}
                  onActualizar={onActualizar} onInactivar={onInactivar} onReactivar={onReactivar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaSimple({ fila, campos, onActualizar, onInactivar, onReactivar, soloLectura = false }) {
  const edicion = useEdicionFila(fila, (b) =>
    onActualizar(fila.id, Object.fromEntries(campos.map((c) => [c.clave, b[c.clave]]))));
  const b = edicion.borrador;

  return (
    <tr className={claseFila(fila)}>
      {campos.map((campo) => (
        <td key={campo.clave}
          className={campo.tamano === 'corto' ? 'w-32 font-mono text-xs font-bold' : 'text-sm'}>
          {edicion.editando ? (
            <CampoCatalogo compacto campo={campo} valor={b[campo.clave]}
              onChange={(v) => edicion.cambiar({ [campo.clave]: v })} />
          ) : campo.tipo === 'booleano' ? (
            fila[campo.clave]
              ? <span className="badge bg-amber-100 text-amber-700">{campo.textoSi || 'Sí'}</span>
              : <span className="text-xs text-slate-400">{campo.textoNo || 'No'}</span>
          ) : (
            // Un campo secundario (la descripción, la fuente) se atenúa y, si
            // está vacío, no dibuja la raya: es opcional, no un dato faltante.
            <span className={campo.secundario ? 'text-xs text-slate-500' : ''}>
              {fila[campo.clave] || (campo.secundario ? '' : '—')}
            </span>
          )}
        </td>
      ))}
      {!soloLectura && (
        <td className="w-40">
          <AccionesFila fila={fila} editando={edicion.editando} ocupado={edicion.ocupado}
            onEditar={() => edicion.editar()} onGuardar={edicion.guardar} onCancelar={edicion.cancelar}
            onInactivar={onInactivar} onReactivar={onReactivar} />
        </td>
      )}
    </tr>
  );
}
