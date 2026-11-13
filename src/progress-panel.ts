import { UIKit, UIKitMLAsset, World } from '@iwsdk/core';

/** Scene node ID of the placed panel in public/scenes/main.iwsdk.scene.json. */
const PANEL_NODE = 'progress-panel';
const STEP_COUNT = 6;

/** One color per board, in play order: the six piece colors. */
const BOARD_COLORS = [
  '#e9805f',
  '#5fa8e9',
  '#f2c14e',
  '#b57be0',
  '#5fd3a6',
  '#ef6f9a',
];
const COLOR_DONE = '#5fd3a6';
const COLOR_UPCOMING = '#565a66';
const HEADER_PLAYING = '#2a2556';
const ACCENT_SOLVED = '#2f9e78';
const ACCENT_COMPLETE = '#c9a700';
/** The current board's step is taller, so it never relies on color alone. */
const STEP_HEIGHT = 14;
const STEP_HEIGHT_CURRENT = 22;
const HEADER_SOLVED = '#5fd3a6';
const HEADER_COMPLETE = '#f5d90a';
const TEXT_LIGHT = '#fafaf7';
const TEXT_DARK = '#10261c';

type Element = UIKit.Text;

/**
 * Thin wrapper over the progress UIKitML panel. Updated only when progress
 * changes (board built, piece placed, board solved), never per frame.
 */
export class ProgressPanel {
  private label: Element | null = null;
  private name: Element | null = null;
  private placed: Element | null = null;
  private bar: Element | null = null;
  private header: Element | null = null;
  private accent: Element | null = null;
  private boardColor = BOARD_COLORS[0];
  private hint: Element | null = null;
  private playAgain: Element | null = null;
  private steps: (Element | null)[] = [];
  private cleanups: (() => void)[] = [];

  constructor(world: World, onPlayAgain: () => void) {
    const panel = world.getSceneObject<UIKitMLAsset>(PANEL_NODE);
    if (panel == null) return;
    const el = (id: string) => panel.getElementById<Element>(id);
    this.label = el('board-label');
    this.name = el('board-name');
    this.placed = el('placed-text');
    this.bar = el('bar-fill');
    this.header = el('header');
    this.accent = el('header-accent');
    this.hint = el('hint');
    this.playAgain = el('play-again');
    for (let i = 1; i <= STEP_COUNT; i++) this.steps.push(el(`step-${i}`));
    if (this.playAgain) {
      this.playAgain.name = 'play-again';
      const button = this.playAgain;
      button.addEventListener('click', onPlayAgain);
      this.cleanups.push(() => button.removeEventListener('click', onPlayAgain));
    }
  }

  /** A board is in play: header neutral, current step highlighted. */
  showBoard(
    index: number,
    count: number,
    boardName: string,
    hint: string,
    placed: number,
    total: number,
  ): void {
    this.boardColor = BOARD_COLORS[index % BOARD_COLORS.length];
    this.label?.setProperties({
      text: `BOARD ${index + 1} OF ${count}`,
      color: this.boardColor,
    });
    this.name?.setProperties({ text: boardName, color: TEXT_LIGHT });
    this.header?.setProperties({ backgroundColor: HEADER_PLAYING });
    this.accent?.setProperties({ backgroundColor: this.boardColor });
    this.hint?.setProperties({ text: hint, display: hint ? 'flex' : 'none' });
    this.playAgain?.setProperties({ display: 'none' });
    this.setSteps(index, false);
    this.setPlaced(placed, total);
  }

  /** Placed count and progress bar for the current board. */
  setPlaced(placed: number, total: number): void {
    this.placed?.setProperties({ text: `${placed} of ${total} placed` });
    const pct = total > 0 ? Math.round((placed / total) * 100) : 0;
    this.bar?.setProperties({
      width: `${pct}%`,
      backgroundColor: placed === total ? COLOR_DONE : this.boardColor,
    });
  }

  /** Board solved: the whole header turns green. */
  showSolved(index: number, count: number): void {
    this.label?.setProperties({
      text: `BOARD ${index + 1} OF ${count}`,
      color: TEXT_DARK,
    });
    this.name?.setProperties({ text: 'Solved!', color: TEXT_DARK });
    this.header?.setProperties({ backgroundColor: HEADER_SOLVED });
    this.accent?.setProperties({ backgroundColor: ACCENT_SOLVED });
    this.hint?.setProperties({ display: 'none' });
    this.setSteps(index, true);
  }

  /** Every board solved: gold header and a Play again button. */
  showComplete(count: number): void {
    this.label?.setProperties({ text: `ALL ${count} BOARDS`, color: TEXT_DARK });
    this.name?.setProperties({ text: 'All solved!', color: TEXT_DARK });
    this.header?.setProperties({ backgroundColor: HEADER_COMPLETE });
    this.accent?.setProperties({ backgroundColor: ACCENT_COMPLETE });
    this.hint?.setProperties({
      text: 'Thanks for playing. Again?',
      display: 'flex',
    });
    this.playAgain?.setProperties({ display: 'flex' });
    this.setSteps(count - 1, true);
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  private setSteps(current: number, currentDone: boolean): void {
    for (let i = 0; i < this.steps.length; i++) {
      const done = i < current || (i === current && currentDone);
      const playing = i === current && !currentDone;
      this.steps[i]?.setProperties({
        backgroundColor:
          done || playing ? BOARD_COLORS[i % BOARD_COLORS.length] : COLOR_UPCOMING,
        height: playing ? STEP_HEIGHT_CURRENT : STEP_HEIGHT,
      });
    }
  }
}
