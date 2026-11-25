import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// La configuración se lee de un `.env` en la raíz del proyecto (ignorado por
// git), y no solo de la variable exportada en la terminal.
//
// Por qué: en una máquina donde convive la Intranet, sus puertos 8080 y 5173 ya
// están tomados, y el SGC tiene que correr en otros. Depender de exportar
// `SGC_API` en cada terminal significa que tarde o temprano alguien abre `npm
// run dev` sin ella, el proxy apunta al backend de la Intranet y `/api/equipos`
// devuelve un 404 que parece del SGC pero no lo es. Con el `.env` la máquina
// queda configurada una vez.
//
// Precedencia: variable de entorno > .env > valor por defecto.
export default defineConfig(({ mode }) => {
  // Prefijo vacío: aquí no se exponen variables al cliente, se configura el
  // servidor de desarrollo, así que no aplica la convención VITE_.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };

  return {
    plugins: [react()],
    resolve: {
      // '@' apunta a src/ para que los imports entre módulos no dependan de la
      // profundidad de carpetas (jsconfig.json replica el alias para el editor).
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
    },
    server: {
      // Puerto fijo del servidor de desarrollo. `strictPort` es deliberado: sin
      // él Vite salta al siguiente puerto libre cuando el elegido está ocupado,
      // y se termina con tres instancias en 5173, 5174 y 5175 sin saber cuál
      // apunta a qué. Es mejor que falle y lo diga.
      port: Number(env.SGC_PUERTO) || 5173,
      strictPort: true,
      proxy: {
        // Backend del SGC. Por defecto :8080, que es donde corre en una máquina
        // limpia; con la Intranet al lado se apunta a otro puerto desde el .env.
        '/api': env.SGC_API || 'http://localhost:8080'
      }
    }
  };
});
