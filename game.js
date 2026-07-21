const animeSelectEl = document.getElementById('animeSelect');
const animeGridEl = document.getElementById('animeGrid');
const characterSelectEl = document.getElementById('characterSelect');
const characterGridEl = document.getElementById('characterGrid');
const backToAnimeBtn = document.getElementById('backToAnimeBtn');
const startRaceBtn = document.getElementById('startRaceBtn');
const raceScreenEl = document.getElementById('raceScreen');
const changeAnimeBtn = document.getElementById('changeAnimeBtn');

const canvas = document.getElementById('raceCanvas');
const ctx = canvas.getContext('2d');
const hudSpeedEl = document.getElementById('hudSpeed');
const hudPositionEl = document.getElementById('hudPosition');
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
const CAR_HALF_WIDTH = 260;
const COLLISION_Z = 220; // roughly one car-length
const COLLISION_X = 0.32; // lateral proximity, in road-half-width units
const COLLISION_SPEED_PENALTY = 0.4; // speed multiplier applied on impact
const COLLISION_COOLDOWN_FRAMES = 30; // ~0.5s, so one hit doesn't register every frame while overlapping

let collisionCooldown = 0;

// Fixed starting grid for the 7 AI cars: staggered ahead of the player (who
// starts at z=0, at the back of the pack), spread across a few lanes so nobody
// starts stacked on top of each other. Offsets must stay positive — a negative
// offset wraps around to "just before the finish line", which puts that car at
// an almost-zero real distance from the player for the first instant, and a
// point that close to the camera projects to an enormous, screen-filling sprite.
const AI_START_GRID = [
  { dz: 220, x: -0.5 }, { dz: 220, x: 0.5 },
  { dz: 440, x: -0.7 }, { dz: 440, x: 0 }, { dz: 440, x: 0.7 },
  { dz: 660, x: -0.4 }, { dz: 660, x: 0.4 },
];

let selectedThemeKey = null;
let selectedCharacter = null;
let player = null;
let aiCars = [];
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

changeAnimeBtn.addEventListener('click', () => {
  player = null;
  aiCars = [];
  selectedThemeKey = null;
  selectedCharacter = null;
  raceScreenEl.classList.add('hidden');
  animeSelectEl.classList.remove('hidden');
});

startRaceBtn.addEventListener('click', () => {
  const theme = THEMES[selectedThemeKey];
  hudAvatarEl.src = selectedCharacter.img;
  player = new Player();
  player.color = theme.color;

  const opponents = theme.characters.filter(ch => ch.id !== selectedCharacter.id);
  aiCars = AI_START_GRID.map((slot, i) => new AICar(
    opponents[i],
    theme.color,
    slot.dz,
    slot.x,
    54 + Math.random() * 18
  ));

  collisionCooldown = 0;

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

let lastBaseSegment = null;

function drawRoad() {
  ctx.fillStyle = SKY_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const baseSegment = findSegment(player.z);
  lastBaseSegment = baseSegment;
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

    // Stash the curve offset used for this segment's near edge so car sprites
    // landing in this segment can project themselves with the same lateral bend.
    segment.curveOffsetX = x;
    segment.visitedN = n;

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

function roundRectPathAt(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Drawn as if seen from behind (the classic "chasing the car ahead" pseudo-3D
// view): a tapered body wider at the rear bumper, wheels peeking out at the
// sides, brake lights, and the driver's portrait sitting above the cockpit.
function drawCarSprite(car, p, fog) {
  const halfW = p.screen.w;
  if (halfW < 1) return;
  const bodyH = halfW * 1.3;
  const bx = p.screen.x, by = p.screen.y;
  const topW = halfW * 0.72;

  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - fog);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(bx, by + halfW * 0.05, halfW * 1.05, halfW * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  const wheelW = halfW * 0.32, wheelH = bodyH * 0.4;
  ctx.fillStyle = '#161616';
  roundRectPathAt(bx - halfW * 1.1, by - wheelH * 0.95, wheelW, wheelH, wheelW * 0.4);
  ctx.fill();
  roundRectPathAt(bx + halfW * 1.1 - wheelW, by - wheelH * 0.95, wheelW, wheelH, wheelW * 0.4);
  ctx.fill();

  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.moveTo(bx - halfW, by);
  ctx.lineTo(bx + halfW, by);
  ctx.lineTo(bx + topW, by - bodyH);
  ctx.lineTo(bx - topW, by - bodyH);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.moveTo(bx - topW * 0.85, by - bodyH * 0.55);
  ctx.lineTo(bx + topW * 0.85, by - bodyH * 0.55);
  ctx.lineTo(bx + topW * 0.65, by - bodyH);
  ctx.lineTo(bx - topW * 0.65, by - bodyH);
  ctx.closePath();
  ctx.fill();

  const lightW = halfW * 0.22, lightH = bodyH * 0.14;
  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(bx - halfW * 0.95, by - lightH * 1.4, lightW, lightH);
  ctx.fillRect(bx + halfW * 0.95 - lightW, by - lightH * 1.4, lightW, lightH);

  const portraitR = topW * 0.85;
  const portraitCy = by - bodyH - portraitR * 0.7;
  ctx.beginPath();
  ctx.arc(bx, portraitCy, portraitR + 2, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1410';
  ctx.fill();
  if (car.img.complete && car.img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, portraitCy, portraitR, 0, Math.PI * 2);
    ctx.clip();
    const s = portraitR * 2.1;
    ctx.drawImage(car.img, bx - s / 2, portraitCy - s / 2, s, s);
    ctx.restore();
  }

  ctx.restore();
}

function checkCollisions() {
  if (collisionCooldown > 0) {
    collisionCooldown--;
    return;
  }
  for (const car of aiCars) {
    const rawDz = Math.abs(player.z - car.z);
    const dz = Math.min(rawDz, TRACK.length - rawDz);
    const dx = Math.abs(player.x - car.x);
    if (dz < COLLISION_Z && dx < COLLISION_X) {
      player.speed *= COLLISION_SPEED_PENALTY;
      collisionCooldown = COLLISION_COOLDOWN_FRAMES;
      break;
    }
  }
}

function updatePositions() {
  const ranked = [player, ...aiCars].slice().sort((a, b) => b.totalDistance - a.totalDistance);
  player.position = ranked.indexOf(player) + 1;
}

function drawTree(x, y, halfW, heightPx, fog) {
  if (heightPx < 2) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - fog);

  const trunkW = halfW * 0.35, trunkH = heightPx * 0.22;
  ctx.fillStyle = '#5b3a24';
  ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH);

  ctx.fillStyle = '#2f7a3d';
  ctx.beginPath();
  ctx.moveTo(x, y - heightPx);
  ctx.lineTo(x + halfW, y - trunkH - heightPx * 0.25);
  ctx.lineTo(x - halfW, y - trunkH - heightPx * 0.25);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x, y - heightPx * 0.62);
  ctx.lineTo(x + halfW * 0.85, y - trunkH);
  ctx.lineTo(x - halfW * 0.85, y - trunkH);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawBuilding(item, x, y, halfW, heightPx, fog) {
  if (heightPx < 2) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - fog);

  ctx.fillStyle = item.buildingColor;
  ctx.fillRect(x - halfW, y - heightPx, halfW * 2, heightPx);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  const floors = Math.max(2, Math.floor(heightPx / 40));
  for (let f = 1; f < floors; f++) {
    const fy = y - (heightPx * f / floors);
    ctx.fillRect(x - halfW, fy, halfW * 2, Math.max(1, heightPx * 0.02));
  }

  ctx.restore();
}

function drawScenery() {
  if (!lastBaseSegment) return;

  const withDepth = TRACK.scenery.map(item => {
    const dz = (item.z - player.z + TRACK.length) % TRACK.length;
    const n = Math.floor(dz / SEGMENT_LENGTH);
    if (n >= DRAW_DISTANCE) return null;
    const segIndex = (lastBaseSegment.index + n) % TRACK.segments.length;
    const segment = TRACK.segments[segIndex];
    if (segment.visitedN !== n) return null;
    return { item, dz, segment };
  }).filter(Boolean);

  withDepth.sort((a, b) => b.dz - a.dz);

  withDepth.forEach(({ item, dz, segment }) => {
    const worldX = item.side * (ROAD_HALF_WIDTH + item.offset);
    const p = { world: { x: worldX, y: 0, z: player.z + dz }, camera: {}, screen: {} };
    project(p, player.x * ROAD_HALF_WIDTH - segment.curveOffsetX, CAMERA_HEIGHT, player.z, CAMERA_DEPTH, WIDTH, HEIGHT, item.worldHalfWidth);
    if (p.camera.z <= 0) return;

    const heightPx = p.screen.scale * item.worldHeight * (HEIGHT / 2);
    const fog = Math.pow(segment.visitedN / DRAW_DISTANCE, 2);
    if (item.type === 'tree') drawTree(p.screen.x, p.screen.y, p.screen.w, heightPx, fog);
    else drawBuilding(item, p.screen.x, p.screen.y, p.screen.w, heightPx, fog);
  });
}

function drawCars() {
  if (!lastBaseSegment) return;

  const withDepth = aiCars.map(car => {
    const dz = (car.z - player.z + TRACK.length) % TRACK.length;
    const n = Math.floor(dz / SEGMENT_LENGTH);
    if (n >= DRAW_DISTANCE) return null;
    const segIndex = (lastBaseSegment.index + n) % TRACK.segments.length;
    const segment = TRACK.segments[segIndex];
    if (segment.visitedN !== n) return null;
    return { car, dz, segment };
  }).filter(Boolean);

  withDepth.sort((a, b) => b.dz - a.dz);

  withDepth.forEach(({ car, dz, segment }) => {
    const p = { world: { x: car.x * ROAD_HALF_WIDTH, y: 0, z: player.z + dz }, camera: {}, screen: {} };
    project(p, player.x * ROAD_HALF_WIDTH - segment.curveOffsetX, CAMERA_HEIGHT, player.z, CAMERA_DEPTH, WIDTH, HEIGHT, CAR_HALF_WIDTH);
    if (p.camera.z <= 0) return;
    const fog = Math.pow(segment.visitedN / DRAW_DISTANCE, 2);
    drawCarSprite(car, p, fog);
  });
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

  aiCars.forEach(car => {
    const seg = findSegment(car.z);
    const px = pad + (seg.mapX - b.minX) * scale;
    const py = pad + (seg.mapY - b.minY) * scale;
    minimapCtx.fillStyle = car.color;
    minimapCtx.globalAlpha = 0.55;
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, 4, 0, Math.PI * 2);
    minimapCtx.fill();
  });
  minimapCtx.globalAlpha = 1;

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
  hudPositionEl.textContent = `Position ${player.position}/${aiCars.length + 1}`;
}

function loop() {
  if (player) {
    player.update(readInput());
    aiCars.forEach(car => car.update());
    checkCollisions();
    updatePositions();
    drawRoad();
    drawScenery();
    drawCars();
    drawMinimap();
    drawHud();
  }
  requestAnimationFrame(loop);
}

buildAnimeGrid();
