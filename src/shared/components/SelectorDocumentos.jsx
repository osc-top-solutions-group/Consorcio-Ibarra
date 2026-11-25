import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { api } from '@/shared/api';

// Selector de documentos del módulo documental para vincular a un control.
//
// Consume la API del documental (no sus componentes: un módulo no importa de
// otro módulo). El listado ya llega filtrado por la visibilidad del usuario y
// aquí solo se ofrecen los que tienen versión vigente: la Declaración
// referencia documentación aplicable, no borradores.
//
// El listado se carga una sola vez por montaje de la matriz y se comparte vía
// una promesa module-level: 93 filas no deben disparar 93 consultas.
let promesaDocumentos = null;
function cargarDocumentos() {
  if (!promesaDocumentos) {
    promesaDocumentos = api('/documental/documentos')
      .then((filas) => filas.filter((d) => ['vigente', 'en_actualizacion'].includes(d.estado)))
      .catch((e) => {
        promesaDocumentos = null; // un fallo no debe quedar cacheado
        throw e;
      });
  }
  return promesaDocumentos;
}

export default function SelectorDocumentos({ vinculados, onChange, deshabilitado }) {
  const [disponibles, setDisponibles] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef(null);

  useEffect(() => {
    cargarDocumentos().then(setDisponibles).catch((e) => setError(e.message));
  }, []);

  // Cierra la lista al hacer clic fuera.
  useEffect(() => {
    function alClic(e) {
      if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', alClic);
    return () => document.removeEventListener('mousedown', alClic);
  }, []);

  const opciones = useMemo(() => {
    if (!disponibles) return [];
    const ya = new Set(vinculados.map((v) => v.docId));
    const term = q.trim().toLowerCase();
    return disponibles
      .filter((d) => !ya.has(d.id))
      .filter((d) => !term || d.codigo.toLowerCase().includes(term) || (d.nombre || '').toLowerCase().includes(term))
      .slice(0, 8);
  }, [disponibles, vinculados, q]);

  function vincular(d) {
    onChange([...vinculados, { docId: d.id, codigo: d.codigo, nombre: d.nombre }]);
    setQ('');
    setAbierto(false);
  }

  function quitar(docId) {
    onChange(vinculados.filter((v) => v.docId !== docId));
  }

  return (
    <div ref={contenedor}>
      <div className="flex flex-wrap gap-1.5">
        {vinculados.map((v) => (
          <span key={v.docId} className="chip max-w-full">
            <FileText className="h-3 w-3 shrink-0 text-primary" />
            <a href={`/documental/documentos/${v.docId}`} target="_blank" rel="noreferrer"
              className="truncate font-mono text-primary hover:underline" title={v.nombre}>
              {v.codigo}
            </a>
            {!deshabilitado && (
              <button type="button" onClick={() => quitar(v.docId)} className="text-slate-400 hover:text-rose-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!vinculados.length && deshabilitado && <span className="text-xs text-slate-400">—</span>}
      </div>

      {!deshabilitado && (
        <div className="relative mt-1.5">
          <input
            className="input py-1.5 text-xs"
            placeholder={error ? 'Listado documental no disponible' : 'Buscar por código o nombre…'}
            value={q}
            disabled={!!error}
            onFocus={() => setAbierto(true)}
            onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
          />
          {abierto && opciones.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {opciones.map((d) => (
                <button key={d.id} type="button" onClick={() => vincular(d)}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-50">
                  <span className="font-mono font-semibold text-primary">{d.codigo}</span>
                  <span className="ml-2 text-slate-600">{d.nombre}</span>
                </button>
              ))}
            </div>
          )}
          {error && <p className="ayuda">{error}</p>}
        </div>
      )}
    </div>
  );
}
