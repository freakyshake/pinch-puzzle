#!/usr/bin/env node
/**
 * Autoplay: drives the IWER emulator's right hand through the IWSDK CLI to
 * solve boards while you watch the managed browser window.
 *
 * Usage (dev server must be running, see docs/EMULATOR-AUTOPLAY.md):
 *   node scripts/autoplay.mjs              solve the current board
 *   node scripts/autoplay.mjs --boards 3   solve the next three boards
 *   node scripts/autoplay.mjs --all        solve every remaining board
 *   node scripts/autoplay.mjs --wrong      first drop one piece on a wrong slot
 *   node scripts/autoplay.mjs --slow       slower moves, easier to follow
 *
 * The CLI is called directly through node (no shell), so the JSON arguments
 * need no quoting on Windows, macOS or Linux.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The CLI package does not export package.json, so read it from disk.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = join(ROOT, 'node_modules', '@iwsdk', 'cli');
const CLI = join(
  CLI_DIR,
  JSON.parse(readFileSync(join(CLI_DIR, 'package.json'), 'utf8')).bin.iwsdk,
);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const BOARD_COUNT_FROM_PANEL = 6;
let boardsToSolve = 1;
if (flag('--all')) boardsToSolve = BOARD_COUNT_FROM_PANEL;
const boardsIdx = args.indexOf('--boards');
if (boardsIdx >= 0) boardsToSolve = Number(args[boardsIdx + 1]) || 1;
const WRONG_FIRST = flag('--wrong');
const SLOW = flag('--slow') ? 2 : 1;

/** Height above a slot (table top) to carry the held piece to before letting go. */
const CARRY_ABOVE_SLOT = 0.105;
/** Seconds the game celebrates before the next board appears (WIN_DURATION). */
const WIN_WAIT_MS = 3500;

function cli(domain, action, input, timeoutMs = 45000) {
  const argv = [CLI, domain, action];
  if (input !== undefined) argv.push('--input-json', JSON.stringify(input));
  if (domain === 'xr' && action === 'run-sequence') {
    argv.push('--timeout', String(timeoutMs));
  }
  const res = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    timeout: timeoutMs + 15000,
  });
  const out = (res.stdout || '').trim();
  try {
    const json = JSON.parse(out);
    if (!json.ok) {
      throw new Error(
        `${domain} ${action} failed: ${json.error?.message ?? out.slice(0, 400)}`,
      );
    }
    return json.data?.result ?? json.data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `${domain} ${action}: unexpected output\n${out.slice(0, 400)}\n${res.stderr}`,
      );
    }
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findEntities(component) {
  return cli('ecs', 'find', { withComponents: [component] }).entities ?? [];
}

function queryEntity(entityIndex) {
  const result = cli('ecs', 'query', { entityIndex });
  const byId = {};
  for (const c of result.components ?? []) byId[c.componentId] = c.values;
  return { name: result.name, ...byId };
}

/** Board state: slots with position and occupant, pieces still on the tray. */
function readBoard() {
  // Entities can vanish between find and query while a board is swapped out;
  // those are skipped rather than treated as errors.
  const slots = [];
  for (const e of findEntities('Slot')) {
    const q = queryEntity(e.entityIndex);
    if (!q.Slot || !q.Transform) continue;
    slots.push({
      name: e.name,
      shape: q.Slot.shape,
      position: q.Transform.position,
      occupied: q.Slot.occupant != null,
    });
  }
  const loose = [];
  for (const e of findEntities('Piece')) {
    if (!e.componentIds.includes('OneHandGrabbable')) continue;
    const q = queryEntity(e.entityIndex);
    if (q.Piece) loose.push({ name: e.name, shape: q.Piece.shape });
  }
  return { slots, loose };
}

let panelIndex = null;

/** Reads text from the progress panel. Pass element IDs to read fewer fields. */
function readPanel(ids = ['board-label', 'board-name', 'placed-text']) {
  if (panelIndex == null) {
    panelIndex =
      cli('ecs', 'find', { namePattern: '^Progress Panel$' }).entities?.[0]
        ?.entityIndex ?? null;
  }
  if (panelIndex == null) return '(progress panel not found)';
  return ids
    .map((id) => {
      const r = cli('ui', 'inspect', { entityIndex: panelIndex, selector: `#${id}` });
      return JSON.stringify(r).match(/"text":"([^"]*)"/)?.[1] ?? '?';
    })
    .join(' | ');
}

/** Pinch a piece, carry it above a point, release, let it settle. */
function moveTo(pieceName, [x, y, z]) {
  cli('xr', 'run-sequence', {
    device: 'hand-right',
    steps: [
      {
        label: 'grab',
        target: pieceName,
        approach: { distance: 0.06 },
        pinch: { value: 1, at: 'arrival' },
      },
      {
        label: 'carry',
        position: { x, y: y + CARRY_ABOVE_SLOT, z },
        duration: 0.7 * SLOW,
      },
      { label: 'release', pinch: 0, duration: 0.15 },
      { label: 'settle', duration: 0.6 * SLOW },
    ],
  });
}

async function ensureSession() {
  const status = cli('xr', 'status');
  const active = status?.sessionActive === true;
  if (!active) {
    console.log('Entering XR (emulated Quest 3)...');
    cli('xr', 'enter', {});
    await sleep(1500);
  }
  cli('xr', 'set-input-mode', { mode: 'hand' });
  console.log('Input mode: hands');
}

async function solveBoard(boardNumber, attempt = 1) {
  const { slots, loose } = readBoard();
  console.log(
    `\nBoard: ${loose.length} loose pieces, ${slots.length} slots. Panel: ${readPanel()}`,
  );
  if (loose.length === 0) {
    console.log('Nothing to place (board already solved or loading).');
    return true;
  }

  if (WRONG_FIRST && boardNumber === 1 && attempt === 1) {
    const piece = loose[0];
    const wrong = slots.find((s) => s.shape !== piece.shape && !s.occupied);
    if (wrong) {
      console.log(`  ${piece.name} -> ${wrong.name} (wrong on purpose, should return)`);
      moveTo(piece.name, wrong.position);
      await sleep(600);
    }
  }

  const taken = new Set(slots.filter((s) => s.occupied).map((s) => s.name));
  for (const piece of loose) {
    const slot = slots.find((s) => s.shape === piece.shape && !taken.has(s.name));
    if (!slot) {
      console.log(`  ${piece.name}: no free ${piece.shape} slot, skipped`);
      continue;
    }
    taken.add(slot.name);
    moveTo(piece.name, slot.position);
    console.log(`  ${piece.name} -> ${slot.name}  [${readPanel(['placed-text'])}]`);
  }

  // CLI round trips are slower than the win celebration, so the next board
  // may already be on the table. A changed slot list means this one was solved.
  const signature = slots.map((s) => s.name).sort().join();
  const deadline = Date.now() + WIN_WAIT_MS + 3000;
  for (;;) {
    const now = readBoard();
    if (now.slots.map((s) => s.name).sort().join() !== signature) {
      console.log('  Board solved, next board is up.');
      return true;
    }
    if (now.loose.length > 0 && attempt === 1) {
      console.log(`  ${now.loose.length} piece(s) missed their slot, retrying once.`);
      return solveBoard(boardNumber, 2);
    }
    if (now.loose.length > 0) {
      console.log(
        `  ${now.loose.length} piece(s) did not lock in. Run again or place them by hand.`,
      );
      return false;
    }
    if (Date.now() > deadline) {
      console.log('  Board solved.');
      return true;
    }
    await sleep(500);
  }
}

try {
  await ensureSession();
  for (let i = 1; i <= boardsToSolve; i++) {
    if (!(await solveBoard(i))) process.exit(2);
  }
  console.log(`\nDone. Panel: ${readPanel()}`);
} catch (err) {
  console.error(`\nAutoplay stopped: ${err.message}`);
  process.exit(1);
}
