#!/usr/bin/env node
/**
 * One continuous raw take for the demo video, played in the managed emulator
 * window. You record the window; this script plays the game.
 *
 *   node scripts/record-take.mjs          full take (about 4 minutes raw)
 *   node scripts/record-take.mjs --prep   only set up the view, no shots
 *
 * Needs the dev server (npm run dev). Each shot prints its start time, so
 * cutting the raw file down to under 3 minutes is quick.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = join(ROOT, 'node_modules', '@iwsdk', 'cli');
const CLI = join(
  CLI_DIR,
  JSON.parse(readFileSync(join(CLI_DIR, 'package.json'), 'utf8')).bin.iwsdk,
);
const AUTOPLAY = join(ROOT, 'scripts', 'autoplay.mjs');

/** Seated eye height, looking down at the table: table, both panels in frame. */
const HEAD_POSITION = { x: 0, y: 1.28, z: 0.2 };
const HEAD_TARGET = { x: -0.05, y: 0.84, z: -0.8 };
const COUNTDOWN = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let started = 0;
const stamp = () => {
  const s = Math.round((Date.now() - started) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function cli(domain, action, input, timeoutMs = 45000) {
  const argv = [CLI, domain, action];
  if (input !== undefined) argv.push('--input-json', JSON.stringify(input));
  if (domain === 'xr' && action === 'run-sequence') argv.push('--timeout', String(timeoutMs));
  const res = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: timeoutMs + 15000 });
  const json = JSON.parse((res.stdout || '').trim() || '{}');
  if (!json.ok) throw new Error(`${domain} ${action} failed: ${json.error?.message ?? res.stderr}`);
  return json.data?.result ?? json.data;
}

function autoplay(...args) {
  spawnSync(process.execPath, [AUTOPLAY, ...args], { stdio: 'inherit' });
}

/** Poke a button on a panel with the left hand. */
function press(target) {
  cli('xr', 'run-sequence', { device: 'hand-left', steps: [{ target, press: {} }] });
}

function shot(label) {
  console.log(`\n[${stamp()}] SHOT: ${label}`);
}

async function prep() {
  console.log('Fresh page, board 1...');
  cli('browser', 'reload', {});
  cli('runtime', 'wait', {}, 60000);
  await sleep(2000);
  cli('browser', 'set-muted', { muted: false });
  cli('xr', 'enter', {});
  await sleep(1500);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  // Defaults: lower table, contrast off, music on.
  press('reset-settings');
  cli('xr', 'set-transform', { device: 'headset', position: HEAD_POSITION });
  cli('xr', 'look-at', { device: 'headset', target: HEAD_TARGET });
  // Park the left hand low and out of the way after the reset press.
  cli('xr', 'run-sequence', {
    device: 'hand-left',
    steps: [{ anchor: 'wrist', position: { x: -0.35, y: 0.6, z: -0.1 }, duration: 0.6 }],
  });
}

async function main() {
  await prep();
  if (process.argv.includes('--prep')) {
    console.log('View ready. Run without --prep to record.');
    return;
  }

  console.log('\nClick the game window, then press Win+Alt+R to start recording.');
  for (let i = COUNTDOWN; i > 0; i--) {
    process.stdout.write(`  ${i}...`);
    await sleep(1000);
  }
  console.log('\n');
  started = Date.now();

  shot('Ghost hand shows the pinch (first-time help, no text)');
  await sleep(12000);

  shot('Wrong drop: soft bonk, piece floats home; then board 1 solved, melody and win');
  autoplay('--wrong', '--slow');
  await sleep(4000);

  shot('Comfort panel: table lower and higher');
  press('height-down');
  await sleep(1200);
  press('height-down');
  await sleep(1500);
  press('height-up');
  await sleep(1200);
  press('height-up');
  await sleep(1500);

  shot('High contrast on, board 2 played in high contrast');
  press('contrast-toggle');
  await sleep(2500);
  autoplay('--slow');
  await sleep(4000);
  press('contrast-toggle');
  await sleep(1500);

  shot('Boards 3 to 6 (cut to the best bits), All solved');
  autoplay('--boards', '4');

  shot('End: All solved panel (hold here)');
  await sleep(8000);
  console.log(`\n[${stamp()}] DONE. Press Win+Alt+R to stop recording.`);
  console.log('Game Bar saves to Videos\\Captures.');
  // Leave VR so the emulator stops drawing at full speed in the background.
  await sleep(8000);
  cli('xr', 'exit', {});
  console.log('Left VR in the emulator.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
