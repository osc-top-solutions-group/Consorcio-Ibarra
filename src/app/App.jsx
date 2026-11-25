import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import { useAuth } from '@/shared/context/AuthContext.jsx';
import { rutasInicio } from '@/modules/inicio/routes.jsx';
import { rutasDocumental } from '@/modules/documental/routes.jsx';
import { rutasAdmin } from '@/modules/admin/routes.jsx';
import { rutasManuales } from '@/modules/manuales/routes.jsx';
import Ingreso from '@/modules/inicio/pages/Ingreso.jsx';

export default function App() {
  const { cargando, error, sinSesion } = useAuth();
  if (cargando) return <Pantalla texto="Cargando…" />;
  // Sin cookie de sesión el backend responde 401: se muestra la pantalla de
  // ingreso, donde la persona elige con quién entra (no hay login).
  if (sinSesion) return <Ingreso />;
  if (error) return <Pantalla texto={`No fue posible autenticar: ${error}`} tono="text-rose-600" />;

  return (
    <Routes>
      <Route element={<Layout />}>
        {rutasInicio}
        {rutasDocumental}
        {rutasAdmin}
        {rutasManuales}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Pantalla({ texto, tono = 'text-slate-500' }) {
  return <div className={`flex h-screen items-center justify-center text-sm ${tono}`}>{texto}</div>;
}
