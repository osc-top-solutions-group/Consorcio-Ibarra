console.log(`[runtime] Node ${process.version} (${process.platform}/${process.arch})`);
// Gestor Documental — Backend (Express sobre Firestore y Cloud Storage).
//
// Es el módulo de Gestión Documental del SGC, extraído como aplicación propia:
// un solo proceso sirve la API bajo /api y, en producción, la interfaz compilada
// (carpeta ../dist). Así un único Cloud Run atiende todo, sin balanceador.
//
// Variables de entorno locales (.env). En Cloud Run las inyecta la plataforma:
// dotenv no sobreescribe lo que ya existe en process.env, así que es inocuo allí.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { conUsuario, exige, bloquearEscrituraCruzada } = require('./lib/permisos');
const { moduloHabilitado } = require('./core/config/modulos');

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

const app = express();
// Detrás del proxy de Cloud Run: req.ip y req.protocol salen de X-Forwarded-*.
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '5mb' }));

// `lecturas` publica el contador de documentos leídos de Firestore desde que
// arrancó el proceso: es la forma de medir el costo de una pantalla sin abrir
// la consola de facturación. Ver docs/POLITICA-COSTOS.md.
app.get('/api/health', (req, res) => res.json({
  ok: true,
  servicio: 'gestor-documental',
  raiz: require('./lib/db').RAIZ,
  almacenamiento: require('./lib/storage').descripcion(),
  correo: require('./lib/mailer').descripcion(),
  lecturas: require('./lib/db').lecturasAcumuladas(),
  cache: require('./lib/cache').estado(),
  fecha: new Date().toISOString()
}));

// Ingreso sin login: antes de conUsuario, porque es lo que crea la identidad.
app.use('/api/sesion', require('./api/sesion').router);

// Todo lo demás requiere identidad (cookie de sesión; en local, DEV_USER_EMAIL).
app.use('/api', conUsuario);
// Escrituras solo desde el propio sitio (CSRF): ver lib/permisos.js.
app.use('/api', bloquearEscrituraCruzada);

// ---- Servicios transversales ----
app.use('/api/profile', require('./api/profile').router);
app.use('/api/config', require('./core/config').router);
app.use('/api/pendientes', require('./core/pendientes').router);
app.use('/api/empleados', require('./core/empleados').router);
app.use('/api/accesos', require('./core/accesos').router);
app.use('/api/formularios', require('./core/formularios').router);

// ---- Módulo de negocio ----
app.use('/api/documental', moduloHabilitado('documental'), exige('modulo.documental'), require('./forms/documental').router);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no existe' }));

// ---- Interfaz compilada (producción) ----
//
// `npm run build` en la raíz deja la SPA en ../dist. Los assets llevan hash en
// el nombre y son inmutables; el index.html nunca se cachea, para que un
// despliegue nuevo se vea de inmediato. Cualquier ruta que no sea un archivo
// cae en index.html para que React Router resuelva la navegación.
const DIST = path.join(__dirname, '..', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(DIST, { index: false, maxAge: 0 }));
  app.get(/.*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(DIST, 'index.html'));
  });
  console.log('[sgc-api] sirviendo la interfaz desde', DIST);
} else {
  console.log('[sgc-api] sin ../dist: en desarrollo la interfaz la sirve Vite (npm run dev)');
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(
  `[sgc-api] escuchando en :${PORT} · raíz ${require('./lib/db').RAIZ}` +
  ` (usuario dev: ${process.env.DEV_USER_EMAIL || 'no definido'})`
));
