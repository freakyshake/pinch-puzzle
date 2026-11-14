import {
  CircleGeometry,
  createSystem,
  Entity,
  Euler,
  Grabbed,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { TABLE } from './levels.js';
import { Piece } from './puzzle-components.js';
import { PuzzleSystem } from './puzzle-system.js';
import { getSettings, onSettingsChange, snapHeight, updateSettings } from './settings.js';

/** A comfortable table top sits this far below the eyes. */
const EYE_TO_TABLE = 0.62;
/** Eye height the game assumes for a player who is not upright. */
const SEATED_EYE = 1.2;
/** A reclined player's line of sight lands on the board, this far below level. */
const BOARD_PITCH = (22 * Math.PI) / 180;
/** Looking up by more than this (sine of the angle) counts as reclined. */
const RECLINED_LOOK_UP = Math.sin((30 * Math.PI) / 180);
/** Head rolled sideways by more than this (sine) counts as lying on one side. */
const RECLINED_ROLL = Math.sin((35 * Math.PI) / 180);

/** Seconds after VR starts before the automatic fit reads the head pose. */
const AUTO_DELAY = 0.8;
/**
 * While the height is automatic, the table refits when the eyes have stayed
 * this far from where they were for this long: sitting down or standing up,
 * not leaning in to reach.
 */
const FOLLOW_DISTANCE = 0.2;
const FOLLOW_SECONDS = 2.5;
/** Pinch-and-hold in empty air: the marker appears, then the fit happens. */
const HOLD_SHOW = 0.7;
const HOLD_DONE = 3;
/** "Fit to me" button: time to look where the table should be. */
const BUTTON_DELAY = 2;

type Hand = 'left' | 'right';

/**
 * Fits the game to the player's body instead of asking the body to fit the
 * game.
 *
 * Upright players: the table height follows their eye height, every session
 * and again if they sit down or stand up, until they choose a height with the
 * Lower and Higher buttons (that choice is saved and kept). A refit also turns
 * and centres the game on where they are facing.
 * Reclined players (leaning far back, lying on their back or on one side): the
 * whole world turns with them, so the table sits in front of their eyes just
 * as it does for a seated player. Pieces float, so nothing falls.
 *
 * Nothing in the puzzle moves: only the player rig does (world.player, the
 * same object locomotion would move), so all game logic is untouched.
 *
 * Triggers: automatically when VR starts (the height alone, upright players
 * only; the reclined turn is never automatic), a pinch held in empty air for
 * three seconds with either hand, or the Fit to me button.
 */
export class PostureSystem extends createSystem({
  held: { required: [Piece, Grabbed] },
}) {
  private immersive = false;
  private sinceEnter = 0;
  private autoDone = false;
  /** Eye height the table was last fitted to, in tracking space. */
  private fittedEye = 0;
  /** False after a reclined fit: tracking height then says nothing useful. */
  private followHeight = false;
  /** The world is turned to a reclined player. */
  private reclined = false;
  /** Reset was pressed: go back to the automatic height on the next frame. */
  private refitHeight = false;
  private drift = 0;

  private holdHand: Hand | null = null;
  private holdTime = 0;
  private countdown = 0;

  private marker!: Entity;
  private fill!: Mesh;
  private session: XRSession | null = null;

  private forward = new Vector3();
  private right = new Vector3();
  private headPos = new Vector3();
  private rigPos = new Vector3();
  private rigQuat = new Quaternion();
  private headInv = new Quaternion();
  private euler = new Euler();
  private markerPos = new Vector3();

  private onSelectStart = (event: XRInputSourceEvent) => {
    const hand = event.inputSource.handedness;
    if (hand !== 'left' && hand !== 'right') return;
    this.holdHand = hand;
    this.holdTime = 0;
  };

  private onSelectEnd = (event: XRInputSourceEvent) => {
    if (event.inputSource.handedness === this.holdHand) this.holdHand = null;
  };

  init(): void {
    const material = new MeshBasicMaterial({
      color: '#f5d90a',
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const ring = new Mesh(new RingGeometry(0.03, 0.036, 40), material);
    this.fill = new Mesh(new CircleGeometry(0.027, 32), material);
    ring.renderOrder = 20;
    this.fill.renderOrder = 20;
    // A display only: never in the way of a pointer.
    ring.raycast = () => {};
    this.fill.raycast = () => {};
    const group = new Group();
    group.name = 'fit-marker';
    group.add(ring, this.fill);
    group.visible = false;
    this.marker = this.world.createTransformEntity(group);

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const immersive = state !== VisibilityState.NonImmersive;
        if (immersive === this.immersive) return;
        this.immersive = immersive;
        if (immersive) this.enter();
        else this.leave();
      }),
      // Reset hands the height back to automatic. Applied in update(), not
      // here, so other settings listeners never see a half-applied change.
      onSettingsChange((next, prev) => {
        if (prev.heightSet && !next.heightSet) this.refitHeight = true;
      }),
      () => this.unlisten(),
    );
  }

  /** Fit to me button: fits after a short pause to look at the table spot. */
  requestFit(): void {
    if (this.immersive) this.countdown = BUTTON_DELAY;
  }

  private enter(): void {
    this.sinceEnter = 0;
    this.autoDone = false;
    this.session = this.world.renderer.xr.getSession();
    this.session?.addEventListener('selectstart', this.onSelectStart);
    this.session?.addEventListener('selectend', this.onSelectEnd);
  }

  private leave(): void {
    this.unlisten();
    this.holdHand = null;
    this.countdown = 0;
    this.marker.object3D!.visible = false;
    this.reclined = false;
    this.followHeight = false;
    // The flat page uses the authored camera: put the rig back.
    this.player.position.set(0, 0, 0);
    this.player.quaternion.identity();
  }

  private unlisten(): void {
    this.session?.removeEventListener('selectstart', this.onSelectStart);
    this.session?.removeEventListener('selectend', this.onSelectEnd);
    this.session = null;
  }

  /** True when the head is far from upright: leaning back or lying down. */
  private readPosture(): boolean {
    const head = this.player.head;
    this.forward.set(0, 0, -1).applyQuaternion(head.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(head.quaternion);
    return this.forward.y > RECLINED_LOOK_UP || Math.abs(this.right.y) > RECLINED_ROLL;
  }

  /**
   * Places the player rig so the head lands on the seat, and sets the table
   * height. `head` is the pose in tracking space, so the rig is solved from
   * rig * head = wanted head pose.
   */
  private fit(): void {
    const head = this.player.head;
    const reclined = this.readPosture();
    let eye = head.position.y;
    if (reclined) {
      // Their line of sight becomes a seated player's view of the board.
      this.headInv.copy(head.quaternion).invert();
      this.rigQuat
        .setFromEuler(this.euler.set(-BOARD_PITCH, 0, 0))
        .multiply(this.headInv);
      this.headPos.copy(head.position).applyQuaternion(this.rigQuat);
      this.rigPos.set(0, SEATED_EYE, 0).sub(this.headPos);
      eye = SEATED_EYE;
    } else {
      // Upright: turn and centre only, the floor stays the floor.
      const flat = Math.hypot(this.forward.x, this.forward.z);
      const yaw = flat > 0.3 ? Math.atan2(-this.forward.x, -this.forward.z) : 0;
      this.rigQuat.setFromEuler(this.euler.set(0, -yaw, 0));
      this.headPos.set(head.position.x, 0, head.position.z).applyQuaternion(this.rigQuat);
      this.rigPos.set(0, 0, 0).sub(this.headPos);
    }
    this.player.position.copy(this.rigPos);
    this.player.quaternion.copy(this.rigQuat);
    this.fitHeight(eye);
    this.fittedEye = head.position.y;
    this.followHeight = !reclined;
    this.reclined = reclined;
    this.player.head.getWorldPosition(this.headPos);
    this.world.getSystem(PuzzleSystem)?.cue(this.headPos);
    console.info(
      `[posture] fit ${reclined ? 'reclined' : 'upright'}: eye ${eye.toFixed(2)} m, table offset ${getSettings().height.toFixed(2)}, rig ${this.rigPos
        .toArray()
        .map((n) => n.toFixed(2))
        .join(' ')} / ${this.rigQuat
        .toArray()
        .map((n) => n.toFixed(2))
        .join(' ')}`,
    );
  }

  /** Table height from eye height. The height stays automatic. */
  private fitHeight(eye: number): void {
    updateSettings({
      height: snapHeight(eye - EYE_TO_TABLE - TABLE.topY),
      heightSet: false,
    });
    this.fittedEye = eye;
    this.followHeight = true;
    this.drift = 0;
  }

  update(delta: number): void {
    if (!this.immersive) return;
    const head = this.player.head;

    // Once per session, as soon as the head pose is real.
    if (!this.autoDone) {
      this.sinceEnter += delta;
      if (this.sinceEnter >= AUTO_DELAY && head.position.y > 0.2) {
        this.autoDone = true;
        // Automatic: height only, and only for an upright player. A reclined
        // pose is never guessed at here; the player asks for it (button or
        // pinch-hold), because a wrong turn at VR start costs more than it saves.
        if (!this.readPosture() && !getSettings().heightSet) this.fitHeight(head.position.y);
      }
    } else if (this.refitHeight) {
      if (!this.reclined) this.fitHeight(head.position.y);
    } else if (
      this.followHeight &&
      !getSettings().heightSet &&
      this.queries.held.entities.size === 0 &&
      Math.abs(head.position.y - this.fittedEye) > FOLLOW_DISTANCE &&
      !this.readPosture()
    ) {
      this.drift += delta;
      if (this.drift >= FOLLOW_SECONDS) this.fitHeight(head.position.y);
    } else {
      this.drift = 0;
    }

    this.refitHeight = false;

    const marker = this.marker.object3D!;
    let progress = -1;

    if (this.countdown > 0) {
      this.countdown -= delta;
      progress = 1 - Math.max(0, this.countdown) / BUTTON_DELAY;
      // In front of the eyes, a little below the line of sight.
      head.getWorldPosition(this.markerPos);
      this.world.camera.getWorldQuaternion(this.headInv);
      this.forward.set(0, -0.12, -0.5).applyQuaternion(this.headInv);
      this.markerPos.add(this.forward);
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.fit();
        progress = -1;
      }
    } else if (this.holdHand) {
      // A pinch that picked up a piece is play, not a refit.
      if (this.queries.held.entities.size > 0) {
        this.holdHand = null;
      } else {
        this.holdTime += delta;
        if (this.holdTime >= HOLD_DONE) {
          this.holdHand = null;
          this.fit();
        } else if (this.holdTime >= HOLD_SHOW) {
          progress = (this.holdTime - HOLD_SHOW) / (HOLD_DONE - HOLD_SHOW);
          this.player.raySpaces[this.holdHand].getWorldPosition(this.markerPos);
          this.markerPos.y += 0.07;
        }
      }
    }

    marker.visible = progress >= 0;
    if (marker.visible) {
      marker.position.copy(this.markerPos);
      // Face the player.
      this.world.camera.getWorldQuaternion(marker.quaternion);
      this.fill.scale.setScalar(Math.max(0.001, progress));
    }
  }
}
