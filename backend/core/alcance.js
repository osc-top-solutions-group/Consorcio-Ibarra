// ALCANCE GEOGRÁFICO DE UN REGISTRO: global / regional / específico de una sede.
//
// Vive en `core/` y no dentro de un módulo porque lo usan dos: Gestión Documental
// —donde además decide el último segmento del código— y Mejoramiento Continuo.
// Un módulo consume `core/`, nunca otro módulo, así que duplicar la regla era la
// única alternativa, y una regla duplicada se corrige en un sitio y no en el otro.
//
// OJO con la diferencia de significado entre los dos módulos, que es real:
//
//   · En el documental el alcance MUEVE LÓGICA: compone el código (GLO/REG/COL)
//     y determina desde qué sedes se ve el documento.
//   · En mejoramiento es DESCRIPTIVO: dice a qué sedes atañe el hallazgo. El
//     módulo no tiene aislamiento por sede a propósito —la mejora continua
//     funciona por transparencia— así que aquí el alcance no restringe quién ve
//     qué; solo clasifica y alimenta el filtro del listado.
//
// La validación es la misma en ambos casos, y es lo que se comparte.

const ALCANCES = ['global', 'regional', 'especifico'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Valida la combinación alcance/sedes antes de escribir nada.
//
// `global` no lleva sedes: aplica a toda la compañía y una lista ahí solo sería
// ruido que después alguien interpretaría como una restricción.
function validarAlcance({ alcance, sedes }) {
  if (!ALCANCES.includes(alcance)) throw httpError(400, `Alcance inválido: ${alcance}`);
  const ids = sedes || [];
  if (alcance === 'especifico' && ids.length !== 1) {
    throw httpError(400, 'El alcance específico requiere exactamente una sede');
  }
  if (alcance === 'regional' && ids.length < 1) {
    throw httpError(400, 'El alcance regional requiere indicar las sedes a las que aplica');
  }
}

// Deja `sedes` coherente con el alcance elegido. Se aplica ANTES de escribir para
// que la base no guarde una combinación que la validación rechazaría al releer:
// cambiar de "específico de Colombia" a "global" tiene que borrar la sede, no
// dejarla colgando.
function normalizarSedes({ alcance, sedes }) {
  if (alcance === 'global') return [];
  const ids = [...new Set((sedes || []).filter(Boolean))];
  return alcance === 'especifico' ? ids.slice(0, 1) : ids;
}

// Etiqueta legible para exportaciones y correos.
const ETIQUETAS = { global: 'Global', regional: 'Regional', especifico: 'Específico de una sede' };

module.exports = { ALCANCES, ETIQUETAS, validarAlcance, normalizarSedes, httpError };
