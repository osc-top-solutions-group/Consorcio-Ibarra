import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Search, Plus } from 'lucide-react';
import { api, catalogo, invalidarCatalogo } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';

// Glosario general del SGC. Los términos también se usan como palabras clave
// al diseñar el contenido de un documento.
export default function Glosario() {
  const { usuario } = useAuth();
  const [terminos, setTerminos] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [nuevo, setNuevo] = useState(null);

  function cargar() {
    invalidarCatalogo('definiciones');
    catalogo('definiciones').then(setTerminos).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return terminos;
    return terminos.filter((t) =>
      t.termino.toLowerCase().includes(term) || (t.definicion || '').toLowerCase().includes(term));
  }, [terminos, q]);

  // Agrupa por letra inicial para navegar un glosario largo.
  const porLetra = useMemo(() => {
    const grupos = new Map();
    for (const t of [...filtrados].sort((a, b) => a.termino.localeCompare(b.termino, 'es'))) {
      const letra = t.termino[0].toUpperCase();
      if (!grupos.has(letra)) grupos.set(letra, []);
      grupos.get(letra).push(t);
    }
    return [...grupos.entries()];
  }, [filtrados]);

  async function guardar(e) {
    e.preventDefault();
    try {
      await api('/config/definiciones', { method: 'POST', body: nuevo });
      setNuevo(null);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina flex items-center gap-2">
            <BookMarked className="h-6 w-6" /> Glosario y Definiciones
          </h1>
          <p className="subtitulo-pagina">{terminos.length} términos del sistema de gestión</p>
        </div>
        {usuario?.rol === 'admin' && !nuevo && (
          <button className="btn-accent" onClick={() => setNuevo({ termino: '', definicion: '', fuente: '' })}>
            <Plus className="h-4 w-4" /> Nuevo término
          </button>
        )}
      </div>

      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {nuevo && (
        <form className="card space-y-3" onSubmit={guardar}>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Término *</label>
              <input required className="input" value={nuevo.termino}
                onChange={(e) => setNuevo({ ...nuevo, termino: e.target.value })} />
            </div>
            <div>
              <label className="label">Fuente</label>
              <input className="input" placeholder="ISO 9000:2015, Gestor Documental…" value={nuevo.fuente}
                onChange={(e) => setNuevo({ ...nuevo, fuente: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Definición *</label>
            <textarea required rows={3} className="input" value={nuevo.definicion}
              onChange={(e) => setNuevo({ ...nuevo, definicion: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">Guardar</button>
            <button type="button" className="btn-secondary" onClick={() => setNuevo(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <label className="label">Buscar</label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input !pl-9" placeholder="Término o definición…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {porLetra.map(([letra, items]) => (
        <div key={letra} className="card">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
              {letra}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {items.length} término{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <dl className="divide-y divide-slate-100">
            {items.map((t) => (
              <div key={t.id} className="py-3 first:pt-0 last:pb-0">
                <dt className="font-semibold text-slate-800">{t.termino}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-slate-600">{t.definicion}</dd>
                {t.fuente && (
                  <dd className="mt-1 text-[11px] font-medium uppercase tracking-wide text-accent">{t.fuente}</dd>
                )}
              </div>
            ))}
          </dl>
        </div>
      ))}

      {porLetra.length === 0 && (
        <div className="card py-10 text-center text-slate-400">No hay términos que coincidan con la búsqueda.</div>
      )}
    </div>
  );
}
