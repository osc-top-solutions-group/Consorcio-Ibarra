import { useEffect, useState } from 'react';
import { Users, XCircle } from 'lucide-react';
import { api, catalogo, TIPOS_ASIGNACION } from '@/shared/api';
import SelectorEmpleados from '@/shared/components/SelectorEmpleados.jsx';

// Selector de un conjunto de personas expresado como CRITERIO, no como lista:
// una persona concreta, o todas las que ocupan un cargo, pertenecen a un área o
// grupo, o trabajan en una sede. Es la misma gramática que usa el backend
// (core/config/destinatarios.js), así que sirve igual para asignar un flujo de
// aprobación que para decidir quién ve o descarga un documento.
//
// Guardar el criterio y no la lista es lo que hace que un cambio de personal no
// rompa lo configurado: los integrantes se resuelven en el momento de usarlo.

// Los catálogos se cargan una vez por sesión y se comparten entre pantallas.
// Cargos y áreas son los REALES del catálogo de Usuarios: así una
// asignación nunca apunta a un cargo que no existe en la organización.
let enVuelo = null;
function cargarCatalogos() {
  if (!enVuelo) {
    enVuelo = Promise.all([catalogo('grupos'), catalogo('sedes'), api('/empleados/dimensiones')])
      .then(([grupos, sedes, dim]) => ({
        grupos,
        sedes,
        areas: dim.areas.map((a) => ({ id: a.valor, nombre: `${a.valor} (${a.total})` })),
        cargos: dim.cargos.map((c) => ({ id: c.valor, nombre: `${c.valor} (${c.total})` }))
      }))
      .catch((e) => { enVuelo = null; throw e; });   // un fallo no queda cacheado
  }
  return enVuelo;
}

const VACIO = { grupos: [], sedes: [], areas: [], cargos: [] };

export function useCatalogosAudiencia() {
  const [cat, setCat] = useState(VACIO);
  useEffect(() => {
    let vigente = true;
    cargarCatalogos().then((c) => { if (vigente) setCat(c); }).catch(() => {});
    return () => { vigente = false; };
  }, []);
  return cat;
}

export default function SelectorAudiencia({ titulo, seleccion = [], onChange, cat: catExterno }) {
  const catPropio = useCatalogosAudiencia();
  const cat = catExterno || catPropio;
  const [tipo, setTipo] = useState('usuario');

  const OPCIONES = {
    cargo: cat.cargos.map((c) => [c.id, c.nombre]),
    area: cat.areas.map((a) => [a.id, a.nombre]),
    grupo: cat.grupos.map((g) => [g.id, g.nombre]),
    sede: cat.sedes.map((s) => [s.id, s.nombre])
  };

  const personas = seleccion.filter((s) => s.tipo === 'usuario').map((s) => s.valor);
  const colectivos = seleccion.filter((s) => s.tipo !== 'usuario');

  function alternar(valor) {
    const existe = seleccion.some((s) => s.tipo === tipo && s.valor === valor);
    onChange(existe
      ? seleccion.filter((s) => !(s.tipo === tipo && s.valor === valor))
      : [...seleccion, { tipo, valor }]);
  }

  function etiquetaDe({ tipo: t, valor }) {
    const par = (OPCIONES[t] || []).find(([v]) => v === valor);
    return par ? par[1] : valor;
  }

  return (
    <div>
      {titulo && (
        <label className="label !flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {titulo}</label>
      )}

      <div className="mb-2 flex flex-wrap gap-1">
        {Object.entries(TIPOS_ASIGNACION).map(([valor, texto]) => (
          <button type="button" key={valor} onClick={() => setTipo(valor)}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
              tipo === valor ? 'bg-primary text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
            }`}>
            {texto}
          </button>
        ))}
      </div>

      {tipo === 'usuario' ? (
        <SelectorEmpleados
          seleccion={personas}
          placeholder="Buscar colaborador por nombre…"
          onChange={(nuevos) => onChange([
            ...colectivos,
            ...nuevos.map((correo) => ({ tipo: 'usuario', valor: correo }))
          ])} />
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex flex-wrap gap-1.5">
            {(OPCIONES[tipo] || []).map(([valor, texto]) => (
              <button type="button" key={valor} onClick={() => alternar(valor)}
                className={`chip ${seleccion.some((s) => s.tipo === tipo && s.valor === valor) ? 'chip-activo' : ''}`}
                title={valor}>
                {texto}
              </button>
            ))}
            {(OPCIONES[tipo] || []).length === 0 && (
              <span className="px-1 py-0.5 text-xs text-slate-400">Sin opciones disponibles.</span>
            )}
          </div>
        </div>
      )}

      {colectivos.length > 0 && (
        <div className="mt-2 space-y-1">
          {colectivos.map((s) => (
            <div key={`${s.tipo}:${s.valor}`} className="flex items-center gap-2 text-xs">
              <span className="rounded bg-slate-100 px-1.5 font-semibold text-slate-500">{TIPOS_ASIGNACION[s.tipo]}</span>
              <span className="flex-1 truncate">{etiquetaDe(s)}</span>
              <button type="button" className="text-rose-500"
                onClick={() => onChange(seleccion.filter((x) => !(x.tipo === s.tipo && x.valor === s.valor)))}
                aria-label={`Quitar ${etiquetaDe(s)}`}>
                <XCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Resumen legible de una audiencia, para las fichas y los listados.
// Sin criterios significa "sin restricción adicional", no "nadie".
export function ResumenAudiencia({ audiencia = [], cat, sinRestriccion = 'Sin restricción' }) {
  const catPropio = useCatalogosAudiencia();
  const c = cat || catPropio;
  if (!audiencia.length) return <span className="text-slate-500">{sinRestriccion}</span>;

  const nombreDe = ({ tipo, valor }) => {
    const lista = { cargo: c.cargos, area: c.areas, grupo: c.grupos, sede: c.sedes }[tipo] || [];
    const hallado = lista.find((x) => x.id === valor);
    return `${TIPOS_ASIGNACION[tipo] || tipo}: ${hallado ? hallado.nombre : valor}`;
  };

  return (
    <span className="flex flex-wrap gap-1">
      {audiencia.map((a) => (
        <span key={`${a.tipo}:${a.valor}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
          {nombreDe(a)}
        </span>
      ))}
    </span>
  );
}
