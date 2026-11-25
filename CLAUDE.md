# Gestor Documental (GAD Ibarra) — instrucciones del proyecto

Copia del módulo Gestión Documental del SGC OSC Qualita, como aplicación propia
para demostración: React 19 + Vite / Node 24 + Express / Firestore / Cloud Storage.
Un solo Cloud Run, público, **sin IAP y sin login** (pantalla de ingreso que
elige usuario). Arquitectura, identidad, despliegue y costo: [README.md](README.md).

## Reglas

- **Política de costo de Firestore**: leer [docs/POLITICA-COSTOS.md](docs/POLITICA-COSTOS.md)
  antes de escribir una consulta. `page()` para listados, `contar()` para totales,
  `list()` solo sobre `CATALOGOS_LISTABLES` (`backend/lib/db.js`). Nunca `offset`.
- **Nada se borra físicamente** (trazabilidad ISO): inactivación lógica. `removeHard` solo para catálogos.
- **Toda escritura audita** con `lib/audit.js`.
- **Los archivos se abren en el visor de la herramienta**, nunca en otra pestaña
  (`EnlaceArchivo` de `src/shared/components/VisorArchivo.jsx`); el backend rechaza
  con 403 un `inline` sin `X-Requested-With`. La descarga es solo para administradores,
  salvo tipos «formato» y permisos excepcionales por persona.
- **Identidad**: `backend/lib/sesion.js` es el único sitio que sabe cómo se
  identifica una petición; `lib/permisos.js` compone identidad + motor de accesos.
  Las personas viven en el catálogo `usuarios` (`core/empleados` lo expone como directorio).
- **Catálogos en código**: recursos de acceso en `core/accesos/registry.js`,
  configuración en `core/config/registro.js`, formularios en `core/formularios/definicion.js`.
  Un catálogo nuevo se declara ahí y en `AMBITOS` / `CATALOGOS_LISTABLES` de `lib/db.js`.
- **Comentarios en español**, explicando el *por qué*.
- `SGC_ROOT=sgc_dev` en local; **nunca** correr pruebas con `SGC_ROOT=sgc` (es la demostración).

## Desarrollo

```powershell
cd backend; npm start      # :8080 (PORT en backend/.env si está ocupado)
npm run dev                # :5173 (SGC_API / SGC_PUERTO en .env de la raíz)
cd backend; node pruebas/preparar.js; npm test   # contra el backend en ejecución
```
