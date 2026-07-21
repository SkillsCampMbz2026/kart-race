// Pseudo-3D "Outrun style" road: the track is a sequence of flat segments along a
// single Z axis. Each segment has a "curve" value; accumulating curve while
// projecting bends the road left/right on screen. This is the classic approach
// used by many small pseudo-3D racers (perspective projection + painter's-algorithm
// segment culling) — no hills here, just curves, to keep the first version simple.

const SEGMENT_LENGTH = 200;
const ROAD_HALF_WIDTH = 1000;
const RUMBLE_LENGTH = 3;

const COLORS = {
  LIGHT: { road: '#666a73', grass: '#3a6b3f', rumble: '#d94b4b' },
  DARK: { road: '#5b5f68', grass: '#335f36', rumble: '#e8e8e8' },
};

function easeIn(a, b, percent) { return a + (b - a) * Math.pow(percent, 2); }
function easeInOut(a, b, percent) { return a + (b - a) * ((-Math.cos(percent * Math.PI) / 2) + 0.5); }

const TRACK = { segments: [] };

function addSegment(curve) {
  const n = TRACK.segments.length;
  TRACK.segments.push({
    index: n,
    curve,
    color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.DARK : COLORS.LIGHT,
    p1: { world: { x: 0, y: 0, z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
    p2: { world: { x: 0, y: 0, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
  });
}

function addStraight(num) {
  for (let i = 0; i < num; i++) addSegment(0);
}

// Eases into the curve, holds it, then eases back out, so bends feel smooth
// instead of kinking sharply at the entry/exit.
function addCurve(num, curveAmount) {
  const third = Math.floor(num / 3);
  const hold = num - third * 2;
  for (let i = 0; i < third; i++) addSegment(easeIn(0, curveAmount, i / third));
  for (let i = 0; i < hold; i++) addSegment(curveAmount);
  for (let i = 0; i < third; i++) addSegment(easeInOut(curveAmount, 0, i / third));
}

// A more varied layout than the original stadium oval — four turns of different
// sharpness and length instead of two identical 180s, plus uneven straights.
// All turns bend the same rotational direction, which keeps the minimap's
// loop-closing math (see buildMinimap below) simple and exact.
addStraight(70);
addCurve(55, 3.4);
addStraight(35);
addCurve(75, 1.5);
addStraight(50);
addCurve(45, 3.0);
addStraight(30);
addCurve(85, 1.7);

TRACK.length = TRACK.segments.length * SEGMENT_LENGTH;

// Precompute a flat top-down (x, y) point per segment for the minimap. The pseudo-3D
// renderer only tracks "curve" (a turn-rate unit tuned for the projection, not radians),
// so here we rescale it: total curve across the whole lap is forced to map to exactly
// 2*PI of heading change, which guarantees the minimap path always closes into a loop
// regardless of the specific curve profile.
(function buildMinimap() {
  const totalCurve = TRACK.segments.reduce((sum, seg) => sum + seg.curve, 0);
  const anglePerCurveUnit = totalCurve !== 0 ? (Math.PI * 2) / totalCurve : 0;

  let heading = 0, x = 0, y = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  TRACK.segments.forEach(seg => {
    seg.mapX = x;
    seg.mapY = y;
    heading += seg.curve * anglePerCurveUnit;
    x += Math.cos(heading) * SEGMENT_LENGTH;
    y += Math.sin(heading) * SEGMENT_LENGTH;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  TRACK.mapBounds = { minX, maxX, minY, maxY };
})();

function findSegment(z) {
  const idx = Math.floor(z / SEGMENT_LENGTH) % TRACK.segments.length;
  return TRACK.segments[(idx + TRACK.segments.length) % TRACK.segments.length];
}

// Projects a world-space point to screen space given a camera position.
// p.camera.z keeps its true sign so callers can cull points behind the camera;
// the scale calculation clamps the denominator separately to avoid a divide-by-zero.
function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadHalfWidth) {
  p.camera.x = (p.world.x || 0) - cameraX;
  p.camera.y = (p.world.y || 0) - cameraY;
  p.camera.z = (p.world.z || 0) - cameraZ;
  const scale = cameraDepth / (p.camera.z > 1 ? p.camera.z : 1);
  p.screen.scale = scale;
  p.screen.x = Math.round((width / 2) + (scale * p.camera.x * width / 2));
  p.screen.y = Math.round((height / 2) - (scale * p.camera.y * height / 2));
  p.screen.w = Math.round(scale * roadHalfWidth * width / 2);
}
