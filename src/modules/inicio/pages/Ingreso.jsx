import { useEffect, useState } from 'react';
import { KeyRound, LogIn, UserRound, Loader2 } from 'lucide-react';
import { api } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';

// Pantalla de ingreso SIN login (instalación de demostración).
//
// A la izquierda, los usuarios registrados (Configuración › Usuarios): se entra
// eligiéndolos, y si tienen clave hay que escribirla. A la derecha, cualquier
// persona entra como visitante con su nombre, con los permisos de un
// colaborador: consulta la documentación vigente.
export default function Ingreso() {
  const { recargar } = useAuth();
  const [usuarios, setUsuarios] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [clave, setClave] = useState('');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api('/sesion/usuarios').then(setUsuarios).catch((e) => { setUsuarios([]); setError(e.message); });
  }, []);

  async function entrar(body) {
    setEnviando(true);
    setError(null);
    try {
      await api('/sesion', { method: 'POST', body });
      await recargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  function elegir(u) {
    setError(null);
    setClave('');
    if (u.requiereClave) setElegido(u);
    else entrar({ correo: u.correo });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-light)] p-6">
      <div className="w-full max-w-4xl">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/logo-gad-ibarra.png" alt="GAD Municipal San Miguel de Ibarra" className="h-20 w-auto" />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Gestor Documental</h1>
            <p className="text-sm text-slate-500">Elija con quién desea entrar. Esta es una instalación de demostración: no tiene inicio de sesión.</p>
          </div>
        </div>

        {error && <div className="card mb-4 border-rose-200 bg-rose-50 text-sm text-rose-600">{error}</div>}

        <div className="grid gap-6 md:grid-cols-2">
          <section className="card space-y-3">
            <h2 className="font-bold text-slate-700">Usuarios registrados</h2>
            {usuarios === null && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>}
            {usuarios?.length === 0 && <div className="text-sm text-slate-400">No hay usuarios registrados: entre como visitante.</div>}
            {usuarios?.map((u) => (
              <div key={u.correo} className={`rounded-xl border p-3 ${elegido?.correo === u.correo ? 'border-primary bg-primary-soft' : 'border-slate-200'}`}>
                <button type="button" onClick={() => elegir(u)} disabled={enviando} className="flex w-full items-start gap-3 text-left">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                    {u.nombre.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      {u.nombre}
                      {u.requiereClave && <KeyRound className="h-3.5 w-3.5 text-slate-400" title="Requiere clave" />}
                    </div>
                    <div className="text-xs text-slate-500">{[u.cargo, u.area].filter(Boolean).join(' · ')}</div>
                    {u.descripcion && <div className="mt-1 text-xs text-slate-500">{u.descripcion}</div>}
                  </div>
                  <LogIn className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
                </button>
                {elegido?.correo === u.correo && (
                  <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); entrar({ correo: u.correo, clave }); }}>
                    <input className="input flex-1" type="password" placeholder="Clave de ingreso" value={clave} autoFocus
                      onChange={(e) => setClave(e.target.value)} />
                    <button className="btn-primary" type="submit" disabled={enviando}>Entrar</button>
                  </form>
                )}
              </div>
            ))}
          </section>

          <section className="card">
            <h2 className="font-bold text-slate-700">Entrar como visitante</h2>
            <p className="mt-1 text-sm text-slate-500">
              Consulta la documentación vigente, como cualquier colaborador. Su nombre queda en el registro de auditoría.
            </p>
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); entrar({ nombre, correo }); }}>
              <div>
                <label className="label">Nombre completo</label>
                <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" required minLength={3} />
              </div>
              <div>
                <label className="label">Correo (opcional)</label>
                <input className="input" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@ejemplo.com" />
              </div>
              <button className="btn-accent w-full" type="submit" disabled={enviando}>
                <UserRound className="h-4 w-4" /> Entrar como visitante
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
