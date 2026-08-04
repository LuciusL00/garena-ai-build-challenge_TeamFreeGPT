import './style.css';
import {
  SwarmfallAdaptiveInput,
  type AdaptiveAttemptFeedback,
  type SwarmfallBindingSettingsView,
} from './adaptiveInput.ts';
import type {
  ChannelScore,
  MetricComparison,
} from '../../../packages/adaptive-input/src/index.ts';
import { GameActionBus, type Squad } from './actionBus.ts';
import { BALANCE } from './config/balance.ts';
import { wireCanvasInput, wireUiInput } from './input.ts';
import { getArenaLayout, getDefaultLasso, type Point } from './ui/layout.ts';
import {
  getStrategy,
  STRATEGIES,
  type StrategyId,
} from './strategy.ts';

type RoundStatus = 'INTRO' | 'PLAYING' | 'FINISHED';
type UnitKind = 'GUARD' | 'HARVESTER';

interface Lasso {
  points: Point[];
}

interface Unit {
  id: number;
  kind: UnitKind;
  index: number;
  position: Point;
  velocity: Point;
  cargo: number;
  returning: boolean;
  targetId?: number;
  escortTargetUnitId?: number;
  escortSlot?: number;
  impactCooldown: number;
  flash: number;
}

interface Asteroid {
  id: number;
  position: Point;
  velocity: Point;
  radius: number;
  baseRadius: number;
  health: number;
  maxHealth: number;
  hitCooldown: number;
}

interface Deposit {
  id: number;
  position: Point;
  radius: number;
  baseRadius: number;
  ore: number;
  maxOre: number;
}

interface Effect {
  position: Point;
  color: string;
  age: number;
  radius: number;
}

interface GameState {
  width: number;
  height: number;
  core: Point;
  status: RoundStatus;
  timeRemaining: number;
  score: number;
  asteroidTimer: number;
  depositTimer: number;
  nextId: number;
  units: Unit[];
  asteroids: Asteroid[];
  deposits: Deposit[];
  lassos: Map<Squad, Lasso>;
  effects: Effect[];
  stars: Point[];
}

interface UiRefs {
  score: HTMLElement;
  time: HTMLElement;
  swarmStatus: HTMLElement;
  activeStrategy: HTMLElement;
  strategyHint: HTMLElement;
  toast: HTMLElement;
  introOverlay: HTMLElement;
  introPanel: HTMLElement;
  resultPanel: HTMLElement;
  resultScore: HTMLElement;
  resultMessage: HTMLElement;
  selectedSquad: HTMLElement;
  inputSummary: HTMLElement;
  inputActivity: HTMLElement;
  inputIndicator: HTMLElement;
  settingsLayer: HTMLElement;
  settingsActionList: HTMLElement;
  settingsActionTitle: HTMLElement;
  settingsActionDescription: HTMLElement;
  settingsCurrentBinding: HTMLElement;
  settingsSourceList: HTMLElement;
  settingsRecommendation: HTMLElement;
  settingsComparison: HTMLElement;
  settingsTest: HTMLButtonElement;
  settingsReview: HTMLButtonElement;
  settingsKeep: HTMLButtonElement;
  settingsConfirm: HTMLButtonElement;
  settingsReset: HTMLButtonElement;
  visionStatus: HTMLElement;
  visionDetail: HTMLElement;
  cameraVideo: HTMLVideoElement;
  strategyButtons: NodeListOf<HTMLButtonElement>;
}

const TAU = Math.PI * 2;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalized(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function scalePoint(point: Point, xScale: number, yScale: number): Point {
  return { x: point.x * xScale, y: point.y * yScale };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function averagePoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function idleAnchor(lasso: Lasso, index: number): Point {
  const centre = averagePoint(lasso.points);
  const point = lasso.points[index % lasso.points.length] ?? centre;
  const blend = 0.42 + (index % 3) * 0.12;
  return {
    x: centre.x * (1 - blend) + point.x * blend,
    y: centre.y * (1 - blend) + point.y * blend,
  };
}

function makeStars(width: number, height: number): Point[] {
  return Array.from({ length: 70 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
  }));
}

function createRoundState(width: number, height: number): GameState {
  const layout = getArenaLayout(width, height);
  const lassos = new Map<Squad, Lasso>([
    ['GUARDS', { points: getDefaultLasso('GUARDS', width, height) }],
    ['HARVESTERS', { points: getDefaultLasso('HARVESTERS', width, height) }],
  ]);
  const state: GameState = {
    width,
    height,
    core: layout.core,
    status: 'INTRO',
    timeRemaining: BALANCE.roundSeconds,
    score: 0,
    asteroidTimer: 1.6,
    depositTimer: BALANCE.depositSpawnSeconds,
    nextId: 1,
    units: [],
    asteroids: [],
    deposits: [],
    lassos,
    effects: [],
    stars: makeStars(width, height),
  };

  for (let index = 0; index < BALANCE.guardCount; index += 1) {
    const lasso = lassos.get('GUARDS');
    const anchor = lasso ? idleAnchor(lasso, index) : layout.core;
    state.units.push({
      id: state.nextId++,
      kind: 'GUARD',
      index,
      position: { x: anchor.x, y: anchor.y },
      velocity: { x: 0, y: 0 },
      cargo: 0,
      returning: false,
      impactCooldown: 0,
      flash: 0,
    });
  }

  for (let index = 0; index < BALANCE.harvesterCount; index += 1) {
    const lasso = lassos.get('HARVESTERS');
    const anchor = lasso ? idleAnchor(lasso, index) : layout.core;
    state.units.push({
      id: state.nextId++,
      kind: 'HARVESTER',
      index,
      position: { x: anchor.x, y: anchor.y },
      velocity: { x: 0, y: 0 },
      cargo: 0,
      returning: false,
      impactCooldown: 0,
      flash: 0,
    });
  }

  for (let index = 0; index < BALANCE.initialDepositCount; index += 1) {
    spawnDeposit(state);
  }
  return state;
}

function spawnDeposit(state: GameState): void {
  if (state.deposits.length >= BALANCE.depositMaxCount) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const position = {
      x: randomBetween(48, state.width - 48),
      y: randomBetween(52, state.height - 48),
    };
    if (distance(position, state.core) < 90) continue;
    if (state.deposits.some((deposit) => distance(position, deposit.position) < 56)) continue;
    const radius = randomBetween(BALANCE.depositMinRadius, BALANCE.depositMaxRadius);
    const ore = randomBetween(BALANCE.depositMinOre, BALANCE.depositMaxOre);
    state.deposits.push({
      id: state.nextId++,
      position,
      radius,
      baseRadius: radius,
      ore,
      maxOre: ore,
    });
    return;
  }
}

function spawnAsteroid(state: GameState): void {
  if (state.asteroids.length >= BALANCE.asteroidMaxCount) return;
  const side = Math.floor(Math.random() * 4);
  const margin = 18;
  const position: Point =
    side === 0
      ? { x: -margin, y: randomBetween(20, state.height - 20) }
      : side === 1
        ? { x: state.width + margin, y: randomBetween(20, state.height - 20) }
        : side === 2
          ? { x: randomBetween(20, state.width - 20), y: -margin }
          : { x: randomBetween(20, state.width - 20), y: state.height + margin };
  const direction = normalized({ x: state.core.x - position.x, y: state.core.y - position.y });
  const speed = randomBetween(BALANCE.asteroidSpeedMin, BALANCE.asteroidSpeedMax);
  const radius = randomBetween(BALANCE.asteroidMinRadius, BALANCE.asteroidMaxRadius);
  state.asteroids.push({
    id: state.nextId++,
    position,
    velocity: { x: direction.x * speed, y: direction.y * speed },
    radius,
    baseRadius: radius,
    health: BALANCE.asteroidHealth,
    maxHealth: BALANCE.asteroidHealth,
    hitCooldown: 0,
  });
}

function addEffect(state: GameState, position: Point, color: string, radius: number): void {
  state.effects.push({ position: { ...position }, color, age: 0, radius });
}

function findAsteroid(state: GameState, id: number | undefined): Asteroid | undefined {
  return state.asteroids.find((asteroid) => asteroid.id === id);
}

function findDeposit(state: GameState, id: number | undefined): Deposit | undefined {
  return state.deposits.find((deposit) => deposit.id === id);
}

function findUnit(state: GameState, id: number | undefined): Unit | undefined {
  return state.units.find((unit) => unit.id === id);
}

class SwarmfallGame {
  private readonly context: CanvasRenderingContext2D;
  private state: GameState;
  private readonly ui: UiRefs;
  private readonly canvas: HTMLCanvasElement;
  private readonly bus: GameActionBus;
  private selectedSquad: Squad = 'GUARDS';
  private activeStrategy: StrategyId = 'MINER_PROTECT';
  private drawingPath: Point[] | null = null;
  private lastFrame = 0;
  private lastUiUpdate = 0;
  private toastUntil = 0;

  public constructor(
    canvas: HTMLCanvasElement,
    bus: GameActionBus,
    ui: UiRefs,
  ) {
    this.canvas = canvas;
    this.bus = bus;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    this.context = context;
    this.ui = ui;
    this.state = createRoundState(900, 560);
    this.connectActions();
    this.resize();
    this.updateUi(true);
  }

  public resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(320, bounds.width || 900);
    const height = Math.max(360, bounds.height || 560);
    const oldWidth = this.state.width;
    const oldHeight = this.state.height;
    const xScale = oldWidth > 0 ? width / oldWidth : 1;
    const yScale = oldHeight > 0 ? height / oldHeight : 1;
    const devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * devicePixelRatio);
    this.canvas.height = Math.floor(height * devicePixelRatio);
    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    if (oldWidth !== width || oldHeight !== height) {
      this.state.units.forEach((unit) => {
        unit.position = scalePoint(unit.position, xScale, yScale);
      });
      this.state.asteroids.forEach((asteroid) => {
        asteroid.position = scalePoint(asteroid.position, xScale, yScale);
      });
      this.state.deposits.forEach((deposit) => {
        deposit.position = scalePoint(deposit.position, xScale, yScale);
      });
      this.state.stars = this.state.stars.map((star) => scalePoint(star, xScale, yScale));
      this.state.lassos.forEach((lasso) => {
        lasso.points = lasso.points.map((point) => scalePoint(point, xScale, yScale));
      });
      if (this.drawingPath) this.drawingPath = this.drawingPath.map((point) => scalePoint(point, xScale, yScale));
    }
    this.state.width = width;
    this.state.height = height;
    this.state.core = getArenaLayout(width, height).core;
  }

  public start(): void {
    requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  private connectActions(): void {
    this.bus.on('SELECT_SQUAD', ({ squad }) => {
      this.selectedSquad = squad;
      this.showToast(`${squad === 'GUARDS' ? 'Guards' : 'Harvesters'} selected`);
      this.updateUi(true);
    });
    this.bus.on('TOGGLE_SQUAD', () => {
      this.selectedSquad = this.selectedSquad === 'GUARDS' ? 'HARVESTERS' : 'GUARDS';
      this.drawingPath = null;
      this.showToast(`${this.selectedSquad === 'GUARDS' ? 'Guards' : 'Harvesters'} selected`);
      this.updateUi(true);
    });
    this.bus.on('LASSO_START', ({ point }) => {
      if (this.state.status !== 'PLAYING') return;
      this.drawingPath = [point];
    });
    this.bus.on('LASSO_POINT', ({ point }) => {
      if (!this.drawingPath) return;
      const previous = this.drawingPath[this.drawingPath.length - 1];
      if (!previous || distance(previous, point) > 5) this.drawingPath.push(point);
    });
    this.bus.on('LASSO_END', ({ point }) => {
      if (!this.drawingPath) return;
      this.drawingPath.push(point);
      if (this.drawingPath.length >= 3) {
        this.state.lassos.set(this.selectedSquad, { points: [...this.drawingPath] });
        this.showToast(`${this.selectedSquad === 'GUARDS' ? 'Guard' : 'Harvester'} territory updated`);
      }
      this.drawingPath = null;
    });
    this.bus.on('SELECT_STRATEGY', ({ strategyId }) => {
      this.activeStrategy = strategyId;
      this.showToast(`Strategy active: ${getStrategy(this.activeStrategy).label}`);
      this.updateUi(true);
    });
    this.bus.on('BEGIN_ROUND', () => this.beginRound());
    this.bus.on('RESTART_ROUND', () => this.resetToIntro());
  }

  private beginRound(): void {
    this.state = createRoundState(this.state.width, this.state.height);
    this.state.status = 'PLAYING';
    this.drawingPath = null;
    this.showToast(`Strategy active: ${getStrategy(this.activeStrategy).label}`);
    this.updateUi(true);
  }

  private resetToIntro(): void {
    this.state = createRoundState(this.state.width, this.state.height);
    this.drawingPath = null;
    this.updateUi(true);
  }

  private frame(timestamp: number): void {
    const delta = this.lastFrame === 0 ? 0 : Math.min(0.04, (timestamp - this.lastFrame) / 1000);
    this.lastFrame = timestamp;
    this.update(delta);
    this.draw();
    if (timestamp - this.lastUiUpdate > 80) this.updateUi(false);
    requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }

  private update(delta: number): void {
    if (this.state.status !== 'PLAYING') return;
    this.state.timeRemaining = Math.max(0, this.state.timeRemaining - delta);
    this.state.asteroidTimer -= delta;
    this.state.depositTimer -= delta;
    if (this.state.asteroidTimer <= 0) {
      spawnAsteroid(this.state);
      this.state.asteroidTimer = BALANCE.asteroidSpawnSeconds;
    }
    if (this.state.depositTimer <= 0) {
      spawnDeposit(this.state);
      this.state.depositTimer = BALANCE.depositSpawnSeconds;
    }

    this.assignTargets();
    this.updateAsteroids(delta);
    this.updateUnits(delta);
    this.resolveCollisions();
    this.state.effects = this.state.effects.filter((effect) => {
      effect.age += delta;
      return effect.age < BALANCE.effectSeconds;
    });
    if (this.state.timeRemaining <= 0) this.finishRound();
  }

  private assignTargets(): void {
    const strategy = getStrategy(this.activeStrategy);
    const guardCounts = new Map<number, number>();
    const harvesterCounts = new Map<number, number>();
    const escortCounts = new Map<number, number>();
    const guardLasso = this.state.lassos.get('GUARDS');
    const harvesterLasso = this.state.lassos.get('HARVESTERS');
    const loadedMiners = this.state.units.filter(
      (unit) => unit.kind === 'HARVESTER' && (unit.returning || unit.cargo >= BALANCE.harvesterCargoCapacity),
    );

    for (const unit of this.state.units) {
      unit.targetId = undefined;
      unit.escortTargetUnitId = undefined;
      unit.escortSlot = undefined;
      if (unit.kind === 'GUARD') {
        if (strategy.guardPolicy === 'ESCORT_LOADED_MINER') {
          const escortTarget = loadedMiners
            .filter((miner) => guardLasso && pointInPolygon(miner.position, guardLasso.points))
            .filter((miner) => !escortCounts.has(miner.id))
            .sort((left, right) => distance(unit.position, left.position) - distance(unit.position, right.position))[0];
          if (escortTarget) {
            unit.escortTargetUnitId = escortTarget.id;
            unit.escortSlot = 0;
            escortCounts.set(escortTarget.id, 1);
            continue;
          }
        }
        const candidates = this.state.asteroids.filter(
          (asteroid) => guardLasso && pointInPolygon(asteroid.position, guardLasso.points),
        );
        const target = candidates
          .map((asteroid) => {
            const existing = guardCounts.get(asteroid.id) ?? 0;
            const unitDistance = distance(unit.position, asteroid.position);
            const crowdingPenalty = strategy.guardPolicy === 'SPREAD_IN_LASSO' ? BALANCE.spreadCrowdingPenalty : BALANCE.targetCrowdingPenalty;
            return { asteroid, score: unitDistance + existing * crowdingPenalty };
          })
          .sort((left, right) => left.score - right.score)[0]?.asteroid;
        unit.targetId = target?.id;
        if (target) guardCounts.set(target.id, (guardCounts.get(target.id) ?? 0) + 1);
      } else if (!unit.returning && unit.cargo < BALANCE.harvesterCargoCapacity) {
        if (strategy.harvesterPolicy === 'PROTECT_LOADED_MINER') {
          const escortTarget = loadedMiners
            .map((miner) => ({ miner, count: escortCounts.get(miner.id) ?? 0 }))
            .filter(({ count }) => count < BALANCE.minerEscortCount)
            .sort((left, right) => distance(unit.position, left.miner.position) - distance(unit.position, right.miner.position))[0]?.miner;
          if (escortTarget) {
            const slot = escortCounts.get(escortTarget.id) ?? 0;
            unit.escortTargetUnitId = escortTarget.id;
            unit.escortSlot = slot;
            escortCounts.set(escortTarget.id, slot + 1);
            continue;
          }
        }
        const candidates = this.state.deposits.filter(
          (deposit) => harvesterLasso && pointInPolygon(deposit.position, harvesterLasso.points),
        );
        const target = candidates
          .map((deposit) => {
            const existing = harvesterCounts.get(deposit.id) ?? 0;
            const unitDistance = distance(unit.position, deposit.position);
            const crowdingPenalty = strategy.harvesterPolicy === 'SPREAD_IN_LASSO' ? BALANCE.spreadCrowdingPenalty : BALANCE.targetCrowdingPenalty;
            return { deposit, score: unitDistance + existing * crowdingPenalty };
          })
          .sort((left, right) => left.score - right.score)[0]?.deposit;
        unit.targetId = target?.id;
        if (target) harvesterCounts.set(target.id, (harvesterCounts.get(target.id) ?? 0) + 1);
      }
    }
  }

  private updateAsteroids(delta: number): void {
    for (const asteroid of this.state.asteroids) {
      asteroid.hitCooldown = Math.max(0, asteroid.hitCooldown - delta);
      const inward = normalized({
        x: this.state.core.x - asteroid.position.x,
        y: this.state.core.y - asteroid.position.y,
      });
      asteroid.velocity.x += inward.x * 15 * delta;
      asteroid.velocity.y += inward.y * 15 * delta;
      const speed = Math.hypot(asteroid.velocity.x, asteroid.velocity.y);
      if (speed > 75) {
        asteroid.velocity.x = (asteroid.velocity.x / speed) * 75;
        asteroid.velocity.y = (asteroid.velocity.y / speed) * 75;
      }
      asteroid.position.x += asteroid.velocity.x * delta;
      asteroid.position.y += asteroid.velocity.y * delta;
    }
  }

  private updateUnits(delta: number): void {
    const unitsByKind = {
      GUARD: this.state.units.filter((unit) => unit.kind === 'GUARD'),
      HARVESTER: this.state.units.filter((unit) => unit.kind === 'HARVESTER'),
    };
    for (const unit of this.state.units) {
      unit.impactCooldown = Math.max(0, unit.impactCooldown - delta);
      unit.flash = Math.max(0, unit.flash - delta);
      if (unit.kind === 'HARVESTER' && unit.cargo >= BALANCE.harvesterCargoCapacity) unit.returning = true;

      let destination: Point;
      const escortTarget = findUnit(this.state, unit.escortTargetUnitId);
      if (unit.returning) {
        destination = this.state.core;
      } else if (escortTarget) {
        const slotAngle = unit.kind === 'HARVESTER' ? (unit.escortSlot === 0 ? -0.65 : 0.65) : Math.PI;
        const escortDistance = unit.kind === 'HARVESTER' ? BALANCE.minerEscortDistance : BALANCE.unitRadius * 4;
        destination = {
          x: escortTarget.position.x + Math.cos(slotAngle) * escortDistance,
          y: escortTarget.position.y + Math.sin(slotAngle) * escortDistance,
        };
      } else {
        const target = unit.kind === 'GUARD' ? findAsteroid(this.state, unit.targetId) : findDeposit(this.state, unit.targetId);
        destination = target?.position ?? idleAnchor(this.state.lassos.get(unit.kind === 'GUARD' ? 'GUARDS' : 'HARVESTERS') ?? { points: [this.state.core] }, unit.index);
      }

      const desiredDirection = normalized({
        x: destination.x - unit.position.x,
        y: destination.y - unit.position.y,
      });
      const speed = unit.kind === 'GUARD' ? BALANCE.guardSpeed : BALANCE.harvesterSpeed;
      const rate = 1 - Math.exp(-BALANCE.unitAcceleration * delta);
      const desiredVelocity = { x: desiredDirection.x * speed, y: desiredDirection.y * speed };
      unit.velocity.x += (desiredVelocity.x - unit.velocity.x) * rate;
      unit.velocity.y += (desiredVelocity.y - unit.velocity.y) * rate;

      for (const other of unitsByKind[unit.kind]) {
        if (other.id === unit.id) continue;
        const separation = distance(unit.position, other.position);
        if (separation > 0 && separation < BALANCE.separationRadius) {
          const push = normalized({ x: unit.position.x - other.position.x, y: unit.position.y - other.position.y });
          const strength = (1 - separation / BALANCE.separationRadius) * BALANCE.separationStrength;
          unit.velocity.x += push.x * strength * delta;
          unit.velocity.y += push.y * strength * delta;
        }
      }

      const damping = Math.pow(BALANCE.unitDamping, delta * 10);
      unit.velocity.x *= damping;
      unit.velocity.y *= damping;
      unit.position.x = clamp(unit.position.x + unit.velocity.x * delta, 12, this.state.width - 12);
      unit.position.y = clamp(unit.position.y + unit.velocity.y * delta, 12, this.state.height - 12);
    }
  }

  private resolveCollisions(): void {
    for (const guard of this.state.units.filter((unit) => unit.kind === 'GUARD')) {
      for (const asteroid of this.state.asteroids) {
        if (distance(guard.position, asteroid.position) > BALANCE.unitRadius + asteroid.radius) continue;
        if (asteroid.hitCooldown > 0) continue;
        const away = normalized({ x: asteroid.position.x - guard.position.x, y: asteroid.position.y - guard.position.y });
        asteroid.velocity.x += away.x * BALANCE.guardImpactForce;
        asteroid.velocity.y += away.y * BALANCE.guardImpactForce;
        guard.velocity.x -= away.x * 12;
        guard.velocity.y -= away.y * 12;
        asteroid.health -= BALANCE.guardImpactDamage;
        asteroid.hitCooldown = BALANCE.asteroidHitCooldown;
        guard.impactCooldown = BALANCE.asteroidHitCooldown;
        guard.flash = 0.16;
        asteroid.radius = asteroid.baseRadius * (asteroid.health / asteroid.maxHealth);
        addEffect(this.state, asteroid.position, '#ff815b', asteroid.baseRadius * 1.6);
      }
    }

    for (const harvester of this.state.units.filter((unit) => unit.kind === 'HARVESTER')) {
      if (!harvester.returning) {
        const deposit = findDeposit(this.state, harvester.targetId);
        if (deposit && distance(harvester.position, deposit.position) < BALANCE.unitRadius + deposit.radius) {
          const mined = Math.min(BALANCE.miningRate / 60, deposit.ore, BALANCE.harvesterCargoCapacity - harvester.cargo);
          deposit.ore -= mined;
          harvester.cargo += mined;
          deposit.radius = Math.max(4, deposit.baseRadius * (deposit.ore / deposit.maxOre));
          if (deposit.ore <= 0) harvester.targetId = undefined;
        }
      } else if (distance(harvester.position, this.state.core) < BALANCE.cargoBankRadius) {
        this.state.score += harvester.cargo;
        harvester.cargo = 0;
        harvester.returning = false;
        harvester.targetId = undefined;
        addEffect(this.state, this.state.core, '#b8f15d', 28);
      }

      for (const asteroid of this.state.asteroids) {
        if (distance(harvester.position, asteroid.position) > BALANCE.unitRadius + asteroid.radius) continue;
        if (harvester.impactCooldown > 0) continue;
        const away = normalized({ x: harvester.position.x - asteroid.position.x, y: harvester.position.y - asteroid.position.y });
        if (harvester.cargo > 0) harvester.cargo = 0;
        harvester.velocity.x += away.x * BALANCE.harvesterImpactForce;
        harvester.velocity.y += away.y * BALANCE.harvesterImpactForce;
        harvester.impactCooldown = BALANCE.asteroidHitCooldown;
        harvester.flash = 0.24;
        addEffect(this.state, harvester.position, '#61d7d7', 22);
      }
    }

    for (const asteroid of this.state.asteroids) {
      if (distance(asteroid.position, this.state.core) > BALANCE.coreRadius) continue;
      if (asteroid.hitCooldown <= 0) {
        this.state.score = Math.max(0, this.state.score - BALANCE.coreImpactDamage);
        const outward = normalized({ x: asteroid.position.x - this.state.core.x, y: asteroid.position.y - this.state.core.y });
        asteroid.velocity.x += outward.x * BALANCE.coreImpactForce;
        asteroid.velocity.y += outward.y * BALANCE.coreImpactForce;
        asteroid.health -= 1;
        asteroid.hitCooldown = BALANCE.asteroidHitCooldown;
        addEffect(this.state, this.state.core, '#ff665f', 42);
      }
    }

    this.state.asteroids = this.state.asteroids.filter((asteroid) => asteroid.health > 0 && asteroid.position.x > -100 && asteroid.position.x < this.state.width + 100 && asteroid.position.y > -100 && asteroid.position.y < this.state.height + 100);
    this.state.deposits = this.state.deposits.filter((deposit) => deposit.ore > 0);
  }

  private finishRound(): void {
    this.state.status = 'FINISHED';
    this.showToast('Extraction window closed');
    this.updateUi(true);
  }

  private showToast(message: string): void {
    this.ui.toast.textContent = message;
    this.toastUntil = performance.now() + 2200;
    this.ui.toast.classList.add('visible');
  }

  private updateUi(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastUiUpdate < 80) return;
    this.lastUiUpdate = now;
    const strategy = getStrategy(this.activeStrategy);
    this.ui.score.textContent = Math.floor(this.state.score).toString().padStart(4, '0');
    this.ui.time.textContent = `00:${Math.ceil(this.state.timeRemaining).toString().padStart(2, '0')}`;
    this.ui.time.classList.toggle('danger', this.state.timeRemaining <= 10 && this.state.status === 'PLAYING');
    this.ui.swarmStatus.textContent = this.state.status === 'PLAYING' ? 'AUTONOMY ENGAGED' : this.state.status;
    this.ui.activeStrategy.textContent = strategy.label;
    this.ui.strategyHint.textContent = 'Changes apply immediately';
    this.ui.selectedSquad.textContent = this.selectedSquad === 'GUARDS' ? 'Guards' : 'Harvesters';
    this.ui.strategyButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.strategy === this.activeStrategy);
    });
    this.ui.introOverlay.toggleAttribute('hidden', this.state.status === 'PLAYING');
    this.ui.introPanel.toggleAttribute('hidden', this.state.status !== 'INTRO');
    this.ui.resultPanel.toggleAttribute('hidden', this.state.status !== 'FINISHED');
    this.ui.resultScore.textContent = Math.floor(this.state.score).toString();
    this.ui.resultMessage.textContent = this.state.score > 180 ? 'The core held and the swarm ran a rich route.' : this.state.score > 70 ? 'A workable extraction with room to sharpen the perimeter.' : 'The core needs a tighter defense next run.';
    this.ui.toast.classList.toggle('visible', now < this.toastUntil);
  }

  private draw(): void {
    const context = this.context;
    const { width, height } = this.state;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#081512';
    context.fillRect(0, 0, width, height);

    const illumination = context.createRadialGradient(this.state.core.x, this.state.core.y, 20, this.state.core.x, this.state.core.y, Math.max(width, height) * 0.65);
    illumination.addColorStop(0, 'rgba(184, 241, 93, .11)');
    illumination.addColorStop(1, 'rgba(7, 17, 15, 0)');
    context.fillStyle = illumination;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(95, 151, 128, .11)';
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += BALANCE.gridSize) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += BALANCE.gridSize) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.fillStyle = 'rgba(216, 231, 215, .55)';
    for (const star of this.state.stars) {
      context.fillRect(star.x, star.y, 1, 1);
    }
    this.drawLassos();
    this.drawDeposits();
    this.drawAsteroids();
    this.drawCore();
    this.drawUnits();
    this.drawEffects();
    if (this.drawingPath) this.drawPath(this.drawingPath, this.selectedSquad === 'GUARDS' ? '#ff815b' : '#61d7d7', true);
  }

  private drawLassos(): void {
    for (const [squad, lasso] of this.state.lassos) {
      const active = squad === this.selectedSquad;
      const color = squad === 'GUARDS' ? '#ff815b' : '#61d7d7';
      this.drawPath(lasso.points, color, active);
    }
  }

  private drawPath(points: readonly Point[], color: string, active: boolean): void {
    if (points.length < 2) return;
    const context = this.context;
    context.save();
    context.globalAlpha = active ? 0.85 : 0.35;
    context.fillStyle = color.replace(')', ', .08)').replace('rgb', 'rgba');
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.closePath();
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = active ? 2.2 : 1.2;
    context.setLineDash([7, 5]);
    context.stroke();
    context.restore();
  }

  private drawDeposits(): void {
    const context = this.context;
    for (const deposit of this.state.deposits) {
      context.save();
      context.translate(deposit.position.x, deposit.position.y);
      context.shadowColor = '#b8f15d';
      context.shadowBlur = 12;
      context.fillStyle = '#b8f15d';
      context.beginPath();
      context.moveTo(0, -deposit.radius);
      context.lineTo(deposit.radius * 0.72, deposit.radius * 0.42);
      context.lineTo(0, deposit.radius * 0.72);
      context.lineTo(-deposit.radius * 0.72, deposit.radius * 0.42);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = '#edffb0';
      context.lineWidth = 1;
      context.stroke();
      context.restore();
    }
  }

  private drawAsteroids(): void {
    const context = this.context;
    for (const asteroid of this.state.asteroids) {
      context.save();
      context.translate(asteroid.position.x, asteroid.position.y);
      context.rotate(Math.atan2(asteroid.velocity.y, asteroid.velocity.x));
      context.fillStyle = '#53655d';
      context.strokeStyle = '#8a9e91';
      context.lineWidth = 1;
      context.beginPath();
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * TAU;
        const radius = asteroid.radius * (0.78 + (index % 3) * 0.09);
        const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = '#30423b';
      context.beginPath();
      context.arc(-asteroid.radius * 0.25, -asteroid.radius * 0.12, Math.max(2, asteroid.radius * 0.16), 0, TAU);
      context.fill();
      context.restore();
    }
  }

  private drawCore(): void {
    const context = this.context;
    const { x, y } = this.state.core;
    context.save();
    context.translate(x, y);
    context.shadowColor = '#b8f15d';
    context.shadowBlur = 20;
    context.strokeStyle = '#b8f15d';
    context.lineWidth = 3;
    context.fillStyle = '#132b1e';
    context.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = index * (TAU / 6) - Math.PI / 6;
      const point = { x: Math.cos(angle) * BALANCE.coreRadius, y: Math.sin(angle) * BALANCE.coreRadius };
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(184, 241, 93, .5)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(0, 0, BALANCE.coreRadius + 9, 0, TAU);
    context.stroke();
    context.fillStyle = '#b8f15d';
    context.font = '700 9px Consolas, monospace';
    context.textAlign = 'center';
    context.fillText('CORE', 0, 3);
    context.restore();
  }

  private drawUnits(): void {
    const context = this.context;
    context.save();
    context.setLineDash([3, 4]);
    context.lineWidth = 1;
    for (const unit of this.state.units) {
      const escortTarget = findUnit(this.state, unit.escortTargetUnitId);
      if (!escortTarget) continue;
      context.strokeStyle = unit.kind === 'GUARD' ? 'rgba(255, 129, 91, .5)' : 'rgba(97, 215, 215, .5)';
      context.beginPath();
      context.moveTo(unit.position.x, unit.position.y);
      context.lineTo(escortTarget.position.x, escortTarget.position.y);
      context.stroke();
    }
    context.restore();
    for (const unit of this.state.units) {
      const color = unit.kind === 'GUARD' ? '#ff815b' : '#61d7d7';
      context.save();
      context.translate(unit.position.x, unit.position.y);
      const angle = Math.atan2(unit.velocity.y, unit.velocity.x);
      context.rotate(angle);
      context.fillStyle = unit.flash > 0 ? '#ffffff' : color;
      context.strokeStyle = '#07110f';
      context.lineWidth = 1.5;
      context.beginPath();
      if (unit.kind === 'GUARD') {
        context.moveTo(10, 0);
        context.lineTo(-7, -7);
        context.lineTo(-4, 0);
        context.lineTo(-7, 7);
      } else {
        context.moveTo(9, 0);
        context.lineTo(0, -8);
        context.lineTo(-8, 0);
        context.lineTo(0, 8);
      }
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();

      if (unit.kind === 'HARVESTER') {
        const cargoRatio = unit.cargo / BALANCE.harvesterCargoCapacity;
        context.fillStyle = 'rgba(7, 17, 15, .85)';
        context.fillRect(unit.position.x - 10, unit.position.y - 16, 20, 3);
        context.fillStyle = '#b8f15d';
        context.fillRect(unit.position.x - 10, unit.position.y - 16, 20 * cargoRatio, 3);
      }
    }
  }

  private drawEffects(): void {
    const context = this.context;
    for (const effect of this.state.effects) {
      const progress = effect.age / BALANCE.effectSeconds;
      context.save();
      context.globalAlpha = 1 - progress;
      context.strokeStyle = effect.color;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(effect.position.x, effect.position.y, effect.radius * (0.5 + progress), 0, TAU);
      context.stroke();
      context.restore();
    }
  }
}

function createUi(root: HTMLElement): UiRefs {
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div>
          <div class="brand">SWARMFALL</div>
          <div class="eyebrow">Extraction Protocol // Native Strategy Host</div>
        </div>
        <div class="topbar-actions">
          <div class="mission">Hold the core. Bank the ore.</div>
          <button class="controls-trigger" type="button" data-action="open-adaptive-settings">
            <span class="input-indicator" id="input-indicator" aria-hidden="true"></span>
            Controls <strong id="input-summary">Touch button</strong>
          </button>
        </div>
      </header>
      <section class="statusbar" aria-label="Mission status">
        <div class="status-cell"><span class="label">Banked ore</span><span class="value" id="score">0000</span></div>
        <div class="status-cell"><span class="label">Time remaining</span><span class="value" id="time">00:60</span></div>
        <div class="status-cell"><span class="label">Swarm status</span><span class="value" id="swarm-status">INTRO</span></div>
      </section>
      <main class="game-area">
        <div class="arena-frame">
          <canvas id="arena" aria-label="Swarmfall tactical arena. Select a squad and draw its territory."></canvas>
          <div class="toast" id="toast" role="status" aria-live="polite"></div>
          <div class="overlay" id="round-overlay">
            <section class="overlay-card" id="intro-panel">
              <div class="eyebrow">One minute // One core</div>
              <h1>Command the swarm.</h1>
              <p>Choose a squad, draw its territory, and let the autonomous units coordinate inside it. Native strategies are formation policies the game already supports.</p>
              <p class="tip">Five guards repel asteroids. Five harvesters mine and bank ore.</p>
              <button type="button" data-action="begin-round">Begin extraction</button>
            </section>
            <section class="overlay-card" id="result-panel" hidden>
              <div class="eyebrow">Extraction window closed</div>
              <h1>Round complete.</h1>
              <p>Banked ore</p>
              <div class="value" id="result-score">0</div>
              <p id="result-message"></p>
              <button type="button" data-action="restart-round">Run again</button>
            </section>
          </div>
        </div>
        <aside class="side-panel" aria-label="Swarm commands">
          <h2 class="panel-title">Squad territory</h2>
          <p class="panel-copy">Draw a lasso for the selected squad. Each squad remembers its own territory.</p>
          <div class="squad-readout"><span class="label">Selected squad</span><strong id="selected-squad">Guards</strong></div>
          <button class="switch-squad" type="button" data-action="switch-squad">Switch squad</button>
          <h2 class="panel-title">Native strategy</h2>
          <p class="panel-copy">These policies are built into the game. Later, natural language can select one safely.</p>
          <div class="strategy-list">
            ${STRATEGIES.map((strategy) => `<button class="strategy${strategy.id === 'MINER_PROTECT' ? ' active' : ''}" type="button" data-strategy="${strategy.id}"><strong>${strategy.label}</strong><small>${strategy.description}</small></button>`).join('')}
          </div>
          <div class="active-strategy"><span class="label">Active strategy</span><strong id="active-strategy">Miner Protect</strong><span class="microcopy" id="strategy-hint">Changes apply immediately</span></div>
        </aside>
      </main>
      <footer class="bottom-bar">
        <span class="microcopy" id="input-activity" role="status" aria-live="polite">Touch controls ready</span>
        <div class="legend"><span class="guard">Guards</span><span class="harvester">Harvesters</span><span class="ore">Core + ore</span></div>
      </footer>
      <div class="settings-layer" id="adaptive-settings" hidden>
        <button class="settings-scrim" type="button" data-action="close-adaptive-settings" aria-label="Close controls"></button>
        <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header class="settings-header">
            <div><div class="eyebrow">Controls &amp; accessibility</div><h2 id="settings-title">Input bindings</h2></div>
            <button type="button" data-action="close-adaptive-settings" aria-label="Close controls">Close</button>
          </header>
          <div class="settings-body">
            <nav class="settings-actions" aria-label="Remappable game actions" id="settings-action-list"></nav>
            <section class="settings-detail">
              <div>
                <h3 id="settings-action-title">Choose an action</h3>
                <p id="settings-action-description"></p>
              </div>
              <div class="current-binding"><span class="label">Current input</span><strong id="settings-current-binding">Touch button</strong></div>
              <div class="settings-source-list" id="settings-source-list" aria-label="Compatible inputs"></div>
              <div class="settings-recommendation" id="settings-recommendation">Choose an alternative input to compare it with the current control.</div>
              <div class="settings-comparison" id="settings-comparison" hidden></div>
              <div class="settings-buttons">
                <button class="secondary" id="settings-test" type="button" data-action="start-adaptive-calibration" hidden>Test inputs</button>
                <button class="secondary" id="settings-review" type="button" data-action="review-adaptive-binding" hidden>Review saved results</button>
                <button class="secondary" id="settings-keep" type="button" data-action="keep-current-binding" hidden>Keep current input</button>
                <button class="primary" id="settings-confirm" type="button" data-action="confirm-adaptive-binding" hidden>Use alternative input</button>
              </div>
              <button class="restore-default" id="settings-reset" type="button" data-action="reset-adaptive-binding">Restore game default</button>
              <div class="vision-readout">
                <span><span class="label">Visual input</span> <strong id="vision-status">Off</strong></span>
                <span id="vision-detail">Camera starts only after you approve a camera-based input.</span>
              </div>
            </section>
          </div>
        </section>
      </div>
      <video class="input-processing-video" id="adaptive-camera" muted playsinline aria-hidden="true" tabindex="-1"></video>
    </div>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  };
  return {
    score: query('#score'),
    time: query('#time'),
    swarmStatus: query('#swarm-status'),
    activeStrategy: query('#active-strategy'),
    strategyHint: query('#strategy-hint'),
    toast: query('#toast'),
    introOverlay: query('#round-overlay'),
    introPanel: query('#intro-panel'),
    resultPanel: query('#result-panel'),
    resultScore: query('#result-score'),
    resultMessage: query('#result-message'),
    selectedSquad: query('#selected-squad'),
    inputSummary: query('#input-summary'),
    inputActivity: query('#input-activity'),
    inputIndicator: query('#input-indicator'),
    settingsLayer: query('#adaptive-settings'),
    settingsActionList: query('#settings-action-list'),
    settingsActionTitle: query('#settings-action-title'),
    settingsActionDescription: query('#settings-action-description'),
    settingsCurrentBinding: query('#settings-current-binding'),
    settingsSourceList: query('#settings-source-list'),
    settingsRecommendation: query('#settings-recommendation'),
    settingsComparison: query('#settings-comparison'),
    settingsTest: query<HTMLButtonElement>('#settings-test'),
    settingsReview: query<HTMLButtonElement>('#settings-review'),
    settingsKeep: query<HTMLButtonElement>('#settings-keep'),
    settingsConfirm: query<HTMLButtonElement>('#settings-confirm'),
    settingsReset: query<HTMLButtonElement>('#settings-reset'),
    visionStatus: query('#vision-status'),
    visionDetail: query('#vision-detail'),
    cameraVideo: query<HTMLVideoElement>('#adaptive-camera'),
    strategyButtons: root.querySelectorAll<HTMLButtonElement>('[data-strategy]'),
  };
}

function renderBindingSettings(view: SwarmfallBindingSettingsView, ui: UiRefs): void {
  const selectedAction = view.actions.find((action) => action.id === view.selectedAction);
  if (!selectedAction) return;

  ui.settingsActionList.replaceChildren(
    ...view.actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.bindingAction = action.id;
      button.className = action.id === view.selectedAction ? 'active' : '';
      const label = document.createElement('strong');
      label.textContent = action.label;
      const binding = document.createElement('span');
      binding.textContent = action.currentSourceLabel;
      button.append(label, binding);
      return button;
    }),
  );
  ui.settingsActionTitle.textContent = selectedAction.label;
  ui.settingsActionDescription.textContent = selectedAction.description;
  ui.settingsCurrentBinding.textContent = selectedAction.currentSourceLabel;
  ui.settingsReset.disabled = selectedAction.currentSource === selectedAction.defaultSource;

  ui.settingsSourceList.replaceChildren(
    ...view.sources.map((source) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.inputSource = source.id;
      button.disabled = source.isCurrent;
      button.className = source.id === view.selectedSource ? 'active' : '';
      const label = document.createElement('strong');
      label.textContent = source.label;
      const detail = document.createElement('span');
      detail.textContent = source.isCurrent
        ? 'Current input'
        : source.requiresCamera
          ? 'Uses visual input'
          : 'No camera required';
      button.append(label, detail);
      return button;
    }),
  );

  const preview = view.preview;
  ui.settingsComparison.replaceChildren();
  ui.settingsComparison.hidden = true;
  ui.settingsTest.hidden = true;
  ui.settingsReview.hidden = true;
  ui.settingsKeep.hidden = true;
  ui.settingsConfirm.hidden = true;
  ui.settingsConfirm.textContent = 'Use alternative input';

  if (!preview) {
    ui.settingsRecommendation.textContent =
      'Choose another input to compare it with the current control.';
  } else {
    ui.settingsKeep.hidden = false;
    ui.settingsTest.hidden = false;
    if (preview.recommendation.verdict === 'needs-calibration') {
      const missingLabels = preview.recommendation.missing.map((source) =>
        view.sources.find((candidate) => candidate.id === source)?.label ?? source,
      );
      ui.settingsRecommendation.textContent =
        `Test ${missingLabels.join(' and ')} before deciding whether to change this control.`;
      ui.settingsTest.textContent = 'Start input test';
    } else if (view.stage === 'PREPARE') {
      ui.settingsRecommendation.textContent =
        `Saved results are available from ${formatSavedResultDate(preview)}. Review them or test again.`;
      ui.settingsTest.textContent = 'Test again';
      ui.settingsReview.hidden = false;
    } else {
      const conflict = preview.conflicts.length > 0
        ? ` It will replace ${preview.conflicts.map((item) => item.label).join(', ')} in this context.`
        : '';
      ui.settingsRecommendation.textContent =
        `${recommendationLabel(preview.recommendation.verdict)}: ${preview.recommendation.explanation}${conflict}`;
      renderComparison(ui.settingsComparison, preview);
      ui.settingsComparison.hidden = false;
      ui.settingsTest.textContent = 'Test again';
      ui.settingsConfirm.hidden = false;
      ui.settingsConfirm.textContent = preview.conflicts.length > 0
        ? `Replace and use ${preview.toLabel}`
        : `Use ${preview.toLabel}`;
    }
  }

  const changedActions = view.actions.filter(
    (action) => action.currentSource !== action.defaultSource,
  );
  ui.inputSummary.textContent = changedActions.length === 0
    ? 'Touch defaults'
    : changedActions.length === 1
      ? `${changedActions[0].label}: ${changedActions[0].currentSourceLabel}`
      : `${changedActions.length} custom bindings`;
}

function renderComparison(
  container: HTMLElement,
  preview: NonNullable<SwarmfallBindingSettingsView['preview']>,
): void {
  if (preview.recommendation.verdict === 'needs-calibration') return;
  const { current, alternative, comparison } = preview.recommendation.evidence;
  const table = document.createElement('table');
  const header = document.createElement('tr');
  header.append(
    tableCell('th', 'Measurement'),
    tableCell('th', preview.fromLabel),
    tableCell('th', preview.toLabel),
  );
  table.append(header);
  appendMetricRow(table, 'Actions detected', formatSuccess(current), formatSuccess(alternative), comparison.success);
  appendMetricRow(table, 'Typical response', formatLatency(current), formatLatency(alternative), comparison.latency);
  appendMetricRow(
    table,
    'Accidental activations',
    formatFalseActivations(current),
    formatFalseActivations(alternative),
    comparison.falseActivations,
  );
  container.append(table);
}

function appendMetricRow(
  table: HTMLTableElement,
  label: string,
  current: string,
  alternative: string,
  comparison: MetricComparison,
): void {
  const row = document.createElement('tr');
  const currentCell = tableCell('td', current);
  const alternativeCell = tableCell('td', alternative);
  if (comparison === 'current-better') {
    currentCell.className = 'better';
    alternativeCell.className = 'worse';
  } else if (comparison === 'alternative-better') {
    currentCell.className = 'worse';
    alternativeCell.className = 'better';
  } else {
    currentCell.className = 'similar';
    alternativeCell.className = 'similar';
  }
  row.append(tableCell('th', label), currentCell, alternativeCell);
  table.append(row);
}

function tableCell<T extends 'th' | 'td'>(tag: T, text: string): HTMLElementTagNameMap[T] {
  const cell = document.createElement(tag);
  cell.textContent = text;
  return cell;
}

function formatSuccess(score: ChannelScore): string {
  return `${score.successCount}/${score.trialCount} (${Math.round(score.successRate * 100)}%)`;
}

function formatLatency(score: ChannelScore): string {
  return score.medianLatencyMs === null ? 'No response' : `${Math.round(score.medianLatencyMs)} ms`;
}

function formatFalseActivations(score: ChannelScore): string {
  return `${score.falseActivationCount} (${score.falseActivationsPerMinute.toFixed(1)}/min)`;
}

function recommendationLabel(verdict: string): string {
  if (verdict === 'swap') return 'Alternative performed better';
  if (verdict === 'keep') return 'Original input performed better';
  if (verdict === 'trade-off') return 'Each input has a trade-off';
  return 'Retest recommended';
}

function formatSavedResultDate(
  preview: NonNullable<SwarmfallBindingSettingsView['preview']>,
): string {
  if (preview.recommendation.verdict === 'needs-calibration') return 'an earlier test';
  const oldestResult = Math.min(
    preview.recommendation.evidence.current.recordedAt,
    preview.recommendation.evidence.alternative.recordedAt,
  );
  return new Date(oldestResult).toLocaleString();
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root is missing.');
const ui = createUi(root);
const canvas = root.querySelector<HTMLCanvasElement>('#arena');
if (!canvas) throw new Error('Arena canvas is missing.');
const bus = new GameActionBus();
const showAttempt = (feedback: AdaptiveAttemptFeedback): void => {
  const confidence = feedback.confidence === undefined
    ? ''
    : ` (${Math.round(feedback.confidence * 100)}% confidence)`;
  ui.inputActivity.textContent = feedback.accepted
    ? `${feedback.sourceLabel}${confidence} used for Switch squad`
    : `${feedback.sourceLabel} did not run Switch squad; it currently uses ${feedback.bindingLabel}`;
};
const adaptive = new SwarmfallAdaptiveInput(bus, ui.cameraVideo, {
  onAttempt: showAttempt,
  onNotice: (message, isError) => {
    ui.inputActivity.textContent = message;
    ui.inputActivity.classList.toggle('warning', isError);
  },
  onSettingsChanged: (view) => renderBindingSettings(view, ui),
  onSettingsVisibilityChanged: (open) => {
    ui.settingsLayer.toggleAttribute('hidden', !open);
  },
  onCalibrationRequested: ({ action, source }) => {
    const returnQuery = new URLSearchParams({
      adaptiveControls: 'review',
      action,
      source,
    });
    const calibrationQuery = new URLSearchParams({ return: `/?${returnQuery.toString()}` });
    window.location.assign(`/calibration?${calibrationQuery.toString()}`);
  },
  onVisionStatus: (status, detail) => {
    const labels: Record<typeof status, string> = {
      IDLE: 'Off',
      REQUESTING: 'Permission requested',
      LOADING: 'Loading',
      READY: 'Active',
      DENIED: 'Permission denied',
      UNAVAILABLE: 'Unavailable',
      ERROR: 'Error',
    };
    ui.visionStatus.textContent = labels[status];
    ui.visionDetail.textContent = detail ?? '';
    ui.inputIndicator.classList.toggle('active', status === 'READY');
  },
});
const pendingSettings = new URLSearchParams(window.location.search);
if (pendingSettings.get('adaptiveControls') === 'review') {
  const action = pendingSettings.get('action');
  const source = pendingSettings.get('source');
  if (action && source) adaptive.openPendingSettings(action, source);
  window.history.replaceState(null, '', '/');
}
wireUiInput(root, bus, adaptive);
wireCanvasInput(canvas, bus);
const game = new SwarmfallGame(canvas, bus, ui);
const resizeObserver = new ResizeObserver(() => game.resize());
resizeObserver.observe(canvas);
game.start();
