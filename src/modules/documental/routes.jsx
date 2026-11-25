// Rutas del módulo de Gestión Documental. App.jsx solo las compone,
// igual que index.js del backend monta forms/documental con app.use().
import { Route, Navigate } from 'react-router-dom';
import ListadoMaestro from './pages/ListadoMaestro.jsx';
import DocumentoNuevo from './pages/DocumentoNuevo.jsx';
import DocumentoDetalle from './pages/DocumentoDetalle.jsx';
import Obsoletos from './pages/Obsoletos.jsx';
import Externos from './pages/Externos.jsx';
import Solicitudes from './pages/Solicitudes.jsx';
import Glosario from './pages/Glosario.jsx';
import MapaProcesos from './pages/MapaProcesos.jsx';

export const rutasDocumental = (
  <>
    <Route path="/documental" element={<Navigate to="/documental/documentos" replace />} />
    <Route path="/documental/documentos" element={<ListadoMaestro />} />
    <Route path="/documental/documentos/nuevo" element={<DocumentoNuevo />} />
    <Route path="/documental/documentos/:id" element={<DocumentoDetalle />} />
    <Route path="/documental/obsoletos" element={<Obsoletos />} />
    <Route path="/documental/externos" element={<Externos />} />
    <Route path="/documental/solicitudes" element={<Solicitudes />} />
    <Route path="/documental/glosario" element={<Glosario />} />
    <Route path="/documental/mapa-procesos" element={<MapaProcesos />} />
    {/* Ruta heredada de la versión anterior del menú */}
    <Route path="/mapa-procesos" element={<Navigate to="/documental/mapa-procesos" replace />} />
  </>
);
