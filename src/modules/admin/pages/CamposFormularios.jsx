import { useEffect, useMemo, useState } from 'react';
import {
  SlidersHorizontal, Plus, Trash2, Save, RotateCcw, Lock, GripVertical,
  Loader2, AlertTriangle, Construction, Info
} from 'lucide-react';
import { api } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import {
  PanelConNavegacion, ItemNav, Plegable, Linea, iconoDeModulo
} from '../components/NavegacionConfig.jsx';

// PANEL DEL ADMINISTRADOR: qué se registra en el formulario de cada módulo.
//
// Era "Campos del documento" y solo servía al módulo documental, con el
// formulario cableado en la URL. Ahora hay un formulario POR MÓDULO —el motor los
// declara en core/formularios/definicion.js— y esta pantalla se agrupa igual que
// Catálogos y parámetros: primero se elige el módulo, después se configura su
// formulario. Los módulos que todavía no tienen formulario aparecen igual, para
// que se vea el hueco en lugar de descubrirlo cuando el módulo ya está en
// producción y hay registros creados sin parametrizar.
//
// Los campos de sistema mueven lógica de negocio (código documental, aislamiento
// por sedes, ciclo de vida, por dónde arranca el flujo de una acción), así que no
// se pueden eliminar ni cambiar de tipo: solo se les ajusta la etiqueta, la ayuda,
// el orden y si son columna del listado. Los campos personalizados se crean aquí
// sin tocar código.
export default function CamposFormularios() {
  const { usuario } = useAuth();
  const [meta, setMeta] = useState(null);
  const [formularioId, setFormularioId] = useState(null);
  const [definicion, setDefinicion] = useState(null);
  const [ajustes, setAjustes] = useState({});
  const [personalizados, setPersonalizados] = useState([]);
  const [errores, setErrores] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api('/formularios/metadatos')
      .then((m) => {
        setMeta(m);
        setFormularioId((actual) => actual ?? m.formularios[0]?.id ?? null);
      })
      .catch((e) => setErrores([e.message]));
  }, []);

  // La definición se recarga al cambiar de formulario. `formularioId` en las
  // dependencias es lo que hace que cambiar de módulo no arrastre los ajustes
  // pendientes del anterior.
  function cargar(id = formularioId) {
    if (!id) return;
    api(`/formularios/${id}`)
      .then((d) => {
        setDefinicion(d);
        setAjustes({});
        setPersonalizados(d.campos.filter((c) => !c.sistema));
        setErrores([]);
        setMensaje(null);
      })
      .catch((e) => setErrores([e.message]));
  }

  useEffect(() => { cargar(formularioId); }, [formularioId]);

  const sistema = useMemo(
    () => (definicion ? definicion.campos.filter((c) => c.sistema) : []),
    [definicion]
  );

  // Un módulo por cada formulario, más los que todavía no tienen ninguno.
  const modulos = useMemo(() => {
    if (!meta) return [];
    return meta.modulos
      .filter((m) => m.id !== 'global')
      .map((m) => ({ ...m, formulario: meta.formularios.find((f) => f.modulo === m.id) || null }));
  }, [meta]);

  const [moduloSinFormulario, setModuloSinFormulario] = useState(null);
  const [verPendientes, setVerPendientes] = useState(false);

  // Valor efectivo de un campo de sistema: el ajuste pendiente o el vigente.
  const valor = (campo, clave) => {
    const a = ajustes[campo.clave];
    return a && a[clave] !== undefined ? a[clave] : campo[clave];
  };

  const ajustar = (clave, prop, v) =>
    setAjustes((p) => ({ ...p, [clave]: { ...(p[clave] || {}), [prop]: v } }));

  const sucio = Object.keys(ajustes).length > 0 ||
    JSON.stringify(personalizados) !== JSON.stringify(definicion?.campos.filter((c) => !c.sistema) || []);

  async function guardar() {
    setGuardando(true);
    setErrores([]);
    setMensaje(null);
    try {
      const cuerpo = {
        ajustes: Object.entries(ajustes).map(([clave, a]) => ({ clave, ...a })),
        personalizados
      };
      const d = await api(`/formularios/${formularioId}`, { method: 'PUT', body: cuerpo });
      setDefinicion(d);
      setAjustes({});
      setPersonalizados(d.campos.filter((c) => !c.sistema));
      setMensaje(`Guardado. El formulario de ${d.nombre.toLowerCase()} ya usa esta definición.`);
    } catch (e) {
      setErrores([e.message]);
    } finally {
      setGuardando(false);
    }
  }

  async function restablecer() {
    if (!confirm('¿Restablecer el formulario a su definición de fábrica? Se perderán los campos personalizados.')) return;
    try {
      await api(`/formularios/${formularioId}/restablecer`, { method: 'POST' });
      cargar();
      setMensaje('Formulario restablecido.');
    } catch (e) {
      setErrores([e.message]);
    }
  }

  // La definición se puede LEER sin permisos (cada formulario la necesita para
  // pintarse), pero editarla exige el acceso de configuración.
  if (!usuario?.permisos?.['sgc.configuracion']) {
    return <div className="card max-w-xl border-rose-200 bg-rose-50 text-sm text-rose-600">
      Esta sección requiere el acceso de configuración. Solicítelo a un administrador de la plataforma.
    </div>;
  }

  if (!meta) {
    return errores.length > 0
      ? <div className="card max-w-xl border-rose-200 bg-rose-50 text-sm text-rose-600">{errores[0]}</div>
      : <div className="flex justify-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const pendiente = moduloSinFormulario
    ? modulos.find((m) => m.id === moduloSinFormulario)
    : null;

  // Navegación: un módulo por formulario, y los que aún no tienen, plegados al
  // final. Misma estructura que Catálogos y parámetros a propósito: es la misma
  // tarea (elegir un módulo y configurarlo) y verse distinto obligaba a aprenderla
  // dos veces.
  const conFormulario = modulos.filter((m) => m.formulario);
  const sinFormulario = modulos.filter((m) => !m.formulario);

  const navegacion = (
    <>
      <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wide text-slate-400">Módulo</p>
      {conFormulario.map((m) => {
        const Icono = iconoDeModulo(m.id);
        return (
          <ItemNav key={m.id} texto={m.nombre}
            activo={m.formulario.id === formularioId && !moduloSinFormulario}
            sufijo={Icono ? <Icono className="h-3.5 w-3.5 shrink-0 opacity-40" /> : null}
            onClick={() => { setModuloSinFormulario(null); setFormularioId(m.formulario.id); }} />
        );
      })}

      <div className="mt-2 border-t border-slate-200 pt-2">
        <Plegable texto={`Sin formulario todavía (${sinFormulario.length})`} sangria
          abierto={verPendientes || !!moduloSinFormulario}
          onAlternar={() => setVerPendientes((v) => !v)}>
          {sinFormulario.map((m) => (
            <ItemNav key={m.id} texto={m.nombre} activo={moduloSinFormulario === m.id}
              onClick={() => setModuloSinFormulario(m.id)} />
          ))}
        </Plegable>
      </div>
    </>
  );

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6" /> Campos de los formularios
          </h1>
          <p className="subtitulo-pagina">
            Define qué se registra en cada módulo, sin depender de desarrollo.
          </p>
        </div>
        {!pendiente && definicion && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={restablecer}>
              <RotateCcw className="h-4 w-4" /> Restablecer
            </button>
            <button className="btn-accent" disabled={guardando || !sucio} onClick={guardar}>
              <Save className="h-4 w-4" /> {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </div>

      <PanelConNavegacion navegacion={navegacion}>

      {errores.length > 0 && (
        <div className="card border-rose-200 bg-rose-50 text-sm text-rose-700">
          <ul className="list-inside list-disc space-y-1">{errores.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {mensaje && <div className="card border-emerald-200 bg-emerald-50 text-sm text-emerald-700">{mensaje}</div>}

      {/* Módulo sin formulario todavía: se muestra el hueco, no se esconde. */}
      {pendiente && (
        <div className="card space-y-2 border-amber-200 bg-amber-50/60 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <Construction className="h-4 w-4" /> {pendiente.nombre}: formulario por desarrollar
          </div>
          <p className="text-xs leading-relaxed">{pendiente.descripcion}</p>
          <p className="text-xs leading-relaxed">
            Cuando el módulo se desarrolle, su formulario se declara en el motor
            (<span className="font-mono">core/formularios/definicion.js</span>) y aparece aquí con sus
            campos de sistema, listo para agregarle campos propios. Los catálogos globales que ya
            hereda sí se pueden administrar desde ahora, en Catálogos y parámetros.
          </p>
        </div>
      )}

      {!pendiente && !definicion && (
        <div className="flex justify-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      )}

      {!pendiente && definicion && (
        <>
          {/* Encabezado ligero, no una tarjeta: lo que interesa es llegar a los
              campos, y el contexto cabe en dos renglones. */}
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
              {(() => { const I = iconoDeModulo(definicion.modulo); return I ? <I className="h-5 w-5 text-primary" /> : null; })()}
              {definicion.nombre}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {definicion.descripcion}
              {definicion.actualizadoPor && (
                <span className="text-slate-400"> · Última modificación: {definicion.actualizadoPor}</span>
              )}
            </p>
          </div>

          {/* Campos de sistema, por sección */}
          {definicion.secciones.map((seccion) => {
            const campos = sistema.filter((c) => c.seccion === seccion.id);
            if (!campos.length) return null;
            return (
              <div key={seccion.id} className="card">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-700">{seccion.nombre}</span>
                  <span className="badge bg-slate-100 text-slate-500">{campos.length} campos de sistema</span>
                </div>

                <div className="space-y-2">
                  {campos.map((c) => (
                    <div key={c.clave} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <GripVertical className="mt-2 h-4 w-4 shrink-0 text-slate-300" />
                        <div className="min-w-56 flex-1">
                          <label className="label">Etiqueta</label>
                          <input className="input" value={valor(c, 'etiqueta')}
                            onChange={(e) => ajustar(c.clave, 'etiqueta', e.target.value)} />
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="font-mono">{c.clave}</span>
                            <span>·</span>
                            <span>{meta.nombresTipo?.[c.tipo] || (meta.tipos.find((t) => t.id === c.tipo) || {}).nombre || c.tipo}</span>
                            {c.catalogo && <span>· {c.catalogo}</span>}
                            {c.bloqueado && (
                              <span className="inline-flex items-center gap-1 text-amber-600">
                                <Lock className="h-3 w-3" /> indispensable
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="w-20">
                          <label className="label">Orden</label>
                          <input type="number" className="input" value={valor(c, 'orden') ?? 0}
                            onChange={(e) => ajustar(c.clave, 'orden', Number(e.target.value))} />
                        </div>

                        <div className="min-w-56 flex-1">
                          <label className="label">Texto de ayuda</label>
                          <input className="input" placeholder="Se muestra bajo el campo"
                            value={valor(c, 'ayuda') || ''}
                            onChange={(e) => ajustar(c.clave, 'ayuda', e.target.value)} />
                        </div>

                        <div className="flex flex-col gap-1.5 pt-5 text-xs">
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={!!valor(c, 'enListado')}
                              onChange={(e) => ajustar(c.clave, 'enListado', e.target.checked)} />
                            Columna del listado
                          </label>
                          <label className={`flex items-center gap-1.5 ${c.bloqueado ? 'opacity-40' : ''}`}>
                            <input type="checkbox" disabled={c.bloqueado} checked={!!valor(c, 'requerido')}
                              onChange={(e) => ajustar(c.clave, 'requerido', e.target.checked)} />
                            Obligatorio
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <CamposPersonalizados meta={meta} secciones={definicion.secciones}
            campos={personalizados} onChange={setPersonalizados} />

          {definicion.nota && (
            <Linea tono="info" icono={Info}>
              <strong>Por qué algunos campos están bloqueados:</strong> {definicion.nota}
            </Linea>
          )}
        </>
      )}
      </PanelConNavegacion>
    </div>
  );
}

const CAMPO_NUEVO = {
  clave: '', etiqueta: '', tipo: 'texto', seccion: 'adicional', orden: 100,
  requerido: false, activo: true, ayuda: '', enListado: false, opciones: [], catalogo: null
};

function CamposPersonalizados({ meta, secciones, campos, onChange }) {
  const [nuevo, setNuevo] = useState(null);

  function agregar() {
    // La clave se sugiere a partir de la etiqueta, en minúsculas sin espacios.
    const clave = nuevo.clave || nuevo.etiqueta
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, '').split(' ')
      .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
    onChange([...campos, { ...nuevo, clave }]);
    setNuevo(null);
  }

  const requiereOpciones = (t) => ['seleccion', 'seleccionMultiple'].includes(t);
  const requiereCatalogo = (t) => ['catalogo', 'catalogoMultiple'].includes(t);

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-bold text-slate-700">Campos personalizados</span>
          <p className="text-xs text-slate-500">
            Se guardan aparte y aparecen al final del formulario. Puede crearlos y quitarlos libremente.
          </p>
        </div>
        {!nuevo && (
          <button className="btn-secondary" onClick={() => setNuevo({ ...CAMPO_NUEVO })}>
            <Plus className="h-4 w-4" /> Nuevo campo
          </button>
        )}
      </div>

      {nuevo && (
        <div className="mb-4 rounded-lg border-2 border-dashed border-accent/40 bg-accent-soft/40 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="label">Etiqueta *</label>
              <input className="input" value={nuevo.etiqueta}
                onChange={(e) => setNuevo({ ...nuevo, etiqueta: e.target.value })} />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select className="input" value={nuevo.tipo}
                onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value, opciones: [], catalogo: null })}>
                {meta.tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Sección</label>
              <select className="input" value={nuevo.seccion}
                onChange={(e) => setNuevo({ ...nuevo, seccion: e.target.value })}>
                {secciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>

            {requiereCatalogo(nuevo.tipo) && (
              <div>
                <label className="label">Catálogo *</label>
                <select className="input" value={nuevo.catalogo || ''}
                  onChange={(e) => setNuevo({ ...nuevo, catalogo: e.target.value })}>
                  <option value="">Seleccione…</option>
                  {meta.catalogos.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {requiereOpciones(nuevo.tipo) && (
              <div className="md:col-span-2">
                <label className="label">Opciones * (una por línea)</label>
                <textarea className="input" rows={3} placeholder={'Alta\nMedia\nBaja'}
                  value={(nuevo.opciones || []).map((o) => o.etiqueta).join('\n')}
                  onChange={(e) => setNuevo({
                    ...nuevo,
                    opciones: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean)
                      .map((l) => ({ valor: l.toLowerCase().replace(/\s+/g, '-'), etiqueta: l }))
                  })} />
              </div>
            )}

            <div className="md:col-span-2">
              <label className="label">Texto de ayuda</label>
              <input className="input" value={nuevo.ayuda}
                onChange={(e) => setNuevo({ ...nuevo, ayuda: e.target.value })} />
            </div>

            <div className="flex items-end gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={nuevo.requerido}
                  onChange={(e) => setNuevo({ ...nuevo, requerido: e.target.checked })} />
                Obligatorio
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={nuevo.enListado}
                  onChange={(e) => setNuevo({ ...nuevo, enListado: e.target.checked })} />
                Columna del listado
              </label>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button className="btn-primary"
              disabled={!nuevo.etiqueta.trim() ||
                (requiereCatalogo(nuevo.tipo) && !nuevo.catalogo) ||
                (requiereOpciones(nuevo.tipo) && (nuevo.opciones || []).length < 2)}
              onClick={agregar}>
              Añadir campo
            </button>
            <button className="btn-secondary" onClick={() => setNuevo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {campos.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          Todavía no hay campos personalizados. El formulario usa solo los de sistema.
        </p>
      ) : (
        <div className="space-y-2">
          {campos.map((c, i) => (
            <div key={c.clave} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
              <div className="min-w-48 flex-1">
                <div className="text-sm font-semibold">{c.etiqueta}</div>
                <div className="text-[11px] text-slate-400">
                  <span className="font-mono">{c.clave}</span> ·{' '}
                  {meta.nombresTipo?.[c.tipo] || (meta.tipos.find((t) => t.id === c.tipo) || {}).nombre || c.tipo}
                  {c.catalogo ? ` · ${c.catalogo}` : ''}
                  {c.requerido ? ' · obligatorio' : ''}
                  {c.enListado ? ' · en el listado' : ''}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={c.activo !== false}
                  onChange={(e) => {
                    const copia = [...campos];
                    copia[i] = { ...c, activo: e.target.checked };
                    onChange(copia);
                  }} />
                Activo
              </label>
              <button className="text-rose-500 hover:text-rose-700"
                onClick={() => onChange(campos.filter((x) => x.clave !== c.clave))}
                title="Quitar campo">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Quitar un campo no borra lo que ya se registró: deja de pedirse y de mostrarse.
            Si solo quiere ocultarlo, desmárquelo como activo.
          </div>
        </div>
      )}
    </div>
  );
}
