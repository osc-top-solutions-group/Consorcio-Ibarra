import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, FileText, ArrowRight, Loader2 } from 'lucide-react';
import CadenaValor from '../components/CadenaValor.jsx';
import { api, catalogo, ESTADOS, fechaCorta } from '@/shared/api';

// Mapa de procesos como cadena de valor: anillo central con un sector por cada
// grupo del catálogo «Cadena de valor» (tipos_proceso), ciclos de innovación y
// conocimiento, y los procesos desplegados a los lados con sus subprocesos.
// Todo se arma desde los catálogos, así que Configuración lo mantiene sin
// tocar código: agregar «Procesos de Asesoría» es una fila más.
export default function MapaProcesos() {
  const [procesos, setProcesos] = useState([]);
  const [tipos, setTipos] = useState([]);
  // El resaltado por paso del ratón y el fijado con clic se guardan aparte, para
  // que salir con el ratón no borre el sector que el usuario dejó seleccionado.
  const [tipoHover, setTipoHover] = useState(null);
  const [tipoFijado, setTipoFijado] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  const tipoActivo = tipoHover || tipoFijado;

  useEffect(() => {
    Promise.all([api('/documental/mapa-procesos'), catalogo('tipos_proceso')])
      .then(([lista, cat]) => { setProcesos(lista); setTipos(cat); })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  // Una columna por grupo del catálogo, con sus procesos ordenados. Un proceso
  // cuyo grupo ya no exista en el catálogo no se pierde: va a «Sin clasificar».
  const columnas = useMemo(() => {
    const orden = (a, b) => (a.orden ?? 99) - (b.orden ?? 99) || a.nombre.localeCompare(b.nombre, 'es');
    const conocidos = new Set(tipos.map((t) => t.id));
    const lista = tipos.map((t) => ({
      tipo: t.id, titulo: t.nombre, procesos: procesos.filter((p) => p.tipo === t.id).sort(orden)
    }));
    const huerfanos = procesos.filter((p) => !conocidos.has(p.tipo)).sort(orden);
    if (huerfanos.length) lista.push({ tipo: '_otros', titulo: 'Sin clasificar', procesos: huerfanos });
    return lista;
  }, [procesos, tipos]);

  const total = procesos.reduce((n, p) => n + p.documentos.total, 0);

  // Composición de escritorio: los grupos se alternan a los lados del anillo
  // (segundo y cuarto a la izquierda; primero y tercero a la derecha), que con
  // tres grupos reproduce el mapa clásico: operativos solos a la izquierda.
  const izquierda = columnas.filter((_, i) => i % 2 === 1);
  const derecha = columnas.filter((_, i) => i % 2 === 0);

  // `conector` dibuja la línea que une el corchete del grupo con el anillo; solo
  // aplica en la composición de escritorio, donde el anillo está al lado.
  const propsColumna = (columna, lado, conector = false) => ({
    ...columna,
    lado,
    conector,
    activo: tipoActivo,
    onHover: setTipoHover,
    onSeleccionar: setSeleccion
  });

  return (
    // El panel es hermano del contenedor con `space-y-*`: esas utilidades aplican
    // margin-top a los hermanos siguientes y desplazarían el modal fijo.
    <>
      <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-accent">
          Mapa de procesos, nuestra cadena de valor
        </h1>
        <p className="subtitulo-pagina">
          {cargando
            ? 'Consultando…'
            : `${total} documento${total === 1 ? '' : 's'} publicados. Haga clic en un proceso o subproceso para consultarlos.`}
        </p>
      </div>

      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {cargando ? (
        <div className="flex justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* Composición de escritorio: misionales a la izquierda, anillo al
              centro, estratégicos y soporte a la derecha (como el original).
              El anillo lleva ancho explícito: dentro de un flex, un SVG con
              ancho relativo se encoge hasta quedar minúsculo. */}
          <div className="mx-auto hidden min-h-[calc(100vh-13rem)] max-w-[1500px] items-center justify-center gap-2 xl:flex">
            <div className="flex-1 space-y-9">
              {izquierda.map((c) => <Columna key={c.tipo} {...propsColumna(c, 'izquierda', true)} />)}
            </div>

            <div className="w-[540px] shrink-0">
              <CadenaValor tipos={tipos} activo={tipoActivo} onSeleccionar={setTipoFijado} />
            </div>

            <div className="flex-1 space-y-9">
              {derecha.map((c) => <Columna key={c.tipo} {...propsColumna(c, 'derecha', true)} />)}
            </div>
          </div>

          {/* Composición compacta: el anillo arriba y los procesos apilados. */}
          <div className="space-y-6 xl:hidden">
            <div className="mx-auto w-full max-w-[460px]">
              <CadenaValor tipos={tipos} activo={tipoActivo} onSeleccionar={setTipoFijado} />
            </div>
            <div className={`grid gap-6 ${columnas.length >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
              {columnas.map((c) => <Columna key={c.tipo} {...propsColumna(c, 'derecha')} />)}
            </div>
          </div>
        </>
      )}
      </div>

      {seleccion && <PanelDocumentos seleccion={seleccion} onCerrar={() => setSeleccion(null)} />}
    </>
  );
}

// Grupo de procesos de un tipo, con el corchete magenta que lo conecta al anillo.
function Columna({ titulo, procesos, lado, conector, activo, tipo, onHover, onSeleccionar }) {
  if (!procesos.length) return null;
  const atenuado = activo && activo !== tipo;
  const derecha = lado === 'derecha';

  return (
    <div
      className={`transition-opacity ${atenuado ? 'opacity-40' : 'opacity-100'}`}
      onMouseEnter={() => onHover(tipo)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={`mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400 ${derecha ? '' : 'text-right'}`}>
        {titulo}
      </div>

      <div className={`relative space-y-5 border-accent ${derecha ? 'border-l-2 pl-4' : 'border-r-2 pr-4'}`}>
        {conector && (
          <span aria-hidden
            className={`absolute top-1/2 h-0.5 w-16 bg-accent ${derecha ? '-left-16' : '-right-16'}`} />
        )}
        {procesos.map((p) => (
          <Proceso key={p.id} proceso={p} derecha={derecha} onSeleccionar={onSeleccionar} />
        ))}
      </div>
    </div>
  );
}

function Proceso({ proceso, derecha, onSeleccionar }) {
  return (
    <div>
      <button
        onClick={() => onSeleccionar({ proceso })}
        className={`group flex w-full items-center gap-2 ${derecha ? '' : 'flex-row-reverse'}`}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        <span className={`min-w-0 flex-1 ${derecha ? 'text-left' : 'text-right'}`}>
          <span className="block text-sm font-bold leading-snug text-primary group-hover:text-accent">
            {proceso.nombre}
          </span>
          <span className="text-[11px] font-medium text-slate-400">
            {proceso.codigo} · {proceso.documentos.total} doc.
          </span>
        </span>
      </button>

      {proceso.subprocesos.length > 0 && (
        <ul className={`mt-1.5 space-y-1 ${derecha ? 'pl-4' : 'pr-4'}`}>
          {proceso.subprocesos.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onSeleccionar({ proceso, subproceso: s })}
                className={`group flex w-full items-start gap-2 ${derecha ? '' : 'flex-row-reverse'}`}
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span className={`text-xs leading-snug text-slate-600 group-hover:text-accent ${derecha ? 'text-left' : 'text-right'}`}>
                  {s.nombre}
                  {s.documentos.total > 0 && (
                    <span className="ml-1 text-[10px] font-semibold text-slate-400">({s.documentos.total})</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Panel lateral con los documentos del proceso o subproceso elegido,
// agrupados por tipo documental.
function PanelDocumentos({ seleccion, onCerrar }) {
  const { proceso, subproceso } = seleccion;
  const [docs, setDocs] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const qs = new URLSearchParams({ procesoId: proceso.id });
    if (subproceso) qs.set('subprocesoId', subproceso.id);
    setDocs(null);
    api(`/documental/documentos?${qs}`).then(setDocs).catch((e) => setError(e.message));
    catalogo('tipos_documento').then(setTipos).catch(() => {});
  }, [proceso.id, subproceso]);

  // Cierre con Escape, como cualquier panel modal.
  useEffect(() => {
    const alPresionar = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [onCerrar]);

  const agrupados = useMemo(() => {
    if (!docs) return [];
    return tipos
      .map((t) => ({ tipo: t, items: docs.filter((d) => d.tipoId === t.id) }))
      .filter((g) => g.items.length > 0);
  }, [docs, tipos]);

  const enlaceListado = `/documental/documentos?procesoId=${proceso.id}${subproceso ? `&subprocesoId=${subproceso.id}` : ''}`;

  return (
    <>
      {/* Modal real: por encima del encabezado de la aplicación (z-10). */}
      <div className="fixed inset-0 z-40 bg-surface-dark/40" onClick={onCerrar} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 bg-surface-dark px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              {subproceso ? 'Subproceso' : 'Proceso'}
            </div>
            <div className="truncate font-bold">{subproceso ? subproceso.nombre : proceso.nombre}</div>
            <div className="text-xs text-slate-400">
              {subproceso ? `${proceso.codigo}-${subproceso.codigo} · ${proceso.nombre}` : proceso.codigo}
            </div>
          </div>
          <button onClick={onCerrar} className="shrink-0 rounded-lg p-1 hover:bg-white/10" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="text-sm text-rose-600">{error}</div>}

          {!docs && !error && (
            <div className="flex justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {docs && docs.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-400">
              Este {subproceso ? 'subproceso' : 'proceso'} todavía no tiene documentos publicados.
            </div>
          )}

          <div className="space-y-5">
            {agrupados.map(({ tipo, items }) => (
              <div key={tipo.id}>
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-accent" />
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{tipo.nombre}</span>
                  <span className="badge bg-slate-100 text-slate-500">{items.length}</span>
                </div>
                <ul className="space-y-1.5">
                  {items.map((d) => (
                    <li key={d.id}>
                      <Link to={`/documental/documentos/${d.id}`}
                        className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-accent/40 hover:bg-accent-soft">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-[11px] font-bold text-primary">{d.codigo}</span>
                          <span className={`badge ${ESTADOS[d.estado]?.clase}`}>{ESTADOS[d.estado]?.texto}</span>
                        </div>
                        <div className="mt-0.5 text-sm font-medium leading-snug">{d.nombre}</div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          v{d.version}
                          {/* Solo los documentos aprobados tienen fecha de vigencia. */}
                          {d.fechaVigencia && ` · vigente desde ${fechaCorta(d.fechaVigencia)}`}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 p-4">
          <Link to={enlaceListado} className="btn-accent w-full">
            Ver en el listado maestro <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </aside>
    </>
  );
}
