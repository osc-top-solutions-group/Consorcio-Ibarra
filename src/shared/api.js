// Cliente de la API (mismo origen; en producción el balanceador enruta /api).
export async function api(ruta, opciones = {}) {
  const esFormData = opciones.body instanceof FormData;
  const res = await fetch(`/api${ruta}`, {
    credentials: 'include',
    ...opciones,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      ...(opciones.body && !esFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(opciones.headers || {})
    },
    body: opciones.body && !esFormData ? JSON.stringify(opciones.body) : opciones.body
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = data && data.details ? ` (${data.details.join('; ')})` : '';
    const err = new Error((data && data.error ? data.error : `Error ${res.status}`) + detalle);
    // El código y el cuerpo viajan en el error para que la pantalla pueda
    // DISTINGUIR los casos, no solo pintar el texto. Un 403 no es un fallo:
    // es «esta persona no tiene este acceso», y merece una respuesta que lo
    // diga con todas las letras (SinAcceso) en vez de un recuadro rojo.
    // Quien solo use `e.message` sigue funcionando igual.
    err.status = res.status;
    err.datos = data;
    throw err;
  }
  return data;
}

// Catálogos con caché en memoria.
const cache = {};
export async function catalogo(nombre) {
  if (!cache[nombre]) {
    cache[nombre] = api(`/config/${nombre}`).catch((e) => {
      delete cache[nombre]; // un fallo no debe quedar cacheado
      throw e;
    });
  }
  return cache[nombre];
}
export function invalidarCatalogo(nombre) {
  delete cache[nombre];
}

export const ESTADOS = {
  borrador: { texto: 'Borrador', clase: 'bg-slate-100 text-slate-600' },
  en_revision: { texto: 'En revisión', clase: 'bg-amber-100 text-amber-700' },
  en_aprobacion: { texto: 'En aprobación', clase: 'bg-blue-100 text-blue-700' },
  en_ajustes: { texto: 'En ajustes', clase: 'bg-orange-100 text-orange-700' },
  vigente: { texto: 'Vigente', clase: 'bg-emerald-100 text-emerald-700' },
  en_actualizacion: { texto: 'En actualización', clase: 'bg-violet-100 text-violet-700' },
  obsoleto: { texto: 'Obsoleto', clase: 'bg-rose-100 text-rose-700' },
  obsoleta: { texto: 'Obsoleta', clase: 'bg-rose-100 text-rose-700' },
  atendida: { texto: 'Atendida', clase: 'bg-emerald-100 text-emerald-700' },
  abierta: { texto: 'Abierta', clase: 'bg-amber-100 text-amber-700' },
  rechazada: { texto: 'Rechazada', clase: 'bg-rose-100 text-rose-700' }
};

// Estados que el usuario puede filtrar en el listado maestro.
export const ESTADOS_FILTRABLES = ['vigente', 'en_actualizacion', 'borrador', 'en_revision', 'en_aprobacion', 'en_ajustes'];

export const CONFIDENCIALIDAD = {
  publico: { texto: 'Público', clase: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  interno: { texto: 'Interno', clase: 'bg-blue-50 text-blue-700 border border-blue-200' },
  confidencial: { texto: 'Confidencial', clase: 'bg-rose-50 text-rose-700 border border-rose-200' }
};

export const ALCANCES = {
  global: { texto: 'Global', ayuda: 'Aplica a toda la compañía. Visible desde cualquier sede.', sufijo: 'GLO' },
  regional: { texto: 'Regional', ayuda: 'Aplica a varios países. Visible desde cualquier sede.', sufijo: 'REG' },
  especifico: { texto: 'Específico de una sede', ayuda: 'Documento local: solo lo consultan los usuarios de esa sede.', sufijo: 'sede' }
};

// Gramática de asignación de flujos. Cargo, área y sede se resuelven contra el
// directorio de Talento Humano en el momento del envío.
export const TIPOS_ASIGNACION = {
  usuario: 'Persona',
  cargo: 'Cargo',
  area: 'Área',
  grupo: 'Grupo',
  sede: 'Sede'
};

export function fechaCorta(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

// "faltan 12 días" / "vencida hace 3 días" — el requerimiento pide el conteo,
// no solo la fecha, para evitar saturar de correos a los usuarios.
export function textoDias(dias) {
  if (dias === null || dias === undefined) return '—';
  if (dias < 0) {
    const d = Math.abs(dias);
    return `vencida hace ${d} ${d === 1 ? 'día' : 'días'}`;
  }
  if (dias === 0) return 'vence hoy';
  return `faltan ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

// Descarga un archivo respetando la sesión de IAP (mismo origen).
export function descargar(ruta) {
  window.location.assign(`/api${ruta}`);
}
