// Rutas transversales: portada y bandeja de pendientes.
import { Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Pendientes from './pages/Pendientes.jsx';

export const rutasInicio = (
  <>
    <Route index element={<Home />} />
    <Route path="/pendientes" element={<Pendientes />} />
  </>
);
