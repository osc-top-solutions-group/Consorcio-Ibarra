import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Clock, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import { getModulo, manualesDe } from '../data/index.js';

// Un módulo con varios manuales: la portada del módulo lista sus procesos y
// cada tarjeta abre el manual de ese proceso. Mismo lenguaje visual que el
// índice general para que la navegación sea «módulo → proceso → manual».
export default function ManualesModulo() {
  const { id } = useParams();
  const navigate = useNavigate();
  const modulo = getModulo(id);
  const manuales = manualesDe(id);

  if (!modulo) {
    return (
      <div className="card mx-auto my-10 max-w-2xl text-center">
        <BookOpen className="mx-auto mb-4 h-12 w-12 text-slate-200" />
        <h2 className="text-xl font-bold text-primary">Módulo no encontrado</h2>
        <button onClick={() => navigate('/manuales')} className="btn-secondary mt-6">
          <ArrowLeft className="h-4 w-4" /> Ver todos los manuales
        </button>
      </div>
    );
  }

  const Icono = modulo.icono || BookOpen;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-deep p-6 text-white md:p-8">
        <Link to="/manuales" className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-white/70 transition-colors hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Todos los manuales
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10"><Icono className="h-7 w-7" /></div>
          <div className="min-w-[240px] flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">Manuales de usuario · {modulo.area}</p>
            <h1 className="mt-1 text-2xl font-extrabold md:text-3xl">{modulo.titulo}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">{modulo.descripcion}</p>
            {modulo.rutaModulo && (
              <Link to={modulo.rutaModulo} className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-primary transition-all hover:bg-slate-100">
                Ir al módulo <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Procesos</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {manuales.map((m) => {
          const IconoM = m.icono || BookOpen;
          return (
            <Link key={m.id} to={`/manuales/${m.id}`} className="card group flex flex-col gap-3 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><IconoM className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Proceso</div>
                  <h3 className="text-base font-bold text-slate-800 group-hover:text-primary">{m.proceso || m.titulo}</h3>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-500">{m.descripcion}</p>
              <div className="mt-auto flex items-center justify-between pt-1">
                {m.actualizado && <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"><Clock className="h-3.5 w-3.5" /> {m.actualizado}</span>}
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
                  Abrir el manual <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          );
        })}
        {manuales.length === 0 && <p className="text-sm text-slate-400">Este módulo todavía no tiene manuales publicados.</p>}
      </div>
    </div>
  );
}
