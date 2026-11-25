import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList, AlertTriangle, Clock, FileCheck2, Lock, Wrench } from 'lucide-react';
import { MODULOS } from '@/app/menu';
import { estadoModulo } from '@/shared/proximamente';
import { api } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';

// Portada: resumen accionable y entrada a los módulos.
export default function Home() {
  const { usuario } = useAuth();
  const [pendientes, setPendientes] = useState([]);
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    // Si un widget falla, se degrada en silencio en lugar de romper el Home.
    api('/pendientes').then(setPendientes).catch(() => {});
    api('/documental/documentos').then(setDocs).catch(() => {});
  }, []);

  const vencidas = docs.filter((d) => d.alertaRevision === 'vencida');
  const proximas = docs.filter((d) => d.alertaRevision === 'proxima');
  const vigentes = docs.filter((d) => d.estado === 'vigente');

  const INDICADORES = [
    { etiqueta: 'Tareas pendientes', valor: pendientes.length, icono: ClipboardList, a: '/pendientes', tono: pendientes.length ? 'acento' : 'neutro' },
    { etiqueta: 'Documentos vigentes', valor: vigentes.length, icono: FileCheck2, a: '/documental/documentos?estado=vigente', tono: 'neutro' },
    { etiqueta: 'Revisión vencida', valor: vencidas.length, icono: AlertTriangle, a: '/documental/documentos', tono: vencidas.length ? 'critico' : 'neutro' },
    { etiqueta: 'Revisión próxima', valor: proximas.length, icono: Clock, a: '/documental/documentos', tono: proximas.length ? 'alerta' : 'neutro' }
  ];

  const TONOS = {
    neutro: 'text-slate-800',
    acento: 'text-accent',
    critico: 'text-rose-600',
    alerta: 'text-amber-600'
  };

  const primerNombre = (usuario?.nombre || '').split(' ')[0];

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl bg-surface-dark px-8 py-9 text-white">
        <div className="flex items-center justify-between gap-8">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Sistema de Gestión
            </div>
            <h1 className="text-3xl font-bold leading-tight">
              Hola{primerNombre ? `, ${primerNombre}` : ''}.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Gestor Documental del Gobierno Autónomo Descentralizado Municipal San Miguel de Ibarra:
              políticas, procedimientos, formatos y demás documentos controlados, con su ciclo de
              revisión y aprobación, versiones y control de cambios en un solo lugar.
            </p>
          </div>
          <div className="hidden shrink-0 rounded-xl bg-white p-3 lg:block">
            <img src="/logo-gad-ibarra.png" alt="GAD Municipal San Miguel de Ibarra" className="h-16 w-auto" />
          </div>
        </div>
      </section>

      {/* Resumen accionable */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {INDICADORES.map(({ etiqueta, valor, icono: Icono, a, tono }) => (
          <Link key={etiqueta} to={a} className="card transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <div className={`text-3xl font-bold ${TONOS[tono]}`}>{valor}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</div>
              </div>
              <Icono className={`h-5 w-5 ${TONOS[tono]}`} />
            </div>
          </Link>
        ))}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-800">Módulos</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {MODULOS.map((m) => <TarjetaModulo key={m.id} modulo={m} estado={estadoModulo(m, usuario)} />)}
        </div>
      </section>
    </div>
  );
}

function TarjetaModulo({ modulo, estado }) {
  const { nombre, descripcion, ruta, icono: Icono, conecta } = modulo;
  const activo = estado !== 'proximamente';
  const enPreparacion = estado === 'preparacion';

  const contenido = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          activo ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
        }`}>
          <Icono className="h-5 w-5" />
        </div>
        {enPreparacion
          ? <span className="badge bg-amber-50 text-amber-700"><Wrench className="h-3 w-3" /> En preparación · solo administradores</span>
          : activo
            ? <span className="badge bg-accent-soft text-accent">Disponible</span>
            : <span className="badge bg-slate-100 text-slate-500"><Lock className="h-3 w-3" /> Próximamente</span>}
      </div>

      <h3 className={`mt-3 font-bold ${activo ? 'text-slate-800' : 'text-slate-500'}`}>{nombre}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">{descripcion}</p>

      {conecta?.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {conecta.map((texto) => (
            <li key={texto} className="flex gap-2 text-xs leading-relaxed text-slate-400">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {texto}
            </li>
          ))}
        </ul>
      )}

      {activo && (
        <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          Entrar <ArrowRight className="h-4 w-4" />
        </div>
      )}
    </>
  );

  if (!activo) {
    return <div className="card cursor-not-allowed opacity-70">{contenido}</div>;
  }
  return (
    <Link to={ruta} className="card block transition-shadow hover:border-primary/30 hover:shadow-md">
      {contenido}
    </Link>
  );
}
