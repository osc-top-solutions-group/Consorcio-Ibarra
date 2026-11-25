import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Download, Search, Info } from 'lucide-react';
import { api, catalogo, fechaCorta, descargar } from '@/shared/api';

// Repositorio estricto de obsoletos: separado del listado maestro para que un
// documento sin vigencia nunca se confunda con uno aplicable. Se conserva
// únicamente para trazabilidad (requisito ISO).
export default function Obsoletos() {
  const [docs, setDocs] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    catalogo('procesos').then(setProcesos).catch(() => {});
    catalogo('tipos_documento').then(setTipos).catch(() => {});
  }, []);

  useEffect(() => {
    setCargando(true);
    api(`/documental/obsoletos?q=${encodeURIComponent(q)}`)
      .then((d) => { setDocs(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [q]);

  const nombreDe = (lista, id) => (lista.find((x) => x.id === id) || {}).nombre || id || '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina flex items-center gap-2">
            <Archive className="h-6 w-6" /> Documentos Obsoletos
          </h1>
          <p className="subtitulo-pagina">
            {cargando ? 'Consultando…' : `${docs.length} documento${docs.length === 1 ? '' : 's'} sin vigencia`}
          </p>
        </div>
        <button className="btn-secondary" onClick={() => descargar(`/documental/documentos.csv?obsoletos=1&q=${encodeURIComponent(q)}`)}>
          <Download className="h-4 w-4" /> Exportar
        </button>
      </div>

      <div className="card border-amber-200 bg-amber-50/60">
        <div className="flex gap-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Estos documentos <strong>no son aplicables</strong>. Se conservan solo como evidencia
            histórica del sistema de gestión. Para la versión aplicable, consulte el listado maestro.
          </p>
        </div>
      </div>

      <div className="card">
        <label className="label">Buscar</label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input !pl-9" placeholder="Código o nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
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
              <th>Última versión</th>
              <th>Estuvo vigente desde</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap font-mono text-xs font-semibold text-slate-500">
                  <Link to={`/documental/documentos/${d.id}`}>{d.codigo}</Link>
                </td>
                <td>
                  <Link to={`/documental/documentos/${d.id}`} className="font-medium text-slate-600 hover:text-accent">
                    {d.nombre}
                  </Link>
                </td>
                <td className="text-xs text-slate-500">{nombreDe(procesos, d.procesoId)}</td>
                <td className="text-xs text-slate-500">{nombreDe(tipos, d.tipoId)}</td>
                <td>v{d.version ?? '—'}</td>
                <td className="text-xs text-slate-500">{fechaCorta(d.fechaVigencia)}</td>
              </tr>
            ))}
            {!cargando && docs.length === 0 && (
              <tr><td colSpan="6" className="py-10 text-center text-slate-400">No hay documentos obsoletos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
