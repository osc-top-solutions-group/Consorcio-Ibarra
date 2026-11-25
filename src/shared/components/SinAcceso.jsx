import { Link } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';

// Pantalla para el 403: «no tiene acceso», dicho de frente.
//
// Por qué existe. Las fichas de la plataforma se enlazan desde fuera —la
// Batería de Indicadores del Portal BI apunta a la ficha del indicador, un
// correo de pendientes apunta al documento—. Quien llega por uno de esos
// enlaces sin el acceso correspondiente recibía un recuadro rojo con el texto
// crudo de la API, que se lee como si la plataforma se hubiera roto. No se
// rompió nada: simplemente no tiene ese permiso, y lo que necesita es saber
// QUÉ pedir y A QUIÉN, no un mensaje de error.
//
// Deliberadamente NO dice qué contiene el recurso ni si existe: confirmar la
// existencia de una ficha a quien no puede verla ya es filtrar información.
export default function SinAcceso({
  titulo = 'No tiene acceso a esta página',
  detalle,
  correo,
  volverA,
  volverTexto = 'Volver'
}) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
        <Lock className="h-6 w-6 text-slate-400" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-700">{titulo}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {detalle || 'Su usuario no tiene habilitado este acceso en la plataforma.'}
      </p>
      <p className="mt-4 text-sm text-slate-500">
        Si necesita consultarla, solicítelo al dueño del proceso o al administrador
        del módulo desde <span className="font-semibold">Gestión de Accesos</span>.
      </p>
      {correo && (
        <p className="mt-3 text-xs text-slate-400">
          Está ingresando como <span className="font-mono">{correo}</span>.
        </p>
      )}
      <div className="mt-6 flex justify-center gap-2">
        {volverA && (
          <Link to={volverA} className="btn-secondary">
            <ArrowLeft className="h-4 w-4" /> {volverTexto}
          </Link>
        )}
        <Link to="/" className="btn-secondary">Ir a los módulos</Link>
      </div>
    </div>
  );
}
