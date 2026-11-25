import { useEffect, useState } from 'react';
import { Plus, Upload, ExternalLink, Eye, Trash2 } from 'lucide-react';
import { api, catalogo, fechaCorta } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import { EnlaceArchivo } from '@/shared/components/VisorArchivo.jsx';

const FORM_VACIO = {
  codigoExterno: '', nombre: '', tipo: '', version: '', origen: '', url: '',
  procesoId: '', fechaImplementacion: '', notas: ''
};

export default function Externos() {
  const { usuario } = useAuth();
  const [filas, setFilas] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);

  const puedeGestionar = ['admin', 'lider'].includes(usuario?.rol);

  function cargar() {
    api('/documental/externos').then(setFilas).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
    catalogo('procesos').then(setProcesos);
  }, []);

  async function guardar(e) {
    e.preventDefault();
    try {
      const body = { ...form, procesoId: form.procesoId || null, fechaImplementacion: form.fechaImplementacion || null };
      await api('/documental/externos', { method: 'POST', body });
      setForm(FORM_VACIO);
      setCreando(false);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function subirArchivo(id, archivo) {
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      await api(`/documental/externos/${id}/archivo`, { method: 'POST', body: fd });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function inactivar(id) {
    if (!confirm('¿Inactivar este documento externo?')) return;
    try {
      await api(`/documental/externos/${id}`, { method: 'DELETE' });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Documentos Externos</h1>
          <p className="subtitulo-pagina">
            Documentos de terceros (clientes, proveedores o normativos) que impactan la operación.
          </p>
        </div>
        {puedeGestionar && (
          <button className="btn-accent" onClick={() => setCreando(!creando)}>
            <Plus className="h-4 w-4" /> Registrar externo
          </button>
        )}
      </div>
      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {creando && (
        <form onSubmit={guardar} className="card grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className="label">ID externo</label><input className="input" value={form.codigoExterno} onChange={(e) => setForm({ ...form, codigoExterno: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Nombre *</label><input required className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div><label className="label">Tipo *</label><input required className="input" placeholder="Norma, contrato…" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} /></div>
          <div><label className="label">Versión</label><input className="input" placeholder="v2, 2024, Rev. B…" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
          <div><label className="label">Origen</label><input className="input" placeholder="Proveedor, cliente…" value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} /></div>
          <div><label className="label">Fecha implementación</label><input type="date" className="input" value={form.fechaImplementacion} onChange={(e) => setForm({ ...form, fechaImplementacion: e.target.value })} /></div>
          <div>
            <label className="label">Proceso</label>
            <select className="input" value={form.procesoId} onChange={(e) => setForm({ ...form, procesoId: e.target.value })}>
              <option value="">(general)</option>
              {procesos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div><label className="label">URL</label><input className="input" placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          <div className="col-span-2 md:col-span-4"><label className="label">Notas</label><input className="input" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></div>
          <div className="col-span-2 md:col-span-4 flex gap-2">
            <button className="btn-primary">Guardar</button>
            <button type="button" className="btn-secondary" onClick={() => setCreando(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Versión</th>
              <th className="px-4 py-3">Origen</th>
              <th className="px-4 py-3">Implementación</th>
              <th className="px-4 py-3">Acceso</th>
              {puedeGestionar && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{f.codigoExterno || '—'}</td>
                <td className="px-4 py-3 font-medium">{f.nombre}<div className="text-xs font-normal text-slate-400">{f.notas}</div></td>
                <td className="px-4 py-3 text-xs">{f.tipo}</td>
                <td className="px-4 py-3 text-xs">{f.version || '—'}</td>
                <td className="px-4 py-3 text-xs">{f.origen || '—'}</td>
                <td className="px-4 py-3 text-xs">{f.fechaImplementacion ? fechaCorta(f.fechaImplementacion) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {f.url && <a className="btn-secondary !px-2 !py-1" href={f.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}
                    {f.archivo && (
                      <EnlaceArchivo className="btn-secondary !px-2 !py-1" title="Ver archivo"
                        ruta={`/documental/externos/${f.id}/archivo`} titulo={f.nombre}>
                        <Eye className="h-4 w-4" />
                      </EnlaceArchivo>
                    )}
                    {puedeGestionar && (
                      <label className="btn-secondary !px-2 !py-1 cursor-pointer" title="Subir archivo">
                        <Upload className="h-4 w-4" />
                        <input type="file" className="hidden" onChange={(e) => e.target.files[0] && subirArchivo(f.id, e.target.files[0])} />
                      </label>
                    )}
                  </div>
                </td>
                {puedeGestionar && (
                  <td className="px-4 py-3">
                    <button className="text-rose-500 hover:text-rose-700" title="Inactivar" onClick={() => inactivar(f.id)}><Trash2 className="h-4 w-4" /></button>
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-400">Sin documentos externos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
