import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, ArrowLeft, ExternalLink, Printer, List, Clock } from 'lucide-react';
import { getManual, getModulo } from '../data/index.js';

// Visor de manuales de usuario. Es el gemelo del de la Intranet
// (src/pages/Manuales/ManualViewer.jsx allá), con los colores y las clases de
// esta plataforma: el mismo manual tiene que leerse igual en los dos sitios,
// porque para el colaborador es la misma empresa.

// Convierte un título en un ancla estable.
const slugify = (texto) =>
  String(texto).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

// Texto plano de los hijos de un encabezado de react-markdown.
const textoDe = (children) =>
  React.Children.toArray(children)
    .map((c) => (typeof c === 'string' ? c : c?.props?.children || '')).join('');

export default function ManualVisor() {
  const { id } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const manual = getManual(id);
  const modulo = manual?.modulo ? getModulo(manual.modulo) : null;
  const [seccionActiva, setSeccionActiva] = useState('');

  // Índice: los títulos de nivel 2 del markdown.
  const indice = useMemo(() => {
    if (!manual) return [];
    return (manual.contenido.match(/^## .+$/gm) || []).map((l) => {
      const texto = l.replace(/^## /, '').trim();
      return { texto, slug: slugify(texto) };
    });
  }, [manual]);

  // Resalta en el índice la sección visible. El scroll vive en el <main> del
  // Layout, no en window, así que se escucha en fase de captura sobre document:
  // funciona sin importar qué contenedor haga scroll.
  useEffect(() => {
    if (!indice.length) return;
    const alDesplazar = () => {
      let actual = indice[0]?.slug || '';
      for (const { slug } of indice) {
        const el = document.getElementById(slug);
        if (el && el.getBoundingClientRect().top <= 140) actual = slug;
      }
      setSeccionActiva(actual);
    };
    alDesplazar();
    document.addEventListener('scroll', alDesplazar, true);
    return () => document.removeEventListener('scroll', alDesplazar, true);
  }, [indice]);

  // Con ancla (#1-firmantes-de-un-bloque, desde el correo o desde la ficha del
  // paz y salvo) se va a esa sección; sin ancla, al inicio.
  useEffect(() => {
    const slug = (hash || '').replace('#', '');
    const destino = slug ? document.getElementById(slug) : null;
    if (destino) { destino.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    document.querySelector('main')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [id, hash]);

  if (!manual) {
    return (
      <div className="card mx-auto my-10 max-w-2xl text-center">
        <BookOpen className="mx-auto mb-4 h-12 w-12 text-slate-200" />
        <h2 className="text-xl font-bold text-primary">Manual no encontrado</h2>
        <p className="mt-2 text-sm text-slate-500">El manual que busca no existe o cambió de dirección.</p>
        <button onClick={() => navigate('/manuales')} className="btn-secondary mt-6">
          <ArrowLeft className="h-4 w-4" /> Ver todos los manuales
        </button>
      </div>
    );
  }

  const irA = (slug) => document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const Icono = manual.icono || BookOpen;

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary-deep p-6 text-white md:p-10 print:hidden">
        <div className="mb-4 flex flex-wrap gap-4">
          <Link to="/manuales" className="inline-flex items-center gap-1.5 text-xs font-bold text-white/70 transition-colors hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Todos los manuales
          </Link>
          {modulo && (
            <Link to={`/manuales/${modulo.id}`} className="inline-flex items-center gap-1.5 text-xs font-bold text-white/70 transition-colors hover:text-white">
              <BookOpen className="h-3.5 w-3.5" /> Manuales de {modulo.titulo}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10">
            <Icono className="h-7 w-7" />
          </div>
          <div className="min-w-[240px] flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">
              Manual de usuario · {manual.area}{manual.proceso ? ` · ${manual.proceso}` : ''}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold md:text-3xl">{manual.titulo}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">{manual.descripcion}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {manual.rutaModulo && (
                <Link to={manual.rutaModulo}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-primary transition-all hover:bg-slate-100">
                  Ir al módulo <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
              <button onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-white/20">
                <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
              </button>
              {manual.actualizado && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/60">
                  <Clock className="h-3.5 w-3.5" /> Actualizado: {manual.actualizado}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-6">
        {indice.length > 0 && (
          <aside className="sticky top-24 hidden w-72 shrink-0 lg:block print:hidden">
            <div className="card p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <List className="h-3.5 w-3.5" /> Contenido
              </p>
              <nav className="space-y-0.5">
                {indice.map(({ texto, slug }) => (
                  <button key={slug} onClick={() => irA(slug)}
                    className={`w-full rounded-lg px-3 py-1.5 text-left text-[13px] leading-snug transition-colors ${
                      seccionActiva === slug
                        ? 'border-l-2 border-accent bg-primary-soft font-bold text-primary'
                        : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    }`}>
                    {texto}
                  </button>
                ))}
              </nav>
            </div>
          </aside>
        )}

        <article className="card min-w-0 flex-1 p-6 md:p-10">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="mb-2 border-b border-slate-100 pb-4 text-2xl font-extrabold text-primary md:text-3xl">{children}</h1>,
              h2: ({ children }) => {
                const texto = textoDe(children);
                return <h2 id={slugify(texto)} className="mb-4 mt-10 scroll-mt-24 border-b border-slate-100 pb-2 text-xl font-extrabold text-primary md:text-2xl">{children}</h2>;
              },
              h3: ({ children }) => <h3 className="mb-3 mt-7 text-base font-bold text-primary md:text-lg">{children}</h3>,
              p: ({ children }) => <p className="mb-4 text-[15px] leading-relaxed text-slate-600">{children}</p>,
              ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6 text-[15px] leading-relaxed text-slate-600">{children}</ul>,
              ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-6 text-[15px] leading-relaxed text-slate-600">{children}</ol>,
              strong: ({ children }) => <strong className="font-bold text-slate-800">{children}</strong>,
              blockquote: ({ children }) => (
                <blockquote className="mb-4 rounded-r-xl border-l-4 border-amber-300 bg-amber-50/60 px-4 py-3 [&_p]:mb-0 [&_p]:text-amber-900">{children}</blockquote>
              ),
              code: ({ inline, children }) => (inline
                ? <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-accent">{children}</code>
                : <code className="font-mono text-[12.5px] leading-relaxed">{children}</code>),
              pre: ({ children }) => <pre className="mb-5 overflow-x-auto rounded-2xl bg-slate-900 p-5 text-slate-100">{children}</pre>,
              table: ({ children }) => (
                <div className="mb-5 overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full border-collapse text-left text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
              th: ({ children }) => <th className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</th>,
              td: ({ children }) => <td className="border-b border-slate-50 px-4 py-2.5 align-top text-[13.5px] text-slate-600">{children}</td>,
              hr: () => <hr className="my-8 border-slate-100" />,
              a: ({ href, children }) => <a href={href} className="font-semibold text-accent hover:underline">{children}</a>
            }}>
            {manual.contenido}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
