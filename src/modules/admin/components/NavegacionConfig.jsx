import { ChevronRight, Search, Globe } from 'lucide-react';
import { MODULOS } from '@/app/menu';

// PIEZAS DE NAVEGACIÓN DEL PANEL DE CONFIGURACIÓN.
//
// Las comparten «Catálogos y parámetros» y «Campos de los formularios»: son la
// misma tarea (elegir un módulo y configurarlo) y tenían que verse igual. Antes
// cada pantalla dibujaba sus propias filas de pestañas y ya empezaban a divergir.
//
// Por qué un árbol lateral y no dos filas de pestañas, que es como estaba:
//
//   · Con diez módulos y hasta nueve catálogos cada uno, las dos filas se partían
//     en cuatro y empujaban el contenido media pantalla hacia abajo. Un árbol
//     crece hacia abajo, que es donde sobra espacio, y aguanta los módulos que
//     falten sin volver a tocar el diseño.
//   · La jerarquía «módulo → catálogo» se ve; en dos filas de pestañas hay que
//     deducirla.
//   · El contenido empieza arriba del todo, no debajo de la navegación.

// El icono de cada módulo sale del catálogo de módulos del menú principal, para
// que el mismo módulo se vea igual en el Home, en el sidebar y aquí.
export function iconoDeModulo(id) {
  if (id === 'global') return Globe;
  return (MODULOS.find((m) => m.id === id) || {}).icono || null;
}

// Dos columnas: navegación pegajosa a la izquierda, contenido a la derecha.
// La navegación se queda a la vista al desplazarse por un catálogo largo, que es
// justo cuando se quiere saltar a otro.
export function PanelConNavegacion({ navegacion, children }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-64 lg:self-start lg:overflow-y-auto">
        {navegacion}
      </aside>
      <div className="min-w-0 flex-1 space-y-4">{children}</div>
    </div>
  );
}

export function Buscador({ valor, onChange, placeholder = 'Buscar…' }) {
  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="input !pl-8" value={valor} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// Encabezado de un módulo dentro del árbol. Es un botón: lleva al resumen del
// módulo, que es donde se ve todo lo que se configura ahí y lo que le falta.
export function GrupoModulo({ modulo, activo, onClick, children, insignia }) {
  const Icono = iconoDeModulo(modulo.id);
  return (
    <div className="mb-1">
      <button onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide transition-colors ${
          activo ? 'bg-primary-soft text-primary' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
        }`}>
        {Icono && <Icono className="h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{modulo.nombre}</span>
        {insignia}
      </button>
      {children && <div className="mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 ml-3.5">{children}</div>}
    </div>
  );
}

// Una entrada hoja del árbol (un catálogo, un formulario).
//
// `conteo` en cero se pinta en ámbar y no en gris: un catálogo vacío no es un
// dato neutro, es la causa de que un campo del formulario salga sin opciones.
export function ItemNav({ texto, activo, onClick, conteo, global: esGlobal, sufijo }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        activo ? 'bg-accent-soft font-semibold text-accent' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}>
      {esGlobal && <Globe className="h-3 w-3 shrink-0 opacity-50" />}
      <span className="min-w-0 flex-1 truncate">{texto}</span>
      {sufijo}
      {conteo !== null && conteo !== undefined && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
          conteo === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {conteo}
        </span>
      )}
    </button>
  );
}

// Sección que se pliega. Se usa para los globales que un módulo hereda y para los
// módulos por desarrollar: están, se pueden abrir, pero no ocupan sitio de salida.
export function Plegable({ texto, abierto, onAlternar, children, sangria = false }) {
  return (
    <>
      <button onClick={onAlternar}
        className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600">
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${abierto ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate">{texto}</span>
      </button>
      {abierto && (
        <div className={`space-y-0.5 ${sangria ? 'border-l border-slate-200 pl-2 ml-3.5' : ''}`}>{children}</div>
      )}
    </>
  );
}

// Aviso de una sola línea. Reemplaza las tarjetas apiladas que había antes: el
// mismo texto, pero sin empujar el formulario fuera de la pantalla.
const TONOS = {
  global: 'border-violet-200 bg-violet-50 text-violet-900',
  alerta: 'border-amber-200 bg-amber-50/70 text-amber-900',
  info: 'border-primary/20 bg-primary-soft text-primary'
};

export function Linea({ tono = 'info', icono: Icono, children }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${TONOS[tono]}`}>
      {Icono && <Icono className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// "A, B y C" — en español, con la conjunción y sin coma antes de ella.
export function listar(nombres) {
  if (nombres.length <= 1) return nombres[0] || '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}
