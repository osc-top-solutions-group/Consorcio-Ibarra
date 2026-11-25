import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { catalogo } from '@/shared/api';

// Renderiza un campo que el administrador definió en Configuración › Campos de
// los formularios. Es el punto donde la parametrización se vuelve interfaz:
// agregar un campo en el panel lo hace aparecer en el formulario sin tocar código.
//
// Vive en `shared/` porque lo consumen dos módulos —documental (documento) y
// mejoramiento (hallazgo)— y va a consumirlo cada módulo nuevo que declare su
// formulario. Nació dentro de DocumentoNuevo.jsx; dejarlo ahí habría obligado a
// que mejoramiento importara de otro módulo, o —lo más probable— a que copiara
// las once ramas del `switch` y las dos versiones divergieran en el primer tipo
// de campo nuevo.
//
// `catalogosPrecargados` evita volver a pedir por red un catálogo que la pantalla
// ya tiene en memoria: se pasa como { nombreDelCatalogo: filas }.
export default function CampoDinamico({ campo, catalogosPrecargados = {}, valor, onChange }) {
  const [opcionesCatalogo, setOpcionesCatalogo] = useState(null);

  const esDeCatalogo = ['catalogo', 'catalogoMultiple'].includes(campo.tipo);
  const yaCargado = catalogosPrecargados[campo.catalogo];

  useEffect(() => {
    if (!esDeCatalogo) return;
    if (yaCargado) return setOpcionesCatalogo(yaCargado);
    catalogo(campo.catalogo).then(setOpcionesCatalogo).catch(() => setOpcionesCatalogo([]));
  }, [esDeCatalogo, campo.catalogo, yaCargado]);

  const etiqueta = `${campo.etiqueta}${campo.requerido ? ' *' : ''}`;
  const ancho = ['textoLargo', 'etiquetas', 'seleccionMultiple', 'catalogoMultiple', 'lista'].includes(campo.tipo)
    ? 'md:col-span-2' : '';

  // El nombre visible de una fila de catálogo cambia según el catálogo
  // (`nombre` en casi todos, `termino` en el glosario): se resuelve aquí para que
  // ningún catálogo aparezca como un id crudo en un desplegable.
  const nombreFila = (o) => o.nombre || o.termino || o.id;

  function contenido() {
    switch (campo.tipo) {
      case 'textoLargo':
        return <textarea className="input" rows={3} required={campo.requerido}
          value={valor || ''} onChange={(e) => onChange(e.target.value)} />;
      case 'numero':
        return <input type="number" className="input" required={campo.requerido}
          min={campo.minimo ?? undefined} max={campo.maximo ?? undefined}
          value={valor ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
      case 'fecha':
        return <input type="date" className="input" required={campo.requerido}
          value={valor || ''} onChange={(e) => onChange(e.target.value)} />;
      case 'booleano':
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />
            Sí
          </label>
        );
      case 'seleccion':
        return (
          <select className="input" required={campo.requerido} value={valor || ''}
            onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Seleccione…</option>
            {(campo.opciones || []).map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
          </select>
        );
      case 'catalogo':
        return (
          <select className="input" required={campo.requerido} value={valor || ''}
            onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Seleccione…</option>
            {(opcionesCatalogo || []).map((o) => <option key={o.id} value={o.id}>{nombreFila(o)}</option>)}
          </select>
        );
      case 'seleccionMultiple':
      case 'catalogoMultiple': {
        const lista = campo.tipo === 'seleccionMultiple'
          ? (campo.opciones || []).map((o) => [o.valor, o.etiqueta])
          : (opcionesCatalogo || []).map((o) => [o.id, nombreFila(o)]);
        const activos = Array.isArray(valor) ? valor : [];
        return (
          <div className="flex flex-wrap gap-2">
            {lista.map(([v, t]) => (
              <button type="button" key={v}
                className={`chip ${activos.includes(v) ? 'chip-activo' : ''}`}
                onClick={() => onChange(activos.includes(v)
                  ? activos.filter((x) => x !== v)
                  : [...activos, v])}>
                {t}
              </button>
            ))}
          </div>
        );
      }
      case 'etiquetas':
        // Sin etiqueta propia: la de arriba ya la puso este componente. Antes se
        // reutilizaba el bloque de palabras clave completo y salían dos rótulos.
        return <Etiquetas valores={Array.isArray(valor) ? valor : []} onChange={onChange} />;
      case 'lista':
        return <Lista campo={campo} filas={Array.isArray(valor) ? valor : []} onChange={onChange} />;
      default:
        return <input className="input" required={campo.requerido}
          value={valor || ''} onChange={(e) => onChange(e.target.value)} />;
    }
  }

  return (
    <div className={ancho}>
      <label className="label">{etiqueta}</label>
      {contenido()}
      {campo.ayuda && <p className="ayuda">{campo.ayuda}</p>}
    </div>
  );
}

// Lista de términos libres. Con `etiqueta` dibuja su propio rótulo (así lo usa el
// campo de palabras clave del documento); sin ella asume que quien la envuelve ya
// lo puso.
export function Etiquetas({ valores, onChange, etiqueta, ayuda }) {
  const [texto, setTexto] = useState('');

  function agregar() {
    const limpio = texto.trim().toLowerCase();
    if (!limpio || valores.includes(limpio)) return setTexto('');
    onChange([...valores, limpio]);
    setTexto('');
  }

  return (
    <div>
      {etiqueta && <label className="label">{etiqueta}</label>}
      <div className="flex max-w-md gap-2">
        <input className="input" placeholder="Añada un término y presione Enter" value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }} />
        <button type="button" className="btn-secondary shrink-0" onClick={agregar} disabled={!texto.trim()}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {valores.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {valores.map((p) => (
            <span key={p} className="chip chip-activo">
              {p}
              <button type="button" onClick={() => onChange(valores.filter((v) => v !== p))} aria-label={`Quitar ${p}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {ayuda && <p className="ayuda">{ayuda}</p>}
    </div>
  );
}

// Grupo repetible (tipo `lista`): una fila por elemento con los subcampos
// declarados en el campo de sistema (beneficiarios, mascotas, contactos de
// emergencia). Las filas vacías se quedan en pantalla hasta guardar: el backend
// las descarta, así que un «+ Agregar» de más no estorba.
export function Lista({ campo, filas, onChange }) {
  const subcampos = campo.subcampos || [];
  const tope = campo.maxItems || 20;
  const fijar = (i, clave, v) => onChange(filas.map((f, j) => (j === i ? { ...f, [clave]: v } : f)));
  const quitar = (i) => onChange(filas.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {filas.map((fila, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {subcampos.map((s) => (
            <div key={s.clave} className="min-w-[140px] flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.etiqueta}{s.requerido ? ' *' : ''}</label>
              {s.tipo === 'seleccion' ? (
                <select className="input" value={fila[s.clave] || ''} onChange={(e) => fijar(i, s.clave, e.target.value || undefined)}>
                  <option value="">Seleccione…</option>
                  {(s.opciones || []).map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                </select>
              ) : (
                <input className="input" type={s.tipo === 'fecha' ? 'date' : s.tipo === 'numero' ? 'number' : 'text'}
                  value={fila[s.clave] ?? ''} onChange={(e) => fijar(i, s.clave, e.target.value)} />
              )}
            </div>
          ))}
          <button type="button" className="btn-ghost shrink-0" onClick={() => quitar(i)} aria-label="Quitar fila"><X className="h-4 w-4" /></button>
        </div>
      ))}
      {filas.length < tope && (
        <button type="button" className="btn-secondary" onClick={() => onChange([...filas, {}])}>
          <Plus className="h-4 w-4" /> Agregar
        </button>
      )}
    </div>
  );
}
