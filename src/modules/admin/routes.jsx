// Rutas de Administración (accesos, catálogos y campos de los formularios).
import { Route } from 'react-router-dom';
import Admin from './pages/Admin.jsx';
import Accesos from './pages/Accesos.jsx';
import CamposFormularios from './pages/CamposFormularios.jsx';

export const rutasAdmin = (
  <>
    <Route path="/accesos" element={<Accesos />} />
    <Route path="/admin" element={<Admin />} />
    <Route path="/admin/campos" element={<CamposFormularios />} />
  </>
);
