// Módulos cerrados por el parámetro `modulosProximamente` (ver
// sgc-backend/core/config/modulos.js). El perfil trae la lista con la marca
// `previsualiza` para administradores. Aquí se resuelve en un solo lugar cómo
// debe verse cada módulo para esta persona.
export function estadoModulo(modulo, usuario) {
  const cerrado = (usuario?.modulosProximamente || []).find((m) => m.id === modulo.id);
  if (modulo.estado !== 'activo') return 'proximamente';
  if (!cerrado) return 'activo';
  return cerrado.previsualiza ? 'preparacion' : 'proximamente';
}
