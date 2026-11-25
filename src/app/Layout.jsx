import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutGrid, ChevronLeft, Lock, LogOut } from 'lucide-react';
import { estadoModulo } from '@/shared/proximamente';
import { MENU_DOCUMENTAL, MENU_TRANSVERSAL, MENU_ADMIN, moduloDe } from '@/app/menu';
import { api } from '@/shared/api';
import { useAuth } from '@/shared/context/AuthContext.jsx';

// Menú lateral por módulo. Al agregar un módulo se registra su menú aquí.
const MENUS = {
  documental: MENU_DOCUMENTAL
};

export default function Layout() {
  const { usuario, salir } = useAuth();
  const { pathname } = useLocation();
  const [pendientes, setPendientes] = useState(0);

  const modulo = moduloDe(pathname);
  // Módulo cerrado por el parámetro `modulosProximamente` para esta persona:
  // ni menú ni pantalla; se le muestra «Próximamente». El backend también
  // responde 403, esto solo evita que llegue a una pantalla rota.
  const cerrado = !!modulo && estadoModulo(modulo, usuario) === 'proximamente';
  const menuModulo = (cerrado ? [] : (modulo ? MENUS[modulo.id] || [] : []))
    .filter((i) => !i.roles || i.roles.includes(usuario?.rol))
    // `recursos`: basta con tener UNO (el administrador del módulo los tiene todos).
    .filter((i) => !i.recursos || i.recursos.some((r) => usuario?.permisos?.[r]));
  const menuAdmin = MENU_ADMIN.filter((i) => usuario?.permisos?.[i.recurso]);

  // El contador se refresca al navegar: basta para reflejar tareas atendidas.
  useEffect(() => {
    api('/pendientes').then((p) => setPendientes(p.length)).catch(() => {});
  }, [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col bg-surface-dark text-slate-200">
        {/* Marca del cliente sobre una tarjeta blanca: el sidebar es oscuro y el
            logo es a color sobre fondo claro. Los archivos viven en public/. */}
        <Link to="/" className="block border-b border-white/10 px-5 py-4">
          <div className="rounded-lg bg-white px-3 py-2">
            <img src="/logo-ibarra.png" alt="Alcaldía de Ibarra" className="mx-auto h-10 w-auto" />
          </div>
          <div className="mt-2 text-[11px] font-semibold text-slate-300">Gestor Documental</div>
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <Item item={{ a: '/', icono: LayoutGrid, texto: 'Inicio', exacto: true }} />
          {MENU_TRANSVERSAL.map((item) => (
            <Item key={item.a} item={item}
              insignia={item.a === '/pendientes' ? (pendientes || null) : null} />
          ))}

          {menuModulo.length > 0 && (
            <div className="pt-5">
              <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {modulo.nombre}
              </div>
              {menuModulo.map((item) => <Item key={item.a} item={item} />)}
            </div>
          )}

          {/* Solo se muestra lo que la persona puede abrir según sus accesos.
              Ocultarlo es UX: el backend revalida cada petición. */}
          {menuAdmin.length > 0 && (
            <div className="pt-5">
              <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Administración
              </div>
              {menuAdmin.map((item) => <Item key={item.a} item={item} />)}
            </div>
          )}
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">
          GAD Municipal San Miguel de Ibarra
        </div>
      </aside>

      {/* `min-w-0` es obligatorio aquí: sin él, este hijo del flex crece hasta
          el ancho mínimo de su contenido, y una tabla ancha empuja la barra
          horizontal de TODA la página en vez de desplazarse dentro de su propio
          contenedor `overflow-x-auto`. */}
      <div className="ml-64 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
          {modulo && (
            <Link to="/" className="btn-ghost -ml-3 shrink-0">
              <ChevronLeft className="h-4 w-4" /> Inicio
            </Link>
          )}
          <div className="min-w-0 flex-1">
            {modulo && <div className="truncate text-sm font-semibold text-slate-700">{modulo.nombre}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold leading-tight">{usuario?.nombre}</div>
              <div className="text-xs text-slate-500">
                {usuario?.cargo || usuario?.correo} · {usuario?.rol}
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
              {(usuario?.nombre || '?').slice(0, 1).toUpperCase()}
            </div>
            {/* Sin login no hay «cerrar sesión» real: esto borra la cookie y
                vuelve a la pantalla de ingreso para entrar como otra persona. */}
            <button type="button" onClick={salir} className="btn-ghost" title="Cambiar de usuario">
              <LogOut className="h-4 w-4" /> Salir
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">
          {cerrado ? <Proximamente modulo={modulo} /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

// Pantalla de un módulo cerrado por `modulosProximamente`.
function Proximamente({ modulo }) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
        <Lock className="h-6 w-6 text-slate-400" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-700">{modulo.nombre}: próximamente</h1>
      <p className="mt-2 text-sm text-slate-500">
        Este módulo todavía no está disponible. Se anunciará cuando entre en funcionamiento.
      </p>
      <Link to="/" className="btn-secondary mt-6 inline-flex"><ChevronLeft className="h-4 w-4" /> Volver al inicio</Link>
    </div>
  );
}

function Item({ item, insignia }) {
  const { a, icono: Icono, texto, exacto, pendiente } = item;

  if (pendiente) {
    return (
      <div
        title={`Disponible en la ${pendiente.toLowerCase()}`}
        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500"
      >
        <Icono className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{texto}</span>
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold uppercase">{pendiente}</span>
      </div>
    );
  }

  return (
    <NavLink
      to={a}
      end={exacto}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-accent text-white' : 'text-slate-300 hover:bg-white/10'
        }`
      }
    >
      <Icono className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{texto}</span>
      {insignia ? (
        <span className="rounded-full bg-white/20 px-1.5 text-[11px] font-bold">{insignia}</span>
      ) : null}
    </NavLink>
  );
}
