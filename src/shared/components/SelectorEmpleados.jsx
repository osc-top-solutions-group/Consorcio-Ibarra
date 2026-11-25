import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, UserPlus, Loader2 } from 'lucide-react';
import { api } from '@/shared/api';

// Selector de colaboradores contra el DIRECTORIO de la compañía (BigQuery, 322
// personas). Se usa en el panel de accesos y en la asignación de flujos, para
// que nadie tenga que escribir correos a mano ni mantener una lista aparte.
export default function SelectorEmpleados({ seleccion = [], onChange, placeholder = 'Buscar colaborador…' }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [detalles, setDetalles] = useState({});
  const contenedor = useRef(null);

  // Resuelve nombre y cargo de los correos ya seleccionados, para no mostrar
  // solo direcciones sueltas.
  useEffect(() => {
    const faltantes = seleccion.filter((c) => !detalles[c]);
    if (!faltantes.length) return;
    let vigente = true;
    Promise.all(faltantes.map((correo) =>
      api(`/empleados/${encodeURIComponent(correo)}`).catch(() => ({ correo, nombre: correo }))))
      .then((filas) => {
        if (!vigente) return;
        setDetalles((prev) => ({ ...prev, ...Object.fromEntries(filas.map((f) => [f.correo, f])) }));
      });
    return () => { vigente = false; };
  }, [seleccion, detalles]);

  // Búsqueda con retardo: el directorio son 322 filas en caché del backend,
  // pero no hace falta consultar en cada tecla.
  useEffect(() => {
    if (texto.trim().length < 2) { setResultados([]); return; }
    setBuscando(true);
    const id = setTimeout(() => {
      api(`/empleados?q=${encodeURIComponent(texto)}&limite=25`)
        .then((r) => setResultados(r.empleados || []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(id);
  }, [texto]);

  useEffect(() => {
    function fuera(e) {
      if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const disponibles = useMemo(
    () => resultados.filter((e) => !seleccion.includes(e.correo)),
    [resultados, seleccion]
  );

  function agregar(empleado) {
    setDetalles((prev) => ({ ...prev, [empleado.correo]: empleado }));
    onChange([...seleccion, empleado.correo]);
    setTexto('');
    setResultados([]);
  }

  return (
    <div ref={contenedor} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          // `!pl-9` y no `pl-9`: la clase .input se declara después de las
          // utilidades de Tailwind, así que su px-3 gana el desempate y el texto
          // se monta sobre la lupa.
          className="input !pl-9"
          placeholder={placeholder}
          value={texto}
          onFocus={() => setAbierto(true)}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
        />
        {buscando && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {abierto && texto.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {disponibles.length === 0 && !buscando && (
            <div className="px-3 py-3 text-sm text-slate-400">Sin resultados en el directorio.</div>
          )}
          {disponibles.map((e) => (
            <button type="button" key={e.correo} onClick={() => agregar(e)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent-soft">
              <Avatar empleado={e} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{e.nombre}</span>
                <span className="block truncate text-xs text-slate-500">
                  {e.cargo || '—'} · {e.area || 's/área'}
                </span>
              </span>
              <UserPlus className="h-4 w-4 shrink-0 text-accent" />
            </button>
          ))}
        </div>
      )}

      {seleccion.length > 0 && (
        <ul className="mt-2 space-y-1">
          {seleccion.map((correo) => {
            const e = detalles[correo] || { correo, nombre: correo };
            return (
              <li key={correo} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                <Avatar empleado={e} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.nombre}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {e.correo}{e.cargo ? ` · ${e.cargo}` : ''}
                  </span>
                </span>
                <button type="button" className="shrink-0 text-slate-400 hover:text-rose-600"
                  onClick={() => onChange(seleccion.filter((c) => c !== correo))} aria-label={`Quitar ${correo}`}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Avatar({ empleado }) {
  const inicial = (empleado.nombre || empleado.correo || '?').slice(0, 1).toUpperCase();
  if (empleado.foto) {
    return <img src={empleado.foto} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
      {inicial}
    </span>
  );
}
