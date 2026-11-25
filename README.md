# Gestor Documental — GAD Municipal San Miguel de Ibarra

Aplicación de **gestión documental** (listado maestro, ciclo de vida con revisión y
aprobación, versiones y control de cambios, documentos externos, solicitudes,
glosario y mapa de procesos), con su configuración (catálogos, campos de
formulario y accesos) y una pantalla de ingreso sin contraseña para demostración.

Es el módulo de Gestión Documental del SGC OSC Qualita, extraído como aplicación
propia. React 19 + Vite + Tailwind en el frontend; Node 24 + Express en el
backend; Firestore para los datos y Cloud Storage para los archivos.

---

## Cómo está armada

```
.
├── src/                     # Frontend (React). app/ (shell, menú), shared/, modules/{inicio,documental,admin,manuales}
├── backend/
│   ├── index.js             # API bajo /api y, en producción, la interfaz compilada (../dist)
│   ├── api/sesion.js        # Ingreso sin login (elige usuario / visitante)
│   ├── lib/                 # db (Firestore), storage (GCS o disco), sesion, permisos, audit, mailer (solo bandeja)
│   ├── core/                # config (catálogos), accesos (motor y catálogo de recursos), empleados (directorio = catálogo usuarios), pendientes, formularios
│   ├── forms/documental/    # El módulo: documentos, codificación, externos, solicitudes, permisos excepcionales
│   ├── seed/seed.js         # Catálogos, usuarios y accesos de arranque
│   └── pruebas/             # Pruebas end-to-end (ver abajo)
├── Dockerfile               # Una sola imagen: compila la SPA y la sirve el backend
├── deploy.ps1               # Despliegue a Cloud Run (público, sin IAP, capa gratuita)
└── infra/crear-infraestructura.ps1
```

Un solo Cloud Run atiende la API y la interfaz: no hay nginx, balanceador ni IAP.

### Identidad: sin login (a propósito)

Esta instalación es una demostración pública y temporal. En la pantalla de
ingreso cada persona **elige con quién entra**:

| Quién | Qué puede hacer |
|---|---|
| Usuarios registrados (Configuración › Usuarios) | Lo que digan sus accesos. Si el usuario tiene una **clave** en el catálogo, hay que escribirla; si no, basta elegirlo |
| Cualquier visitante, con su nombre | Consulta la documentación **vigente**, como un colaborador sin accesos. Queda registrado en el catálogo de usuarios y en la auditoría |

De arranque: **Cristian Moreno** y **Hernando Castellanos** son administradores de la plataforma (todo) y
**Elue** administra el módulo documental (revisa y aprueba los documentos de
todos los procesos, documentos externos y glosario). Se cambian desde Gestión
de Accesos; los datos de las personas, desde Configuración › Usuarios.

La cookie de sesión va firmada (`SESION_SECRETO`) para que la clave opcional no
se pueda saltar editando la cookie. Para pasar a un login real: reemplazar
`backend/lib/sesion.js` (quien pone `req.usuario` a partir de la petición) y la
pantalla `src/modules/inicio/pages/Ingreso.jsx`; nada más depende de cómo se
autentica.

### Lo que NO tiene (decisiones de la demostración)

- **Correo**: las notificaciones se registran en la bandeja interna («Mis
  Pendientes») y no se envían. `backend/lib/mailer.js › enviarCorreo` es el
  punto donde conectar un transporte (SMTP, Gmail, SendGrid…).
- **Recordatorios programados** (Cloud Scheduler) de decisiones pendientes: la
  ruta existe (`POST /api/documental/recordatorios/procesar`, solo
  administradores) pero nadie la invoca periódicamente.
- **Directorio corporativo**: las personas son el catálogo `usuarios`.

---

## Desarrollo local

Requiere Node 24 (≥ 24.22.1) y `gcloud` autenticado con acceso al proyecto.

```powershell
gcloud auth application-default login     # credenciales ADC para Firestore

cd backend
npm install
copy .env.example .env                    # GCP_PROJECT_ID, SGC_ROOT=sgc_dev
npm run seed                              # catálogos, usuarios y accesos en sgc_dev
npm start                                 # API en :8080

cd ..
npm install
npm run dev                               # interfaz en :5173, proxy /api → :8080
```

Si los puertos 8080 o 5173 están ocupados: `PORT=` en `backend/.env` y
`SGC_API` / `SGC_PUERTO` en un `.env` de la raíz (ver `.env.example`).

Sin `STORAGE_BUCKET` los archivos van a `backend/data/storage` (disco local).
`SGC_ROOT=sgc_dev` separa los datos de desarrollo de los de la demostración
(`sgc`), en la misma base de Firestore.

Con `DEV_USER_EMAIL` en `backend/.env` el backend asume esa identidad cuando no
hay cookie (se salta la pantalla de ingreso); sin ella se ve la pantalla de
ingreso igual que en la nube. El header `x-dev-user-email` siempre vale en
local (es lo que usan las pruebas). En Cloud Run ambos se ignoran.

### Pruebas

```powershell
cd backend
npm start                     # en otra terminal
node pruebas/preparar.js      # usuarios, procesos y sedes que las pruebas esperan (solo en raíces de desarrollo)
npm test
```

Son las suites del módulo documental del SGC original, que corren contra el
backend en ejecución actuando como distintas personas. Abortan si detectan la
raíz `sgc`. Con el backend en otro puerto: `$env:SGC_API_BASE='http://localhost:8123/api'`.

---

## Despliegue (Cloud Run, público, capa gratuita)

Proyecto GCP: **`gad-ibarra-documental`** (organización de OSC, creado el
2026-11-24). Región `us-central1`.

```powershell
# 1. Una vez: facturación (la vincula un administrador de facturación), APIs,
#    Firestore (default), bucket y cuenta de servicio
.\infra\crear-infraestructura.ps1 -CuentaFacturacion XXXXXX-XXXXXX-XXXXXX

# 2. Cada despliegue: Docker local construye la imagen, la sube a Artifact
#    Registry y la despliega (una vez: gcloud auth configure-docker us-central1-docker.pkg.dev)
.\deploy.ps1
#    Sin Docker local: .\deploy.ps1 -CloudBuild (construye en Cloud Build)

# 3. Primera vez: sembrar la raíz de la demostración
cd backend; $env:SGC_ROOT='sgc'; npm run seed; Remove-Item Env:SGC_ROOT
```

`deploy.ps1` imprime la URL `https://gestor-documental-….run.app`. La primera
corrida deja `APP_BASE_URL` apuntando a localhost (la URL no existe todavía):
ejecútelo una segunda vez para fijarla.

URL actual de la demostración: **https://gestor-documental-2txlkvb5sq-uc.a.run.app**
(desplegada el 2026-11-25). Repositorio: https://github.com/osc-top-solutions-group/Consorcio-Ibarra

**Por qué es público sin `--allow-unauthenticated`**: la política de la
organización prohíbe `allUsers`; el servicio se despliega con
`--no-invoker-iam-check`, que Cloud Run sí permite aquí. En un proyecto fuera
de la organización se puede usar `--allow-unauthenticated` sin más.

### Costo

Todo cabe en la capa gratuita mensual de GCP mientras el uso sea el de una
demostración: Cloud Run (2 millones de peticiones, `min-instances 0`),
Firestore (1 GiB, 50 000 lecturas/día), Cloud Storage (5 GB en us-central1),
Cloud Build y Artifact Registry. No se usan balanceador, Cloud Armor, KMS,
BigQuery ni Cloud Scheduler, que es lo que cobraría. Hace falta una cuenta de
facturación vinculada aunque el consumo sea cero. Al terminar, borrar el
proyecto elimina todo.

### Seguridad de una URL pública

No hay autenticación: cualquiera con la URL entra como visitante y ve lo
vigente. Asigne una **clave** a Hernando y a Elue en Configuración › Usuarios
para que nadie entre como ellos por curiosidad, no cargue documentos reales
sensibles, y borre el proyecto al terminar la demostración. El ingreso tiene
límite de tasa; las cookies son HttpOnly y Secure.

---

## Entrega al cliente

Para llevarlo a su propia infraestructura: exportar Firestore (raíz `sgc/`) y
el bucket, crear un proyecto con `infra/crear-infraestructura.ps1 -Proyecto`,
cambiar `GCP_PROJECT_ID` y desplegar con `deploy.ps1 -Proyecto`. El código no
tiene nada atado al proyecto actual salvo los valores por defecto.

Antes de un uso real: login verdadero (ver «Identidad»), correo, recordatorios
programados y la estructura real de procesos y sedes (la sigla del proceso y de
la sede quedan embebidas en el código de cada documento; corregirlas después
exige «Actualizar códigos» en el catálogo de Procesos).

## Política de costo de Firestore

Firestore cobra por documento **leído**. Lea [docs/POLITICA-COSTOS.md](docs/POLITICA-COSTOS.md)
antes de escribir una consulta nueva: listados con `page()`, totales con
`contar()`, `list()` solo para catálogos declarados en `CATALOGOS_LISTABLES`
(`backend/lib/db.js`). `/api/health` publica el contador de lecturas del proceso.
