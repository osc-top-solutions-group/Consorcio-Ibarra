import { Eye, Download, Lock } from 'lucide-react';
import { CONFIDENCIALIDAD } from '@/shared/api';
import SelectorAudiencia from './SelectorAudiencia.jsx';
import SelectorEmpleados from '@/shared/components/SelectorEmpleados.jsx';

// PERMISOS DE ACCESO DEL DOCUMENTO — quién lo consulta.
//
// No todos los documentos se publican a todo el mundo dentro de su alcance: hay
// procedimientos que solo aplican a un equipo.
//
// El alcance por sede sigue mandando por encima de esto: la audiencia acota
// dentro del alcance, nunca lo amplía.
//
// LA DESCARGA YA NO SE CONFIGURA AQUÍ (2026-09-25). Antes había tres modos por
// documento; hoy la regla general es una sola: solo descargan el administrador
// global de la plataforma y el administrador del módulo documental. La ÚNICA
// excepción (2026-11-04) es nominal: un permiso excepcional por persona, con
// motivo y vigencia, que se otorga desde el panel «Permisos excepcionales» de la
// ficha (PermisosExcepcionales.jsx) y no desde aquí. Se deja el bloque
// informativo porque quien buscaba aquí el ajuste necesita saber a dónde fue.
// La regla vive en el backend (DocumentosService.puedeDescargarPdf).

// Modo actual deducido del propio documento: la interfaz no guarda un campo
// aparte para el modo, para que no pueda quedar desalineado con los datos.
export function modoVisualizacionDe(valor) {
  return (valor.audienciaVisualizacion || []).length ? 'restringida' : 'todos';
}

// Lista de correos con acceso a un documento CONFIDENCIAL. Es un filtro
// distinto de la audiencia: la audiencia acota quién lo consulta dentro del
// alcance, la confidencialidad (ISO 27001) reserva el documento a personas
// concretas además de quienes lo administran o participan en su flujo.
export function ListaAccesoConfidencial({ valor, onChange }) {
  return (
    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
      <label className="label">Personas con acceso al documento confidencial</label>
      <SelectorEmpleados seleccion={valor.accesoConfidencial || []}
        onChange={(lista) => onChange({ ...valor, accesoConfidencial: lista })} />
      <p className="ayuda">
        Además de esta lista lo ven los administradores, el líder del proceso y quienes participen en su flujo.
        {(valor.accesoConfidencial || []).length === 0 && ' Mientras esté vacía, nadie más lo alcanza.'}
      </p>
    </div>
  );
}

// `conConfidencialidad` agrega la clasificación al panel: al editar un documento
// existente es la única vía para cambiarla (al crear, va con la clasificación).
export default function PermisosAcceso({ valor, onChange, modos, setModos, conConfidencialidad = false }) {
  const visual = modos.visualizacion;

  function cambiarConfidencialidad(nivel) {
    onChange({
      ...valor,
      confidencialidad: nivel,
      // Bajar de confidencial vacía la lista (misma regla que el backend).
      accesoConfidencial: nivel === 'confidencial' ? valor.accesoConfidencial || [] : []
    });
  }

  function cambiarVisualizacion(modo) {
    setModos({ ...modos, visualizacion: modo });
    // Volver a "todos" limpia la lista: dejarla guardada como restricción
    // invisible es la forma segura de que nadie entienda por qué no ve un
    // documento seis meses después.
    if (modo === 'todos') onChange({ ...valor, audienciaVisualizacion: [] });
  }

  return (
    <div className="space-y-5">
      {conConfidencialidad && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Lock className="h-4 w-4 text-primary" /> Confidencialidad (ISO 27001)
          </div>
          <Opciones
            nombre="confidencialidad"
            activo={valor.confidencialidad || 'interno'}
            onChange={cambiarConfidencialidad}
            opciones={[
              ['publico', CONFIDENCIALIDAD.publico.texto, 'Lo consulta cualquier colaborador dentro del alcance.'],
              ['interno', CONFIDENCIALIDAD.interno.texto, 'Uso interno: cualquier colaborador autenticado dentro del alcance.'],
              ['confidencial', CONFIDENCIALIDAD.confidencial.texto, 'Solo las personas de la lista, además de quienes lo administran.']
            ]} />
          {(valor.confidencialidad || 'interno') === 'confidencial' && (
            <ListaAccesoConfidencial valor={valor} onChange={onChange} />
          )}
        </div>
      )}

      <div className={conConfidencialidad ? 'border-t border-slate-100 pt-4' : ''}>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Eye className="h-4 w-4 text-primary" /> Visualización
        </div>
        <Opciones
          nombre="visualizacion"
          activo={visual}
          onChange={cambiarVisualizacion}
          opciones={[
            ['todos', 'Todos los colaboradores del alcance', 'Cualquiera que alcance el documento por su alcance y confidencialidad.'],
            ['restringida', 'Solo estas personas', 'Por usuarios, cargos, áreas, grupos o sedes.']
          ]} />
        {visual === 'restringida' && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <SelectorAudiencia
              titulo="Quiénes pueden consultar el documento"
              seleccion={valor.audienciaVisualizacion || []}
              onChange={(a) => onChange({ ...valor, audienciaVisualizacion: a })} />
            {(valor.audienciaVisualizacion || []).length === 0 && (
              <p className="ayuda !text-amber-700">
                Mientras no agregue a nadie, el documento se comporta como sin restricción.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Download className="h-4 w-4 text-primary" /> Descarga e impresión del PDF
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">No se configura por audiencia.</p>
          <p className="mt-1 leading-snug">
            Solo descargan el PDF los <strong>administradores globales de la plataforma</strong> y
            los <strong>administradores del módulo de Gestión Documental</strong>. Todos los demás
            consultan el documento completo en línea, dentro del visor.
          </p>
          <p className="ayuda mt-2">
            Si una persona concreta necesita descargarlo (una licitación, una auditoría externa), el
            camino es un <strong>permiso excepcional</strong> desde el panel «Permisos excepcionales por
            persona» de la ficha: nominal, con motivo obligatorio y vigencia, y auditado. Un documento
            controlado que sale como archivo deja de estar controlado, por eso no se abre por grupos.
          </p>
        </div>
      </div>
    </div>
  );
}

function Opciones({ nombre, activo, onChange, opciones }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {opciones.map(([id, texto, ayuda]) => (
        <button type="button" key={id} onClick={() => onChange(id)}
          className={`rounded-lg border p-3 text-left transition-colors ${
            activo === id ? 'border-primary bg-primary-soft' : 'border-slate-200 hover:border-slate-300'
          }`}
          aria-pressed={activo === id} aria-label={`${nombre}: ${texto}`}>
          <div className={`text-sm font-semibold ${activo === id ? 'text-primary' : 'text-slate-700'}`}>{texto}</div>
          <div className="mt-0.5 text-xs leading-snug text-slate-500">{ayuda}</div>
        </button>
      ))}
    </div>
  );
}
