const animeSelectEl = document.getElementById('animeSelect');
const animeGridEl = document.getElementById('animeGrid');
const characterSelectEl = document.getElementById('characterSelect');
const characterGridEl = document.getElementById('characterGrid');
const backToAnimeBtn = document.getElementById('backToAnimeBtn');
const startRaceBtn = document.getElementById('startRaceBtn');
const raceScreenEl = document.getElementById('raceScreen');

const canvas = document.getElementById('raceCanvas');
const ctx = canvas.getContext('2d');
const hudSpeedEl = document.getElementById('hudSpeed');
const hudAvatarEl = document.getElementById('hudAvatar');
const minimapCanvas = document.getElementById('minimapCanvas');
const minimapCtx = minimapCanvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const FIELD_OF_VIEW = 100;
const CAMERA_HEIGHT = 1000;
const CAMERA_DEPTH = 1 / Math.tan((FIELD_OF_VIEW / 2) * Math.PI / 180);
const DRAW_DISTANCE = 70; // segments ahead we render — keeps the view to "some meters ahead"
const SKY_COLOR = '#16241c';

let selectedThemeKey = null;
let selectedCharacter = null;
let player = null;
let loopStarted = false;

function buildAnimeGrid() {
  animeGridEl.innerHTML = '';
  Object.entries(THEMES).forEach(([key, theme]) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pick-card';
    card.innerHTML = `
      <img src="${theme.cover}" alt="${theme.name}">
      <div class="swatch" style="background:${theme.color}"></div>
      <span>${theme.name}</span>
    `;
    card.addEventListener('click', () => {
      selectedThemeKey = key;
      buildCharacterGrid();
      animeSelectEl.classList.add('hidden');
      characterSelectEl.classList.remove('hidden');
    });
    animeGridEl.appendChild(card);
  });
}

function buildCharacterGrid() {
  const theme = THEMES[selectedThemeKey];
  characterGridEl.innerHTML = '';
  selectedCharacter = null;
  startRaceBtn.disabled = true;
  theme.characters.forEach(ch => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pick-card';
    card.innerHTML = `
      <img src="${ch.img}" alt="${ch.name}">
      <div class="swatch" style="background:${theme.color}"></div>
      <span>${ch.name}</span>
    `;
    card.addEventListener('click', () => {
      selectedCharacter = ch;
      characterGridEl.querySelectorAll('.pick-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      startRaceBtn.disabled = false;
    });
    characterGridEl.appendChild(card);
  });
}

backToAnimeBtn.addEventListener('click', () => {
  characterSelectEl.classList.add('hidden');
  animeSelectEl.classList.remove('hidden');
});

startRaceBtn.addEventListener('click', () => {
  const theme = THEMES[selectedThemeKey];
  hudAvatarEl.src = selectedCharacter.img;
  player = new Player();
  player.color = theme.color;

  characterSelectEl.classList.add('hidden');
  raceScreenEl.classList.remove('hidden');

  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(loop);
  }
});

const DRIVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '];
const keys = {};
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (DRIVE_KEYS.includes(k)) e.preventDefault();
  keys[k] = true;
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readInput() {
  let throttle = 0;
  let steer = 0;
  if (keys[' '] || keys['arrowup'] || keys['w']) throttle = 1;
  else if (keys['arrowdown'] || keys['s']) throttle = -1;
  if (keys['arrowleft'] || keys['a']) steer = -1;
  else if (keys['arrowright'] || keys['d']) steer = 1;
  return { throttle, steer };
}

function lerpColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

function polygon(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function drawSegmentPoly(segment, fog) {
  const p1 = segment.p1.screen, p2 = segment.p2.screen;

  const grassColor = fog > 0 ? lerpColor(segment.color.grass, SKY_COLOR, fog) : segment.color.grass;
  ctx.fillStyle = grassColor;
  ctx.fillRect(0, Math.min(p1.y, p2.y) - 1, WIDTH, Math.abs(p1.y - p2.y) + 2);

  const rumbleColor = fog > 0 ? lerpColor(segment.color.rumble, SKY_COLOR, fog) : segment.color.rumble;
  const rw1 = p1.w * 1.15, rw2 = p2.w * 1.15;
  polygon(p1.x - rw1, p1.y, p1.x + rw1, p1.y, p2.x + rw2, p2.y, p2.x - rw2, p2.y, rumbleColor);

  const roadColor = fog > 0 ? lerpColor(segment.color.road, SKY_COLOR, fog) : segment.color.road;
  polygon(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, roadColor);

  if (segment.index === 0) {
    const squares = 10;
    const segW = (p1.w * 2) / squares;
    for (let i = 0; i < squares; i++) {
      const stripe = i % 2 === 0 ? '#ffffff' : '#111111';
      polygon(
        p1.x - p1.w + i * segW, p1.y, p1.x - p1.w + (i + 1) * segW, p1.y,
        p2.x - p2.w + (i + 1) * segW, p2.y, p2.x - p2.w + i * segW, p2.y,
        stripe
      );
    }
  }
}

function drawRoad() {
  ctx.fillStyle = SKY_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const baseSegment = findSegment(player.z);
  const basePercent = (player.z % SEGMENT_LENGTH) / SEGMENT_LENGTH;
  const cameraX = player.x * ROAD_HALF_WIDTH;

  let maxy = HEIGHT;
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);

  const visible = [];

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const segIndex = (baseSegment.index + n) % TRACK.segments.length;
    const segment = TRACK.segments[segIndex];
    const looped = segIndex < baseSegment.index;
    const zOffset = looped ? TRACK.length : 0;

    project(segment.p1, cameraX - x, CAMERA_HEIGHT, player.z - zOffset, CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_HALF_WIDTH);
    project(segment.p2, cameraX - x - dx, CAMERA_HEIGHT, player.z - zOffset, CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_HALF_WIDTH);

    x += dx;
    dx += segment.curve;

    if (segment.p1.camera.z <= 0) continue;
    if (segment.p2.screen.y >= segment.p1.screen.y) continue;
    if (segment.p2.screen.y >= maxy) continue;

    segment.fog = Math.pow(n / DRAW_DISTANCE, 2);
    visible.push(segment);
    maxy = segment.p2.screen.y;
  }

  for (let i = visible.length - 1; i >= 0; i--) {
    drawSegmentPoly(visible[i], visible[i].fog);
  }
}

function drawMinimap() {
  const size = minimapCanvas.width;
  const pad = 14;
  const b = TRACK.mapBounds;
  const w = (b.maxX - b.minX) || 1;
  const h = (b.maxY - b.minY) || 1;
  const scale = Math.min((size - 2 * pad) / w, (size - 2 * pad) / h);

  minimapCtx.clearRect(0, 0, size, size);

  minimapCtx.strokeStyle = '#9aa0a6';
  minimapCtx.lineWidth = 7;
  minimapCtx.lineJoin = 'round';
  minimapCtx.lineCap = 'round';
  minimapCtx.beginPath();
  TRACK.segments.forEach((seg, i) => {
    const px = pad + (seg.mapX - b.minX) * scale;
    const py = pad + (seg.mapY - b.minY) * scale;
    if (i === 0) minimapCtx.moveTo(px, py); else minimapCtx.lineTo(px, py);
  });
  minimapCtx.closePath();
  minimapCtx.stroke();

  const seg = findSegment(player.z);
  const px = pad + (seg.mapX - b.minX) * scale;
  const py = pad + (seg.mapY - b.minY) * scale;
  minimapCtx.fillStyle = player.color || '#39d98a';
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 6, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.strokeStyle = '#0b1410';
  minimapCtx.lineWidth = 2;
  minimapCtx.stroke();
}

function drawHud() {
  const offRoad = Math.abs(player.x) > 1;
  hudSpeedEl.textContent = `Speed ${player.speed.toFixed(0)}${offRoad ? ' (off-track)' : ''}`;
}

function loop() {
  if (player) {
    player.update(readInput());
    drawRoad();
    drawMinimap();
    drawHud();
  }
  requestAnimationFrame(loop);
}

buildAnimeGrid();
