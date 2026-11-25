import { useMemo, useState } from 'react';
import { KeyRound, Plus, Ban, History, Download, Eye } from 'lucide-react';
import { api, fechaCorta } from '@/shared/api';
import { pedirMotivo } from '@/shared/components/ui.jsx';
import SelectorEmpleados from '@/shared/components/SelectorEmpleados.jsx';

// PERMISOS EXCEPCIONALES por persona sobre un documento.
//
// Son la vía controlada para que alguien fuera de la audiencia, del alcance por
// sede o de la lista confidencial consulte un documento —y, en casos puntuales,
// descargue el PDF— sin recibir el rol de administrador del módulo. Cada permiso
// es nominal, lleva motivo obligatorio, vigencia y quién lo otorgó; se revoca
// con motivo y nunca desaparece de la lista (los vencidos y revocados quedan
// como historial). Las reglas de vigencia las aplica el backend
// (DocumentosService.otorgarPermiso); aquí solo se anticipan en el formulario.
//
// Lo ve y lo opera quien administra el documento: líder del proceso,
// administrador del módulo o de la plataforma.

const TIPOS = {
  consultar: { texto: 'Consulta en línea', icono: Eye },
  descargar: { texto: 'Consulta y descarga del PDF', icono: Download }
};

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

export function estadoPermiso(p) {
  if (p.revocado) return 'revocado';
  if (p.hasta && p.hasta < hoyIso()) return 'vencido';
  return 'vigente';
}

const ESTADO = {
  vigente: { texto: 'Vigente', clase: 'bg-emerald-100 text-emerald-700' },
  vencido: { texto: 'Vencido', clase: 'bg-slate-100 text-slate-500' },
  revocado: { texto: 'Revocado', clase: 'bg-rose-100 text-rose-700' }
};

const FORMULARIO_INICIAL = { correo: '', tipo: 'consultar', motivo: '', hasta: '' };

export default function PermisosExcepcionales({ doc, onHecho, onError }) {
  const lista = doc.permisosExcepcionales || [];
  const [verHistorial, setVerHistorial] = useState(false);
  const [nuevo, setNuevo] = useState(null); // null = formulario cerrado
  const [guardando, setGuardando] = useState(false);

  const vigentes = useMemo(() => lista.filter((p) => estadoPermiso(p) === 'vigente'), [lista]);
  const visibles = useMemo(() => {
    const base = verHistorial ? lista : vigentes;
    return [...base].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [lista, vigentes, verHistorial]);

  // El líder del proceso debe poner fecha a la descarga (D4): el formulario lo
  // exige de entrada para no estrellarse con el 400 del backend.
  const exigeFecha = nuevo?.tipo === 'descargar' && !doc.permisos?.otorgaDescargaIndefinida;

  async function otorgar(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api(`/documental/documentos/${doc.id}/permisos`, {
        method: 'POST',
        body: { correo: nuevo.correo, tipo: nuevo.tipo, motivo: nuevo.motivo, hasta: nuevo.hasta || null }
      });
      setNuevo(null);
      onHecho('Permiso otorgado. La persona recibió un correo con el motivo y la vigencia.');
    } catch (err) {
      onError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function revocar(p) {
    const motivo = pedirMotivo(`¿Por qué se revoca el permiso de ${p.correo}?`);
    if (!motivo) return;
    try {
      await api(`/documental/documentos/${doc.id}/permisos/${p.id}/revocar`, { method: 'POST', body: { motivo } });
      onHecho('Permiso revocado.');
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <KeyRound className="h-4 w-4 text-primary" /> Permisos excepcionales por persona
            <span className="badge bg-slate-100 text-slate-600">{vigentes.length} vigente(s)</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Para abrirle este documento a una persona concreta por fuera de su audiencia, su sede o la lista
            confidencial, con motivo y vigencia. Queda en la auditoría quién lo dio, a quién, por qué y hasta cuándo.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {lista.length > vigentes.length && (
            <button type="button" className="btn-secondary" onClick={() => setVerHistorial((v) => !v)}>
              <History className="h-4 w-4" /> {verHistorial ? 'Solo vigentes' : `Historial (${lista.length})`}
            </button>
          )}
          {!nuevo && !doc.obsoleto && (
            <button type="button" className="btn-accent" onClick={() => setNuevo(FORMULARIO_INICIAL)}>
              <Plus className="h-4 w-4" /> Otorgar permiso
            </button>
          )}
        </div>
      </div>

      {nuevo && (
        <form onSubmit={otorgar} className="space-y-3 rounded-lg border border-primary/30 bg-primary-soft/40 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Persona *</label>
              <SelectorEmpleados seleccion={nuevo.correo ? [nuevo.correo] : []}
                onChange={(l) => setNuevo({ ...nuevo, correo: l.at(-1) || '' })} />
            </div>
            <div>
              <label className="label">Tipo de permiso *</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(TIPOS).map(([id, t]) => (
                  <button type="button" key={id} onClick={() => setNuevo({ ...nuevo, tipo: id })}
                    aria-pressed={nuevo.tipo === id}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left text-sm ${
                      nuevo.tipo === id ? 'border-primary bg-white font-semibold text-primary' : 'border-slate-200 bg-white text-slate-600'}`}>
                    <t.icono className="h-4 w-4 shrink-0" /> {t.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="label">Motivo / justificación *</label>
              <textarea className="input" rows={2} required minLength={10} maxLength={1000}
                placeholder="P. ej. «Licitación X: debe adjuntar el procedimiento vigente al pliego»"
                value={nuevo.motivo} onChange={(e) => setNuevo({ ...nuevo, motivo: e.target.value })} />
              <p className="ayuda">Obligatorio. La persona lo recibe por correo y lo ve en la ficha del documento.</p>
            </div>
            <div>
              <label className="label">Vigente hasta {exigeFecha ? '*' : '(opcional)'}</label>
              <input type="date" className="input" min={hoyIso()} required={exigeFecha}
                value={nuevo.hasta} onChange={(e) => setNuevo({ ...nuevo, hasta: e.target.value })} />
              <p className="ayuda">
                {exigeFecha
                  ? 'Un permiso de descarga otorgado por el líder del proceso debe tener fecha de vencimiento (tope configurable en Parámetros).'
                  : 'Vacío = indefinido. Al vencer, el permiso deja de aplicar solo, sin que nadie lo apague.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-accent" disabled={guardando || !nuevo.correo || nuevo.motivo.trim().length < 10 || (exigeFecha && !nuevo.hasta)}>
              {guardando ? 'Otorgando…' : 'Otorgar permiso'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setNuevo(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {visibles.length === 0 ? (
        <p className="text-sm text-slate-400">
          {verHistorial ? 'Este documento no ha tenido permisos excepcionales.' : 'No hay permisos excepcionales vigentes.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3">Persona</th>
                <th className="py-1.5 pr-3">Permiso</th>
                <th className="py-1.5 pr-3">Motivo</th>
                <th className="py-1.5 pr-3">Vigencia</th>
                <th className="py-1.5 pr-3">Otorgó</th>
                <th className="py-1.5">Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const est = estadoPermiso(p);
                const atenuado = est !== 'vigente';
                return (
                  <tr key={p.id} className={`border-t border-slate-100 align-top ${atenuado ? 'text-slate-400' : ''}`}>
                    <td className="py-2 pr-3 break-all">{p.correo}</td>
                    <td className="py-2 pr-3">{TIPOS[p.tipo]?.texto || p.tipo}</td>
                    <td className="max-w-xs py-2 pr-3 whitespace-pre-wrap break-words">
                      {p.motivo}
                      {p.revocado && (
                        <div className="mt-1 text-xs text-rose-600">
                          Revocado por {p.revocado.por} el {fechaCorta(p.revocado.fecha)}: {p.revocado.motivo}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {fechaCorta(p.desde)} → {p.hasta ? fechaCorta(p.hasta) : 'indefinido'}
                    </td>
                    <td className="py-2 pr-3 break-all">{p.otorgadoPor}<div className="text-xs">{fechaCorta(p.fecha)}</div></td>
                    <td className="py-2"><span className={`badge ${ESTADO[est].clase}`}>{ESTADO[est].texto}</span></td>
                    <td className="py-2 pl-2 text-right">
                      {est === 'vigente' && (
                        <button type="button" className="btn-secondary text-rose-600" onClick={() => revocar(p)} title="Revocar con motivo">
                          <Ban className="h-4 w-4" /> Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Aviso para la persona beneficiaria, en la cabecera de la ficha.
export function AvisoMiPermiso({ permisos }) {
  if (!permisos || !permisos.length) return null;
  return (
    <div className="card border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          {permisos.map((p) => (
            <div key={p.id}>
              Tiene un permiso excepcional de <strong>{TIPOS[p.tipo]?.texto.toLowerCase() || p.tipo}</strong> sobre este documento,
              otorgado por {p.otorgadoPor} el {fechaCorta(p.fecha)}
              {p.hasta ? <> y vigente hasta el <strong>{fechaCorta(p.hasta)}</strong></> : ' sin fecha de vencimiento'}.
              <div className="text-xs text-emerald-700">Motivo: {p.motivo}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
