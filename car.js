// Player state lives directly in track space now: z = distance traveled along the
// road, x = lateral offset in road-half-widths (0 = center line, +-1 = road edge).
class Player {
  constructor() {
    this.z = 0;
    this.x = 0;
    this.speed = 0;
    this.totalDistance = 0; // unwrapped distance traveled, used to rank race position

    this.maxSpeed = 70;
    this.accel = 1.3;
    this.braking = 2.2;
    this.coasting = 0.5;
    this.offRoadDecel = 1.4;
    this.offRoadMaxSpeed = 20;
    this.steerRate = 0.05;
    this.centrifugal = 0.3;
  }

  update(input) {
    const { throttle, steer } = input;

    if (throttle > 0) this.speed += this.accel;
    else if (throttle < 0) this.speed -= this.braking;
    else this.speed -= this.coasting;

    const offRoad = Math.abs(this.x) > 1;
    if (offRoad) {
      this.speed -= this.offRoadDecel;
      this.speed = Math.min(this.speed, this.offRoadMaxSpeed);
    }

    this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));

    const speedPercent = this.speed / this.maxSpeed;
    const steerStrength = 0.3 + 0.7 * speedPercent; // some steering authority even at low speed
    this.x += steer * this.steerRate * steerStrength;

    // The road's curvature tugs the car toward the outside of the turn, so cutting
    // a corner takes active counter-steering, like a real (if gentle) kart.
    const segment = findSegment(this.z);
    this.x -= segment.curve * speedPercent * this.centrifugal * 0.01;

    this.x = Math.max(-2, Math.min(2, this.x));

    this.totalDistance += this.speed;
    this.z = (this.z + this.speed + TRACK.length) % TRACK.length;
  }
}

// AI racers keep a fixed lane offset and near-constant speed. Because x is a
// lateral offset relative to the road's own local frame (not world-absolute),
// holding it constant automatically "follows" every curve — no steering logic
// needed for a convincing drive around the track.
class AICar {
  constructor(character, color, startZ, laneX, speed) {
    this.character = character;
    this.color = color;
    this.z = (startZ + TRACK.length) % TRACK.length;
    this.x = laneX;
    this.speed = speed;
    this.totalDistance = startZ; // credit their head start on the grid
    this.img = new Image();
    this.img.src = character.img;
  }

  update() {
    this.totalDistance += this.speed;
    this.z = (this.z + this.speed + TRACK.length) % TRACK.length;
  }
}
