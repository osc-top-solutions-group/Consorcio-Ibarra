import { useEffect, useState } from 'react';
import { Plus, Paperclip, CheckCircle2, XCircle } from 'lucide-react';
import { api, catalogo, fechaCorta } from '@/shared/api';
import SelectorEmpleados from '@/shared/components/SelectorEmpleados.jsx';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import { EnlaceArchivo } from '@/shared/components/VisorArchivo.jsx';

const TIPOS = { creacion: 'Creación', modificacion: 'Modificación', eliminacion: 'Eliminación' };
const ESTADOS_SOL = {
  abierta: 'bg-amber-100 text-amber-700',
  atendida: 'bg-emerald-100 text-emerald-700',
  rechazada: 'bg-rose-100 text-rose-700'
};

const INICIAL = { tipo: 'creacion', nombreDocumento: '', procesoId: '', descripcion: '', responsable: '' };

export default function Solicitudes() {
  const { usuario } = useAuth();
  const [filas, setFilas] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState(INICIAL);
  const [adjunto, setAdjunto] = useState(null);
  const [enviando, setEnviando] = useState(false);

  function cargar() {
    api('/documental/solicitudes').then(setFilas).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
    catalogo('procesos').then(setProcesos).catch(() => {});
  }, []);

  const nombreProceso = (id) => (procesos.find((p) => p.id === id) || {}).nombre || id || '—';

  async function guardar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const s = await api('/documental/solicitudes', { method: 'POST', body: form });
      if (adjunto) {
        const fd = new FormData();
        fd.append('archivo', adjunto);
        await api(`/documental/solicitudes/${s.id}/adjunto`, { method: 'POST', body: fd });
      }
      setForm(INICIAL);
      setAdjunto(null);
      setCreando(false);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  async function responder(id, decision) {
    const respuesta = prompt(`Comentario para ${decision === 'atendida' ? 'atender' : 'rechazar'} la solicitud:`) || '';
    try {
      await api(`/documental/solicitudes/${id}/responder`, { method: 'POST', body: { decision, respuesta } });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="titulo-pagina">Solicitudes documentales</h1>
          <p className="subtitulo-pagina">Pida la creación, modificación o eliminación de documentos.</p>
        </div>
        <button className="btn-accent" onClick={() => setCreando(!creando)}>
          <Plus className="h-4 w-4" /> Nueva solicitud
        </button>
      </div>
      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {creando && (
        <form onSubmit={guardar} className="card space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Tipo *</label>
              <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Proceso al que pertenece *</label>
              <select required className="input" value={form.procesoId}
                onChange={(e) => setForm({ ...form, procesoId: e.target.value })}>
                <option value="">Seleccione…</option>
                {procesos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Nombre del documento solicitado *</label>
              <input required minLength={3} className="input" value={form.nombreDocumento}
                placeholder="Cómo se llama (o se llamaría) el documento"
                onChange={(e) => setForm({ ...form, nombreDocumento: e.target.value })} />
            </div>
          </div>

          <div>
            {/* Se busca en el directorio de Talento Humano por nombre: nadie tiene
                que conocer el correo de quien debe atender la solicitud. */}
            <label className="label">Responsable de atenderla *</label>
            <SelectorEmpleados
              seleccion={form.responsable ? [form.responsable] : []}
              placeholder="Buscar colaborador por nombre…"
              onChange={(lista) => setForm({ ...form, responsable: lista[lista.length - 1] || '' })} />
          </div>

          <div>
            <label className="label">Descripción / justificación *</label>
            <textarea required minLength={5} className="input" rows={3}
              placeholder="Qué necesita y por qué…" value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>
          <div>
            <label className="label">Borrador adjunto (opcional)</label>
            <input type="file" className="input" onChange={(e) => setAdjunto(e.target.files[0] || null)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={enviando || !form.responsable}>
              {enviando ? 'Enviando…' : 'Enviar solicitud'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setCreando(false)}>Cancelar</button>
          </div>
          {!form.responsable && (
            <p className="ayuda">Indique quién debe atender la solicitud para poder enviarla.</p>
          )}
        </form>
      )}

      <div className="space-y-3">
        {filas.map((s) => (
          <div key={s.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ESTADOS_SOL[s.estado]}`}>{s.estado}</span>
                <span className="text-sm font-semibold">{TIPOS[s.tipo]}: {s.nombreDocumento || 'documento'}</span>
                <span className="text-xs text-slate-500">· {s.solicitante} · {fechaCorta(s.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                {s.adjunto && (
                  <EnlaceArchivo className="btn-secondary !px-2 !py-1"
                    ruta={`/documental/solicitudes/${s.id}/adjunto`} titulo={s.adjunto.nombre}>
                    <Paperclip className="h-4 w-4" /> {s.adjunto.nombre}
                  </EnlaceArchivo>
                )}
                {s.estado === 'abierta' && (s.responsable === usuario.correo || usuario.rol === 'admin') && (
                  <>
                    <button className="btn-primary !px-3 !py-1.5" onClick={() => responder(s.id, 'atendida')}><CheckCircle2 className="h-4 w-4" /> Atender</button>
                    <button className="btn-secondary !px-3 !py-1.5 !text-rose-600" onClick={() => responder(s.id, 'rechazada')}><XCircle className="h-4 w-4" /> Rechazar</button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-2 text-sm text-slate-600">{s.descripcion}</p>
            <div className="mt-1 text-xs text-slate-500">
              Proceso: {nombreProceso(s.procesoId)} · Responsable: {s.responsable}
            </div>
            {s.respuesta && <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600"><b>Respuesta ({s.atendidaPor}):</b> {s.respuesta}</div>}
          </div>
        ))}
        {filas.length === 0 && <div className="card py-8 text-center text-slate-400">Sin solicitudes.</div>}
      </div>
    </div>
  );
}
