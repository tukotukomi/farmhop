// Builds the ".fun by tuko" logo as SVG: Farm Hop's chunky rainbow letters and plum
// ink, Fractalize's Sierpinski triangle (the dot) and yellow-green glow, Fantasy
// Radio's pixel lettering and pixel stars.
const fs = require('fs');
const OUT = __dirname;   // run: node make-logo.js
fs.mkdirSync(OUT, { recursive: true });

const INK = '#3a2442';
const RAINBOW = ['#ff4b4b', '#ff9a2e', '#ffd93b', '#5fd35f', '#46a6ff', '#9b6bff'];
const GLOW = ['#fff3a8', '#e9ffa0', '#c4ff80'];

// ---- ".fun": letters drawn as thick round strokes ----
const F = 'M232 232 V112 Q232 70 276 70';
const FBAR = 'M204 142 H270';
const U = 'M318 140 V188 Q318 234 366 234 Q414 234 414 188 V140 M414 140 V232';
const N = 'M462 232 V140 M462 178 Q462 138 510 138 Q558 138 558 182 V232';
const LETTERS = [F, FBAR, U, N].join(' ');

// ---- the dot: a Sierpinski triangle ----
function sierpinski(x, y, s, depth, out) {   // apex at (x, y), side s
  if (!depth) { out.push(`M${x} ${y} L${x + s / 2} ${y + s * 0.866} L${x - s / 2} ${y + s * 0.866} Z`); return; }
  const h = s / 2;
  sierpinski(x, y, h, depth - 1, out);
  sierpinski(x - h / 2, y + h * 0.866, h, depth - 1, out);
  sierpinski(x + h / 2, y + h * 0.866, h, depth - 1, out);
}
const tri = []; sierpinski(160, 186, 54, 2, tri);
const triOuter = `M160 186 L187 232.8 L133 232.8 Z`;

// ---- "by tuko": a 5 x 7 pixel font ----
const GLYPHS = {
  b: ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
  y: ['00000', '00000', '10001', '10001', '01111', '00001', '01110'],
  t: ['01000', '01000', '11110', '01000', '01000', '01001', '00110'],
  u: ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
  k: ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function pixelText(text, cx, top, px) {
  const w = text.length * 6 * px - px, x0 = cx - w / 2, cells = [];
  [...text].forEach((ch, i) => GLYPHS[ch].forEach((row, r) => [...row].forEach((on, c) => {
    if (on === '1') cells.push([x0 + (i * 6 + c) * px, top + r * px]);
  })));
  return cells;
}
const cells = pixelText('by tuko', 358, 272, 9);   // centred under ".fun", dot included
const ink = cells.map(([x, y]) => `<rect x="${x - 4}" y="${y - 4}" width="17" height="17"/>`).join('');
const fill = cells.map(([x, y]) => `<rect x="${x - 0.4}" y="${y - 0.4}" width="9.8" height="9.8"/>`).join('');   // a hair wider, so neighbours join

// ---- pixel stars ----
const star = (x, y, p, c) => `<g fill="${c}"><rect x="${x - p / 2}" y="${y - p * 1.5}" width="${p}" height="${p * 3}"/><rect x="${x - p * 1.5}" y="${y - p / 2}" width="${p * 3}" height="${p}"/></g>`;
const stars = (c1, c2) => star(126, 92, 6, c1) + star(600, 96, 5, c2) + star(592, 300, 4, c1) + star(110, 300, 4, c2) + star(330, 46, 4, c2);

function logo({ badge }) {
  const bg = badge ? `<rect x="40" y="16" width="640" height="368" rx="56" fill="#1a1740" stroke="${INK}" stroke-width="10"/>
  <rect x="40" y="16" width="640" height="368" rx="56" fill="url(#sky)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 400" width="1440" height="800">
  <title>.fun by tuko</title>
  <defs>
    <linearGradient id="rainbow" x1="130" y1="0" x2="565" y2="0" gradientUnits="userSpaceOnUse">
      ${RAINBOW.map((c, i) => `<stop offset="${(i / (RAINBOW.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="272" x2="0" y2="335" gradientUnits="userSpaceOnUse">
      ${GLOW.map((c, i) => `<stop offset="${(i / (GLOW.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="186" x2="0" y2="233" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff3a8"/><stop offset="1" stop-color="#ffc21a"/>
    </linearGradient>
    <radialGradient id="sky" cx="50%" cy="0%" r="90%">
      <stop offset="0" stop-color="#3b2f86" stop-opacity=".9"/><stop offset="1" stop-color="#0e0a22" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  ${bg}
  ${stars(badge ? '#ffd678' : '#ffc21a', badge ? '#96c8ff' : '#9b6bff')}
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${LETTERS}" stroke="${INK}" stroke-width="62"/>
    <path d="${LETTERS}" stroke="url(#rainbow)" stroke-width="40"/>
    <path d="${LETTERS}" stroke="#fff" stroke-width="9" stroke-opacity=".45" transform="translate(-5 -8)"/>
  </g>
  <path d="${triOuter}" fill="${INK}" stroke="${INK}" stroke-width="16" stroke-linejoin="round"/>
  <path d="${tri.join(' ')}" fill="url(#gold)"/>
  ${badge ? `<g fill="url(#glow)" opacity=".55" filter="url(#soft)">${fill}</g>` : ''}
  <g fill="${INK}">${ink}</g>
  <g fill="url(#glow)">${fill}</g>
</svg>
`;
}
fs.writeFileSync(`${OUT}/fun-by-tuko.svg`, logo({ badge: false }));
fs.writeFileSync(`${OUT}/fun-by-tuko-badge.svg`, logo({ badge: true }));
console.log('ok');
