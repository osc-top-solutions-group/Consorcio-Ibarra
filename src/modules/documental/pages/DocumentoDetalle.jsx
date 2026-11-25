import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FileText, Download, Upload, Send, CheckCircle2, XCircle, GitBranch, Archive, Eye,
  AlertTriangle, Clock, Lock, Printer, History, Hash, ShieldCheck, Info,
  CornerUpLeft, BellRing, UserPlus, UserX, Reply, Pencil, Play, ArrowLeft
} from 'lucide-react';
import {
  api, catalogo, ESTADOS, CONFIDENCIALIDAD, ALCANCES, TIPOS_ASIGNACION, fechaCorta, textoDias
} from '@/shared/api';
import SelectorAudiencia, { useCatalogosAudiencia, ResumenAudiencia } from '../components/SelectorAudiencia.jsx';
import PermisosAcceso, { modoVisualizacionDe } from '../components/PermisosAcceso.jsx';
import PermisosExcepcionales, { AvisoMiPermiso } from '../components/PermisosExcepcionales.jsx';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import { EnlaceArchivo } from '@/shared/components/VisorArchivo.jsx';

export default function DocumentoDetalle() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [doc, setDoc] = useState(null);
  const [propios, setPropios] = useState({ procesos: [], tipos: [] });
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  // Grupos, sedes, cargos y áreas los comparte el selector de audiencia: los usan
  // igual el flujo de aprobación y los permisos de acceso.
  const audiencia = useCatalogosAudiencia();
  const cat = { ...audiencia, ...propios };

  const cargar = useCallback(() => {
    api(`/documental/documentos/${id}`).then(setDoc).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    cargar();
    Promise.all([catalogo('procesos'), catalogo('tipos_documento')])
      .then(([procesos, tipos]) => setPropios({ procesos, tipos }))
      .catch(() => {});
  }, [cargar]);

  const proceso = useMemo(() => cat.procesos.find((p) => p.id === doc?.procesoId), [cat.procesos, doc]);
  const tipo = useMemo(() => cat.tipos.find((t) => t.id === doc?.tipoId), [cat.tipos, doc]);

  if (error && !doc) return <div className="card max-w-3xl border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>;
  if (!doc) return <div className="text-slate-400">Cargando…</div>;

  // Para quien no ve el ciclo completo, el backend entrega SOLO la versión
  // vigente: aquí no hay que volver a filtrar nada, pero tampoco se puede dar por
  // hecho que la última versión del arreglo sea la que está en curso.
  const ultima = doc.versiones[doc.versiones.length - 1] || null;
  const etapa = ultima?.estado === 'en_revision' ? 'revisores' : ultima?.estado === 'en_aprobacion' ? 'aprobadores' : null;
  const miDecision = etapa && ultima.flujo[etapa].find((p) => p.correo === usuario.correo && p.estado === 'pendiente');
  const nombreSede = (sedeId) => (cat.sedes.find((s) => s.id === sedeId) || {}).nombre || sedeId;
  // El equipo elaborador (autor + co-elaboradores) trabaja la versión en curso
  // y le da seguimiento aunque no sea gestor formal del proceso; `elaborar`
  // viene del backend, que aplica la misma regla en cada endpoint.
  const puedeSeguimiento = doc.permisos.elaborar || doc.permisos.administrar;
  const enProceso = ['en_revision', 'en_aprobacion'].includes(ultima?.estado);

  async function accion(fn) {
    setError(null);
    setMensaje(null);
    try {
      await fn();
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const vigente = doc.versiones.find((v) => v.estado === 'vigente') || null;

  return (
    <div className={`max-w-5xl space-y-4 ${doc.permisos.imprimir ? '' : 'no-imprimible'}`}>
      {/* Regreso DENTRO del módulo, arriba a la izquierda y con la misma forma
          que en equipos, auditorías e indicadores. Antes vivía a la derecha, con
          aspecto de botón de acción entre los demás: estaba, pero no se leía
          como la salida. El «‹ Módulos» de la cabecera es global y sale del
          módulo, así que no sirve para volver al listado. */}
      <Link to="/documental/documentos" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Volver al listado maestro
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-sm font-bold text-primary">{doc.codigo}</div>
          {/* Códigos con los que este documento se identificó antes. Se muestran
              siempre: una referencia vieja citada en otro documento tiene que
              poder reconciliarse con el código actual. */}
          {(doc.codigosAnteriores || []).length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span>Antes:</span>
              {doc.codigosAnteriores.map((c) => (
                <span key={c.codigo} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono line-through"
                  title={`${c.motivo} — ${c.por}, ${fechaCorta(c.fecha)}`}>
                  {c.codigo}
                </span>
              ))}
            </div>
          )}
          <h1 className="text-2xl font-bold">{doc.nombre}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={`badge ${ESTADOS[doc.estado]?.clase}`}>{ESTADOS[doc.estado]?.texto}</span>
            <span className={`badge ${CONFIDENCIALIDAD[doc.confidencialidad]?.clase}`}>
              {CONFIDENCIALIDAD[doc.confidencialidad]?.texto}
            </span>
            <span>{tipo?.nombre}</span>·<span>{proceso?.nombre}</span>
            {doc.fechaVigencia && <span>· Vigente desde {fechaCorta(doc.fechaVigencia)}</span>}
          </div>
        </div>
        {/* ABRIR EL DOCUMENTO es lo que viene a hacer el 95 % de quien entra a
            esta ficha, y estaba enterrado como un botón secundario más dentro
            de la lista de versiones, compitiendo con «PDF», «Original» y el
            control de cambios. Aquí arriba, en color de acento, es lo primero
            que se ve. La lista de versiones conserva el suyo para el histórico. */}
        {vigente?.archivos?.pdf && (
          <EnlaceArchivo className="btn-accent shrink-0"
            ruta={`/documental/documentos/${doc.id}/archivo/${vigente.numero}/pdf`}
            titulo={`${doc.codigo} · v${vigente.numero} · ${doc.nombre}`}
            rutaDescarga={doc.permisos.descargarPdf ? `/documental/documentos/${doc.id}/archivo/${vigente.numero}/pdf?descargar=1` : null}>
            <Eye className="h-4 w-4" /> Ver documento
          </EnlaceArchivo>
        )}
      </div>

      {doc.alertaRevision && (
        <div className={`card flex items-center gap-3 text-sm ${
          doc.alertaRevision === 'vencida'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {doc.alertaRevision === 'vencida' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0" />}
          <span>
            Revisión programada para {fechaCorta(doc.proximaRevision)} — <strong>{textoDias(doc.diasParaRevision)}</strong>.
          </span>
        </div>
      )}

      {mensaje && <div className="card border-emerald-200 bg-emerald-50 text-sm text-emerald-700">{mensaje}</div>}
      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {/* Quien entra por un permiso excepcional (o descarga gracias a uno) lo ve
          dicho con todas las letras: tipo, quién lo dio, motivo y vencimiento. */}
      <AvisoMiPermiso permisos={doc.misPermisosExcepcionales} />

      {miDecision && (
        <PanelDecision docId={doc.id} etapa={etapa}
          onHecho={() => { setMensaje('Decisión registrada.'); cargar(); }} onError={setError} />
      )}

      {puedeSeguimiento && ultima?.estado === 'borrador' && (
        <PanelBorrador doc={doc} version={ultima} cat={cat} onCambio={cargar} onError={setError} />
      )}

      {puedeSeguimiento && ultima?.estado === 'en_ajustes' && (
        <PanelAjustes doc={doc} version={ultima}
          onHecho={() => { setMensaje('Flujo reanudado: quien devolvió el documento fue convocado de nuevo.'); cargar(); }}
          onCambio={cargar} onError={setError} />
      )}

      {doc.permisos.administrar && (
        <PermisosExcepcionales doc={doc}
          onHecho={(m) => { setMensaje(m); cargar(); }}
          onError={setError} />
      )}

      {doc.permisos.administrar && (
        <PanelPermisos doc={doc} cat={cat}
          onHecho={() => { setMensaje('Permisos de acceso actualizados.'); cargar(); }}
          onError={setError} />
      )}

      {/* Versiones */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <GitBranch className="h-5 w-5 text-primary" />
            {doc.permisos.verCicloCompleto ? 'Versiones y control de cambios' : 'Versión vigente'}
          </div>
          <div className="flex gap-2">
            {doc.permisos.administrar && doc.estado === 'vigente' && (
              <BotonNuevaVersion docId={doc.id} onHecho={cargar} onError={setError} />
            )}
            {doc.permisos.administrar && doc.estado !== 'obsoleto' && (
              <BotonObsoletizar docId={doc.id} onHecho={cargar} onError={setError} />
            )}
            {/* Recodificar toca la identidad del documento: solo el administrador
                del SGC, no el líder del proceso. */}
            {usuario?.permisos?.['sgc.administrador'] && (
              <BotonRecodificar doc={doc}
                onHecho={() => { setMensaje('Código actualizado. El anterior quedó en el histórico.'); cargar(); }}
                onError={setError} />
            )}
          </div>
        </div>

        {/* Control documental: al colaborador se le muestra únicamente la versión
            aprobada, para que no trabaje sobre borradores ni sobre lo obsoleto. */}
        {!doc.permisos.verCicloCompleto && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Se muestra la versión vigente, que es la única aplicable. El histórico de versiones lo
            consulta quien administra el documento.
          </p>
        )}

        <ul className="space-y-3">
          {[...doc.versiones].reverse().map((v) => (
            <li key={v.numero} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-bold">v{v.numero}</span>
                  <span className={`badge ${ESTADOS[v.estado]?.clase}`}>{ESTADOS[v.estado]?.texto || v.estado}</span>
                  <span className="text-xs text-slate-500">
                    Elaboró: {v.flujo.elaboro.correo} · {fechaCorta(v.flujo.elaboro.fecha)}
                    {(v.flujo.elaboradores || []).map((e) => (
                      <span key={e.correo} className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium"
                        title={`Co-elaborador · agregado por ${e.agregadoPor} · ${fechaCorta(e.fecha)}`}>
                        +{e.correo}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.archivos.pdf && (
                    <>
                      {/* Se abre en el visor de la herramienta, nunca en otra
                          pestaña: el visor nativo del navegador permite bajar
                          e imprimir y anula la restricción de descarga. */}
                      <EnlaceArchivo className="btn-secondary"
                        ruta={`/documental/documentos/${doc.id}/archivo/${v.numero}/pdf`}
                        titulo={`${doc.codigo} · v${v.numero} · ${doc.nombre}`}
                        rutaDescarga={doc.permisos.descargarPdf ? `/documental/documentos/${doc.id}/archivo/${v.numero}/pdf?descargar=1` : null}>
                        <Eye className="h-4 w-4" /> Ver PDF
                      </EnlaceArchivo>
                      {doc.permisos.descargarPdf ? (
                        <a className="btn-secondary" href={`/api/documental/documentos/${doc.id}/archivo/${v.numero}/pdf?descargar=1`}>
                          <Download className="h-4 w-4" /> PDF
                        </a>
                      ) : (
                        <span className="btn-secondary cursor-not-allowed opacity-60" title="Solo consulta en línea">
                          <Printer className="h-4 w-4" /> Restringido
                        </span>
                      )}
                    </>
                  )}
                  {v.archivos.original && (
                    doc.permisos.descargarOriginal ? (
                      <a className="btn-secondary" href={`/api/documental/documentos/${doc.id}/archivo/${v.numero}/original?descargar=1`}>
                        <Download className="h-4 w-4" /> Editable
                      </a>
                    ) : (
                      <span className="btn-secondary cursor-not-allowed opacity-60" title="Descarga del editable restringida">
                        <Lock className="h-4 w-4" /> Editable
                      </span>
                    )
                  )}
                </div>
              </div>

              <div className="mt-2 text-sm text-slate-600">
                <span className="font-semibold">Control de cambios:</span> {v.controlCambios}
              </div>

              {/* Correcciones editoriales: cambios de forma sobre la versión
                  vigente, sin nueva versión. Visibles siempre: la transparencia
                  es lo que las hace defendibles en auditoría. */}
              {(v.correcciones || []).length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {v.correcciones.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                      <Pencil className="h-3 w-3 shrink-0 text-slate-400" />
                      <span>Corrección editorial · {fechaCorta(c.fecha)} · {c.por}</span>
                      <span className="italic">“{c.motivo}”</span>
                      {doc.permisos.administrar && c.anteriores?.pdf && (
                        <EnlaceArchivo className="text-primary underline"
                          ruta={`/documental/documentos/${doc.id}/archivo/${v.numero}/pdf?correccion=${i + 1}`}
                          titulo={`${doc.codigo} · v${v.numero} · antes de la corrección ${i + 1}`}>
                          PDF anterior
                        </EnlaceArchivo>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {doc.permisos.administrar && v.estado === 'vigente' && (
                <BotonCorreccion docId={doc.id}
                  onHecho={() => { setMensaje('Corrección editorial aplicada. Los archivos anteriores quedaron en el histórico.'); cargar(); }}
                  onError={setError} />
              )}

              {(v.flujo.revisores.length > 0 || v.flujo.aprobadores.length > 0) && (
                <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                  {['revisores', 'aprobadores'].map((grupo) => v.flujo[grupo].length > 0 && (
                    <div key={grupo}>
                      <div className="font-semibold uppercase tracking-wide text-slate-500">{grupo}</div>
                      <ul className="mt-1 space-y-1.5">
                        {v.flujo[grupo].map((p) => (
                          <Participante key={p.correo} p={p} doc={doc} version={v} grupo={grupo}
                            esUltima={v === ultima} enProceso={enProceso}
                            puedeSeguimiento={puedeSeguimiento}
                            onCambio={cargar} onMensaje={setMensaje} onError={setError} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {/* Rondas anteriores (reenvíos tras rechazo): quedan plegadas, pero
                  quedan — antes solo sobrevivían en la colección de auditoría. */}
              {(v.rondasAnteriores || []).length > 0 && (
                <RondasAnteriores rondas={v.rondasAnteriores} />
              )}

              {v === ultima && enProceso && doc.permisos.administrar && (
                <GestionParticipantes docId={doc.id} version={v} cat={cat}
                  onHecho={() => { setMensaje('Participantes del flujo actualizados.'); cargar(); }}
                  onError={setError} />
              )}

              {v === ultima && !['vigente', 'obsoleta'].includes(v.estado) && doc.permisos.administrar && (
                <GestionElaboradores docId={doc.id} version={v} cat={cat}
                  onHecho={() => { setMensaje('Equipo elaborador actualizado.'); cargar(); }}
                  onError={setError} />
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Ficha */}
      <div className="card text-sm text-slate-600">
        <div className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
          <FileText className="h-5 w-5 text-primary" /> Ficha del documento
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          <Dato etiqueta="Alcance" valor={ALCANCES[doc.alcance]?.texto || doc.alcance} />
          <Dato etiqueta="Sedes" valor={(doc.sedes || []).map(nombreSede).join(', ') || 'Todas'} />
          <Dato etiqueta="Normas" valor={(doc.normas || []).join(', ') || '—'} />
          <Dato etiqueta="Palabras clave" valor={(doc.palabrasClave || []).join(', ') || '—'} />
          <Dato etiqueta="Meses de revisión" valor={doc.mesesRevision} />
          <Dato etiqueta="Próxima revisión" valor={fechaCorta(doc.proximaRevision)} />
          <Dato etiqueta="Archivo editable" valor={doc.permisos.descargarOriginal ? 'Descargable' : 'Restringido'} />
          {/* Se dice lo que le pasa a QUIEN MIRA, no una propiedad del documento:
              desde 2026-09-25 la descarga no depende del documento sino del rol. */}
          <Dato etiqueta="Descarga del PDF" valor={
            doc.permisos.descargarPdf
              ? (doc.permisos.descargaPorPermiso
                ? `Habilitada por permiso excepcional${doc.permisos.descargaPorPermiso.hasta ? ` hasta ${fechaCorta(doc.permisos.descargaPorPermiso.hasta)}` : ''}`
                : 'Habilitada para su usuario')
              : 'Solo consulta en línea (reservada a administradores o a un permiso excepcional)'} />
          <Dato etiqueta="Creado por" valor={doc.createdBy} />
          {/* La audiencia solo viaja a quien administra el documento. */}
          {doc.permisos.verCicloCompleto && (
            <>
              <Dato etiqueta="Visualización" valor={
                <ResumenAudiencia audiencia={doc.audienciaVisualizacion} cat={cat}
                  sinRestriccion="Todos los del alcance" />} />
            </>
          )}
        </dl>
        {doc.descripcion && <p className="mt-4 border-t border-slate-100 pt-3">{doc.descripcion}</p>}
        {doc.obsoleto && doc.motivoObsolescencia && (
          <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
            <strong>Motivo de obsolescencia:</strong> {doc.motivoObsolescencia}
            {doc.obsoletizadoPor && ` — ${doc.obsoletizadoPor}`}
          </p>
        )}
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <div>
      <dt className="label">{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function PanelDecision({ docId, etapa, onHecho, onError }) {
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function decidir(decision) {
    if (['rechazado', 'devuelto'].includes(decision) && !comentario.trim()) {
      return onError(decision === 'rechazado'
        ? 'Para rechazar debe indicar un comentario.'
        : 'Para devolver a ajustes debe indicar qué se debe corregir.');
    }
    setEnviando(true);
    try {
      await api(`/documental/documentos/${docId}/decision`, { method: 'POST', body: { decision, comentario } });
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card border-blue-200 bg-blue-50">
      <div className="mb-2 font-semibold text-blue-900">
        Tiene una {etapa === 'revisores' ? 'revisión' : 'aprobación'} pendiente sobre este documento
      </div>
      <textarea className="input mb-3" rows={2} placeholder="Comentario (obligatorio si devuelve o rechaza)"
        value={comentario} onChange={(e) => setComentario(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={enviando} onClick={() => decidir('aprobado')}>
          <CheckCircle2 className="h-4 w-4" /> Aprobar
        </button>
        {/* Devolver conserva la ronda: solo quien devuelve queda a la espera de
            los ajustes. Rechazar anula todo y regresa la versión a borrador. */}
        <button className="btn-secondary !border-orange-300 !text-orange-700" disabled={enviando}
          title="Pide correcciones sin anular las aprobaciones ya registradas"
          onClick={() => decidir('devuelto')}>
          <CornerUpLeft className="h-4 w-4" /> Devolver para ajustes
        </button>
        <button className="btn-danger" disabled={enviando} onClick={() => decidir('rechazado')}>
          <XCircle className="h-4 w-4" /> Rechazar
        </button>
      </div>
    </div>
  );
}

// Un participante del flujo con su estado, plazo, comentario y el hilo de
// respuestas. Desde aquí el gestor/elaborador responde, recuerda o retira.
function Participante({ p, doc, version, grupo, esUltima, enProceso, puedeSeguimiento, onCambio, onMensaje, onError }) {
  const [respondiendo, setRespondiendo] = useState(false);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const etapaActiva = (version.estado === 'en_revision' && grupo === 'revisores') ||
    (version.estado === 'en_aprobacion' && grupo === 'aprobadores');

  async function responder() {
    if (!texto.trim()) return;
    setOcupado(true);
    try {
      await api(`/documental/documentos/${doc.id}/flujo/comentarios`, {
        method: 'POST', body: { correo: p.correo, texto }
      });
      setTexto('');
      setRespondiendo(false);
      onCambio();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function recordar() {
    setOcupado(true);
    try {
      await api(`/documental/documentos/${doc.id}/flujo/recordar`, {
        method: 'POST', body: { correo: p.correo }
      });
      onMensaje(`Recordatorio enviado a ${p.correo}.`);
      onCambio();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-1.5">
        {p.estado === 'aprobado' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
        {p.estado === 'rechazado' && <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />}
        {p.estado === 'devuelto' && <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-orange-600" />}
        {p.estado === 'retirado' && <UserX className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
        {!['aprobado', 'rechazado', 'devuelto', 'retirado'].includes(p.estado) && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
        )}
        <span className={p.estado === 'retirado' ? 'text-slate-400 line-through' : ''}>{p.correo}</span>
        {/* Trazabilidad: por qué esta persona está en el flujo. */}
        {p.asignadoPor && p.asignadoPor.tipo !== 'usuario' && (
          <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
            {TIPOS_ASIGNACION[p.asignadoPor.tipo]}: {p.asignadoPor.etiqueta}
          </span>
        )}
        <span className="text-slate-400">
          {p.estado}{p.fecha ? ` · ${fechaCorta(p.fecha)}` : ''}
        </span>
        {p.estado === 'pendiente' && p.fechaLimite && (
          <span className="rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700"
            title="Plazo para decidir">
            plazo: {fechaCorta(p.fechaLimite)}
          </span>
        )}
        {p.estado === 'retirado' && p.retiro && (
          <span className="text-[10px] text-slate-400" title={`Retiró: ${p.retiro.por}`}>
            “{p.retiro.motivo}”
          </span>
        )}
        {puedeSeguimiento && esUltima && etapaActiva && p.estado === 'pendiente' && (
          <button className="text-primary hover:underline" disabled={ocupado} onClick={recordar}
            title="Enviar recordatorio por correo (máx. 1 al día)">
            <BellRing className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {p.comentario && <div className="ml-5 mt-0.5 italic text-slate-500">“{p.comentario}”</div>}
      {/* Comentarios de rondas previas del mismo participante (devoluciones ya
          atendidas): siguen visibles como historia del hilo. */}
      {(p.historial || []).map((h, i) => (
        <div key={i} className="ml-5 mt-0.5 italic text-slate-400">
          “{h.comentario}” <span className="not-italic">(devuelto · {fechaCorta(h.fecha)}, atendido)</span>
        </div>
      ))}
      {(p.respuestas || []).map((r, i) => (
        <div key={i} className="ml-5 mt-0.5 flex flex-wrap items-center gap-1 text-slate-600">
          <Reply className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="font-medium">{r.autor}</span>
          <span className="text-slate-400">· {fechaCorta(r.fecha)}:</span>
          <span className="italic">“{r.texto}”</span>
        </div>
      ))}

      {puedeSeguimiento && esUltima && (p.comentario || (p.historial || []).length > 0) && p.estado !== 'retirado' && (
        respondiendo ? (
          <div className="ml-5 mt-1 flex flex-wrap items-center gap-1.5">
            <input className="input !w-72 !py-1 text-xs" placeholder="Respuesta (queda en el historial del flujo)"
              value={texto} onChange={(e) => setTexto(e.target.value)} />
            <button className="btn-primary !px-2 !py-1 text-xs" disabled={ocupado || !texto.trim()} onClick={responder}>
              Responder
            </button>
            <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setRespondiendo(false)}>Cancelar</button>
          </div>
        ) : (
          <button className="ml-5 mt-0.5 flex items-center gap-1 text-[11px] text-primary hover:underline"
            onClick={() => setRespondiendo(true)}>
            <Reply className="h-3 w-3" /> Responder
          </button>
        )
      )}
    </li>
  );
}

// Rondas de flujo archivadas por un reenvío tras rechazo.
function RondasAnteriores({ rondas }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        onClick={() => setAbierto(true)}>
        <History className="h-3.5 w-3.5" />
        {rondas.length === 1 ? 'Ver la ronda de flujo anterior' : `Ver ${rondas.length} rondas de flujo anteriores`}
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
      {rondas.map((r, i) => (
        <div key={i}>
          <div className="font-semibold">
            Ronda {i + 1} · enviada {fechaCorta(r.fechaEnvio)} · archivada {fechaCorta(r.archivadaEl)}
          </div>
          {['revisores', 'aprobadores'].map((g) => (r[g] || []).length > 0 && (
            <div key={g} className="ml-2">
              {g}: {r[g].map((p) => `${p.correo} (${p.estado}${p.comentario ? `: “${p.comentario}”` : ''})`).join(' · ')}
            </div>
          ))}
        </div>
      ))}
      <button className="text-slate-400 hover:text-slate-600" onClick={() => setAbierto(false)}>Ocultar</button>
    </div>
  );
}

// Agregar o retirar participantes con el flujo en curso (solo gestores). El
// retiro se hace desde aquí y no por participante para obligar a dejar motivo.
function GestionParticipantes({ docId, version, cat, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [etapa, setEtapa] = useState(version.estado === 'en_aprobacion' ? 'aprobadores' : 'revisores');
  const [seleccion, setSeleccion] = useState([]);
  const [retirar, setRetirar] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const pendientes = version.flujo[etapa].filter((p) => p.estado === 'pendiente');

  async function ejecutar(body) {
    setOcupado(true);
    try {
      await api(`/documental/documentos/${docId}/flujo/participantes`, { method: 'POST', body });
      setSeleccion([]);
      setRetirar('');
      setMotivo('');
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => setAbierto(true)}>
        <UserPlus className="h-3.5 w-3.5" /> Gestionar participantes del flujo
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-600">Etapa:</span>
        {/* Los revisores solo se agregan mientras la revisión sigue abierta:
            con la etapa cerrada el proceso no se devuelve. */}
        <select className="input !w-auto !py-1" value={etapa} onChange={(e) => setEtapa(e.target.value)}>
          {version.estado === 'en_revision' && <option value="revisores">Revisores</option>}
          <option value="aprobadores">Aprobadores</option>
        </select>
      </div>

      <div>
        <div className="mb-1 font-semibold text-slate-600">Agregar (persona, cargo, área, grupo o sede)</div>
        <SelectorAudiencia titulo="" cat={cat} seleccion={seleccion} onChange={setSeleccion} />
        <button className="btn-primary mt-2 !px-2 !py-1 text-xs" disabled={ocupado || !seleccion.length}
          onClick={() => ejecutar({ accion: 'agregar', etapa, asignacion: seleccion[0] })}>
          <UserPlus className="h-3.5 w-3.5" /> Agregar al flujo
        </button>
        {seleccion.length > 1 && (
          <p className="mt-1 text-amber-700">Se agrega una asignación a la vez: se tomará la primera.</p>
        )}
      </div>

      {pendientes.length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-slate-600">
            Retirar a un pendiente (quien ya decidió no se puede retirar)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto !py-1" value={retirar} onChange={(e) => setRetirar(e.target.value)}>
              <option value="">Seleccione…</option>
              {pendientes.map((p) => <option key={p.correo} value={p.correo}>{p.correo}</option>)}
            </select>
            <input className="input !w-72 !py-1" placeholder="Motivo del retiro (obligatorio)"
              value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button className="btn-danger !px-2 !py-1 text-xs" disabled={ocupado || !retirar || motivo.trim().length < 3}
              onClick={() => ejecutar({ accion: 'retirar', etapa, correo: retirar, motivo })}>
              <UserX className="h-3.5 w-3.5" /> Retirar
            </button>
          </div>
        </div>
      )}

      <button className="text-slate-400 hover:text-slate-600" onClick={() => setAbierto(false)}>Cerrar</button>
    </div>
  );
}

// Equipo elaborador de la versión en curso: co-elaboradores además del autor.
// Solo gestores deciden quién elabora; los agregados heredan los derechos de
// trabajo del elaborador (archivos, envío del flujo, seguimiento).
function GestionElaboradores({ docId, version, cat, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState([]);
  const [ocupado, setOcupado] = useState(false);

  async function ejecutar(body) {
    setOcupado(true);
    try {
      await api(`/documental/documentos/${docId}/elaboradores`, { method: 'POST', body });
      setSeleccion([]);
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => setAbierto(true)}>
        <UserPlus className="h-3.5 w-3.5" /> Gestionar equipo elaborador
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
      <div>
        <div className="mb-1 font-semibold text-slate-600">Agregar co-elaborador (persona, cargo, área, grupo o sede)</div>
        <SelectorAudiencia titulo="" cat={cat} seleccion={seleccion} onChange={setSeleccion} />
        <button className="btn-primary mt-2 !px-2 !py-1 text-xs" disabled={ocupado || !seleccion.length}
          onClick={() => ejecutar({ accion: 'agregar', asignacion: seleccion[0] })}>
          <UserPlus className="h-3.5 w-3.5" /> Agregar al equipo
        </button>
      </div>
      {(version.flujo.elaboradores || []).length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-slate-600">Retirar (el autor de la versión no se puede retirar)</div>
          <ul className="space-y-1">
            {version.flujo.elaboradores.map((e) => (
              <li key={e.correo} className="flex items-center gap-2">
                <span>{e.correo}</span>
                <button className="text-rose-600 hover:underline" disabled={ocupado}
                  onClick={() => ejecutar({ accion: 'retirar', correo: e.correo })}>
                  <UserX className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button className="text-slate-400 hover:text-slate-600" onClick={() => setAbierto(false)}>Cerrar</button>
    </div>
  );
}

// La versión fue devuelta para ajustes: aquí el responsable corrige archivos,
// deja su respuesta y reanuda el flujo. Las aprobaciones previas se conservan.
function PanelAjustes({ doc, version, onHecho, onCambio, onError }) {
  const [original, setOriginal] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [respuesta, setRespuesta] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const etapa = version.etapaAjustes || 'revisores';
  const devolvio = version.flujo[etapa].find((p) => p.estado === 'devuelto');

  async function subir() {
    if (!original && !pdf) return onError('Seleccione al menos un archivo corregido.');
    setOcupado(true);
    try {
      const fd = new FormData();
      if (original) fd.append('original', original);
      if (pdf) fd.append('pdf', pdf);
      await api(`/documental/documentos/${doc.id}/archivos`, { method: 'POST', body: fd });
      setOriginal(null);
      setPdf(null);
      onCambio();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function reanudar() {
    setOcupado(true);
    try {
      await api(`/documental/documentos/${doc.id}/reanudar-flujo`, { method: 'POST', body: { respuesta } });
      setRespuesta('');
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card border-orange-200 bg-orange-50/60">
      <div className="mb-1 flex items-center gap-2 font-semibold text-orange-900">
        <CornerUpLeft className="h-4 w-4" /> Versión {version.numero} devuelta para ajustes
      </div>
      {devolvio && (
        <p className="mb-3 text-sm text-orange-800">
          <strong>{devolvio.correo}</strong> devolvió el documento{devolvio.comentario && <>: <em>“{devolvio.comentario}”</em></>}.
          Corrija los archivos, registre cómo lo resolvió y reanude el flujo: solo quien devolvió vuelve a decidir,
          las demás aprobaciones se conservan.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <CampoArchivo etiqueta="Archivo editable corregido" cargado={version.archivos.original} onChange={setOriginal} />
        <CampoArchivo etiqueta="PDF corregido" accept=".pdf" cargado={version.archivos.pdf} onChange={setPdf} />
      </div>
      <button className="btn-secondary mt-3" disabled={ocupado || (!original && !pdf)} onClick={subir}>
        <Upload className="h-4 w-4" /> Subir archivos corregidos
      </button>

      <div className="mt-4 border-t border-orange-200 pt-3">
        <label className="label">Respuesta a la observación (queda en el hilo del flujo)</label>
        <textarea className="input" rows={2} placeholder="Ej.: Ajustes aplicados — se corrigió el nombre de la empresa y el duplicado del apartado 6.6."
          value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
        <button className="btn-accent mt-3" disabled={ocupado} onClick={reanudar}>
          <Play className="h-4 w-4" /> Reanudar flujo
        </button>
      </div>
    </div>
  );
}

// Corrección editorial sobre la versión vigente: errores de forma que no
// cambian el contenido. El motivo es obligatorio y queda visible en la ficha.
function BotonCorreccion({ docId, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [original, setOriginal] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function aplicar() {
    setOcupado(true);
    try {
      const fd = new FormData();
      fd.append('motivo', motivo);
      if (original) fd.append('original', original);
      if (pdf) fd.append('pdf', pdf);
      await api(`/documental/documentos/${docId}/correccion`, { method: 'POST', body: fd });
      setAbierto(false);
      setMotivo('');
      setOriginal(null);
      setPdf(null);
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => setAbierto(true)}>
        <Pencil className="h-3.5 w-3.5" /> Corrección editorial (sin nueva versión)
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">
        Solo para errores de <strong>forma</strong> (ortografía, fechas mal digitadas, formato) que no cambian el
        contenido. Cualquier cambio de fondo requiere una nueva versión con su flujo de aprobación. Los archivos
        anteriores se conservan y la corrección queda registrada y auditada.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <CampoArchivo etiqueta="Editable corregido (opcional)" cargado={null} onChange={setOriginal} />
        <CampoArchivo etiqueta="PDF corregido (opcional)" accept=".pdf" cargado={null} onChange={setPdf} />
      </div>
      <input className="input" placeholder="Motivo: qué se corrigió y por qué es solo de forma (obligatorio)"
        value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={ocupado || motivo.trim().length < 5 || (!original && !pdf)}
          onClick={aplicar}>
          {ocupado ? 'Aplicando…' : 'Aplicar corrección'}
        </button>
        <button className="btn-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

// Permisos de acceso del documento ya creado. Existe porque la audiencia cambia
// con el negocio —un documento que era de todo el país pasa a ser de un equipo—
// y volver a crear el documento para eso rompería su código y su historial.
function PanelPermisos({ doc, cat, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState({
    confidencialidad: doc.confidencialidad || 'interno',
    accesoConfidencial: doc.accesoConfidencial || [],
    audienciaVisualizacion: doc.audienciaVisualizacion || [],
    audienciaDescarga: doc.audienciaDescarga || [],
    permitirImpresion: doc.permitirImpresion === true
  });
  const [modos, setModos] = useState({ visualizacion: modoVisualizacionDe(doc) });
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await api(`/documental/documentos/${doc.id}`, { method: 'PUT', body: valor });
      setAbierto(false);
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <ShieldCheck className="h-4 w-4 text-primary" /> Permisos de acceso
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex flex-wrap items-center gap-1">
              Confidencialidad:
              <span className="font-medium text-slate-600">{CONFIDENCIALIDAD[doc.confidencialidad]?.texto || doc.confidencialidad}</span>
              {doc.confidencialidad === 'confidencial' && (
                <span>({(doc.accesoConfidencial || []).length} persona(s) en la lista)</span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              Visualización:
              <ResumenAudiencia audiencia={doc.audienciaVisualizacion} cat={cat}
                sinRestriccion="todos los del alcance" />
            </span>
            <span className="flex flex-wrap items-center gap-1">
              Descarga: <span className="text-slate-500">administradores del módulo, o un permiso excepcional por persona</span>
            </span>
          </div>
        </div>
        <button className="btn-secondary shrink-0" onClick={() => setAbierto(true)}>Cambiar permisos</button>
      </div>
    );
  }

  return (
    <div className="card space-y-4 border-primary/20">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
        <ShieldCheck className="h-4 w-4 text-primary" /> Permisos de acceso
      </div>
      <PermisosAcceso valor={valor} onChange={setValor} modos={modos} setModos={setModos} conConfidencialidad />
      <div className="flex gap-2 border-t border-slate-100 pt-3">
        <button className="btn-accent" disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar permisos'}
        </button>
        <button className="btn-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

function PanelBorrador({ doc, version, cat, onCambio, onError }) {
  const [original, setOriginal] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [revisores, setRevisores] = useState([]);
  const [aprobadores, setAprobadores] = useState([]);
  const [ocupado, setOcupado] = useState(false);

  const faltaPdf = !version.archivos.pdf;
  const faltaOriginal = !version.archivos.original;

  async function subir() {
    if (!original && !pdf) return onError('Seleccione al menos un archivo.');
    setOcupado(true);
    try {
      const fd = new FormData();
      if (original) fd.append('original', original);
      if (pdf) fd.append('pdf', pdf);
      await api(`/documental/documentos/${doc.id}/archivos`, { method: 'POST', body: fd });
      setOriginal(null);
      setPdf(null);
      onCambio();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    if (!aprobadores.length) return onError('Debe asignar al menos un aprobador.');
    setOcupado(true);
    try {
      await api(`/documental/documentos/${doc.id}/enviar-flujo`, { method: 'POST', body: { revisores, aprobadores } });
      onCambio();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card border-amber-200 bg-amber-50/60">
      <div className="mb-1 font-semibold text-amber-900">Versión {version.numero} en borrador</div>
      <p className="mb-4 text-sm text-amber-800">
        Cargue el archivo editable y el PDF, asigne el flujo y envíelo. Ambos archivos son obligatorios.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <CampoArchivo etiqueta="Archivo original editable (Word, Excel, PowerPoint, Visio o modelo Bizagi .bpm / .bpmn) *" cargado={version.archivos.original}
          onChange={setOriginal} />
        <CampoArchivo etiqueta="Archivo PDF de publicación *" accept=".pdf" cargado={version.archivos.pdf}
          onChange={setPdf} />
      </div>
      <button className="btn-secondary mt-3" disabled={ocupado || (!original && !pdf)} onClick={subir}>
        <Upload className="h-4 w-4" /> Subir archivos
      </button>

      <div className="mt-5 grid gap-5 border-t border-amber-200 pt-4 md:grid-cols-2">
        <SelectorAudiencia titulo="Revisores (opcional)" cat={cat} seleccion={revisores} onChange={setRevisores} />
        <SelectorAudiencia titulo="Aprobadores *" cat={cat} seleccion={aprobadores} onChange={setAprobadores} />
      </div>

      <button className="btn-accent mt-4" disabled={ocupado || faltaPdf || faltaOriginal || !aprobadores.length} onClick={enviar}>
        <Send className="h-4 w-4" /> Enviar a {revisores.length ? 'revisión' : 'aprobación'}
      </button>
      {(faltaPdf || faltaOriginal) && (
        <p className="mt-2 text-xs font-medium text-amber-800">
          Falta cargar {[faltaOriginal && 'el archivo editable', faltaPdf && 'el PDF'].filter(Boolean).join(' y ')}.
        </p>
      )}
    </div>
  );
}

function CampoArchivo({ etiqueta, accept, cargado, onChange }) {
  return (
    <div>
      <label className="label">{etiqueta}</label>
      <input type="file" accept={accept} className="input" onChange={(e) => onChange(e.target.files[0] || null)} />
      {cargado
        ? <div className="mt-1 text-xs font-medium text-emerald-700">✓ Cargado: {cargado.nombre}</div>
        : <div className="mt-1 text-xs text-amber-700">Pendiente</div>}
    </div>
  );
}

function BotonNuevaVersion({ docId, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [control, setControl] = useState('');

  async function crear() {
    try {
      await api(`/documental/documentos/${docId}/versiones`, { method: 'POST', body: { controlCambios: control } });
      setAbierto(false);
      setControl('');
      onHecho();
    } catch (e) {
      onError(e.message);
    }
  }

  if (!abierto) {
    return (
      <button className="btn-primary" onClick={() => setAbierto(true)}>
        <GitBranch className="h-4 w-4" /> Nueva versión
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input !w-80" placeholder="Control de cambios: qué cambia y por qué"
        value={control} onChange={(e) => setControl(e.target.value)} />
      <button className="btn-primary" disabled={control.trim().length < 5} onClick={crear}>Crear</button>
      <button className="btn-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
    </div>
  );
}

// Cambia el código conservando el anterior en el histórico. Dejar el campo de
// código vacío recalcula con las siglas actuales del catálogo, que es el caso
// habitual: "corregí la sigla del proceso y hay que actualizar sus documentos".
function BotonRecodificar({ doc, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function ejecutar() {
    setOcupado(true);
    try {
      await api(`/documental/documentos/${doc.id}/recodificar`, {
        method: 'POST',
        body: { motivo, ...(codigo.trim() ? { codigo: codigo.trim() } : {}) }
      });
      setAbierto(false);
      setCodigo('');
      setMotivo('');
      onHecho();
    } catch (e) {
      onError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button className="btn-secondary" onClick={() => setAbierto(true)}>
        <Hash className="h-4 w-4" /> Recodificar
      </button>
    );
  }
  return (
    <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="mb-2 text-xs text-amber-800">
        El código actual (<span className="font-mono font-semibold">{doc.codigo}</span>) pasará al
        histórico y el documento seguirá siendo localizable por él. El consecutivo no cambia.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-56 font-mono" placeholder={`Vacío = recalcular`}
          value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} />
        <input className="input !w-80" placeholder="Motivo del cambio (obligatorio)"
          value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <button className="btn-primary" disabled={ocupado || motivo.trim().length < 5} onClick={ejecutar}>
          {ocupado ? 'Aplicando…' : 'Confirmar'}
        </button>
        <button className="btn-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

function BotonObsoletizar({ docId, onHecho, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');

  async function ejecutar() {
    try {
      await api(`/documental/documentos/${docId}/obsoletizar`, { method: 'POST', body: { motivo } });
      setAbierto(false);
      setMotivo('');
      onHecho();
    } catch (e) {
      onError(e.message);
    }
  }

  if (!abierto) {
    return (
      <button className="btn-secondary" onClick={() => setAbierto(true)}>
        <Archive className="h-4 w-4" /> Obsoletizar
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input !w-80" placeholder="Motivo de la obsolescencia (queda en el histórico)"
        value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <button className="btn-danger" disabled={motivo.trim().length < 5} onClick={ejecutar}>Confirmar</button>
      <button className="btn-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
    </div>
  );
}
