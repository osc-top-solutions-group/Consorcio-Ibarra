// Piezas pequeñas que comparten las pantallas de los módulos: insignia de
// estado, filtro, tarjeta de contador, sección, dato con etiqueta y aviso.
//
// Nacieron en `modules/auditorias/components/ui.jsx` y se promovieron aquí en
// septiembre de 2026, cuando HSEQ resultó ser el segundo módulo que las
// necesitaba: la regla del repo es que lo que consumen dos módulos sube a
// `shared/`, porque un módulo no importa de otro.

export function Badge({ mapa, clave, texto }) {
  if (!clave && !texto) return <span className="text-slate-300">—</span>;
  const e = (mapa && mapa[clave]) || { texto: texto || clave, clase: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${e.clase}`}>
      {e.texto}
    </span>
  );
}

export function Filtro({ etiqueta, valor, onChange, opciones }) {
  return (
    <div>
      <label className="label">{etiqueta}</label>
      <select className="input" value={valor} onChange={(e) => onChange(e.target.value)}>
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </div>
  );
}

export function Tarjeta({ icono: Icono, titulo, valor, clase, detalle, onClick }) {
  const Etiqueta = onClick ? 'button' : 'div';
  return (
    <Etiqueta type={onClick ? 'button' : undefined} onClick={onClick}
      className={`card flex items-center gap-3 text-left ${onClick ? 'transition-shadow hover:shadow-md' : ''}`}>
      <Icono className={`h-8 w-8 shrink-0 ${clase}`} />
      <div>
        <div className="text-2xl font-bold leading-tight">{valor}</div>
        <div className="text-xs text-slate-500">{titulo}</div>
        {detalle && <div className="text-[11px] font-semibold text-rose-500">{detalle}</div>}
      </div>
    </Etiqueta>
  );
}

export function Seccion({ titulo, descripcion, acciones, children }) {
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">{titulo}</h2>
          {descripcion && <p className="text-xs text-slate-400">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

export function Dato({ etiqueta, children, ancho = '' }) {
  return (
    <div className={ancho}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</div>
      <div className="text-sm text-slate-700">{children ?? '—'}</div>
    </div>
  );
}

export function Aviso({ tono = 'info', children }) {
  const clase = {
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    alerta: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-rose-200 bg-rose-50 text-rose-600',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }[tono];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${clase}`}>{children}</div>;
}

// Nombre de una fila de catálogo por su id, con el id como respaldo para que
// nada aparezca vacío si el catálogo aún no cargó.
export const nombreDe = (lista, id) => ((lista || []).find((x) => x.id === id) || {}).nombre || id || '—';

// Pide confirmación con motivo obligatorio (retirar, anular, reabrir).
export function pedirMotivo(pregunta) {
  const motivo = window.prompt(pregunta);
  if (motivo === null) return null;
  if (motivo.trim().length < 5) {
    window.alert('Indique un motivo de al menos 5 caracteres.');
    return null;
  }
  return motivo.trim();
}
