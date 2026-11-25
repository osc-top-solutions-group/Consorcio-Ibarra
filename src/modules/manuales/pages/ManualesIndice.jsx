import { Link } from 'react-router-dom';
import { BookOpen, Clock, ArrowRight } from 'lucide-react';
import { MANUALES, MODULOS, manualesDe } from '../data/index.js';

// Portada de los manuales de usuario. Una tarjeta por manual, con el mismo
// vocabulario que el índice de la Intranet para que quien haya usado uno
// reconozca el otro. Un módulo con varios manuales (Talento Humano) tiene UNA
// tarjeta que abre la portada del módulo, donde están sus procesos.
export default function ManualesIndice() {
  // Tarjetas: los manuales sueltos tal cual, y un módulo con manuales por
  // proceso como una sola tarjeta que resume cuáles tiene.
  const tarjetas = [
    ...MANUALES.filter((m) => !m.modulo).map((m) => ({ ...m, ruta: `/manuales/${m.id}`, accion: 'Abrir el manual' })),
    ...MODULOS.map((mod) => {
      const procesos = manualesDe(mod.id);
      return {
        ...mod,
        ruta: `/manuales/${mod.id}`,
        accion: `Ver los ${procesos.length} ${procesos.length === 1 ? 'manual' : 'manuales'}`,
        actualizado: procesos.map((p) => p.actualizado).filter(Boolean).sort().at(-1) || null,
        procesos: procesos.map((p) => p.proceso || p.titulo)
      };
    })
  ];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="titulo-pagina">Manuales de usuario</h1>
        <p className="subtitulo-pagina max-w-3xl">
          Cómo se usa cada módulo, explicado paso a paso: qué hace, quién puede hacer qué,
          y qué pasa después de cada acción. Escritos para quien entra por primera vez.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {tarjetas.map((m) => {
          const Icono = m.icono || BookOpen;
          return (
            <Link key={m.id} to={m.ruta}
              className="card group flex flex-col gap-3 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icono className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{m.area}</div>
                  <h2 className="text-base font-bold text-slate-800 group-hover:text-primary">{m.titulo}</h2>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-500">{m.descripcion}</p>
              {m.procesos && m.procesos.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.procesos.map((p) => <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p}</span>)}
                </div>
              )}
              <div className="mt-auto flex items-center justify-between pt-1">
                {m.actualizado && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Clock className="h-3.5 w-3.5" /> {m.actualizado}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
                  {m.accion} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
