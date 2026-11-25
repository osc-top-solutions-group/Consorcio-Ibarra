import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Bell, Inbox, ArrowRight } from 'lucide-react';
import { api, fechaCorta } from '@/shared/api';
import { MODULOS } from '@/app/menu';

const TIPO_TEXTO = {
  elaboracion: 'Elaboración',
  revision: 'Revisión',
  aprobacion: 'Aprobación',
  solicitud: 'Solicitud',
  indicador: 'Alimentar indicador',
  accion: 'Plan de acción',
  auditoria: 'Auditoría',
  auditoria_respuesta: 'Responder hallazgo de auditoría',
  auditoria_evaluacion: 'Evaluar auditores',
  visar_contrato: 'Visar contrato',
  tthh_firmar_paz_y_salvo: 'Firmar paz y salvo',
  tthh_capacitacion: 'Asistir a capacitación',
  accesos_aprobar_solicitud: 'Aprobar solicitud de acceso',
  tthh_registrar_asistencia: 'Registrar asistencia de capacitación',
  tthh_evaluar_desempeno: 'Evaluación de desempeño por hacer',
  tthh_retroalimentar_desempeno: 'Registrar la retroalimentación de desempeño',
  tthh_plan_desempeno: 'Elaborar el plan de acción de desempeño',
  planeacion_diagnostico: 'Realizar diagnóstico DOFA',
  planeacion_subactividad: 'Ejecutar subactividad de la planeación',
  planeacion_seguimiento: 'Registrar el seguimiento del mes de una iniciativa'
};

// Bandeja única de tareas: transversal a todos los módulos.
export default function Pendientes() {
  const [pendientes, setPendientes] = useState([]);
  const [notificaciones, setNotificaciones] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/pendientes').then(setPendientes).catch((e) => setError(e.message));
    api('/pendientes/notificaciones').then(setNotificaciones).catch(() => {});
  }, []);

  const nombreModulo = (id) => (MODULOS.find((m) => m.id === id) || {}).nombre || id;

  // Agrupa por módulo para que se entienda de dónde viene cada tarea.
  const porModulo = pendientes.reduce((acc, p) => {
    (acc[p.modulo] = acc[p.modulo] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="titulo-pagina">Mis Pendientes</h1>
        <p className="subtitulo-pagina">Tareas asignadas a usted.</p>
      </div>

      {error && <div className="card border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

      {pendientes.length === 0 ? (
        <div className="card flex items-center gap-3 py-10 text-sm text-slate-400">
          <Inbox className="h-5 w-5" /> No tiene tareas pendientes.
        </div>
      ) : (
        Object.entries(porModulo).map(([modulo, items]) => (
          <div key={modulo} className="card">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <ClipboardCheck className="h-5 w-5 text-accent" /> {nombreModulo(modulo)}
              <span className="badge bg-accent-soft text-accent">{items.length}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {items.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{p.titulo}</div>
                    <div className="text-xs text-slate-500">
                      {TIPO_TEXTO[p.tipo] || p.tipo} · asignada el {fechaCorta(p.createdAt)}
                    </div>
                  </div>
                  {p.ruta && (
                    <Link to={p.ruta} className="btn-accent shrink-0">
                      Atender <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <div className="card">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <Bell className="h-5 w-5 text-primary" /> Notificaciones recientes
        </div>
        {notificaciones.length === 0 ? (
          <div className="py-4 text-sm text-slate-400">Sin notificaciones.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notificaciones.slice(0, 10).map((n) => (
              <li key={n.id} className="py-2">
                <div className="text-sm font-medium">{n.asunto}</div>
                <div className="text-xs text-slate-500">{n.cuerpo} · {fechaCorta(n.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
