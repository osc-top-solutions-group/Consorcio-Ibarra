// Catálogo de módulos y su navegación.
//
// Esta instalación tiene un solo módulo (Gestión Documental). La estructura se
// conserva igual que en el SGC completo para que agregar otro módulo sea
// declararlo aquí, componer sus rutas en App.jsx y registrar su menú en Layout.
import {
  FileText, Network, FileInput, MailQuestion, Archive, BookMarked, Settings,
  SlidersHorizontal, ShieldCheck, ClipboardList, BookOpen
} from 'lucide-react';

export const MODULOS = [
  {
    id: 'documental',
    nombre: 'Gestión Documental',
    descripcion: 'Listado maestro, ciclo de vida, versiones, documentos externos y solicitudes.',
    ruta: '/documental',
    icono: FileText,
    estado: 'activo',
    conecta: ['Es la fuente de verdad de políticas, procedimientos y formatos de la entidad.']
  }
];

// Navegación interna del módulo documental (sidebar).
//
// `roles` limita una entrada a quien administra documentación. El repositorio de
// obsoletos es el caso: para el colaborador la documentación no aplicable no
// existe —el backend ni se la devuelve—, así que ofrecerle la pantalla solo le
// daría una lista vacía y la idea de que hay algo que no puede ver.
export const MENU_DOCUMENTAL = [
  { a: '/documental/documentos', icono: FileText, texto: 'Listado Maestro' },
  { a: '/documental/mapa-procesos', icono: Network, texto: 'Mapa de Procesos' },
  { a: '/documental/externos', icono: FileInput, texto: 'Documentos Externos' },
  { a: '/documental/solicitudes', icono: MailQuestion, texto: 'Solicitudes' },
  { a: '/documental/obsoletos', icono: Archive, texto: 'Obsoletos', roles: ['admin', 'lider'] },
  { a: '/documental/glosario', icono: BookMarked, texto: 'Glosario' }
];

// Accesos transversales, visibles desde cualquier módulo.
export const MENU_TRANSVERSAL = [
  { a: '/pendientes', icono: ClipboardList, texto: 'Mis Pendientes', exacto: true },
  { a: '/manuales', icono: BookOpen, texto: 'Manuales' }
];

// Administración. Cada entrada declara el recurso de acceso que la habilita:
// el sidebar solo muestra lo que la persona realmente puede abrir.
export const MENU_ADMIN = [
  { a: '/accesos', icono: ShieldCheck, texto: 'Gestión de Accesos', recurso: 'sgc.accesos' },
  { a: '/admin', icono: Settings, texto: 'Catálogos y parámetros', recurso: 'sgc.configuracion' },
  { a: '/admin/campos', icono: SlidersHorizontal, texto: 'Campos de los formularios', recurso: 'sgc.configuracion' }
];

export function moduloDe(pathname) {
  return MODULOS.find((m) => pathname === m.ruta || pathname.startsWith(`${m.ruta}/`)) || null;
}
