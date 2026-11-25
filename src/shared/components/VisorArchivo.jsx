import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Download, Loader2, FileWarning } from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import { descargar } from '@/shared/api';
// Solo la URL del worker se importa estáticamente (es una cadena); la
// biblioteca en sí se carga bajo demanda la primera vez que se abre un PDF,
// para no cargar ~400 KB en cada pantalla de la aplicación.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// VISOR DE ARCHIVOS DE LA HERRAMIENTA.
//
// Antes «Ver PDF» abría el archivo en otra pestaña: el visor nativo del
// navegador trae botón de descarga e impresión, y con eso la restricción de
// descarga del documento (permitirImpresion, audienciaDescarga) era decorativa:
// cualquiera que pudiera consultar se lo llevaba y lo reenviaba.
//
// Aquí el archivo se pide con fetch (con el header X-Requested-With que el
// backend exige para la consulta en línea: la URL pegada en una pestaña
// responde 403), el PDF se pinta página a página en <canvas> con pdf.js —sin
// barra de herramientas, sin «guardar como»— y cada página lleva una marca de
// agua con el correo de quien consulta y la fecha. La descarga solo aparece si
// el módulo la autorizó (`rutaDescarga`), y va por la ruta ?descargar=1 que el
// backend valida aparte.
//
// Lo que esto NO es: un control criptográfico. Quien tiene sesión puede hacer
// una captura de pantalla o pedir el archivo con la consola del navegador. Lo
// que cierra es el camino fácil (el enlace que se copia, el botón de bajar) y
// deja rastro: la marca de agua identifica al que consultó y el backend audita
// cada consulta.

let cargaPdfjs = null;
function pdfjs() {
  if (!cargaPdfjs) {
    cargaPdfjs = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    });
  }
  return cargaPdfjs;
}

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];

export default function VisorArchivo({ ruta, titulo, onCerrar, rutaDescarga }) {
  const { usuario } = useAuth();
  const [estado, setEstado] = useState({ cargando: true, error: null, tipo: null, pdf: null, urlBlob: null, nombre: '' });
  const [zoom, setZoom] = useState(1);
  const contenedor = useRef(null);
  const [ancho, setAncho] = useState(0);

  const marca = `${usuario?.correo || ''} · ${new Date().toLocaleString('es-CO')}`;

  // Descarga del archivo por fetch (misma sesión IAP) y decisión de cómo pintarlo.
  useEffect(() => {
    let cancelado = false;
    let tareaPdf = null;
    let urlBlob = null;
    (async () => {
      try {
        const res = await fetch(`/api${ruta}`, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!res.ok) {
          const cuerpo = await res.json().catch(() => null);
          throw new Error((cuerpo && cuerpo.error) || `No fue posible abrir el archivo (${res.status})`);
        }
        const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const nombre = nombreDe(res.headers.get('content-disposition')) || titulo || '';
        const bytes = await res.arrayBuffer();
        if (cancelado) return;

        if (mime === 'application/pdf' || /\.pdf$/i.test(nombre)) {
          const lib = await pdfjs();
          tareaPdf = lib.getDocument({ data: bytes, isEvalSupported: false });
          const doc = await tareaPdf.promise;
          if (cancelado) return;
          setEstado({ cargando: false, error: null, tipo: 'pdf', pdf: doc, urlBlob: null, nombre });
        } else if (mime.startsWith('image/')) {
          urlBlob = URL.createObjectURL(new Blob([bytes], { type: mime }));
          setEstado({ cargando: false, error: null, tipo: 'imagen', pdf: null, urlBlob, nombre });
        } else {
          setEstado({ cargando: false, error: null, tipo: 'otro', pdf: null, urlBlob: null, nombre });
        }
      } catch (e) {
        if (!cancelado) setEstado({ cargando: false, error: e.message, tipo: null, pdf: null, urlBlob: null, nombre: '' });
      }
    })();
    return () => {
      cancelado = true;
      // Nada de lo que falle al limpiar puede propagarse: una excepción en la
      // limpieza de un efecto durante el desmontaje tumba el árbol completo de
      // React y la aplicación queda en blanco (pasó al cerrar el visor).
      // Lo que se destruye es el «loading task» (el PDFDocumentProxy de pdf.js 6
      // no tiene destroy(); llamarlo era lo que lanzaba aquí).
      try { if (tareaPdf) tareaPdf.destroy().catch(() => {}); } catch { /* ya destruido */ }
      try { if (urlBlob) URL.revokeObjectURL(urlBlob); } catch { /* ya liberado */ }
    };
  }, [ruta, titulo]);

  // Ancho disponible para ajustar la página al contenedor.
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return undefined;
    const medir = () => setAncho(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [estado.tipo]);

  // Escape cierra; Ctrl+S / Ctrl+P se neutralizan mientras el visor está
  // abierto (disuasorio: el diálogo de imprimir mostraría la página, no el
  // documento, pero mejor no invitar). El scroll del fondo se bloquea.
  useEffect(() => {
    const teclas = (e) => {
      if (e.key === 'Escape') onCerrar();
      if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener('keydown', teclas, true);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', teclas, true);
      document.body.style.overflow = anterior;
    };
  }, [onCerrar]);

  const cambiarZoom = (paso) => setZoom((z) => {
    const i = ZOOMS.indexOf(z);
    return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + paso))];
  });

  return (
    <div className="visor-archivo fixed inset-0 z-50 flex flex-col bg-slate-900/95"
      onContextMenu={(e) => e.preventDefault()} role="dialog" aria-modal="true" aria-label={titulo || 'Archivo'}>
      <div className="flex items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-slate-100">
        <div className="min-w-0 flex-1 truncate text-sm font-medium" title={estado.nombre || titulo}>
          {titulo || estado.nombre || 'Archivo'}
          {estado.tipo === 'pdf' && estado.pdf && (
            <span className="ml-2 text-xs text-slate-400">{estado.pdf.numPages} {estado.pdf.numPages === 1 ? 'página' : 'páginas'}</span>
          )}
        </div>
        {estado.tipo === 'pdf' && (
          <div className="flex items-center gap-1 text-xs">
            <button type="button" className="rounded p-1.5 hover:bg-slate-700" title="Alejar" onClick={() => cambiarZoom(-1)}>
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" className="rounded p-1.5 hover:bg-slate-700" title="Acercar" onClick={() => cambiarZoom(1)}>
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        )}
        {rutaDescarga && !estado.cargando && !estado.error && (
          <button type="button" className="flex items-center gap-1 rounded bg-slate-700 px-2.5 py-1.5 text-xs hover:bg-slate-600"
            onClick={() => descargar(rutaDescarga)} title="Descargar el archivo">
            <Download className="h-4 w-4" /> Descargar
          </button>
        )}
        <button type="button" className="rounded p-1.5 hover:bg-slate-700" title="Cerrar (Esc)" onClick={onCerrar}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div ref={contenedor} className="flex-1 overflow-auto px-2 py-4 sm:px-6 select-none">
        {estado.cargando && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin" /> Abriendo el archivo…
          </div>
        )}
        {estado.error && (
          <div className="mx-auto mt-10 max-w-md rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
            <FileWarning className="mb-2 h-6 w-6" />
            {estado.error}
          </div>
        )}
        {estado.tipo === 'pdf' && estado.pdf && ancho > 0 && (
          <div className="mx-auto flex flex-col items-center gap-4">
            {Array.from({ length: estado.pdf.numPages }, (_, i) => (
              <PaginaPdf key={`${i + 1}-${zoom}-${ancho}`} pdf={estado.pdf} numero={i + 1}
                anchoDisponible={Math.min(ancho - 16, 1100)} zoom={zoom} marca={marca} />
            ))}
          </div>
        )}
        {estado.tipo === 'imagen' && (
          <div className="relative mx-auto w-fit">
            <img src={estado.urlBlob} alt={estado.nombre} draggable={false}
              className="max-h-[85vh] max-w-full rounded shadow-lg" />
            <MarcaAgua texto={marca} />
          </div>
        )}
        {estado.tipo === 'otro' && (
          <div className="mx-auto mt-10 max-w-md rounded-lg bg-white p-5 text-center text-sm text-slate-600 shadow">
            <FileWarning className="mx-auto mb-2 h-8 w-8 text-slate-400" />
            <p className="font-medium">{estado.nombre || 'Este archivo'}</p>
            <p className="mt-1">Este tipo de archivo no se previsualiza dentro de la herramienta.</p>
            {rutaDescarga
              ? <p className="mt-1 text-slate-500">Use «Descargar» para abrirlo con la aplicación correspondiente.</p>
              : <p className="mt-1 text-slate-500">Su descarga está restringida para este registro.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// Una página del PDF. Se pinta solo cuando entra (o está por entrar) en el
// área visible: un procedimiento de 80 páginas no debe rasterizar las 80 al
// abrir. La marca de agua se dibuja SOBRE el canvas, no como capa CSS: así va
// dentro de cualquier captura de la página.
function PaginaPdf({ pdf, numero, anchoDisponible, zoom, marca }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(numero <= 2);
  const [alto, setAlto] = useState(Math.round(anchoDisponible * zoom * 1.3));

  useEffect(() => {
    if (visible) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let tarea = null;
    let cancelado = false;
    (async () => {
      if (pdf.destroyed) return;
      const pagina = await pdf.getPage(numero);
      if (cancelado) return;
      const base = pagina.getViewport({ scale: 1 });
      const escala = (anchoDisponible * zoom) / base.width;
      const viewport = pagina.getViewport({ scale: escala });
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      setAlto(Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      tarea = pagina.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await tarea.promise;
      if (cancelado) return;
      dibujarMarca(ctx, canvas.width, canvas.height, marca, dpr);
    })().catch((e) => {
      // Una página que no se pudo pintar no tumba el visor: se deja en blanco.
      // Al cerrar, el documento se destruye con dibujos en curso y pdf.js los
      // rechaza: eso no es un error.
      if (cancelado) return;
      if (e && e.name !== 'RenderingCancelledException') console.error('[visor]', e);
    });
    return () => {
      cancelado = true;
      // React limpia el padre (destroy del documento) antes que las páginas:
      // cancelar un dibujo sobre un documento destruido puede lanzar.
      try { if (tarea) tarea.cancel(); } catch { /* documento ya destruido */ }
    };
  }, [visible, pdf, numero, anchoDisponible, zoom, marca]);

  return (
    <canvas ref={ref} className="rounded bg-white shadow-lg"
      style={{ width: Math.floor(anchoDisponible * zoom), height: alto }}
      aria-label={`Página ${numero}`} />
  );
}

function dibujarMarca(ctx, w, h, texto, dpr) {
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#0f172a';
  ctx.font = `${Math.max(11, Math.round(w / 55))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const paso = Math.round(h / 4);
  for (let y = -h; y <= h; y += paso) {
    ctx.fillText(texto, 0, y);
  }
  ctx.restore();
  // Pie discreto y legible, por si la diagonal se pierde en un fondo oscuro.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#334155';
  ctx.font = `${Math.round(10 * dpr)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(`Consulta en línea · ${texto}`, w - 8 * dpr, h - 6 * dpr);
  ctx.restore();
}

// Capa de marca de agua para imágenes (ahí no hay canvas propio).
function MarcaAgua({ texto }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-around overflow-hidden">
      {[0, 1, 2].map((i) => (
        <span key={i} className="-rotate-12 text-sm font-semibold text-slate-900/20">{texto}</span>
      ))}
    </div>
  );
}

function nombreDe(disposition) {
  if (!disposition) return '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* sigue */ } }
  const plano = /filename="?([^";]+)"?/i.exec(disposition);
  return plano ? plano[1] : '';
}

// Enlace que abre el visor. Reemplaza a `<a href="/api/…" target="_blank">`
// en todos los módulos: mismo aspecto (className), pero el archivo se abre
// dentro de la herramienta. `ruta` va SIN el prefijo /api.
export function EnlaceArchivo({ ruta, titulo, rutaDescarga, className = '', children, ...resto }) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  return (
    <>
      <button type="button" className={className} onClick={() => setAbierto(true)} {...resto}>
        {children}
      </button>
      {abierto && <VisorArchivo ruta={ruta} titulo={titulo} rutaDescarga={rutaDescarga} onCerrar={cerrar} />}
    </>
  );
}
