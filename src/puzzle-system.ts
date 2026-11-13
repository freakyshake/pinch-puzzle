import {
  createSystem,
  Entity,
  Grabbed,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OneHandGrabbable,
  Quaternion,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { BOARDS, SLOT_HOVER, TABLE, TRAY_HOVER } from './levels.js';
import { PinchDemo } from './onboarding.js';
import { ProgressPanel } from './progress-panel.js';
import { Piece, PieceStates, Slot, type ShapeKind } from './puzzle-components.js';
import { getSettings, onSettingsChange, type Settings } from './settings.js';
import { createPieceVisual, createPlayMat, createSlotVisual } from './shapes.js';
import { Sounds } from './sounds.js';

/** Release within this horizontal distance of a matching slot snaps the piece. */
const SNAP_RADIUS = 0.12;
/** ...and within this vertical distance of the slot. */
const SNAP_HEIGHT = 0.22;
/**
 * Opening a pinch is not instant: tracked fingers drift for a few frames
 * before the release registers, dragging the piece off its slot. A release
 * also counts if the piece was over the slot at any point in this many
 * seconds before letting go.
 */
const RELEASE_GRACE = 0.18;
/** Recent held positions kept per piece (about 0.25 s at 72 to 90 fps). */
const TRAIL_SAMPLES = 24;
const TRAIL = 'trail';
const TRAIL_HEAD = 'trailHead';
/** Glide speed for snap and return (higher is faster). */
const GLIDE_RATE = 12;
/** How fast the table glides to a new height or distance. */
const TABLE_GLIDE_RATE = 7;
/** Seconds the win celebration plays before the next board appears. */
const WIN_DURATION = 3.2;
/** Seconds without progress before the ghost hand offers help again. */
const IDLE_HINT = 20;
/** Height of the puzzle-table asset (createPlinth(0.74, 1.1)). */
const TABLE_HEIGHT = 0.74;
/** Scene node of the wall shelf; its children trophy-1.. appear as boards are solved. */
const TROPHY_SHELF = 'trophy-shelf';
/** Seconds a newly earned trophy takes to pop in. */
const TROPHY_POP = 0.7;
/** Scene nodes that move with the table when height or distance change. */
const FOLLOWERS = ['progress-panel', 'settings-panel'];

const PIECE_MAT = 'pieceMaterial';
const PIECE_OUTLINE = 'pieceOutline';
const SLOT_RING = 'slotRing';
const SLOT_GHOST = 'slotGhost';
const SLOT_BASE = 'slotBase';
const SLOT_BURST = 'slotBurst';
const SLOT_BURST_MAT = 'slotBurstMat';

const MAT_COLOR = '#4a5363';
const MAT_COLOR_CONTRAST = '#0c0d10';
const SLOT_BASE_COLOR = '#2b2d33';
const SLOT_BASE_CONTRAST = '#000000';

/** `?board=4` in the URL starts on board 4 (1-based), for testing and demos. */
function startBoardFromUrl(): number {
  try {
    const n = Number(new URLSearchParams(location.search).get('board'));
    if (Number.isInteger(n) && n >= 1 && n <= BOARDS.length) return n - 1;
  } catch {
    // No location (non-browser realm): start at board 1.
  }
  return 0;
}

const enum Phase {
  Playing,
  Won,
  Complete,
}

/**
 * Core loop: pinch a piece, release it over the slot of the same shape and it
 * snaps in; anywhere else it glides back to the tray. Filling every slot plays
 * a reward moment and then builds the next board. After the last board the
 * panel offers Play again.
 */
export class PuzzleSystem extends createSystem({
  pieces: { required: [Piece] },
  held: { required: [Piece, Grabbed] },
  slots: { required: [Slot] },
}) {
  private boardIndex = 0;
  private phase = Phase.Playing;
  private winTimer = 0;
  private panel!: ProgressPanel;
  private sounds!: Sounds;
  private demo!: PinchDemo;
  private matMaterial!: MeshStandardMaterial;
  private matEntity!: Entity;
  private table: Object3D | undefined;
  private tableBaseZ = 0;
  private followers: Object3D[] = [];
  private trophies: Object3D[] = [];
  /** Trophy that is popping in, and how far along it is (0 to 1). */
  private newTrophy: Object3D | null = null;
  private trophyTime = 0;

  /** Applied table offset: y = height, z = toward the player. */
  private offset = new Vector3();
  /** Where the settings want the table; `offset` glides toward it. */
  private goal = new Vector3();
  private highContrast = false;
  private immersive = false;

  private everPlaced = false;
  private idle = 0;
  private heldShapes: Record<ShapeKind, boolean> = {
    cube: false,
    sphere: false,
    cone: false,
    torus: false,
    gem: false,
    cylinder: false,
  };

  private piecePos = new Vector3();
  private samplePos = new Vector3();
  private snapPos = new Vector3();
  private now = 0;
  private foundSlot: Entity | null = null;
  private foundDist = 0;
  private foundWrong: Entity | null = null;
  private demoFrom = new Vector3();
  private demoTo = new Vector3();
  private identity = new Quaternion();

  init(): void {
    this.sounds = new Sounds(this.world);
    this.panel = new ProgressPanel(this.world, () => this.restartGame());
    this.demo = new PinchDemo(this.world);

    const mat = createPlayMat(1.0, 0.7, 0.07);
    this.matMaterial = mat.material;
    mat.mesh.name = 'play-mat';
    this.matEntity = this.world.createTransformEntity(mat.mesh);
    this.matEntity.object3D!.position.set(TABLE.x, TABLE.topY + 0.001, TABLE.z);

    this.table = this.world.getSceneObject('puzzle-table');
    this.tableBaseZ = this.table?.position.z ?? TABLE.z;
    for (const id of FOLLOWERS) {
      const object = this.world.getSceneObject(id);
      if (object) this.followers.push(object);
    }
    const shelf = this.world.getSceneObject(TROPHY_SHELF);
    for (let i = 1; i <= BOARDS.length; i++) {
      const trophy = shelf?.getObjectByName(`trophy-${i}`);
      if (trophy) this.trophies.push(trophy);
    }

    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', (entity) => {
        entity.setValue(Piece, 'state', PieceStates.Held);
        // Forget positions from any earlier grab.
        const trail = entity.object3D!.userData[TRAIL] as Float32Array;
        for (let i = 3; i < trail.length; i += 4) trail[i] = -1;
        entity.object3D!.getWorldPosition(this.piecePos);
        this.sounds.pick(this.piecePos);
        this.idle = 0;
      }),
      this.queries.held.subscribe('disqualify', (entity) => {
        if (entity.hasComponent(Piece)) this.onRelease(entity);
      }),
      onSettingsChange((next) => this.applySettings(next)),
      this.world.visibilityState.subscribe((state) => {
        this.immersive = state !== VisibilityState.NonImmersive;
        this.sounds.setMusic(this.immersive && getSettings().music);
      }),
      () => this.panel.dispose(),
    );

    this.boardIndex = startBoardFromUrl();
    // Skipping ahead (testing, demo recording) also skips the first-run demo.
    if (this.boardIndex > 0) this.everPlaced = true;
    this.showTrophies(this.boardIndex);
    this.buildBoard(this.boardIndex);
    this.applySettings(getSettings());
    // No glide on the first frame: start where the settings say.
    this.moveTable(this.goal.y, this.goal.z);
  }

  /** Short confirmation sound at a point (posture fit). */
  cue(position: Vector3): void {
    this.sounds.pick(position);
  }

  /** Current board number, 1-based, for UI and tests. */
  get boardNumber(): number {
    return this.boardIndex + 1;
  }

  get boardCount(): number {
    return BOARDS.length;
  }

  /** Rebuild the current board from scratch (settings panel). */
  restartBoard(): void {
    this.clearBoard();
    this.buildBoard(this.boardIndex);
  }

  /** The shelf shows one trophy for each of the first `count` boards. */
  private showTrophies(count: number): void {
    this.newTrophy = null;
    for (let i = 0; i < this.trophies.length; i++) {
      this.trophies[i].visible = i < count;
      this.trophies[i].scale.setScalar(1);
    }
  }

  /** Back to board 1 (Play again). */
  restartGame(): void {
    this.clearBoard();
    this.showTrophies(0);
    this.boardIndex = 0;
    this.buildBoard(0);
  }

  private buildBoard(index: number): void {
    const board = BOARDS[index];
    const ox = TABLE.x;
    const oy = TABLE.topY + this.offset.y;
    const oz = TABLE.z + this.offset.z;
    // Names are unique per board (piece-cone, piece-cone-2, ...) so tests and
    // the autoplay script can address each piece and slot.
    const seen: Partial<Record<string, number>> = {};
    for (const def of board.pieces) {
      const n = (seen[def.shape] ?? 0) + 1;
      seen[def.shape] = n;
      const suffix = n > 1 ? `-${n}` : '';

      const slotVisual = createSlotVisual(def.shape, SLOT_HOVER);
      const sd = slotVisual.root.userData;
      sd[SLOT_RING] = slotVisual.ring;
      sd[SLOT_GHOST] = slotVisual.ghost;
      sd[SLOT_BASE] = slotVisual.base;
      sd[SLOT_BURST] = slotVisual.burst;
      sd[SLOT_BURST_MAT] = slotVisual.burstMaterial;
      slotVisual.root.name = `slot-${def.shape}${suffix}`;
      const slot = this.world.createTransformEntity(slotVisual.root);
      slot.object3D!.position.set(ox + def.slot[0], oy, oz + def.slot[1]);
      slot.addComponent(Slot, { shape: def.shape });

      const pieceVisual = createPieceVisual(def.shape);
      pieceVisual.root.userData[PIECE_MAT] = pieceVisual.material;
      pieceVisual.root.userData[PIECE_OUTLINE] = pieceVisual.outline;
      // x, y, z, time per sample; time -1 marks an empty sample.
      pieceVisual.root.userData[TRAIL] = new Float32Array(TRAIL_SAMPLES * 4).fill(-1);
      pieceVisual.root.userData[TRAIL_HEAD] = 0;
      pieceVisual.root.name = `piece-${def.shape}${suffix}`;
      const piece = this.world.createTransformEntity(pieceVisual.root);
      const hx = ox + def.tray[0];
      const hy = oy + TRAY_HOVER;
      const hz = oz + def.tray[1];
      piece.object3D!.position.set(hx, hy, hz);
      piece.addComponent(Piece, {
        shape: def.shape,
        state: PieceStates.Tray,
        home: [hx, hy, hz],
        target: [hx, hy, hz],
      });
      piece.addComponent(OneHandGrabbable, { rotate: false, translate: true });
      this.styleSlot(slot);
      this.stylePiece(piece);
    }
    this.phase = Phase.Playing;
    this.idle = 0;
    this.panel.showBoard(
      index,
      BOARDS.length,
      board.name,
      board.hint,
      0,
      board.pieces.length,
    );
  }

  private clearBoard(): void {
    const doomed: Entity[] = [
      ...this.queries.pieces.entities,
      ...this.queries.slots.entities,
    ];
    for (const entity of doomed) entity.dispose();
  }

  /**
   * Nearest free slot of `shape` within snap range of `pos`, into foundSlot
   * and foundDist. A free slot of another shape in range goes to foundWrong.
   */
  private findSlot(pos: Vector3, shape: string): void {
    for (const slot of this.queries.slots.entities) {
      const sp = slot.object3D!.position;
      const dist = Math.hypot(sp.x - pos.x, sp.z - pos.z);
      if (dist > SNAP_RADIUS) continue;
      if (Math.abs(pos.y - sp.y) > SNAP_HEIGHT) continue;
      if (slot.getValue(Slot, 'occupant') != null) continue;
      if (slot.getValue(Slot, 'shape') !== shape) {
        this.foundWrong = slot;
        continue;
      }
      if (dist < this.foundDist) {
        this.foundSlot = slot;
        this.foundDist = dist;
      }
    }
  }

  /** Records where each held piece is, for the release grace window. */
  private recordTrails(): void {
    for (const piece of this.queries.held.entities) {
      const object = piece.object3D!;
      const data = object.userData;
      const trail = data[TRAIL] as Float32Array;
      const head = data[TRAIL_HEAD] as number;
      object.getWorldPosition(this.samplePos);
      const i = head * 4;
      trail[i] = this.samplePos.x;
      trail[i + 1] = this.samplePos.y;
      trail[i + 2] = this.samplePos.z;
      trail[i + 3] = this.now;
      data[TRAIL_HEAD] = (head + 1) % TRAIL_SAMPLES;
    }
  }

  private onRelease(piece: Entity): void {
    const object = piece.object3D!;
    object.getWorldPosition(this.piecePos);
    const shape = piece.getValue(Piece, 'shape') as string;

    this.foundSlot = null;
    this.foundDist = SNAP_RADIUS;
    this.foundWrong = null;
    this.findSlot(this.piecePos, shape);
    // A wrong-shape signal only counts where the piece was actually let go.
    const wrongNear = this.foundWrong as Entity | null;
    if (!this.foundSlot) {
      const trail = object.userData[TRAIL] as Float32Array;
      for (let i = 0; i < trail.length; i += 4) {
        const t = trail[i + 3];
        if (t < 0 || this.now - t > RELEASE_GRACE) continue;
        this.samplePos.set(trail[i], trail[i + 1], trail[i + 2]);
        this.findSlot(this.samplePos, shape);
      }
    }
    const best = this.foundSlot as Entity | null;

    const target = piece.getVectorView(Piece, 'target');
    if (best) {
      best.setValue(Slot, 'occupant', piece);
      piece.setValue(Piece, 'slot', best);
      const sp = best.object3D!.position;
      target[0] = sp.x;
      target[1] = sp.y + SLOT_HOVER;
      target[2] = sp.z;
      piece.setValue(Piece, 'state', PieceStates.Snapping);
      // Lock it in: placed pieces cannot be picked up again.
      piece.removeComponent(OneHandGrabbable);
    } else {
      if (wrongNear) {
        wrongNear.setValue(Slot, 'wrong', 1);
        this.sounds.wrong(this.piecePos);
      }
      target.set(piece.getVectorView(Piece, 'home'));
      piece.setValue(Piece, 'state', PieceStates.Returning);
    }
  }

  /** Table height/distance, high contrast and music. */
  private applySettings(next: Readonly<Settings>): void {
    this.goal.set(0, next.height, next.closer);

    if (next.highContrast !== this.highContrast) {
      this.highContrast = next.highContrast;
      for (const piece of this.queries.pieces.entities) this.stylePiece(piece);
      for (const slot of this.queries.slots.entities) this.styleSlot(slot);
    }
    this.matMaterial.color.set(this.highContrast ? MAT_COLOR_CONTRAST : MAT_COLOR);
    this.sounds.setMusic(this.immersive && next.music);
  }

  /** Moves the table, and everything that lives on it, to an offset. */
  private moveTable(height: number, closer: number): void {
    const dy = height - this.offset.y;
    const dz = closer - this.offset.z;
    if (dy !== 0 || dz !== 0) {
      for (const piece of this.queries.pieces.entities) {
        const home = piece.getVectorView(Piece, 'home');
        const target = piece.getVectorView(Piece, 'target');
        home[1] += dy;
        home[2] += dz;
        target[1] += dy;
        target[2] += dz;
        if (piece.getValue(Piece, 'state') !== PieceStates.Held) {
          piece.object3D!.position.y += dy;
          piece.object3D!.position.z += dz;
        }
      }
      for (const slot of this.queries.slots.entities) {
        slot.object3D!.position.y += dy;
        slot.object3D!.position.z += dz;
      }
      this.matEntity.object3D!.position.y += dy;
      this.matEntity.object3D!.position.z += dz;
      for (const follower of this.followers) {
        follower.position.y += dy;
        follower.position.z += dz;
      }
      if (this.table) {
        // The plinth's origin is its base, so scaling Y raises only the top.
        this.table.scale.y = (TABLE_HEIGHT + height) / TABLE_HEIGHT;
        this.table.position.z = this.tableBaseZ + closer;
      }
      this.offset.set(0, height, closer);
    }
  }

  private get pieceGlow(): number {
    return this.highContrast ? 0.45 : 0.12;
  }

  private stylePiece(piece: Entity): void {
    const data = piece.object3D!.userData;
    (data[PIECE_MAT] as MeshStandardMaterial).emissiveIntensity = this.pieceGlow;
    (data[PIECE_OUTLINE] as Mesh).visible = this.highContrast;
  }

  private styleSlot(slot: Entity): void {
    const base = slot.object3D!.userData[SLOT_BASE] as MeshStandardMaterial;
    base.color.set(this.highContrast ? SLOT_BASE_CONTRAST : SLOT_BASE_COLOR);
  }

  private celebrate(): void {
    const last = this.boardIndex === BOARDS.length - 1;
    this.phase = last ? Phase.Complete : Phase.Won;
    this.winTimer = 0;
    // This board's trophy pops onto the shelf.
    this.newTrophy = this.trophies[this.boardIndex] ?? null;
    this.trophyTime = 0;
    if (this.newTrophy) {
      this.newTrophy.scale.setScalar(0.001);
      this.newTrophy.visible = true;
    }
    if (last) {
      this.sounds.complete();
      this.panel.showComplete(BOARDS.length);
    } else {
      this.sounds.win();
      this.panel.showSolved(this.boardIndex, BOARDS.length);
    }
    for (const piece of this.queries.pieces.entities) {
      piece.setValue(Piece, 'pulse', 1);
    }
    for (const slot of this.queries.slots.entities) {
      slot.setValue(Slot, 'glow', 1);
    }
  }

  update(delta: number, time: number): void {
    const k = 1 - Math.exp(-GLIDE_RATE * delta);
    let justPlaced = false;
    this.now = time;
    this.recordTrails();

    if (this.offset.y !== this.goal.y || this.offset.z !== this.goal.z) {
      const kt = 1 - Math.exp(-TABLE_GLIDE_RATE * delta);
      let y = this.offset.y + (this.goal.y - this.offset.y) * kt;
      let z = this.offset.z + (this.goal.z - this.offset.z) * kt;
      if (Math.abs(this.goal.y - y) < 0.0005) y = this.goal.y;
      if (Math.abs(this.goal.z - z) < 0.0005) z = this.goal.z;
      this.moveTable(y, z);
    }

    for (const shape in this.heldShapes) this.heldShapes[shape as ShapeKind] = false;
    for (const piece of this.queries.held.entities) {
      this.heldShapes[piece.getValue(Piece, 'shape') as ShapeKind] = true;
    }

    let placed = 0;
    for (const piece of this.queries.pieces.entities) {
      const object = piece.object3D!;
      const state = piece.getValue(Piece, 'state');

      if (state === PieceStates.Tray) {
        // Gentle idle bob so tray pieces read as "pick me up".
        const home = piece.getVectorView(Piece, 'home');
        object.position.set(
          home[0],
          home[1] + 0.008 * Math.sin(time * 1.6 + home[0] * 9),
          home[2],
        );
      } else if (
        state === PieceStates.Snapping ||
        state === PieceStates.Returning
      ) {
        const t = piece.getVectorView(Piece, 'target');
        const p = object.position;
        p.x += (t[0] - p.x) * k;
        p.y += (t[1] - p.y) * k;
        p.z += (t[2] - p.z) * k;
        object.quaternion.slerp(this.identity, k);
        const dx = t[0] - p.x;
        const dy = t[1] - p.y;
        const dz = t[2] - p.z;
        if (dx * dx + dy * dy + dz * dz < 0.000004) {
          p.set(t[0], t[1], t[2]);
          object.quaternion.identity();
          if (state === PieceStates.Snapping) {
            piece.setValue(Piece, 'state', PieceStates.Placed);
            piece.setValue(Piece, 'pulse', 1);
            this.snapPos.copy(p);
            const slot = piece.getValue(Piece, 'slot');
            slot?.setValue(Slot, 'glow', 1);
            justPlaced = true;
          } else {
            piece.setValue(Piece, 'state', PieceStates.Tray);
          }
        }
      }
      if (piece.getValue(Piece, 'state') === PieceStates.Placed) placed++;

      const pulse = piece.getValue(Piece, 'pulse') ?? 0;
      if (pulse > 0) {
        const next = Math.max(0, pulse - delta * 1.8);
        piece.setValue(Piece, 'pulse', next);
        object.scale.setScalar(1 + 0.3 * Math.sin(next * Math.PI));
        const mat = object.userData[PIECE_MAT] as MeshStandardMaterial;
        mat.emissiveIntensity = this.pieceGlow + 1.2 * next;
      }
    }

    const contrastBoost = this.highContrast ? 1.6 : 1;
    for (const slot of this.queries.slots.entities) {
      const data = slot.object3D!.userData;
      const glow = slot.getValue(Slot, 'glow') ?? 0;
      const wrong = slot.getValue(Slot, 'wrong') ?? 0;
      const occupied = slot.getValue(Slot, 'occupant') != null;
      const wanted = !occupied && this.heldShapes[slot.getValue(Slot, 'shape') as ShapeKind];
      const ring = data[SLOT_RING] as MeshStandardMaterial;
      const ghost = data[SLOT_GHOST] as MeshStandardMaterial;
      // Empty slots breathe softly; a slot that matches a held piece calls
      // out with a faster, brighter pulse; filled ones go steady.
      const breathe = occupied
        ? 0.9
        : wanted
          ? 1.5 + 0.7 * Math.sin(time * 7)
          : 0.5 + 0.25 * Math.sin(time * 2.2);
      ring.emissiveIntensity = (breathe + 2.5 * glow) * contrastBoost;
      ghost.opacity = occupied ? 0 : this.highContrast ? 0.42 : wanted ? 0.32 : 0.22;
      // Wrong shape: ring dims sharply instead of a colour-only signal.
      if (wrong > 0) ring.emissiveIntensity *= 1 - 0.9 * wrong;

      const burst = data[SLOT_BURST] as Mesh;
      burst.visible = glow > 0;
      if (glow > 0) {
        burst.scale.setScalar(1 + (1 - glow) * 1.6);
        (data[SLOT_BURST_MAT] as MeshBasicMaterial).opacity = 0.8 * glow;
        slot.setValue(Slot, 'glow', Math.max(0, glow - delta * 1.5));
      }
      if (wrong > 0) slot.setValue(Slot, 'wrong', Math.max(0, wrong - delta * 2));
    }

    if (justPlaced) {
      const total = this.queries.pieces.entities.size;
      this.everPlaced = true;
      this.idle = 0;
      // Each placement plays the next note of the scale: a board is a melody.
      this.sounds.snap(this.snapPos, placed - 1);
      this.panel.setPlaced(placed, total);
      if (this.phase === Phase.Playing && total > 0 && placed === total) {
        this.celebrate();
      }
    }

    if (this.phase === Phase.Won) {
      this.winTimer += delta;
      if (this.winTimer >= WIN_DURATION) {
        this.clearBoard();
        this.boardIndex = (this.boardIndex + 1) % BOARDS.length;
        this.buildBoard(this.boardIndex);
      }
    }

    if (this.newTrophy) {
      this.trophyTime = Math.min(1, this.trophyTime + delta / TROPHY_POP);
      // Overshoot a little, then settle at full size.
      const t = this.trophyTime;
      this.newTrophy.scale.setScalar(Math.max(0.001, t + 0.35 * Math.sin(t * Math.PI)));
      if (t >= 1) this.newTrophy = null;
    }

    this.updateDemo(delta);
  }

  /**
   * Ghost-hand help: on the very first board until the first placement, and
   * later whenever the player has been idle for a while.
   */
  private updateDemo(delta: number): void {
    const holding = this.queries.held.entities.size > 0;
    if (this.phase === Phase.Playing && !holding) this.idle += delta;
    const wanted =
      this.phase === Phase.Playing &&
      !holding &&
      ((this.boardIndex === 0 && !this.everPlaced) || this.idle > IDLE_HINT);

    let shown = false;
    if (wanted) {
      for (const piece of this.queries.pieces.entities) {
        if (piece.getValue(Piece, 'state') !== PieceStates.Tray) continue;
        const shape = piece.getValue(Piece, 'shape') as ShapeKind;
        for (const slot of this.queries.slots.entities) {
          if (slot.getValue(Slot, 'shape') !== shape) continue;
          if (slot.getValue(Slot, 'occupant') != null) continue;
          const home = piece.getVectorView(Piece, 'home');
          this.demoFrom.set(home[0], home[1], home[2]);
          this.demoTo.copy(slot.object3D!.position);
          this.demoTo.y += SLOT_HOVER;
          this.demo.show(shape, this.demoFrom, this.demoTo);
          shown = true;
          break;
        }
        if (shown) break;
      }
    }
    if (!shown) this.demo.hide();
    this.demo.update(delta);
  }
}
