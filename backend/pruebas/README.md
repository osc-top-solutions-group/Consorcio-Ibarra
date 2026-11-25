# Pruebas end-to-end del SGC

Verifican los requerimientos funcionales contra el backend **en ejecución**,
usando el header `x-dev-user-email` para actuar como distintos usuarios.

```powershell
cd sgc-backend
npm start          # en otra terminal
npm test
```

| Archivo | Qué verifica |
|---------|--------------|
| `requerimientos.js` | Codificación con región/sede, aislamiento por sedes, archivos obligatorios, asignación por cargo, obsoletos, exportación CSV, mapa de procesos y catálogos de configuración |
| `ciclo-vida.js` | Ciclo completo: borrador → revisión → aprobación → vigente → nueva versión → obsolescencia automática de la anterior, más rechazo, segregación de funciones y restricción de descarga del editable |
| `accesos-y-formularios.js` | Motor de accesos por recurso y campos parametrizables del documento |
| `almacenamiento-correo-codigos.js` | Adaptadores de archivos y correo, y recodificación con trazabilidad |
| `vigencia-y-audiencia.js` | Que el colaborador solo alcance documentación vigente, los permisos de visualización y descarga por usuario/cargo/grupo, la edición de integrantes de un grupo y los campos obligatorios de las solicitudes |
| `confidencialidad.js` | Documento confidencial (ISO 27001): solo lo alcanza quien está en su lista de acceso, la clasificación y la lista las cambia quien administra el documento (líder del proceso o administrador del módulo, no solo el global), la lista se guarda normalizada y se vacía al bajar de confidencial |
| `equipos.js` | Inventario de equipos y cronograma de mantenimiento: primer preventivo según la condición (nuevo 12 meses / usado 6), campos obligatorios condicionados al tipo, serial y placa únicos, filtro del cronograma por semana / mes / año, propuesta de horario dentro de la ventana y su respuesta, ejecución que abre el siguiente ciclo, y baja lógica que cancela lo programado |
| `catalogos.js` | Crear, editar, inactivar y reactivar registros de configuración: que un id inactivado se pueda volver a usar, que solo el panel vea lo inactivo y que los parámetros conserven su tipo al editarse |
| `expedientes.js` | Ciclo completo del contrato sobre el motor de flujo parametrizable: radicado con consecutivo RAD, contrato con documento obligatorio, turnos del flujo secuencial, reglas obligatoria / No Aplica, rechazo que tumba el flujo, reemplazo de documento, pólizas con alerta de vencimiento, vinculados y anulaciones lógicas |
| `oportunidades.js` | Expediente comercial: siembra de las nueve secciones de anexos, anexos clasificados por sección, contrato comercial sobre el mismo motor en modo paralelo (Jurídica obligatoria, No Aplica en las demás), separación de flujos por `aplicaA`, y los guardas del sync con Zoho (cron con secreto, manual solo administradores, 503 sin configurar) |
| `auditorias.js` | Módulo de auditorías (fase 1): registro de auditores con identidad del directorio e id = correo, horas `hhh:mm` en minutos, certificados con vigencia, competencias con firma del evaluador y perfil por tipo; programación con líder acreditado, aviso de duplicados y alcance; itinerario como fuente de horas; hallazgos con respuesta del auditado; vínculo con mejoramiento vía `core/acciones` (la auditoría ve la acción sin leer `hallazgos`); informe final; evaluación 360° por papel con consolidada; cierre con recálculo de horas, reapertura con rastro y anulación lógica. Re-ejecutable: resetea certificados y competencias de sus dos auditores al arrancar |
| `firma.js` | Firma electrónica con el adaptador simulado: solo sobre contratos aprobados, firmantes internos y externos, webhook autenticado en tiempo constante (sin clave 401, procesoId desconocido 200 sin detalle), avance por firmante, completado, eventos tardíos ignorados y cancelación con motivo. Requiere `FIRMA_WEBHOOK_SECRET` en el `.env` local |
| `talento-humano.js` | Talento Humano (fase 1): carpeta del colaborador con identificación única normalizada y confidencialidad por sección (el jefe ve la ficha y la hoja de vida, no el estudio de seguridad; descarga solo TTHH), firma por imagen servida solo desde la aplicación, y el paz y salvo completo sobre `core/flujos`: flujo editable con responsables por país (verificación por sede), 12 bloques en paralelo con el jefe tomado del registro, cierre de TTHH que espera a las áreas, pendientes con plazo, firma con pendientes y descuento, PDF al cierre (consulta para participantes, descarga para TTHH), rechazo que tumba el flujo, recordatorio manual, anulación que revierte el retiro y cron con clave. Respalda y restaura el flujo configurado |
| `capacitaciones.js` | Talento Humano (fase 2, programa de capacitación): tipos con nota y por participación, sesión con campos estandarizados y criterio de evaluación congelado, calendario por periodo denormalizado (semana / mes / año), cargue masivo de participantes (directorio, sede, externos) sin duplicados, confidencialidad de la lista nominal (el participante ve su fila), reprogramación que renueva el pendiente, asistencia con aprobación por umbral y cifras derivadas, cierre por el facilitador que escribe la formación con vigencia en la carpeta, certificado PDF solo del aprobado y solo propio, `core/personas` con formación vigente, evidencias servidas solo desde la aplicación, plan anual con cumplimiento e indicadores, cancelación con motivo y cron |

| `publicacion.js` | Publicación de documentos públicos a otros aplicativos (`/api/documental-publicacion`): falla cerrado sin clave o con identidad de colaborador, entrega metadatos y PDF solo de documentos `publico` y vigentes con su SHA-256, 404 para internos, borradores y obsoletos, y etiqueta `1-c1` con hash nuevo tras una corrección editorial. Requiere `PUBLICACION_API_KEY` en el `.env` local |
| `accesos.js` | Seguridad de la Información, registro autorizado de accesos (matriz v2, fase 2a): quién aprueba configurable (líder de área / jefe directo), proponer solo con perfil catalogado y persona de Colaboradores, un acceso en trámite por persona y app, segregación proponente ≠ aprobador, aprobación por alcance de área o por jefe, segunda aprobación de Seguridad para privilegiados, implementación por el responsable de la app, cambio de perfil que retira al anterior al implementarse, cancelación y retiro con motivo, rechazo con observación y pendiente al proponente, historial por persona con necesidad de conocer, carga inicial idempotente desde lo importado y resumen por agregación |

Las pruebas que crean registros de configuración usan **ids fijos**, no con marca
de tiempo: aquí nada se borra físicamente, así que un id nuevo por corrida iría
dejando una fila inactiva en el catálogo cada vez que se ejecutan.

Escriben en la raíz Firestore que indique `SGC_ROOT` (en local, `sgc_dev`).
**No las ejecute con `SGC_ROOT=sgc`**: crearían documentos de prueba en producción.
