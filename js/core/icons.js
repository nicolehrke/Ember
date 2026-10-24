// Einheitliche Liniensymbole (24er-Raster, Strichstärke über CSS .ln-ic).
const PATHS = {
  study: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>',
  todos: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.5 1.5 2.5-2.5M3.5 12l1.5 1.5 2.5-2.5"/><circle cx="5.2" cy="17.5" r="1.3"/>',
  exams: '<path d="M3 9l9-4.5L21 9l-9 4.5z"/><path d="M7 11.5V16c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5"/>',
  habits: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  mensa: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/>',
  shopping: '<path d="M3 4h2.5l2 10h9.5l2-7.5H7"/><circle cx="9.5" cy="19" r="1.2"/><circle cx="16.5" cy="19" r="1.2"/>',
  notes: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>',
  music: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="7" cy="17.5" r="2.2"/><circle cx="17" cy="15.5" r="2.2"/>',
  resize: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v1h5v-1c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3.5z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  book: '<path d="M4 5.5c2.7-1 5.3-1 8 .8v13c-2.7-1.8-5.3-1.8-8-.8z"/><path d="M20 5.5c-2.7-1-5.3-1-8 .8v13c2.7-1.8 5.3-1.8 8-.8z"/>',
  candle: '<rect x="8.5" y="10" width="7" height="10.5" rx="1"/><path d="M12 10V8.2"/><path d="M12 3.5c1.3 1.4 1.8 2.4 1.8 3.1a1.8 1.8 0 0 1-3.6 0c0-.7.5-1.7 1.8-3.1z"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  house: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5v10h12v-10"/><path d="M10 19.5v-5h4v5"/>',
  screen: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  recipe: '<path d="M4 10.5h16v1.5a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z"/><path d="M2.5 10.5h19M9 7c0-1.4 1-1.6 1-3M13.5 7c0-1.4 1-1.6 1-3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="15" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="9" cy="15" r="1.1"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-1.3-1.2-1.7-1.2-2.9 0-1 .8-1.8 1.9-1.8h2.1a3.7 3.7 0 0 0 3.7-3.7C20.5 6.6 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="10.5" cy="7.4" r="1.1"/><circle cx="15" cy="7.6" r="1.1"/>',
  gear: '<path d="M18.8 10.2 L21.3 10.4 L21.3 13.6 L18.8 13.8 L18.1 15.5 L19.7 17.4 L17.4 19.7 L15.5 18.1 L13.8 18.8 L13.6 21.3 L10.4 21.3 L10.2 18.8 L8.5 18.1 L6.6 19.7 L4.3 17.4 L5.9 15.5 L5.2 13.8 L2.7 13.6 L2.7 10.4 L5.2 10.2 L5.9 8.5 L4.3 6.6 L6.6 4.3 L8.5 5.9 L10.2 5.2 L10.4 2.7 L13.6 2.7 L13.8 5.2 L15.5 5.9 L17.4 4.3 L19.7 6.6 L18.1 8.5z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  'bell-off': '<path d="M8.2 5.9A6 6 0 0 1 18 11v4M6 11v5.5L4.5 18H17"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16"/>',
};

export function icon(name, className = 'ln-ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}
