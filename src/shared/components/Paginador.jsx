import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/shared/api';

// PAGINACIÓN POR CURSOR, compartida por todos los listados.
//
// El backend pagina con `col(x).page()` (cursor opaco, nunca offset: Firestore
// cobra los documentos saltados) y devuelve { filas, cursor, hayMas }. Hasta
// hoy cada pantalla repetía el mismo estado y el mismo botón «Cargar más»;
// aquí vive una sola vez, con páginas de tamaño elegible y Anterior /
// Siguiente. No hay salto a la página N: con cursores solo se avanza desde la
// página actual, y para volver se guarda la pila de cursores recorridos.
//
//   const pag = usePaginado('/talento-humano/colaboradores', params);
//   pag.filas · pag.cargando · pag.error · pag.extra (lo demás que devuelva la API)
//   <Paginador {...pag} />
//
// `params` es un objeto plano (o URLSearchParams): al cambiar se vuelve a la
// primera página. Una respuesta tardía de una consulta anterior se descarta,
// para que cambiar dos filtros rápido no mezcle páginas.
export const TAMANOS_PAGINA = [15, 30, 50, 100];
const CLAVE_TAMANO = 'sgc.paginado.tamano';

function tamanoGuardado() {
  try { const t = Number(localStorage.getItem(CLAVE_TAMANO)); return TAMANOS_PAGINA.includes(t) ? t : 15; } catch { return 15; }
}

export function usePaginado(ruta, params = {}) {
  const [filas, setFilas] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [extra, setExtra] = useState({});
  const [tamano, setTamanoEstado] = useState(tamanoGuardado);
  // Cursores de las páginas ya vistas: pila[i] es el cursor con el que se pidió
  // la página i (null para la primera). `pagina` es el índice actual.
  const [pila, setPila] = useState([null]);
  const [pagina, setPagina] = useState(0);
  const [siguienteCursor, setSiguienteCursor] = useState(null);
  const version = useRef(0);

  const clave = JSON.stringify(params instanceof URLSearchParams ? [...params.entries()] : params);

  const pedir = useCallback(async (cursorActual, indice, pilaActual) => {
    const mia = ++version.current;
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams(params instanceof URLSearchParams ? params : Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      if (cursorActual) qs.set('cursor', cursorActual);
      qs.set('limite', String(tamano));
      const r = await api(`${ruta}${qs.toString() ? `?${qs}` : ''}`);
      if (mia !== version.current) return;
      const { filas: nuevas = [], cursor: c = null, hayMas: mas = false, ...resto } = r;
      setFilas(nuevas);
      setSiguienteCursor(c);
      setHayMas(mas);
      setExtra(resto);
      setPila(pilaActual);
      setPagina(indice);
    } catch (e) {
      if (mia === version.current) setError(e.message);
    } finally {
      if (mia === version.current) setCargando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta, clave, tamano]);

  // Filtros o tamaño nuevos → primera página.
  useEffect(() => { pedir(null, 0, [null]); }, [pedir]);

  const setTamano = (t) => {
    try { localStorage.setItem(CLAVE_TAMANO, String(t)); } catch { /* sin almacenamiento local */ }
    setTamanoEstado(t);
  };

  return {
    filas, cargando, error, extra, tamano, setTamano, pagina, hayMas,
    siguiente: () => hayMas && siguienteCursor && pedir(siguienteCursor, pagina + 1, [...pila.slice(0, pagina + 1), siguienteCursor]),
    anterior: () => pagina > 0 && pedir(pila[pagina - 1], pagina - 1, pila),
    recargar: () => pedir(pila[pagina], pagina, pila)
  };
}

export default function Paginador({ filas, hayMas, cargando, pagina, tamano, setTamano, siguiente, anterior, vacio = 'No hay registros con estos filtros.' }) {
  const desde = pagina * tamano + 1;
  const hasta = pagina * tamano + filas.length;
  return (
    <div className="space-y-2">
      {!cargando && filas.length === 0 && pagina === 0 && <p className="py-6 text-center text-sm text-slate-400">{vacio}</p>}
      {cargando && <p className="py-3 text-center text-sm text-slate-400">Cargando…</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-500">
        <label className="flex items-center gap-2">
          <span className="text-xs">Por página</span>
          <select className="input !w-auto !py-1" value={tamano} onChange={(e) => setTamano(Number(e.target.value))}>
            {TAMANOS_PAGINA.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <span className="text-xs">
          {filas.length > 0 ? `${desde}–${hasta}` : '0'}{hayMas ? ' · hay más' : filas.length > 0 ? ' · fin de la lista' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost" disabled={pagina === 0 || cargando} onClick={anterior} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="px-2 text-xs font-semibold text-slate-600">Página {pagina + 1}</span>
          <button type="button" className="btn-ghost" disabled={!hayMas || cargando} onClick={siguiente} aria-label="Página siguiente">
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
