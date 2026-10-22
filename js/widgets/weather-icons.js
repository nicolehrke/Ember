// Schlichte Linien-Icons für das Wetter-Widget (Hilfsmodul, kein eigenes Widget).
// Gezeichnet auf 24×24, Strichfarbe über CSS (Klassen .ic-*).

const SUN_RAYS = 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4';
const CLOUD = 'M17.5 19H8a6 6 0 1 1 5.7-7.9h1.3a4 4 0 0 1 2.5 7.9z';
const CLOUD_HIGH = 'M17.5 15H8a5.5 5.5 0 1 1 5.2-7.3h1.5a3.65 3.65 0 0 1 2.8 7.3z';

const SHAPES = {
  sun: `<circle cx="12" cy="12" r="4"/><path d="${SUN_RAYS}"/>`,
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  partly: '<g class="ic-part-sun"><path d="M8 2.5v1.5M2.5 8H4M4.1 4.1l1 1M11.9 4.1l-1 1"/><path d="M5.6 10.4a3 3 0 0 1 5.2-3"/></g>'
    + '<path d="M18 21H9.5a5 5 0 1 1 4.8-6.6h1.2a3.3 3.3 0 0 1 2.5 6.6z"/>',
  cloud: `<path d="${CLOUD}"/>`,
  fog: '<path d="M4 9h16M3 13h14M6 17h15M8 21h8"/>',
  rain: `<path d="${CLOUD_HIGH}"/><path class="ic-drops" d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>`,
  snow: `<path d="${CLOUD_HIGH}"/><path class="ic-drops" d="M8 19h.01M12 19h.01M16 19h.01M10 22h.01M14 22h.01"/>`,
  storm: `<path d="${CLOUD_HIGH}"/><path class="ic-bolt" d="M13 15l-2.5 4h3L11 23"/>`,
};

export function icon(name, label = '') {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="ic ic-${name}" viewBox="0 0 24 24" ${a11y}>${SHAPES[name] ?? SHAPES.cloud}</svg>`;
}
