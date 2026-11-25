// Plantillas HTML del correo transaccional del SGC.
//
// Los clientes de correo son mucho más limitados que un navegador: Outlook no
// entiende flexbox ni grid y Gmail descarta las hojas de estilo. Por eso todo va
// con tablas y estilos en línea, y las fuentes propias se declaran con respaldo
// del sistema (Montserrat solo se verá donde ya esté instalada).
const PRIMARIO = '#20248a';
const ACENTO = '#ff0057';
const OSCURO = '#0f172a';
const TEXTO = '#1f2937';
const SUAVE = '#6b7280';
const BORDE = '#e5e7eb';
const FUENTE = "Montserrat, 'Segoe UI', Arial, Helvetica, sans-serif";

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Envuelve el contenido en la identidad visual de la plataforma.
// `etiqueta` es el rótulo pequeño sobre el título (ej. "Tarea asignada").
function envolver({ etiqueta, titulo, parrafos = [], datos = [], accion, nota }) {
  const filasDatos = datos
    .filter((d) => d && d.valor)
    .map(({ campo, valor }) => `
              <tr>
                <td style="padding:6px 0;font-size:13px;color:${SUAVE};width:38%;vertical-align:top;">${escapar(campo)}</td>
                <td style="padding:6px 0;font-size:13px;color:${TEXTO};font-weight:600;">${escapar(valor)}</td>
              </tr>`)
    .join('');

  const bloqueDatos = filasDatos ? `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                 style="margin:20px 0;padding:16px 18px;background:#f9fafb;border:1px solid ${BORDE};border-radius:8px;">
            ${filasDatos}
          </table>` : '';

  // Botón "a prueba de Outlook": relleno con padding sobre una celda, no un <a> con altura.
  const bloqueAccion = accion ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="${ACENTO}" style="border-radius:6px;">
                <a href="${escapar(accion.url)}"
                   style="display:inline-block;padding:13px 28px;font-family:${FUENTE};font-size:14px;
                          font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">
                  ${escapar(accion.texto)}
                </a>
              </td>
            </tr>
          </table>` : '';

  const bloqueNota = nota ? `
          <p style="margin:20px 0 0;padding:12px 14px;background:#fff7ed;border-left:3px solid #f59e0b;
                    font-size:13px;line-height:1.5;color:#7c2d12;">${escapar(nota)}</p>` : '';

  const cuerpoParrafos = parrafos
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXTO};">${p}</p>`)
    .join('');

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
               style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 1px 3px rgba(0,0,0,.08);font-family:${FUENTE};">

          <tr>
            <td style="background:${PRIMARIO};padding:22px 32px;">
              <span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:.3px;">Gestor Documental</span>
              <span style="font-size:13px;color:rgba(255,255,255,.75);margin-left:10px;">
                Sistema Integrado de Gestión
              </span>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 32px 32px;">
              ${etiqueta ? `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1px;
                                      text-transform:uppercase;color:${ACENTO};">${escapar(etiqueta)}</p>` : ''}
              <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;font-weight:700;color:${OSCURO};">
                ${escapar(titulo)}
              </h1>
              ${cuerpoParrafos}
              ${bloqueDatos}
              ${bloqueAccion}
              ${bloqueNota}
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px;background:#f9fafb;border-top:1px solid ${BORDE};">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${SUAVE};">
                Mensaje automático del Gestor Documental del GAD Municipal San Miguel de Ibarra.
                No responda a este correo: gestione la tarea desde
                <a href="${escapar(BASE_URL)}" style="color:${PRIMARIO};font-weight:600;">la plataforma</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Enlace absoluto a una ruta interna de la aplicación.
function enlace(ruta) {
  if (!ruta) return BASE_URL;
  return /^https?:\/\//i.test(ruta) ? ruta : `${BASE_URL}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
}

// Correo genérico: se usa cuando quien notifica solo tiene asunto y texto.
// Mantiene la interfaz histórica de `notificar({ asunto, cuerpo })` funcionando.
function generico({ asunto, cuerpo, ruta, etiqueta }) {
  return envolver({
    etiqueta: etiqueta || 'Notificación',
    // Se acepta también el prefijo histórico «SGC:» por si algún asunto viejo
    // llega desde una notificación pendiente.
    titulo: asunto.replace(/^(Gestor Documental|SGC):\s*/i, ''),
    parrafos: [escapar(cuerpo)],
    accion: ruta ? { texto: 'Abrir en el Gestor Documental', url: enlace(ruta) } : null
  });
}

module.exports = { envolver, generico, enlace, BASE_URL };
