import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, AlertTriangle, Clock, Download, X, ChevronRight } from 'lucide-react';
import {
  api, catalogo, ESTADOS, ESTADOS_FILTRABLES, CONFIDENCIALIDAD, ALCANCES,
  fechaCorta, textoDias, descargar
} from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';

const FILTROS = ['q', 'procesoId', 'subprocesoId', 'tipoId', 'estado', 'confidencialidad', 'alcance', 'sedeId'];

export default function ListadoMaestro() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [docs, setDocs] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  const valores = Object.fromEntries(FILTROS.map((f) => [f, params.get(f) || '']));
  const consulta = FILTROS.map((f) => `${f}=${encodeURIComponent(valores[f])}`).join('&');

  useEffect(() => {
    catalogo('procesos').then(setProcesos).catch(() => {});
    catalogo('tipos_documento').then(setTipos).catch(() => {});
    catalogo('sedes').then(setSedes).catch(() => {});
  }, []);

  useEffect(() => {
    setCargando(true);
    api(`/documental/documentos?${consulta}`)
      .then((d) => { setDocs(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [consulta]);

  const nombreDe = (lista, id) => (lista.find((x) => x.id === id) || {}).nombre || id || '—';
  const procesoSel = useMemo(() => procesos.find((p) => p.id === valores.procesoId), [procesos, valores.procesoId]);
  const puedeCrear = usuario && ['admin', 'lider'].includes(usuario.rol);
  // Quien no elabora documentos solo recibe documentación vigente (el backend lo
  // impone; aquí simplemente no se ofrece un filtro de estado que no aplica).
  const esGestor = puedeCrear;
  const hayFiltros = FILTROS.some((f) => valores[f]);

  function setFiltro(clave, valor) {
    const nuevos = new URLSearchParams(params);
    if (valor) nuevos.set(clave, valor); else nuevos.delete(clave);
    // Cambiar de proceso invalida el subproceso seleccionado.
    if (clave === 'procesoId') nuevos.delete('subprocesoId');
    setParams(nuevos, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Listado Maestro de Documentos</h1>
          <p className="subtitulo-pagina">
            {cargando
              ? 'Consultando…'
              : `${docs.length} documento${docs.length === 1 ? '' : 's'} ` +
                `${esGestor ? 'en su ámbito de consulta' : 'vigentes en su ámbito de consulta'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => descargar(`/documental/documentos.csv?${consulta}`)}>
            <Download className="h-4 w-4" /> Exportar
          </button>
          {puedeCrear && (
            <Link to="/documental/documentos/nuevo" className="btn-accent">
              <Plus className="h-4 w-4" /> Nuevo documento
            </Link>
          )}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="label">Buscar</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input className="input !pl-9" placeholder="Código, nombre o palabra clave…"
                value={valores.q} onChange={(e) => setFiltro('q', e.target.value)} />
            </div>
          </div>
          <Selector etiqueta="Proceso" valor={valores.procesoId} onChange={(v) => setFiltro('procesoId', v)}
            opciones={procesos.map((p) => [p.id, `${p.codigo} — ${p.nombre}`])} />
          {procesoSel?.subprocesos?.length > 0 && (
            <Selector etiqueta="Subproceso" valor={valores.subprocesoId} onChange={(v) => setFiltro('subprocesoId', v)}
              opciones={procesoSel.subprocesos.map((s) => [s.id, `${s.codigo} — ${s.nombre}`])} />
          )}
          <Selector etiqueta="Tipo" valor={valores.tipoId} onChange={(v) => setFiltro('tipoId', v)}
            opciones={tipos.map((t) => [t.id, t.nombre])} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {esGestor && (
            <Selector etiqueta="Estado" valor={valores.estado} onChange={(v) => setFiltro('estado', v)}
              opciones={ESTADOS_FILTRABLES.map((s) => [s, ESTADOS[s].texto])} />
          )}
          <Selector etiqueta="Confidencialidad" valor={valores.confidencialidad} onChange={(v) => setFiltro('confidencialidad', v)}
            opciones={Object.entries(CONFIDENCIALIDAD).map(([k, v]) => [k, v.texto])} />
          <Selector etiqueta="Alcance" valor={valores.alcance} onChange={(v) => setFiltro('alcance', v)}
            opciones={Object.entries(ALCANCES).map(([k, v]) => [k, v.texto])} />
          <Selector etiqueta="Sede" valor={valores.sedeId} onChange={(v) => setFiltro('sedeId', v)}
            opciones={sedes.map((s) => [s.id, s.nombre])} />
          {hayFiltros && (
            <button className="btn-ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              <X className="h-4 w-4" /> Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      <div className="card-plano overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Proceso</th>
              <th>Tipo</th>
              <th>V.</th>
              <th>Estado</th>
              <th>Alcance</th>
              <th>Confidencialidad</th>
              <th>Próxima revisión</th>
              {/* Columna de la punta de flecha: sin cabecera, es una señal
                  visual, no un dato. */}
              <th className="!px-2" />
            </tr>
          </thead>
          <tbody>
            {/* La fila COMPLETA abre el documento. Antes los únicos puntos de
                entrada eran los enlaces del código y del nombre, y quien llegaba
                por primera vez no encontraba cómo entrar. Los dos siguen siendo
                enlaces de verdad para no perder el teclado ni el ctrl+clic: el
                clic en la fila es un atajo encima, no el único camino. */}
            {docs.map((d) => (
              <tr key={d.id} onClick={() => navigate(`/documental/documentos/${d.id}`)}
                className="group cursor-pointer hover:bg-slate-50">
                <td className="whitespace-nowrap font-mono text-xs font-semibold text-primary">
                  <Link to={`/documental/documentos/${d.id}`}>{d.codigo}</Link>
                  {/* Si el documento fue recodificado, se muestra el código
                      retirado: quien busque por la referencia vieja lo reconoce. */}
                  {d.codigosAnteriores?.length > 0 && (
                    <div className="mt-0.5 font-normal text-[10px] text-slate-400 line-through"
                      title="Código anterior de este documento">
                      {d.codigosAnteriores.join(' · ')}
                    </div>
                  )}
                </td>
                <td>
                  <Link to={`/documental/documentos/${d.id}`}
                    className="font-medium group-hover:text-primary group-hover:underline">{d.nombre}</Link>
                  {d.palabrasClave?.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-slate-400">{d.palabrasClave.join(' · ')}</div>
                  )}
                </td>
                <td className="text-xs text-slate-500">{nombreDe(procesos, d.procesoId)}</td>
                <td className="text-xs text-slate-500">{nombreDe(tipos, d.tipoId)}</td>
                <td>{d.version ?? '—'}</td>
                <td>
                  <span className={`badge ${ESTADOS[d.estado]?.clase}`}>{ESTADOS[d.estado]?.texto || d.estado}</span>
                </td>
                <td className="text-xs text-slate-500">
                  {ALCANCES[d.alcance]?.texto || d.alcance}
                  {d.alcance !== 'global' && d.sedes?.length > 0 && (
                    <div className="text-[11px] text-slate-400">
                      {d.sedes.map((s) => nombreDe(sedes, s)).join(', ')}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`badge ${CONFIDENCIALIDAD[d.confidencialidad]?.clase}`}>
                    {CONFIDENCIALIDAD[d.confidencialidad]?.texto}
                  </span>
                </td>
                <td className="whitespace-nowrap text-xs">
                  <AlertaRevision doc={d} />
                </td>
                <td className="!px-2">
                  <ChevronRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
                </td>
              </tr>
            ))}
            {!cargando && docs.length === 0 && (
              <tr><td colSpan="10" className="py-10 text-center text-slate-400">No hay documentos con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Alerta visual de vencimiento con el conteo de días: sustituye el envío masivo
// de correos recordatorios.
function AlertaRevision({ doc }) {
  if (doc.alertaRevision === 'vencida') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
        <AlertTriangle className="h-3.5 w-3.5" /> {textoDias(doc.diasParaRevision)}
      </span>
    );
  }
  if (doc.alertaRevision === 'proxima') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
        <Clock className="h-3.5 w-3.5" /> {textoDias(doc.diasParaRevision)}
      </span>
    );
  }
  return (
    <span className="text-slate-500">
      {fechaCorta(doc.proximaRevision)}
      {doc.diasParaRevision !== null && (
        <span className="ml-1 text-[11px] text-slate-400">({textoDias(doc.diasParaRevision)})</span>
      )}
    </span>
  );
}

function Selector({ etiqueta, valor, onChange, opciones }) {
  return (
    <div>
      <label className="label">{etiqueta}</label>
      <select className="input" value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </div>
  );
}
