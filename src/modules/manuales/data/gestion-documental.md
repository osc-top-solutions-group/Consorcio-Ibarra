# Manual de Usuario — Gestión Documental

**el Gestor Documental · OSC Top Solutions Group**
Módulo: Gestión Documental
Versión del documento: 1.1 · Septiembre de 2026

---

## 1. Qué es este módulo

Gestión Documental es **la fuente de verdad** de las políticas, manuales, procedimientos, instructivos y formatos del sistema de gestión. Todo lo que otro módulo dice que hay que hacer, está escrito en un documento que vive aquí.

Su trabajo es garantizar tres cosas que exige la norma:

- Que **solo circule la versión vigente**. Un procedimiento derogado no debe poder consultarse como si estuviera al día.
- Que cada documento tenga **trazabilidad completa**: quién lo elaboró, quién lo revisó, quién lo aprobó y qué cambió en cada versión.
- Que llegue **a quien le aplica**, y solo a quien le aplica.

El ciclo de vida de un documento es:

```
 Borrador  →  En revisión  →  En aprobación  →  VIGENTE  →  Obsoleto
                   │                │
                   └── En ajustes ──┘   (si alguien lo devuelve)
```

---

## 2. Roles

| Rol | Quién es | Qué puede hacer |
|---|---|---|
| **Colaborador** | Cualquier persona con acceso a la plataforma | Consultar en línea los documentos vigentes que le aplican, buscar en el listado maestro, pedir un documento nuevo por *Solicitudes* |
| **Elaborador** | Quien redacta el documento | Crear el borrador, cargar el archivo, enviarlo a revisión, corregir si se lo devuelven |
| **Revisor / Aprobador** | Las personas citadas en el flujo de esa versión | Revisar o aprobar la versión, o devolverla con observaciones |
| **Líder de proceso** | El dueño del proceso al que pertenece el documento | Administrar los documentos de **su** proceso: crear, editar la ficha, obsoletizar |
| **Administrador del módulo** | Titulares de *Gestión Documental · administrar el módulo* en Gestión de Accesos | Todo lo del módulo, en todos los procesos y todas las sedes. **Es uno de los dos roles que pueden descargar documentos** |
| **Administrador de la plataforma** | Rol `admin` de el Gestor Documental | Todo, en todos los módulos |

---

## 3. Buscar y consultar un documento

### Listado Maestro

Es la portada del módulo y el inventario completo de la documentación. Cada renglón muestra el código, el nombre, el proceso, el tipo, la versión, el estado, el alcance, la confidencialidad y cuándo toca revisarlo.

- **Para abrir un documento, haga clic en cualquier parte de su renglón.**
- El buscador encuentra por código, nombre y palabras clave.
- Los filtros acotan por proceso, tipo, estado, alcance y confidencialidad.
- Si un documento fue recodificado, debajo de su código actual aparece tachado el **código anterior**: una referencia vieja citada en otro documento se sigue reconociendo.

### Ver el documento

Dentro de la ficha, el botón **Ver documento** (arriba a la derecha, en rojo) abre la versión vigente.

El documento se abre **dentro del visor de la plataforma**, nunca en otra pestaña del navegador. No es un capricho: el visor nativo del navegador trae su propio botón de descarga e impresión, y eso anularía el control sobre la difusión.

En la lista de versiones hay un **Ver PDF** por cada versión, para consultar el histórico.

> **No encuentro un documento que sé que existe.** Puede ser por alcance (es local de otra sede), por confidencialidad, o porque su audiencia de visualización está restringida. Si cree que debería verlo, pídalo por *Solicitudes* o escriba al líder del proceso.

---

## 4. Descarga: quién puede y por qué está restringida

**Solo descargan el PDF los administradores de la plataforma y los administradores del módulo de Gestión Documental.** Esa es la regla general. La única excepción es un **permiso excepcional por persona** (ver más abajo), que lleva motivo y vigencia y queda auditado.

Todos los demás **consultan el documento completo en línea**, dentro del visor. No es una versión recortada: es el documento entero.

La razón es simple: un documento controlado que sale como archivo deja de estar controlado. Circula por correo, sobrevive a la obsolescencia de su versión y reaparece meses después en una auditoría como evidencia de algo que ya no rige.

Hay una excepción, y es deliberada: los documentos de tipo **formato** sí se descargan, porque existen justamente para diligenciarse. Una plantilla en blanco no es un documento controlado que se esté repartiendo.

Si alguien necesita descargar documentos **de forma habitual**, el camino es que se le otorgue el rol de administrador del módulo en *Gestión de Accesos*.

### Permisos excepcionales por persona

Para un caso puntual —una persona de otra sede que debe consultar un documento local, alguien fuera de la lista confidencial, o quien debe adjuntar el PDF a una licitación— el líder del proceso o el administrador del módulo le otorga un **permiso excepcional** desde la ficha del documento, panel *Permisos excepcionales por persona → Otorgar permiso*:

- **Persona**: una sola, por su correo. No hay permisos por área ni por grupo: para eso está la audiencia.
- **Tipo**: *Consulta en línea* (pasa por encima del alcance por sede, de la confidencialidad y de la audiencia) o *Consulta y descarga del PDF*.
- **Motivo**: obligatorio. La persona lo recibe por correo y lo ve en la ficha.
- **Vigencia**: una fecha, o indefinido. El permiso de **descarga** que otorga el líder del proceso debe tener fecha y no puede superar el tope del parámetro *diasMaximoPermisoDocumento* (90 días por defecto); el administrador del módulo puede darlo indefinido. Al vencer, el permiso deja de aplicar solo.

Quien recibe el permiso ve **únicamente la versión vigente**, nunca borradores ni versiones reemplazadas. Si vuelve a otorgarse el mismo tipo a la misma persona, el anterior queda revocado como «prorrogado» y nace uno nuevo: la historia queda lineal.

Un permiso se **revoca con motivo** y no desaparece: la tabla muestra los vigentes y, con *Historial*, los vencidos y revocados. Cada otorgamiento, revocación y descarga por permiso queda en la auditoría con quién, a quién, por qué y hasta cuándo.

---

## 5. Crear un documento

Desde el Listado Maestro, botón **Nuevo documento**.

### El código se arma solo

Usted no escribe el código. Lo compone la plataforma con el proceso, el subproceso, el tipo, un consecutivo y el sufijo del alcance:

```
GETI - DSS - PRO - 19 - BOL
  │     │     │    │     └── sede (alcance específico), GLO o REG en los otros
  │     │     │    └── consecutivo
  │     │     └── tipo de documento
  │     └── subproceso
  └── proceso
```

### Qué le va a pedir el formulario

| Campo | Para qué sirve |
|---|---|
| **Proceso y subproceso** | Definen el código y quién administra el documento |
| **Tipo** | Política, manual, procedimiento, instructivo, formato… Decide el código y si el archivo editable se puede descargar |
| **Alcance** | *Global* (toda la compañía), *Regional* (varios países) o *Específico de una sede*. Un documento específico **solo lo ven los usuarios de esa sede** |
| **Confidencialidad** | *Público* e *Interno* los consulta cualquier colaborador dentro del alcance. *Confidencial* lo reserva a una **lista de personas** que se elige aquí mismo, además de quienes lo administran o participan en su flujo. Mientras la lista esté vacía, nadie más lo alcanza |
| **Meses de revisión** | Cada cuánto hay que revisarlo. Con eso la plataforma calcula la próxima revisión y avisa antes de que venza |
| **Normas que impacta** | ISO 9001, 27001, 45001… Sirve para las auditorías |
| **Palabras clave** | Para que el documento se encuentre en el buscador |
| **Flujo de revisión y aprobación** | Quiénes revisan y quiénes aprueban esta versión |

### Permisos de acceso

Se configura **quién puede consultar** el documento: todos los del alcance, o una lista concreta por persona, cargo, área, grupo o sede.

El alcance por sede manda por encima de esto: la audiencia acota dentro del alcance, nunca lo amplía.

La descarga **no se configura aquí** (ver punto 4).

### Cambiar la confidencialidad después

La clasificación no queda fija al crear el documento. En la ficha, el panel **Permisos de acceso → Cambiar permisos** permite subir o bajar la confidencialidad y editar la lista de personas con acceso al documento confidencial, sin crear una versión nueva.

Lo puede hacer quien administra el documento: el **líder del proceso**, el **administrador del módulo** o el administrador de la plataforma. Cada cambio queda en la auditoría.

Al bajar un documento de *Confidencial* a *Interno* o *Público*, la lista de acceso se vacía: si más adelante vuelve a ser confidencial, se arma de nuevo. Así no queda una restricción escondida que nadie recuerda.

Los tres filtros son independientes y se aplican juntos: para ver un documento hay que estar dentro de su **alcance** por sede, superar su **confidencialidad** y pertenecer a su **audiencia** de visualización, si la tiene.

---

## 6. El flujo de revisión y aprobación

1. **Borrador.** El elaborador carga el archivo y completa la ficha. Mientras esté en borrador, solo lo ven quienes participan en el flujo.
2. **Enviar a revisión.** Los revisores reciben correo y un pendiente en *Mis Pendientes*.
3. **Revisión.** Cada revisor aprueba o devuelve con observaciones. Si alguien devuelve, la versión pasa a **En ajustes** y vuelve al elaborador.
4. **Aprobación.** Cuando termina la revisión, se convoca a los aprobadores.
5. **Vigente.** Con la última aprobación, la versión queda vigente **y la anterior pasa automáticamente a obsoleta**. Desde ese momento es la única que ve el resto de la organización.

> Las decisiones son **append-only**: un comentario de revisión no se edita ni se borra. Es lo que permite reconstruir, un año después, por qué el documento quedó como quedó.

### Corrección editorial

Un error de forma —una tilde, un número de página, un nombre mal escrito— no justifica una versión nueva. Para eso está **Corrección editorial (sin nueva versión)**: reemplaza el archivo de la versión vigente dejando registro de quién lo hizo y por qué, sin mover el número de versión ni volver a pedir aprobaciones.

Se usa para la forma, nunca para el contenido. Si cambia lo que el documento *dice*, es una versión nueva.

---

## 7. Mantener la documentación al día

### Revisión programada

Cada documento tiene una periodicidad de revisión. La plataforma avisa **antes** de que venza, con correo y pendiente al responsable, y en la ficha aparece una franja ámbar (por vencer) o roja (vencida).

Una revisión vencida no bloquea nada, pero se ve. Es lo que un auditor pregunta primero.

### Nueva versión

Botón **Nueva versión** en la ficha. Pide el **control de cambios**: qué cambió respecto de la versión anterior. Ese texto es lo que después se lee en el histórico, así que vale la pena escribirlo bien.

### Obsoletizar

Cuando un documento deja de aplicar se **obsoletiza con un motivo obligatorio**. No se borra: nada se borra en esta plataforma.

Un documento obsoleto **deja de existir para el colaborador** —ni lo ve en el listado, ni entra por su enlace directo—. Solo lo consultan quienes administran documentación, desde *Obsoletos*, que es el repositorio histórico que pide la norma.

---

## 8. Los demás apartados del módulo

| Apartado | Para qué |
|---|---|
| **Mapa de Procesos** | La cadena de valor de la organización: procesos estratégicos, misionales y de apoyo, con sus documentos |
| **Documentos Externos** | Normas, leyes, manuales de proveedor y demás documentación que la organización no produce pero debe controlar: identificación, versión, origen y fecha de implementación |
| **Solicitudes** | Para pedir un documento nuevo, un cambio a uno existente o su baja. Se indica el documento y el proceso; el responsable recibe el pendiente |
| **Obsoletos** | Repositorio histórico. Solo visible para quien administra documentación |
| **Glosario** | Definiciones y términos del sistema de gestión, con su norma de origen |

---

## 9. Preguntas frecuentes

**¿Por qué no puedo descargar el documento?**
Porque la descarga está reservada a los administradores de la plataforma y del módulo documental. Consúltelo en línea con *Ver documento*: es el documento completo. Si lo necesita como archivo para un fin concreto, pídale al líder del proceso un permiso excepcional de descarga (punto 4).

**¿Cómo le doy descarga a una persona por una licitación?**
En la ficha del documento, *Permisos excepcionales por persona → Otorgar permiso*: elija a la persona, el tipo *Consulta y descarga del PDF*, escriba el motivo y ponga la fecha de vencimiento. La persona recibe un correo y puede descargar mientras el permiso esté vigente.

**Abrí un documento y dice «Restringido» donde antes estaba el botón de PDF.**
Es lo mismo del punto anterior. La consulta en línea sigue disponible.

**Cambié el nombre de un proceso y los códigos quedaron viejos.**
La recodificación es automática y conserva el código anterior como referencia tachada. Si no ocurrió, avísele a TI.

**Mandé el documento a revisión y el revisor no se enteró.**
Revise que esté en su *Mis Pendientes*. Si no aparece, lo más probable es que el flujo lo cite por cargo o área y el directorio no resuelva a esa persona para su sede.

**Un documento está en revisión hace semanas y nadie decide.**
Hay recordatorios automáticos diarios y escalamiento. Si aun así no avanza, el líder del proceso puede retirar del flujo a quien no responde y dejar registro.

**¿Puedo editar la ficha de un documento ya vigente?**
Sí: el alcance, la confidencialidad, las palabras clave, las normas y los permisos de consulta se editan sin crear una versión nueva. Lo que no se edita sin versión nueva es el **contenido**.

**Marqué un documento como confidencial y una persona del equipo no lo ve.**
Confidencial significa que solo lo alcanzan las personas de su lista de acceso, además de los administradores, el líder del proceso y quienes participen en el flujo. Agréguela desde *Permisos de acceso → Cambiar permisos*.

**¿Quién puede cambiar la confidencialidad de un documento?**
El líder del proceso al que pertenece, el administrador del módulo de Gestión Documental o el administrador de la plataforma. No hace falta escalarlo al administrador global.
