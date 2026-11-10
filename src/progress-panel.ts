import { UIKit, UIKitMLAsset, World } from '@iwsdk/core';

/** Scene node ID of the placed panel in public/scenes/main.iwsdk.scene.json. */
const PANEL_NODE = 'progress-panel';
const STEP_COUNT = 6;

const COLOR_DONE = '#5fd3a6';
const COLOR_CURRENT = '#f5d90a';
const COLOR_UPCOMING = '#6b6f78';
const HEADER_PLAYING = '#2b2f3a';
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
    this.label?.setProperties({
      text: `BOARD ${index + 1} OF ${count}`,
      color: COLOR_CURRENT,
    });
    this.name?.setProperties({ text: boardName, color: TEXT_LIGHT });
    this.header?.setProperties({ backgroundColor: HEADER_PLAYING });
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
      backgroundColor: placed === total ? COLOR_DONE : COLOR_CURRENT,
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
    this.hint?.setProperties({ display: 'none' });
    this.setSteps(index, true);
  }

  /** Every board solved: gold header and a Play again button. */
  showComplete(count: number): void {
    this.label?.setProperties({ text: `ALL ${count} BOARDS`, color: TEXT_DARK });
    this.name?.setProperties({ text: 'All solved!', color: TEXT_DARK });
    this.header?.setProperties({ backgroundColor: HEADER_COMPLETE });
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
      const color = done
        ? COLOR_DONE
        : i === current
          ? COLOR_CURRENT
          : COLOR_UPCOMING;
      this.steps[i]?.setProperties({ backgroundColor: color });
    }
  }
}
