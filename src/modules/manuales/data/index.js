import { FileText } from 'lucide-react';
import gestionDocumental from './gestion-documental.md?raw';

/**
 * MÓDULOS CON VARIOS MANUALES. Un módulo pequeño tiene UN manual y su tarjeta
 * abre el visor directo; uno con varios procesos lista aquí su portada. En esta
 * instalación no hay ninguno.
 */
export const MODULOS = [];

/**
 * REGISTRO DE MANUALES DE USUARIO. Cada manual es un Markdown en esta carpeta,
 * importado con `?raw`. Para publicar uno nuevo: crear el .md (título con #,
 * secciones con ##; el índice lateral del visor se arma solo con los ##) y
 * agregar su entrada aquí.
 */
export const MANUALES = [
  {
    id: 'gestion-documental',
    titulo: 'Gestión Documental',
    descripcion: 'Cómo buscar y consultar un documento, crear uno nuevo, la confidencialidad y su lista de acceso, '
      + 'el flujo de revisión y aprobación, '
      + 'las versiones y el control de cambios, la revisión programada y quién puede descargar.',
    area: 'Sistema de Gestión',
    icono: FileText,
    rutaModulo: '/documental/documentos',
    actualizado: 'Noviembre 2026',
    contenido: gestionDocumental
  }
];

export function getManual(id) {
  return MANUALES.find((m) => m.id === id) || null;
}

export function getModulo(id) {
  return MODULOS.find((m) => m.id === id) || null;
}

export function manualesDe(moduloId) {
  return MANUALES.filter((m) => m.modulo === moduloId);
}
