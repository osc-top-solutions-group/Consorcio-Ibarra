import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, X, FileDown, ShieldCheck } from 'lucide-react';
import { api, catalogo, ALCANCES, CONFIDENCIALIDAD } from '@/shared/api';
import CampoDinamico, { Etiquetas } from '@/shared/components/CampoDinamico.jsx';
import PermisosAcceso, { ListaAccesoConfidencial } from '../components/PermisosAcceso.jsx';

const INICIAL = {
  nombre: '', tipoId: '', procesoId: '', subprocesoId: '', alcance: 'global', sedes: [],
  normas: [], palabrasClave: [], confidencialidad: 'interno', accesoConfidencial: [],
  // Audiencia del documento: vacías = todos los del alcance (ver PermisosAcceso).
  audienciaVisualizacion: [], audienciaDescarga: [],
  // permitirImpresion: false → el documento nace de consulta en línea; la
  // descarga se habilita a propósito en «Permisos de acceso» (política 2026-09-16).
  permitirDescargaOriginal: false, permitirImpresion: false, mesesRevision: 12, descripcion: '',
  // Campos personalizados que el administrador definió en Configuración.
  datos: {}
};

export default function DocumentoNuevo() {
  const navigate = useNavigate();
  const [cat, setCat] = useState({ procesos: [], tipos: [], sedes: [], normas: [], plantillas: [] });
  const [form, setForm] = useState(INICIAL);
  const [codigo, setCodigo] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Modo elegido en el bloque de permisos ("todos" / "restringida" / "nadie").
  // Vive aquí porque se elige antes de agregar a nadie a la lista.
  const [modos, setModos] = useState({ visualizacion: 'todos' });

  const [personalizados, setPersonalizados] = useState([]);

  useEffect(() => {
    Promise.all([
      catalogo('procesos'), catalogo('tipos_documento'), catalogo('sedes'),
      catalogo('normas'), catalogo('plantillas')
    ])
      .then(([procesos, tipos, sedes, normas, plantillas]) => setCat({ procesos, tipos, sedes, normas, plantillas }))
      .catch((e) => setError(e.message));

    // Campos definidos por el administrador: el formulario los pinta solo.
    api('/formularios/documento')
      .then((d) => setPersonalizados(d.campos.filter((c) => !c.sistema && c.activo)))
      .catch(() => {});
  }, []);

  const proceso = useMemo(() => cat.procesos.find((p) => p.id === form.procesoId), [cat.procesos, form.procesoId]);
  const tipo = useMemo(() => cat.tipos.find((t) => t.id === form.tipoId), [cat.tipos, form.tipoId]);
  const plantilla = useMemo(() => cat.plantillas.find((p) => p.tipoId === form.tipoId && p.archivo), [cat.plantillas, form.tipoId]);

  // Vista previa del código: el consecutivo real se asigna al guardar.
  useEffect(() => {
    if (!form.procesoId || !form.tipoId) return setCodigo(null);
    if (form.alcance === 'especifico' && form.sedes.length !== 1) return setCodigo(null);
    let vigente = true;
    api('/documental/previsualizar-codigo', {
      method: 'POST',
      body: {
        procesoId: form.procesoId, subprocesoId: form.subprocesoId || null,
        tipoId: form.tipoId, alcance: form.alcance, sedes: form.sedes
      }
    })
      .then((r) => { if (vigente) setCodigo(r.codigo); })
      .catch(() => { if (vigente) setCodigo(null); });
    return () => { vigente = false; };
  }, [form.procesoId, form.subprocesoId, form.tipoId, form.alcance, form.sedes]);

  function set(clave, valor) {
    setForm((f) => ({ ...f, [clave]: valor }));
  }

  function alternar(clave, valor) {
    setForm((f) => ({
      ...f,
      [clave]: f[clave].includes(valor) ? f[clave].filter((v) => v !== valor) : [...f[clave], valor]
    }));
  }

  // El alcance manda sobre las sedes: global no lleva ninguna, específico solo una.
  function cambiarAlcance(alcance) {
    setForm((f) => ({
      ...f,
      alcance,
      sedes: alcance === 'global' ? [] : alcance === 'especifico' ? f.sedes.slice(0, 1) : f.sedes
    }));
  }

  function elegirSede(sedeId) {
    if (form.alcance === 'especifico') {
      set('sedes', form.sedes.includes(sedeId) ? [] : [sedeId]);
    } else {
      alternar('sedes', sedeId);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const doc = await api('/documental/documentos', {
        method: 'POST',
        body: { ...form, subprocesoId: form.subprocesoId || null, mesesRevision: Number(form.mesesRevision) }
      });
      navigate(`/documental/documentos/${doc.id}`);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="max-w-4xl space-y-4">
      <div>
        <h1 className="titulo-pagina">Nuevo documento</h1>
        <p className="subtitulo-pagina">
          El código se genera solo, a partir del proceso, el tipo y el alcance del documento.
        </p>
      </div>

      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {/* Vista previa del código */}
      <div className="card flex flex-wrap items-center gap-4 border-primary/20 bg-primary-soft">
        <Hash className="h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Código asignado</div>
          <div className="font-mono text-lg font-bold text-primary">
            {codigo || 'Complete proceso, tipo y alcance…'}
          </div>
        </div>
        {plantilla && (
          <a className="btn-secondary shrink-0" href={`/api/config/plantillas/${plantilla.id}/archivo`}>
            <FileDown className="h-4 w-4" /> Descargar plantilla de {tipo?.nombre}
          </a>
        )}
      </div>

      {/* Identificación */}
      <div className="card grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label">Nombre del documento *</label>
          <input className="input" required minLength={3} value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
        </div>

        <div>
          <label className="label">Proceso *</label>
          <select className="input" required value={form.procesoId}
            onChange={(e) => { set('procesoId', e.target.value); set('subprocesoId', ''); }}>
            <option value="">Seleccione…</option>
            {cat.procesos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Subproceso</label>
          <select className="input" value={form.subprocesoId} onChange={(e) => set('subprocesoId', e.target.value)}
            disabled={!proceso || !(proceso.subprocesos || []).length}>
            <option value="">(ninguno)</option>
            {(proceso?.subprocesos || []).map((s) => <option key={s.id} value={s.id}>{s.codigo} — {s.nombre}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Tipo de documento *</label>
          <select className="input" required value={form.tipoId} onChange={(e) => set('tipoId', e.target.value)}>
            <option value="">Seleccione…</option>
            {cat.tipos.map((t) => <option key={t.id} value={t.id}>{t.codigo} — {t.nombre}</option>)}
          </select>
          {tipo?.permiteOriginal && (
            <p className="ayuda">Los {tipo.nombre.toLowerCase()}s permiten descargar el archivo editable.</p>
          )}
        </div>

        <div>
          <label className="label">Meses para la próxima revisión</label>
          <input className="input" type="number" min="1" max="60" value={form.mesesRevision}
            onChange={(e) => set('mesesRevision', e.target.value)} />
        </div>

        <div className="md:col-span-2">
          <label className="label">Objetivo / descripción</label>
          <textarea className="input" rows={3} value={form.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
        </div>
      </div>

      {/* Alcance y sedes */}
      <div className="card space-y-4">
        <div>
          <label className="label">Alcance *</label>
          <div className="grid gap-2 md:grid-cols-3">
            {Object.entries(ALCANCES).map(([valor, { texto, ayuda }]) => (
              <button type="button" key={valor} onClick={() => cambiarAlcance(valor)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  form.alcance === valor ? 'border-primary bg-primary-soft' : 'border-slate-200 hover:border-slate-300'
                }`}>
                <div className={`text-sm font-semibold ${form.alcance === valor ? 'text-primary' : 'text-slate-700'}`}>
                  {texto}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500">{ayuda}</div>
              </button>
            ))}
          </div>
        </div>

        {form.alcance !== 'global' && (
          <div>
            <label className="label">
              {form.alcance === 'especifico' ? 'Sede propietaria * (una sola)' : 'Sedes a las que aplica *'}
            </label>
            <div className="flex flex-wrap gap-2">
              {cat.sedes.map((s) => (
                <button type="button" key={s.id} onClick={() => elegirSede(s.id)}
                  className={`chip ${form.sedes.includes(s.id) ? 'chip-activo' : ''}`}>
                  {s.codigo} · {s.nombre}
                </button>
              ))}
            </div>
            {form.alcance === 'especifico' && (
              <p className="ayuda">
                Solo los usuarios de esta sede verán el documento. El código terminará con su sigla.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Clasificación */}
      <div className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Confidencialidad (ISO 27001)</label>
            <select className="input" value={form.confidencialidad} onChange={(e) => set('confidencialidad', e.target.value)}>
              {Object.entries(CONFIDENCIALIDAD).map(([v, { texto }]) => <option key={v} value={v}>{texto}</option>)}
            </select>
            {form.confidencialidad === 'confidencial' && (
              <ListaAccesoConfidencial valor={form} onChange={setForm} />
            )}
          </div>

          <div>
            <label className="label">Normas que impacta</label>
            <div className="flex flex-wrap gap-2">
              {cat.normas.map((n) => (
                <button type="button" key={n.id} onClick={() => alternar('normas', n.nombre)}
                  className={`chip ${form.normas.includes(n.nombre) ? 'chip-activo' : ''}`}>
                  {n.nombre}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Etiquetas valores={form.palabrasClave} onChange={(v) => set('palabrasClave', v)}
          etiqueta="Palabras clave"
          ayuda="Se usan para encontrar el documento en el listado maestro." />

        <div className="border-t border-slate-100 pt-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.permitirDescargaOriginal}
              onChange={(e) => set('permitirDescargaOriginal', e.target.checked)} />
            <span>
              Permitir descarga del archivo original editable
              <span className="block text-xs text-slate-400">
                Los tipos "formato" ya lo permiten siempre. El resto solo se publica en PDF.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Permisos de acceso: a quién se publica el documento */}
      <div className="card space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <ShieldCheck className="h-4 w-4 text-primary" /> Permisos de acceso
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Por defecto lo ve y lo descarga cualquiera que alcance el documento por su alcance
            y su confidencialidad. Aquí se acota, por usuarios, cargos, áreas, grupos o sedes.
            Al quedar vigente, se avisa a quienes se configuren aquí.
          </p>
        </div>
        <PermisosAcceso
          valor={form}
          onChange={(cambios) => setForm((f) => ({ ...f, ...cambios }))}
          modos={modos}
          setModos={setModos} />
      </div>

      {personalizados.length > 0 && (
        <div className="card space-y-4">
          <div className="text-sm font-bold text-slate-700">Información adicional</div>
          <div className="grid gap-4 md:grid-cols-2">
            {personalizados.map((campo) => (
              <CampoDinamico key={campo.clave} campo={campo}
                catalogosPrecargados={{
                  procesos: cat.procesos, tipos_documento: cat.tipos,
                  sedes: cat.sedes, normas: cat.normas
                }}
                valor={form.datos[campo.clave]}
                onChange={(v) => set('datos', { ...form.datos, [campo.clave]: v })} />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn-accent" disabled={guardando}>{guardando ? 'Creando…' : 'Crear documento'}</button>
        <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
      <p className="text-xs text-slate-400">
        Al crear el documento queda en <strong>borrador</strong>. El siguiente paso es cargar el archivo
        original y el PDF, y enviarlo a revisión o aprobación.
      </p>
    </form>
  );
}
