import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Save, AlertTriangle, Globe, Lock, Users, Eye, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, XCircle, History, Crown, Hourglass, UserCheck
} from 'lucide-react';
import { Link } from 'react-router-dom';
import SelectorEmpleados from '@/shared/components/SelectorEmpleados.jsx';
import { api, fechaCorta } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';

// PANEL DE GESTIÓN DE ACCESOS.
// El catálogo de recursos lo declara el backend (no se puede inventar ni cambiar
// de tipo desde aquí); este panel solo reparte titulares y ámbitos.
export default function Accesos() {
  const { usuario } = useAuth();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [abiertos, setAbiertos] = useState({});
  // La pestaña inicial es la de administradores por módulo: es la asignación
  // más frecuente (el dueño de cada proceso) y antes quedaba escondida entre
  // todos los recursos del grupo.
  const [vista, setVista] = useState('administradores');

  function cargar() {
    api('/accesos/catalogo')
      .then(async (d) => {
        // Opciones del ámbito por aplicación: las ofrece el módulo de
        // seguridad (salen de su última importación). Si quien administra el
        // panel no tiene acceso a ese módulo, el ámbito se asigna sin chips.
        let appsMatriz = [];
        try {
          const dim = await api('/seguridad/matriz/dimensiones');
          appsMatriz = (dim.apps || []).map((a) => ({ id: String(a.id), nombre: a.nombre }));
        } catch { /* sin acceso al módulo o sin importaciones aún */ }
        setDatos({ ...d, appsMatriz });
        setError(null);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  const porGrupo = useMemo(() => {
    if (!datos) return [];
    return datos.grupos
      .map((g) => ({ grupo: g, recursos: datos.recursos.filter((r) => r.grupo === g) }))
      .filter((x) => x.recursos.length);
  }, [datos]);

  // Un recurso administrador por módulo (lo garantiza el catálogo del backend).
  const administradores = useMemo(() => (datos ? datos.recursos.filter((r) => r.administraGrupo) : []), [datos]);

  if (error) {
    return (
      <div className="card max-w-2xl border-rose-200 bg-rose-50">
        <div className="mb-1 flex items-center gap-2 font-semibold text-rose-700">
          <Lock className="h-5 w-5" /> Sin acceso al panel
        </div>
        <p className="text-sm text-rose-600">{error}</p>
        <p className="mt-2 text-xs text-rose-500">Identidad detectada: {usuario?.correo}</p>
      </div>
    );
  }

  if (!datos) {
    return <div className="flex justify-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" /> Gestión de Accesos
          </h1>
          <p className="subtitulo-pagina">
            Qué puede ver y hacer cada colaborador. Los cambios aplican de inmediato y quedan auditados.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {[['administradores', 'Administradores por módulo'], ['recursos', 'Recursos'], ['simular', 'Simulador'], ['auditoria', 'Auditoría']].map(([id, t]) => (
            <button key={id} onClick={() => setVista(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                vista === id ? 'bg-white text-accent shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="card border-primary/20 bg-primary-soft text-sm text-primary">
        La identidad de las personas (nombre, cargo, área y país) viene del directorio de Talento
        Humano, así que no hay que darlas de alta aquí: basta buscarlas. Lo que se administra en este
        panel es únicamente el <strong>acceso</strong>.
      </div>

      {vista === 'simular' && <Simulador />}
      {vista === 'auditoria' && <Auditoria />}

      {vista === 'administradores' && (
        <div className="space-y-4">
          <div className="card text-sm text-slate-600">
            <div className="mb-1 flex items-center gap-2 font-semibold text-slate-700">
              <Crown className="h-4 w-4 text-amber-500" /> Dueño del proceso = administrador del módulo
            </div>
            Quien esté aquí tiene <strong>todos los permisos de su módulo</strong>, incluidos los que se
            agreguen en el futuro, sin repartirlos uno a uno. No recibe acceso a otros módulos ni a la
            configuración de la plataforma. Excepción: en Talento Humano, los costos y nómina y el rol de
            director (quien aprueba los accesos a datos personales) no se heredan; se asignan aparte en
            <strong> Recursos</strong>. Para permisos puntuales (un solo recurso, un ámbito por proceso o
            sede) use la pestaña <strong>Recursos</strong>.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {administradores.map((r) => (
              <TarjetaAdministrador key={r.id} recurso={r} onGuardado={cargar} />
            ))}
          </div>
        </div>
      )}

      {vista === 'recursos' && porGrupo.map(({ grupo, recursos }) => (
        <div key={grupo}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">{grupo}</h2>
          <div className="space-y-2">
            {recursos.map((r) => (
              <Recurso key={r.id} recurso={r} catalogos={datos}
                expandido={!!abiertos[r.id]}
                onToggle={() => setAbiertos((p) => ({ ...p, [r.id]: !p[r.id] }))}
                onGuardado={cargar} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Recurso({ recurso, catalogos, expandido, onToggle, onGuardado }) {
  const [emails, setEmails] = useState(recurso.emails || []);
  const [scopes, setScopes] = useState(recurso.scopes || {});
  const [abierto, setAbierto] = useState(!!recurso.abierto);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const [errores, setErrores] = useState([]);

  useEffect(() => {
    setEmails(recurso.emails || []);
    setScopes(recurso.scopes || {});
    setAbierto(!!recurso.abierto);
  }, [recurso]);

  // Cada tipo con ámbito define su clave, sus etiquetas y de dónde salen las
  // opciones (procesos y sedes de sus catálogos; áreas del directorio de TH).
  const AMBITOS = {
    'scope-procesos': {
      clave: 'procesos', todos: 'todos los procesos', etiqueta: 'procesos',
      opciones: catalogos.procesos,
      ayuda: 'Un líder de proceso administra los documentos únicamente de los procesos que se le asignen.'
    },
    'scope-sedes': {
      clave: 'sedes', todos: 'todas las sedes', etiqueta: 'sedes',
      opciones: catalogos.sedes,
      ayuda: recurso.id === 'tthh.expedientes'
        ? 'Esta persona gestiona los perfiles y los paz y salvos únicamente de los colaboradores de los países marcados.'
        : 'Además de su propia sede, esta persona podrá ver los documentos locales de las sedes marcadas.'
    },
    'scope-areas': {
      clave: 'areas', todos: 'todas las áreas', etiqueta: 'áreas',
      opciones: catalogos.areas || [],
      ayuda: 'Esta persona valida los accesos a aplicaciones únicamente de los colaboradores de las áreas marcadas. Las áreas vienen del catálogo de Usuarios.'
    },
    'scope-apps': {
      clave: 'apps', todos: 'todas las aplicaciones', etiqueta: 'aplicaciones',
      opciones: catalogos.appsMatriz || [],
      ayuda: 'Esta persona es responsable únicamente de las aplicaciones marcadas: ve sus asignaciones completas, define áreas faltantes y marca las correcciones aplicadas. Las aplicaciones salen de la última importación de la matriz.'
    }
  };
  const ambito = AMBITOS[recurso.tipo] || null;
  const conAmbito = !!ambito;
  const claveAmbito = ambito?.clave;
  const ambitoTodos = ambito?.todos;
  const ambitoEtiqueta = ambito?.etiqueta;
  const opcionesAmbito = ambito?.opciones || [];

  const sucio = JSON.stringify({ emails, scopes, abierto }) !==
    JSON.stringify({ emails: recurso.emails || [], scopes: recurso.scopes || {}, abierto: !!recurso.abierto });

  async function guardar() {
    setGuardando(true);
    setErrores([]);
    setMensaje(null);
    setPendiente(null);
    try {
      const r = await api(`/accesos/recurso/${recurso.id}`, {
        method: 'PUT',
        body: { emails, scopes, abierto: recurso.abrible ? abierto : undefined }
      });
      // 202 en los recursos soloTitulares: lo que da acceso quedó como
      // solicitud y NO aplica hasta que lo apruebe el director de TTHH.
      if (r.pendienteAprobacion) setPendiente(r.mensaje);
      else setMensaje(r.advertencias?.length ? r.advertencias.join(' · ') : 'Guardado.');
      onGuardado();
    } catch (e) {
      setErrores([e.message]);
    } finally {
      setGuardando(false);
    }
  }

  // Personas con ámbito limitado: se administran aparte de las de acceso total.
  const conScope = Object.keys(scopes);

  return (
    <div className={`card-plano ${recurso.sensible ? 'border-amber-300' : ''}`}>
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        {expandido ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{recurso.nombre}</span>
            {recurso.pendiente && <span className="badge bg-slate-100 text-slate-500">módulo por construir</span>}
            {recurso.administraGrupo && (
              <span className="badge bg-amber-50 text-amber-700"><Crown className="h-3 w-3" /> administra el módulo</span>
            )}
            {recurso.sensible && (
              <span className="badge bg-amber-100 text-amber-700"><AlertTriangle className="h-3 w-3" /> sensible</span>
            )}
            {recurso.soloTitulares && (
              <span className="badge bg-rose-50 text-rose-700"><Lock className="h-3 w-3" /> requiere aprobación</span>
            )}
            {recurso.solicitudesPendientes > 0 && (
              <span className="badge bg-amber-50 text-amber-700">
                <Hourglass className="h-3 w-3" /> {recurso.solicitudesPendientes} pendiente{recurso.solicitudesPendientes === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{recurso.descripcion}</p>
        </div>
        <div className="shrink-0 text-right">
          {recurso.abierto ? (
            <span className="badge bg-emerald-100 text-emerald-700"><Globe className="h-3 w-3" /> abierto</span>
          ) : (
            <span className="badge bg-slate-100 text-slate-600">
              <Users className="h-3 w-3" /> {recurso.totalPersonas ?? 0}
            </span>
          )}
        </div>
      </button>

      {expandido && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          {recurso.advertencia && (
            <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {recurso.advertencia}
            </div>
          )}

          {recurso.soloTitulares && <AvisoProtegido />}

          {recurso.abrible && (
            <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={abierto}
                onChange={(e) => setAbierto(e.target.checked)} />
              <span>
                Abierto a cualquier colaborador autenticado
                <span className="block text-xs text-slate-500">
                  Mientras esté encendido, la lista de personas deja de aplicar.
                </span>
              </span>
            </label>
          )}

          <div className={abierto ? 'pointer-events-none opacity-40' : ''}>
            <label className="label">
              {conAmbito ? `Acceso total (${ambitoTodos})` : 'Personas con acceso'}
            </label>
            <SelectorEmpleados seleccion={emails} onChange={setEmails} />
          </div>

          {conAmbito && !abierto && (
            <div>
              <label className="label">
                Acceso limitado por {ambitoEtiqueta}
              </label>
              <p className="mb-2 text-xs text-slate-500">{ambito.ayuda}</p>

              <SelectorEmpleados
                seleccion={conScope}
                placeholder="Agregar colaborador con ámbito limitado…"
                onChange={(nuevos) => {
                  const siguiente = {};
                  nuevos.forEach((c) => { siguiente[c] = scopes[c] || { [claveAmbito]: [] }; });
                  setScopes(siguiente);
                }} />

              {conScope.length > 0 && (
                <div className="mt-3 space-y-3">
                  {conScope.map((correo) => (
                    <div key={correo} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 font-mono text-xs font-semibold text-primary">{correo}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {opcionesAmbito.map((o) => {
                          const activos = scopes[correo]?.[claveAmbito] || [];
                          const marcado = activos.includes(o.id);
                          return (
                            <button type="button" key={o.id}
                              className={`chip ${marcado ? 'chip-activo' : ''}`}
                              onClick={() => setScopes((p) => ({
                                ...p,
                                [correo]: {
                                  [claveAmbito]: marcado
                                    ? activos.filter((x) => x !== o.id)
                                    : [...activos, o.id]
                                }
                              }))}>
                              {o.codigo || o.nombre}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {errores.length > 0 && (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{errores.join(' · ')}</div>
          )}
          {mensaje && (
            <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">{mensaje}</div>
          )}
          {pendiente && <AvisoPendiente texto={pendiente} />}

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-accent" disabled={guardando || !sucio} onClick={guardar}>
              <Save className="h-4 w-4" /> {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            {recurso.updatedBy && (
              <span className="text-xs text-slate-400">
                Último cambio: {recurso.updatedBy} · {fechaCorta(recurso.updatedAt)}
              </span>
            )}
            {recurso.origen && (
              <span className="ml-auto font-mono text-[10px] text-slate-300">{recurso.origen}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// "¿Qué vería esta persona?" — evita repartir accesos a ciegas.
// Una tarjeta por módulo con sus administradores, editable en el sitio. Es el
// mismo recurso allowlist de la pestaña Recursos, con la interfaz reducida a lo
// único que se hace aquí: buscar a la persona y guardar.
function TarjetaAdministrador({ recurso, onGuardado }) {
  const [emails, setEmails] = useState(recurso.emails || []);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setEmails(recurso.emails || []); }, [recurso]);
  const sucio = JSON.stringify(emails) !== JSON.stringify(recurso.emails || []);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    setPendiente(null);
    try {
      const r = await api(`/accesos/recurso/${recurso.id}`, { method: 'PUT', body: { emails, scopes: {} } });
      if (r.pendienteAprobacion) setPendiente(r.mensaje);
      else setMensaje(r.advertencias?.length ? r.advertencias.join(' · ') : 'Guardado.');
      onGuardado();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className={`card-plano p-4 ${recurso.pendiente ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Crown className="h-4 w-4 text-amber-500" />
        <span className="font-semibold">{recurso.grupo}</span>
        {recurso.pendiente && <span className="badge bg-slate-100 text-slate-500">módulo por construir</span>}
        <span className="ml-auto badge bg-slate-100 text-slate-600">
          <Users className="h-3 w-3" /> {emails.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{recurso.advertencia}</p>
      {recurso.soloTitulares && <div className="mt-2"><AvisoProtegido /></div>}
      <div className="mt-3">
        <SelectorEmpleados seleccion={emails} onChange={setEmails} placeholder="Buscar en el directorio…" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-accent !px-3 !py-1.5 text-xs" disabled={!sucio || guardando} onClick={guardar}>
          <Save className="h-3.5 w-3.5" /> {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        {mensaje && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {mensaje}</span>}
        {error && <span className="flex items-center gap-1 text-xs text-rose-600"><XCircle className="h-3.5 w-3.5" /> {error}</span>}
      </div>
      {pendiente && <div className="mt-2"><AvisoPendiente texto={pendiente} /></div>}
    </div>
  );
}

// Recursos `soloTitulares` (datos personales de Talento Humano): el panel no
// otorga por sí solo. Se dice ANTES de guardar, para que el 202 no sorprenda.
function AvisoProtegido() {
  return (
    <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Información personal de los colaboradores. Ni el administrador de la plataforma la ve sin estar en
        esta lista. <strong>Quitar</strong> a alguien aplica de inmediato; <strong>agregar</strong> queda
        pendiente hasta que lo apruebe un director de Talento Humano (titular de «Talento Humano ·
        director»; administrar el módulo no basta), distinto de quien lo pide y de quien lo recibe. Puede solicitar el acceso para usted mismo, pero no tendrá efecto hasta que
        otro lo apruebe.
      </span>
    </div>
  );
}

function AvisoPendiente({ texto }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
      <Hourglass className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{texto}</span>
      <Link to="/solicitudes-acceso" className="inline-flex items-center gap-1 font-semibold underline">
        <UserCheck className="h-3.5 w-3.5" /> Ver solicitudes
      </Link>
    </div>
  );
}

function Simulador() {
  const [correo, setCorreo] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!correo.length) { setResultado(null); return; }
    setCargando(true);
    api(`/accesos/simular?correo=${encodeURIComponent(correo[0])}`)
      .then((r) => { setResultado(r); setError(null); })
      .catch((e) => { setError(e.message); setResultado(null); })
      .finally(() => setCargando(false));
  }, [correo]);

  return (
    <div className="card space-y-4">
      <div>
        <label className="label !flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Simular un colaborador</label>
        <SelectorEmpleados seleccion={correo} onChange={(n) => setCorreo(n.slice(-1))}
          placeholder="Buscar a quién simular…" />
      </div>

      {cargando && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      {error && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {resultado && (
        <>
          <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Dato etiqueta="Rol derivado" valor={resultado.rol} />
            <Dato etiqueta="Cargo" valor={resultado.cargo || '—'} />
            <Dato etiqueta="Sede propia" valor={resultado.sedePropia || 'sin sede'} />
            <Dato etiqueta="Ve otras sedes"
              valor={resultado.verTodasLasSedes ? 'todas' : (resultado.sedes.join(', ') || 'solo la suya')} />
            <Dato etiqueta="Procesos que administra"
              valor={resultado.administraTodosLosProcesos ? 'todos' : (resultado.procesos.join(', ') || 'ninguno')} />
            <Dato etiqueta="Áreas cuyos accesos valida"
              valor={resultado.validaTodasLasAreas ? 'todas' : ((resultado.areasQueValida || []).join(', ') || 'ninguna')} />
            <Dato etiqueta="En el directorio" valor={resultado.enDirectorio ? 'sí' : 'NO'} />
          </div>

          {!resultado.enDirectorio && (
            <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Este correo no está en el catálogo de Usuarios: no tendrá sede asignada y no
              verá documentos locales de ningún país.
            </div>
          )}

          <ul className="divide-y divide-slate-100">
            {resultado.detalle.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
                {d.permitido
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  : <XCircle className="h-4 w-4 shrink-0 text-slate-300" />}
                <span className={d.permitido ? '' : 'text-slate-400'}>{d.nombre}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-300">{d.id}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Auditoria() {
  const [registros, setRegistros] = useState(null);

  useEffect(() => {
    api('/accesos/auditoria').then((r) => setRegistros(r.registros)).catch(() => setRegistros([]));
  }, []);

  if (!registros) {
    return <div className="card flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <History className="h-5 w-5 text-primary" /> Cambios de acceso
      </div>
      {registros.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Todavía no hay cambios registrados.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {registros.map((r) => (
            <li key={r.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.detalle?.recurso || r.objeto}</span>
                <span className="badge bg-slate-100 text-slate-500">{r.accion.replace('accesos.', '')}</span>
                <span className="ml-auto text-xs text-slate-400">{fechaCorta(r.createdAt)}</span>
              </div>
              <div className="text-xs text-slate-500">{r.correo}</div>
              {r.detalle?.despues && (
                <div className="mt-1 text-[11px] text-slate-400">
                  {(r.detalle.antes?.emails || []).length} → {(r.detalle.despues.emails || []).length} personas
                  {r.detalle.despues.abierto ? ' · abierto a todos' : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <div>
      <div className="label">{etiqueta}</div>
      <div className="text-sm font-medium">{valor}</div>
    </div>
  );
}
