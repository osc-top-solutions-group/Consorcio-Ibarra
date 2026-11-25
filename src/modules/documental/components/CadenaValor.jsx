import { useId } from 'react';

// Anillo central del mapa de procesos: la cadena de valor.
//
// Geometría: los ángulos se miden en grados EN SENTIDO HORARIO desde las 12.
//   punto(θ) = (cx + r·senθ, cy − r·cosθ)
// Recorrer θ creciente equivale a girar en sentido horario en pantalla, así que
// el `sweep-flag` del arco SVG es 1 cuando θ crece y 0 cuando decrece.
//
// Para que ninguna etiqueta quede boca abajo, los textos cuyo punto medio cae en
// la mitad inferior se dibujan sobre un arco recorrido al revés: el texto sigue
// leyéndose de izquierda a derecha aunque el flujo del ciclo vaya al contrario.

const LADO = 460;
const CX = LADO / 2;
const CY = LADO / 2;

// Radios. La proporción centro/anillo (≈0,68) replica la del mapa actual.
const R_INTERNO = 104;
const R_EXTERNO = 152;
const R_ETIQUETA = (R_INTERNO + R_EXTERNO) / 2;

// Ciclos exteriores: el trazo va separado del anillo y el texto por fuera del
// trazo, para que nunca se monten entre sí.
const R_CICLO = 178;
const R_TEXTO_CICLO = 200;

// Los sectores se reparten para que cada etiqueta caiga donde está en el mapa
// que usa hoy la compañía: Estratégicos arriba a la derecha, Soporte abajo a la
// derecha y Misionales ocupando todo el costado izquierdo.
const SECTORES = [
  { tipo: 'estrategico', etiqueta: 'Estratégicos', desde: -2, hasta: 90 },
  { tipo: 'apoyo', etiqueta: 'Soporte', desde: 92, hasta: 184 },
  { tipo: 'misional', etiqueta: 'Misionales', desde: 186, hasta: 358 }
];

function punto(r, grados) {
  const rad = (grados * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
}

function arco(r, desde, hasta) {
  const p1 = punto(r, desde);
  const p2 = punto(r, hasta);
  const largo = Math.abs(hasta - desde) > 180 ? 1 : 0;
  const sentido = hasta > desde ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largo} ${sentido} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

// Arco para textPath, invertido si haría falta para no quedar boca abajo.
function arcoTexto(r, desde, hasta) {
  const medio = ((desde + hasta) / 2 + 360) % 360;
  const invertir = medio > 95 && medio < 265;
  return invertir ? arco(r, hasta, desde) : arco(r, desde, hasta);
}

// Porción del anillo (donut slice).
function sector(desde, hasta) {
  const ext1 = punto(R_EXTERNO, desde);
  const ext2 = punto(R_EXTERNO, hasta);
  const int2 = punto(R_INTERNO, hasta);
  const int1 = punto(R_INTERNO, desde);
  const largo = Math.abs(hasta - desde) > 180 ? 1 : 0;
  return [
    `M ${ext1.x.toFixed(2)} ${ext1.y.toFixed(2)}`,
    `A ${R_EXTERNO} ${R_EXTERNO} 0 ${largo} 1 ${ext2.x.toFixed(2)} ${ext2.y.toFixed(2)}`,
    `L ${int2.x.toFixed(2)} ${int2.y.toFixed(2)}`,
    `A ${R_INTERNO} ${R_INTERNO} 0 ${largo} 0 ${int1.x.toFixed(2)} ${int1.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

// Punta de flecha tangente al círculo, apuntando en sentido horario.
function Flecha({ grados }) {
  const p = punto(R_CICLO, grados);
  return (
    <polygon
      points="0,-14 27,0 0,14"
      fill="var(--accent)"
      transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${grados})`}
    />
  );
}

export default function CadenaValor({ activo, onSeleccionar }) {
  // La página monta este componente dos veces (composición amplia y compacta,
  // una oculta por CSS). Con ids fijos, `url(#...)` resolvería contra el SVG
  // oculto y el degradado del anillo no se pintaría: useId los hace únicos.
  const uid = useId().replace(/:/g, '');
  const idAnillo = `cv-anillo-${uid}`;
  const idInnovacion = `cv-innovacion-${uid}`;
  const idConocimiento = `cv-conocimiento-${uid}`;
  const idSector = (tipo) => `cv-sector-${tipo}-${uid}`;

  return (
    <svg viewBox={`0 0 ${LADO} ${LADO}`} className="block h-auto w-full" role="img"
      aria-label="Cadena de valor: procesos estratégicos, misionales y de soporte">
      <defs>
        <linearGradient id={idAnillo} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#000086" />
          <stop offset="55%" stopColor="#20248a" />
          <stop offset="100%" stopColor="#3b41b8" />
        </linearGradient>

        <path id={idInnovacion} d={arcoTexto(R_TEXTO_CICLO, -60, 60)} />
        <path id={idConocimiento} d={arcoTexto(R_TEXTO_CICLO, 120, 240)} />
        {SECTORES.map((s) => (
          <path key={s.tipo} id={idSector(s.tipo)} d={arcoTexto(R_ETIQUETA, s.desde, s.hasta)} />
        ))}
      </defs>

      {/* Ciclos exteriores: innovación (arriba) y conocimiento (abajo) */}
      <path d={arco(R_CICLO, -62, 52)} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" />
      <Flecha grados={58} />
      <path d={arco(R_CICLO, 118, 232)} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" />
      <Flecha grados={238} />

      <text className="fill-[var(--accent)] text-[19px] font-bold">
        <textPath href={`#${idInnovacion}`} startOffset="50%" textAnchor="middle">
          Gestión de la Innovación
        </textPath>
      </text>
      <text className="fill-[var(--accent)] text-[19px] font-bold">
        <textPath href={`#${idConocimiento}`} startOffset="50%" textAnchor="middle">
          Gestión del conocimiento
        </textPath>
      </text>

      {/* Anillo de la cadena de valor */}
      {SECTORES.map((s) => {
        const esActivo = activo === s.tipo;
        return (
          <path
            key={s.tipo}
            d={sector(s.desde, s.hasta)}
            fill={`url(#${idAnillo})`}
            className={`cursor-pointer transition-opacity ${activo && !esActivo ? 'opacity-40' : 'opacity-100'}`}
            stroke={esActivo ? 'var(--accent)' : 'transparent'}
            strokeWidth="3"
            onClick={() => onSeleccionar(esActivo ? null : s.tipo)}
          />
        );
      })}

      {SECTORES.map((s) => (
        <text key={s.tipo} className="pointer-events-none fill-white text-[16px] font-bold" letterSpacing="1.8">
          <textPath href={`#${idSector(s.tipo)}`} startOffset="50%" textAnchor="middle">
            {s.etiqueta}
          </textPath>
        </text>
      ))}

      {/* Centro: la razón de ser del sistema */}
      <circle cx={CX} cy={CY} r={R_INTERNO} fill="#ffffff" />
      {['Necesidades', 'de Nuestros', 'Clientes'].map((linea, i) => (
        <text key={linea} x={CX} y={CY - 22 + i * 27} textAnchor="middle"
          className="fill-[var(--accent)] text-[23px] font-bold">
          {linea}
        </text>
      ))}
    </svg>
  );
}
