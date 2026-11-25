import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/shared/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [sinSesion, setSinSesion] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setSinSesion(false);
    return api('/profile')
      .then(setUsuario)
      .catch((e) => {
        // 401 = no hay sesión: no es un error, es la pantalla de ingreso.
        if (e.status === 401) setSinSesion(true);
        else setError(e.message);
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function salir() {
    try { await api('/sesion', { method: 'DELETE' }); } catch { /* la cookie se borra igual */ }
    setUsuario(null);
    setSinSesion(true);
  }

  return (
    <AuthContext.Provider value={{ usuario, cargando, error, sinSesion, recargar: cargar, salir }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
