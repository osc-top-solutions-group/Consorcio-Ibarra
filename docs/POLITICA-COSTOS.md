# Política de costo de la plataforma SGC

Reglas obligatorias para todo módulo nuevo. No son una optimización opcional:
son parte de la definición de "terminado" de un endpoint.

**Por qué existe este documento.** El costo de esta plataforma no lo determina el
tráfico ni el tamaño de los archivos, sino **cómo se escriben las consultas**. Un
listado mal escrito cuesta lo mismo el día que se despliega y cien veces más dos
años después, sin que nadie cambie una línea ni note nada en pantalla. Cuando eso
se descubre en la factura, el módulo ya está en producción y arreglarlo es un
cambio de contrato de la API.

Los cuatro módulos que faltan (auditorías, planeación, proveedores, SST) se
escriben desde cero.
Aplicar estas reglas al escribirlos cuesta cero; aplicarlas después, no.

---

## 1. La regla de oro

> **Firestore cobra por documento LEÍDO, no por documento DEVUELTO.**
> `$0.06 por 100.000 lecturas` — us-central1.

Un endpoint que trae la colección completa para mostrar 50 filas paga por la
colección completa. Su costo por clic es entonces proporcional al volumen
acumulado, y solo crece:

| Documentos en la colección | Costo de UN clic al listado |
|---|---|
| 1.500 | $0.0009 |
| 5.000 | $0.0030 |
| 20.000 | $0.0120 |
| 100.000 | $0.0600 |
| 7.000.000 | **$4.20** |

Ese último renglón no es teórico: es el escenario de 10 TB de almacenamiento que
se analizó para este proyecto. Mil visitas al mes a un listado así son
**USD 4.200/mes**, veinte veces el costo del bucket que guarda los archivos.

Un listado paginado cuesta **$0.00003 por clic, constante**, con 1.500 documentos
o con siete millones.

---

## 2. Qué usar en cada caso

Todo pasa por `lib/db.js`. Ningún módulo habla con Firestore directamente.

| Necesito… | Uso | Cuesta |
|---|---|---|
| Un listado que el usuario ve en pantalla | `col(x).page({filtros, orden, cursor, limite})` | el tamaño de la página |
| Un total, un contador, un badge | `col(x).contar(filtros)` | 1 lectura por cada 1.000 entradas de índice |
| Filtrar por igualdad (los pendientes de UNA persona) | `col(x).query({campo: valor})` | lo que devuelve |
| Buscar dentro de un arreglo (etiquetas, códigos, normas) | `col(x).contiene(campo, valor)` | lo que devuelve |
| El mayor de una serie «empieza por» (consecutivo sugerido) | `col(x).porPrefijo(campo, prefijo, {limite, desc})` | hasta `limite` filas; prefijo vacío no se admite |
| Un registro por id | `col(x).get(id)` | 1 lectura |
| Uno solo por criterio de igualdad | `col(x).findOne({campo: valor})` | 1 lectura |
| Exportar a CSV, migrar, reindexar | `col(x).recorrer(fn)` | la colección, por lotes, sin cargarla en memoria |
| Un catálogo de configuración completo | `col(x).list()` + `cache.memo()` | decenas de lecturas, una vez por minuto |

### `list()` está restringido a propósito

`list()` solo puede leer las colecciones declaradas en `CATALOGOS_LISTABLES`
(`lib/db.js`): procesos, tipos de documento, sedes, normas, cargos, grupos,
plantillas, definiciones, parámetros, accesos y formularios. Son decenas de
registros que cambian una vez al mes.

Cualquier otra colección avisa por consola con la traza del endpoint culpable, y
con `SGC_ESTRICTO=1` **lanza**:

```
[db] list() sobre "hallazgos", que NO es un catálogo de configuración.
      Lee la colección completa y se paga un read por documento, así que el
      costo de este endpoint crece para siempre con el volumen de datos.
      Use en su lugar:  page() ... contar() ... query() ... recorrer()
```

El control es **por colección y no por tamaño** deliberadamente. Un umbral tipo
"avisa a partir de 500 documentos" no protege de nada: en desarrollo la colección
tiene tres registros, el aviso nunca aparece, y el scan llega intacto a
producción para empezar a costar cuando ya hay medio millón. Declarar qué es
catálogo y qué no falla el mismo día en que se escribe la consulta.

### Lecturas completas legítimas

Existen, y se declaran en el código:

```js
col('documentos').list(null, { motivo: 'exportación CSV pedida por el usuario' })
```

`motivo` es obligatorio, se imprime en el log y queda escrito en el sitio de la
llamada. Una exportación paga por todo el conjunto porque el usuario pidió todo
el conjunto: eso es correcto. Lo que no es correcto es que una pantalla de
consulta cueste lo mismo que una exportación.

---

## 3. Reglas al construir un módulo nuevo

1. **Ningún listado sin paginar.** Si aparece en pantalla, es `page()`. Sin
   excepciones y sin "por ahora son pocos registros": los registros de un módulo
   de calidad solo crecen.
2. **Ningún total con `.length`.** Los contadores son `contar()`. Un badge que
   dice "23 hallazgos abiertos" no debe leer 23 documentos, y mucho menos 23.000.
3. **Nunca `offset`.** Firestore cobra los documentos saltados, así que paginar
   con offset hace que la página 20 cueste veinte veces la página 1. `page()` usa
   cursor por eso.
4. **Registrar las colecciones nuevas en `AMBITOS`** (`lib/db.js`), y agregar a
   `CATALOGOS_LISTABLES` **solo sus catálogos**. Los datos transaccionales
   —hallazgos, acciones, mediciones, evidencias, inspecciones— no entran nunca.
5. **Filtrar en Firestore, no en memoria.** Si el criterio es una igualdad, va en
   `query()`. Un `.filter()` de JavaScript sobre el resultado ya pagó por todo.
6. **Cachear los catálogos** con `cache.memo()` e invalidar al escribir. Un
   catálogo que se lee una vez por minuto en lugar de una vez por petición cuesta
   dos órdenes de magnitud menos.
7. **Nada de `Promise.all` de conteos por categoría.** Doce `contar()` en
   paralelo para un tablero son doce consultas de agregación: correcto. Doce
   `list()` filtrados en memoria son doce scans: no.
8. **Los permisos se resuelven por petición, nunca por registro.** Decidir si
   alguien puede ver una fila suele necesitar su cargo, su área o sus grupos. Eso
   se resuelve UNA vez —`destinatarios.contextoDe(usuario)`, que arma el contexto
   de identidad— y después se compara en memoria con `perteneceA()`. Consultarlo
   dentro del filtro convierte un listado de 50 filas en 50 lecturas del catálogo,
   y el error no se nota en desarrollo porque la caché lo tapa.

---

## 4. Denormalización: cuándo y cómo

Firestore no puede filtrar por lo que no está almacenado. Cuando un criterio de
consulta es un valor derivado, hay dos salidas: leer todo y calcular en memoria
(un scan, que crece para siempre) o **guardar el valor derivado en el documento**.

La segunda es la correcta, con tres condiciones:

1. **La fuente de verdad no cambia.** El campo denormalizado es un índice, no un
   dato nuevo. Si discrepan, manda el original.
2. **Se recalcula entero en cada escritura, nunca se parchea.** Un campo que se
   actualiza por partes termina desincronizado.
3. **Se reindexan los documentos anteriores.** Un campo nuevo no existe en los
   registros ya guardados, y una consulta indexada no los encuentra: no falla,
   simplemente devuelve "no hay". Esto es lo que hace `npm run reindexar`, y es
   obligatorio al desplegar un campo de este tipo.

**Ejemplo aplicado — `codigosPlanos`.** El histórico de códigos vive en
`codigosAnteriores` como objetos `{codigo, motivo, fecha, por}`, y Firestore no
indexa el subcampo de un objeto dentro de un arreglo. Resolver "¿quién usó este
código?" obligaba a leer toda la colección. Con un arreglo plano de strings
—código vigente más los retirados— la misma pregunta cuesta **1 lectura en lugar
de 112** (medido en `sgc_dev`), y eliminó dos scans: la búsqueda por código y la
verificación de colisión al recodificar, que la recodificación masiva ejecutaba
**una vez por documento**.

---

## 5. Almacenamiento: escalonamiento por clase (tiering)

`infra/lifecycle-bucket.json`, aplicado por `infra/crear-infraestructura.ps1`.

| Regla | Efecto | Precio USD/GiB-mes |
|---|---|---|
| Versiones no vigentes se borran a los 90 días | respaldo del bucket ante borrado accidental | — |
| Standard → Nearline a los **180 días** | 0.020 → 0.010 | **-50%** |
| Nearline → Coldline a los **365 días** | 0.010 → 0.004 | **-80%** |
| Coldline → Archive a los **1.095 días** | 0.004 → 0.0012 | **-94%** |

Un documento del SGC se consulta mucho el mes que entra en vigencia y casi nada
después, así que el escalonamiento no toca el uso real. Seis meses para el primer
salto deja fuera del recargo de recuperación toda la ventana de uso, incluida una
auditoría semestral.

Ninguna transición genera cargo por borrado temprano: los mínimos de permanencia
(Nearline 30 días, Coldline 90, Archive 365) se respetan con margen — 185 días en
Nearline, 730 en Coldline.

Efecto sobre los escenarios analizados:

| Volumen | Todo Standard | Con escalonamiento | Ahorro/mes |
|---|---|---|---|
| 2 TB | $45.06 | $20.28 | $24.78 |
| 5 TB | $112.64 | $50.69 | $61.95 |
| 10 TB | $225.28 | $101.38 | $123.90 |

> **`--lifecycle-file` REEMPLAZA la configuración completa del bucket.** Cualquier
> regla nueva se agrega a `infra/lifecycle-bucket.json`; aplicarla por separado
> borra las demás sin avisar. El JSON no admite campos de comentario: la API los
> rechaza. El razonamiento va en este documento y en el script.

---

## 6. Cómo medir

`/api/health` publica el contador acumulado de lecturas del proceso:

```json
"lecturas": { "total": 122, "costoEstimadoUsd": 0.000073,
              "porColeccion": { "documentos": 122 } }
```

Para saber cuánto cuesta una pantalla: se consulta `/api/health`, se navega, y se
vuelve a consultar. Un listado paginado mueve el contador en decenas; uno que
hace scan lo mueve en miles. No hace falta abrir la consola de facturación.

Medición del estado actual en `sgc_dev` (112 documentos, 88 pendientes, 124
notificaciones):

| Endpoint | Antes | Después |
|---|---|---|
| `/api/pendientes` (en cada navegación) | 88 lecturas | **10** — solo la bandeja de quien pregunta |
| `/api/config/procesos` × 5 llamadas | 75 lecturas | **15** — una vez por minuto, cacheado |
| `/api/documental/.../por-codigo/X` | 112 lecturas | **1** |
| `seed` importando 1.500 PDFs | >1.000.000 lecturas | **1.500** |

---

## 7. Migración pendiente

Queda **un** cambio, con la misma causa raíz en cuatro endpoints: un criterio de
consulta que hoy no está almacenado.

| Endpoint | Qué lo bloquea |
|---|---|
| `GET /documental/documentos` (listado maestro) | `estado` se deriva de `versiones[]` en cada lectura; `puedeVer` depende del usuario |
| `GET /documental/obsoletos` | igual — comparten la función `listar()` |
| `GET /documental/mapa-procesos` | los contadores excluyen obsoletos y respetan visibilidad |
| `GET /accesos/auditoria` | filtra por prefijo de `accion` sin índice compuesto |

**Qué hay que hacer:**

1. Denormalizar `estado` en el documento, escrito en cada transición del ciclo de
   vida (`DocumentosService`: crear, nueva versión, decisión, obsoletizar).
2. Denormalizar una clave de visibilidad (`alcance` + `sedes`) que permita a
   Firestore recortar por sede antes de traer las filas.
3. Consultar la auditoría por `modulo` — **el campo ya se escribe** en
   `lib/audit.js`; falta reindexar el histórico y cambiar la consulta.
4. `npm run reindexar` para el histórico.
5. Cambiar el contrato de los listados a `{filas, cursor, total}` y adaptar
   `ListadoMaestro.jsx`, `Obsoletos.jsx`, `MapaProcesos.jsx` y `Home.jsx`.

**Por qué va como paso propio:** el punto 5 es un cambio de contrato de la API que
toca cuatro pantallas y añade controles de paginación a la interfaz. Mezclarlo con
los cambios internos —que no alteran ninguna respuesta— haría que un fallo en
producción no se pudiera atribuir. Los scans que quedan están declarados con
`motivo` en el código, así que el log dice la verdad mientras tanto.

**Impacto:** es el 83% del costo proyectado del escenario de 9 módulos
(USD 52 de 62 al mes). Todo lo demás ya está hecho.

---

## 8. Lo que NO se hace

- **Sin Memorystore / Redis.** Costaría más al mes que las lecturas que ahorra y
  añadiría una dependencia con estado a servicios que hoy escalan a cero. La
  caché es de proceso (`lib/cache.js`), y que cada instancia tenga su copia es
  exactamente lo deseado.
- **Sin `min-instances`.** Cloud Run factura por request; poner una instancia
  siempre viva convierte ~$1/mes en ~$15/mes para ahorrar un arranque en frío que
  a esta plataforma no le duele.
- **Sin cachear datos de decisión.** `cache.memo()` es para catálogos. Nunca para
  saldos, consecutivos ni estados de flujo: leer un valor viejo ahí cambia una
  decisión de negocio, y ningún ahorro paga eso.

---

## Referencias

Precios de lista us-central1 usados en este documento. **Conviene confirmarlos en
la calculadora de GCP antes de citarlos a negocio**, porque cambian:

- Firestore: lectura $0.06/100k · escritura $0.18/100k · almacenamiento $0.18/GiB-mes
- Cloud Storage: Standard $0.020 · Nearline $0.010 · Coldline $0.004 · Archive $0.0012 (GiB-mes)
- Operaciones GCS: clase A $0.005/1k · clase B $0.0004/1k
- Cloud Run: $0.000024/vCPU-s · $0.0000025/GiB-s · $0.40/millón de requests
- BigQuery on-demand: $6.25/TiB, primer TiB del mes gratis, mínimo 10 MB por consulta
