// Zonas horarias por país — utilidad TRANSVERSAL.
//
// La compañía opera en toda Latinoamérica y una sesión programada «a las 09:00»
// significa una hora distinta en cada país. El SGC no pretende adivinar la hora
// de cada persona: guarda la hora LOCAL de la sede organizadora y, con esta
// utilidad, muestra la equivalencia en los demás países (petición de Cristian,
// 2026-10-29) y crea el evento de Google Calendar en la zona correcta, para que
// Google se lo muestre a cada invitado en la suya.
//
// La autoridad es el catálogo `sedes` (campo `zonaHoraria`); este mapa es el
// valor sembrado y el respaldo para sedes creadas antes de que existiera el
// campo. Solo usa Intl: sin dependencias.

const ZONA_POR_SEDE = {
  col: 'America/Bogota',
  mex: 'America/Mexico_City',
  per: 'America/Lima',
  ecu: 'America/Guayaquil',
  chl: 'America/Santiago',
  arg: 'America/Argentina/Buenos_Aires',
  pan: 'America/Panama',
  cri: 'America/Costa_Rica',
  gtm: 'America/Guatemala',
  slv: 'America/El_Salvador',
  hnd: 'America/Tegucigalpa',
  nic: 'America/Managua',
  dom: 'America/Santo_Domingo',
  pry: 'America/Asuncion',
  bol: 'America/La_Paz',
  ury: 'America/Montevideo',
  ven: 'America/Caracas',
  // Oficinas de Dallas y Denver: se toma la central (Dallas).
  usa: 'America/Chicago'
};

const ZONA_DEFECTO = 'America/Bogota';

function zonaValida(zona) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

// Zona de una sede del catálogo: la configurada, o la sembrada para su id.
function zonaDeSede(sede) {
  if (!sede) return null;
  if (sede.zonaHoraria && zonaValida(sede.zonaHoraria)) return sede.zonaHoraria;
  return ZONA_POR_SEDE[sede.id] || null;
}

// Partes de un instante expresadas en una zona.
function partesEn(instante, zona) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(f.formatToParts(instante).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { anio: p.year, mes: p.month, dia: p.day, hora: p.hour === 24 ? 0 : p.hour, minuto: p.minute, segundo: p.second };
}

// Desfase (ms) de la zona respecto a UTC en ese instante.
function desfase(instante, zona) {
  const p = partesEn(instante, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - instante.getTime();
}

// Instante (Date) de una hora de pared `YYYY-MM-DD` + `HH:MM` en una zona.
// Dos pasadas bastan para los cambios de horario de verano.
function instanteDe(fecha, hora, zona) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, mi] = (hora || '00:00').split(':').map(Number);
  const supuesto = Date.UTC(a, m - 1, d, h, mi, 0);
  let instante = new Date(supuesto - desfase(new Date(supuesto), zona));
  instante = new Date(supuesto - desfase(instante, zona));
  return instante;
}

const dosDigitos = (n) => String(n).padStart(2, '0');

// Equivalencias de una hora local de la sede base en las demás sedes.
//   equivalencias({ fecha: '2026-11-10', hora: '09:00', zonaBase: 'America/Bogota',
//                   sedes: [{ id, nombre, zonaHoraria }] })
//   → [{ sedeId, nombre, zonaHoraria, fecha, hora, diferenciaHoras, mismaZona }]
// `diferenciaHoras` es respecto a la base (+1 = una hora más tarde en el reloj).
function equivalencias({ fecha, hora, zonaBase, sedes }) {
  if (!fecha || !hora || !zonaBase || !zonaValida(zonaBase)) return [];
  const instante = instanteDe(fecha, hora, zonaBase);
  const base = desfase(instante, zonaBase);
  const salida = [];
  for (const s of sedes || []) {
    const zona = zonaDeSede(s);
    if (!zona) continue;
    const p = partesEn(instante, zona);
    const diferencia = Math.round(((desfase(instante, zona) - base) / 3600000) * 2) / 2;
    salida.push({
      sedeId: s.id, nombre: s.nombre, zonaHoraria: zona,
      fecha: `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}`,
      hora: `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`,
      diferenciaHoras: diferencia,
      mismaZona: diferencia === 0 && zona === zonaBase
    });
  }
  return salida;
}

module.exports = { ZONA_POR_SEDE, ZONA_DEFECTO, zonaValida, zonaDeSede, instanteDe, equivalencias };
