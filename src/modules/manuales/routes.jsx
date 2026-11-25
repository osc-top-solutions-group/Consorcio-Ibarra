// Rutas de los manuales de usuario.
//
// No son un módulo del SGC en el sentido de MODULOS (no tienen backend, ni
// colecciones, ni permisos): son documentación de la propia herramienta, y por
// eso viven en el menú transversal, junto a «Mis Pendientes», y se alcanzan
// desde cualquier módulo.
import { Route } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import ManualesIndice from './pages/ManualesIndice.jsx';
import ManualesModulo from './pages/ManualesModulo.jsx';
import ManualVisor from './pages/ManualVisor.jsx';
import { getModulo } from './data/index.js';

// `/manuales/<id>` es un módulo con varios manuales (su portada) o un manual
// (el visor): el id decide. Así el enlace a un módulo es tan corto como el de
// un manual y el correo puede apuntar a cualquiera de los dos.
function ManualOModulo() {
  const { id } = useParams();
  return getModulo(id) ? <ManualesModulo /> : <ManualVisor />;
}

export const rutasManuales = (
  <>
    <Route path="/manuales" element={<ManualesIndice />} />
    <Route path="/manuales/:id" element={<ManualOModulo />} />
  </>
);
