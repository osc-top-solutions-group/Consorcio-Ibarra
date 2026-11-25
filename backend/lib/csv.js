// Parser CSV mínimo, compartido por las importaciones (comillas, saltos de línea
// dentro de comillas, CRLF y BOM). El delimitador se detecta de la cabecera: el
// export usa ';' (Excel es-CO), pero un archivo guardado con ',' también se
// acepta. Nació en forms/seguridad/activos.js; aquí vive la copia que consumen
// los módulos nuevos.
function parsearCsv(texto) {
  const limpio = String(texto || '').replace(/^﻿/, '');
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] || '';
  const delim = (primeraLinea.match(/;/g) || []).length >= (primeraLinea.match(/,/g) || []).length ? ';' : ',';

  const filas = [];
  let fila = [];
  let celda = '';
  let enComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"' && limpio[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') enComillas = false;
      else celda += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === delim) {
      fila.push(celda); celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some((v) => v.trim() !== '')) filas.push(fila);
      fila = [];
    } else {
      celda += c;
    }
  }
  fila.push(celda);
  if (fila.some((v) => v.trim() !== '')) filas.push(fila);
  return filas;
}

// Nombre sin tildes, minúsculas y con espacios colapsados, para comparar
// cabeceras y valores de catálogo sin distinguir tildes ni mayúsculas.
function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Busca en un catálogo por id, nombre o código, normalizados.
function buscarEnCatalogo(lista, valor) {
  const objetivo = normalizarTexto(valor);
  if (!objetivo) return null;
  return (lista || []).find((x) =>
    normalizarTexto(x.id) === objetivo ||
    normalizarTexto(x.nombre) === objetivo ||
    normalizarTexto(x.codigo) === objetivo ||
    normalizarTexto(x.sigla) === objetivo) || null;
}

const separarLista = (valor) => String(valor || '').split('|').map((x) => x.trim()).filter(Boolean);

const escaparCsv = (valor) => `"${String(valor === null || valor === undefined ? '' : valor).replace(/"/g, '""')}"`;

module.exports = { parsearCsv, normalizarTexto, buscarEnCatalogo, separarLista, escaparCsv };
