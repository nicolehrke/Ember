// Alle Stile mit Farben und Tageszeit-Stützpunkten an einer Stelle.
//
// Pro Stil:
//   label     Name im Stil-Menü
//   modes     unterstützte Modi: ['dark', 'light'] oder nur einer (wird dann erzwungen)
//   phases    [Name, ab Uhrzeit] – die letzte Phase gilt bis 5 Uhr
//   keys      Stützpunkte über den Tag: h (Stunde), glow (Leuchtfarbe), ui (Akzent), k (Glühstärke).
//             Dazwischen wird linear interpoliert; 0 und 24 müssen gleich sein.
//   fonts     Google-Fonts-Familien (nur geladen, wenn der Stil aktiv ist)
//   swatch    Farben für die Mini-Vorschau im Menü (Grund, Fläche, Akzent)
// Die Flächenfarben je Stil stehen in css/styles/<stil>.css.

export const STYLES = {
  glut: {
    label: 'Glut',
    modes: ['dark', 'light'],
    phases: [['Funke', 5], ['Flamme', 10], ['Glut', 15], ['Dämmerung', 19], ['Asche', 23]],
    keys: [
      { h: 0, glow: [143, 84, 70], ui: [192, 130, 112], k: 0.26 },
      { h: 5, glow: [143, 84, 70], ui: [192, 130, 112], k: 0.26 },
      { h: 7, glow: [240, 180, 98], ui: [240, 180, 98], k: 0.5 },
      { h: 10, glow: [238, 138, 75], ui: [238, 138, 75], k: 0.55 },
      { h: 15, glow: [224, 104, 79], ui: [224, 104, 79], k: 0.6 },
      { h: 19, glow: [201, 96, 95], ui: [212, 113, 111], k: 0.5 },
      { h: 23, glow: [143, 84, 70], ui: [192, 130, 112], k: 0.26 },
      { h: 24, glow: [143, 84, 70], ui: [192, 130, 112], k: 0.26 },
    ],
    fonts: 'family=Manrope:wght@200;300;400;500;600;700&family=Newsreader:ital,opsz,wght@1,6..72,400;1,6..72,500',
    swatch: ['#130F0D', '#2A221E', '#EE8A4B'],
  },
  glas: {
    label: 'Glas',
    modes: ['dark'],
    phases: [['Zitrus', 5], ['Kobalt', 10], ['Orchidee', 16], ['Beere', 19], ['Eis', 23]],
    keys: [
      { h: 0, glow: [70, 90, 200], ui: [170, 185, 255], k: 0.55 },
      { h: 5, glow: [70, 90, 200], ui: [170, 185, 255], k: 0.55 },
      { h: 7, glow: [255, 170, 120], ui: [255, 200, 160], k: 0.55 },
      { h: 11, glow: [90, 170, 255], ui: [150, 200, 255], k: 0.55 },
      { h: 16, glow: [255, 130, 160], ui: [255, 170, 195], k: 0.55 },
      { h: 19, glow: [160, 100, 255], ui: [200, 170, 255], k: 0.55 },
      { h: 23, glow: [70, 90, 200], ui: [170, 185, 255], k: 0.55 },
      { h: 24, glow: [70, 90, 200], ui: [170, 185, 255], k: 0.55 },
    ],
    fonts: 'family=Manrope:wght@200;300;400;500;600;700',
    swatch: ['#1B1D3A', '#5A6CD8', '#FFB48C'],
  },
  papier: {
    label: 'Papier',
    modes: ['light'],
    phases: [['Zitrus', 5], ['Kobalt', 10], ['Orchidee', 16], ['Beere', 19], ['Eis', 23]],
    keys: [
      { h: 0, glow: [59, 74, 94], ui: [59, 74, 94], k: 0.2 },
      { h: 5, glow: [59, 74, 94], ui: [59, 74, 94], k: 0.2 },
      { h: 7, glow: [31, 78, 140], ui: [31, 78, 140], k: 0.2 },
      { h: 11, glow: [179, 38, 30], ui: [179, 38, 30], k: 0.2 },
      { h: 16, glow: [150, 83, 0], ui: [150, 83, 0], k: 0.2 },
      { h: 19, glow: [107, 45, 92], ui: [107, 45, 92], k: 0.2 },
      { h: 23, glow: [59, 74, 94], ui: [59, 74, 94], k: 0.2 },
      { h: 24, glow: [59, 74, 94], ui: [59, 74, 94], k: 0.2 },
    ],
    fonts: 'family=Manrope:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500',
    swatch: ['#F4EFE6', '#1A1714', '#B3261E'],
  },
  jarvis: {
    label: 'Jarvis',
    modes: ['dark'],
    phases: [['Zitrus', 5], ['Kobalt', 10], ['Orchidee', 16], ['Beere', 19], ['Eis', 23]],
    keys: [
      { h: 0, glow: [0, 150, 255], ui: [40, 190, 255], k: 0.34 },
      { h: 5, glow: [0, 150, 255], ui: [40, 190, 255], k: 0.34 },
      { h: 7, glow: [0, 255, 200], ui: [40, 255, 210], k: 0.45 },
      { h: 11, glow: [0, 229, 255], ui: [40, 235, 255], k: 0.5 },
      { h: 16, glow: [90, 160, 255], ui: [120, 180, 255], k: 0.5 },
      { h: 19, glow: [255, 170, 0], ui: [255, 185, 40], k: 0.5 },
      { h: 23, glow: [0, 150, 255], ui: [40, 190, 255], k: 0.34 },
      { h: 24, glow: [0, 150, 255], ui: [40, 190, 255], k: 0.34 },
    ],
    fonts: 'family=Manrope:wght@400;500;600;700&family=Rajdhani:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700',
    swatch: ['#02060A', '#0E3A4C', '#28E6FF'],
  },
};

export const DEFAULT_STYLE = 'glut';

// Atemtempo des Glühens: Tag, Abend, Nacht
export const breathFor = hour => (hour < 5 || hour >= 23 ? 14 : hour >= 19 ? 11 : 9);

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Akzent, Leuchtfarbe und Glühstärke für eine Stunde (Kommazahl, 0–24).
export function sample(style, hour) {
  const keys = STYLES[style].keys;
  let i = 0;
  while (i < keys.length - 2 && hour >= keys[i + 1].h) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = (hour - a.h) / (b.h - a.h);
  return { glow: mix(a.glow, b.glow, t), ui: mix(a.ui, b.ui, t), k: a.k + (b.k - a.k) * t };
}

// Phase 0–4 (Morgen, Tag, Nachmittag, Abend, Nacht) und ihr Name im Stil.
export function phaseOf(style, hour) {
  const phases = STYLES[style].phases;
  let index = 4;
  for (let i = 0; i < 4; i++) if (hour >= phases[i][1] && hour < phases[i + 1][1]) index = i;
  return { index, name: phases[index][0] };
}
