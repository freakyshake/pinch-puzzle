#!/usr/bin/env node
/**
 * Synthesises every game sound into public/audio/*.wav. No samples or
 * third-party assets: the sounds are additive sine synthesis, so they are
 * original, tiny and reproducible.
 *
 *   node scripts/make-sounds.mjs
 *
 * pick.wav        soft upward blip when a piece is pinched
 * snap-0..7.wav   marimba-like notes, C major pentatonic; each placement on a
 *                 board plays the next note, so a solved board is a melody
 * wrong.wav       gentle low "bonk" when a piece is dropped on a wrong slot
 * win.wav         bell arpeggio when a board is solved
 * complete.wav    longer arpeggio and chord when all boards are solved
 * ambient.wav     calm seamless pad loop (four chords, 24 s)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');
mkdirSync(OUT, { recursive: true });

const TAU = Math.PI * 2;

function writeWav(name, samples, rate) {
  // Normalise to a safe peak, then 16-bit PCM mono.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(OUT, name), Buffer.concat([header, data]));
  console.log(`${name}  ${(44 + data.length) / 1000} kB`);
}

/** Deterministic noise so the files are byte-identical on every run. */
let seed = 1234567;
function noise() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x3fffffff - 1;
}

/** A struck bar or bell: fundamental plus decaying partials and a soft click. */
function bell(buf, rate, start, freq, dur, amp, partials) {
  const s0 = Math.floor(start * rate);
  const n = Math.floor(dur * rate);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / rate;
    const attack = Math.min(1, t / 0.004);
    let v = 0;
    for (const [mult, gain, decay] of partials) {
      v += gain * Math.sin(TAU * freq * mult * t) * Math.exp(-t * decay);
    }
    // Felt-mallet click in the first few milliseconds.
    if (t < 0.006) v += 0.08 * noise() * (1 - t / 0.006);
    buf[s0 + i] += amp * attack * v;
  }
}

const RATE = 22050;
const buffer = (seconds) => new Float32Array(Math.ceil(seconds * RATE));

// pick: quick rising blip
{
  const b = buffer(0.16);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    const f = 520 + 300 * (t / 0.16);
    phase += (TAU * f) / RATE;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 22);
    b[i] = env * (Math.sin(phase) + 0.2 * Math.sin(2 * phase));
  }
  writeWav('pick.wav', b, RATE);
}

// snap-0..7: marimba notes, C major pentatonic from C5
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
const MARIMBA = [
  [1, 1, 6],
  [4, 0.22, 18],
  [10, 0.05, 40],
];
PENTATONIC.forEach((f, i) => {
  const b = buffer(0.9);
  bell(b, RATE, 0, f, 0.9, 1, MARIMBA);
  bell(b, RATE, 0, f / 2, 0.9, 0.25, [[1, 1, 7]]); // warm undertone
  writeWav(`snap-${i}.wav`, b, RATE);
});

// wrong: soft descending two-note bonk, low and short (never harsh)
{
  const b = buffer(0.42);
  const notes = [
    [0, 330],
    [0.12, 262],
  ];
  for (const [start, f] of notes) {
    bell(b, RATE, start, f, 0.3, 0.8, [
      [1, 1, 14],
      [2, 0.15, 30],
    ]);
  }
  writeWav('wrong.wav', b, RATE);
}

const BELL = [
  [1, 1, 2.6],
  [2.76, 0.18, 5],
  [5.4, 0.06, 9],
];

// win: C E G C arpeggio
{
  const b = buffer(2.2);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    bell(b, RATE, i * 0.11, f, 1.8, 0.7, BELL),
  );
  writeWav('win.wav', b, RATE);
}

// complete: two-octave arpeggio resolving into a held chord
{
  const b = buffer(4.2);
  const run = [392, 523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  run.forEach((f, i) => bell(b, RATE, i * 0.1, f, 2.2, 0.55, BELL));
  [523.25, 659.25, 783.99, 1046.5].forEach((f) =>
    bell(b, RATE, 0.85, f, 3.3, 0.45, [
      [1, 1, 1.1],
      [2, 0.12, 3],
    ]),
  );
  writeWav('complete.wav', b, RATE);
}

// ambient: 24 s seamless pad loop. Rendered circularly so the tail of the
// last chord wraps into the start and the loop point is inaudible.
{
  const rate = 16000;
  const len = 24 * rate;
  const b = new Float32Array(len);
  const chords = [
    [130.81, 196.0, 246.94, 329.63], // Cmaj7
    [110.0, 164.81, 261.63, 329.63], // Am7
    [87.31, 174.61, 220.0, 329.63], // Fmaj7
    [98.0, 146.83, 246.94, 293.66], // G6
  ];
  const chordLen = 6;
  const fade = 2.2;
  chords.forEach((chord, ci) => {
    const start = ci * chordLen - fade / 2;
    const dur = chordLen + fade;
    const n = Math.floor(dur * rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env = Math.min(1, t / fade) * Math.min(1, (dur - t) / fade);
      const shaped = env * env * (3 - 2 * env); // smoothstep
      let v = 0;
      chord.forEach((f, k) => {
        const detune = 1 + (k % 2 ? 0.0025 : -0.002);
        v +=
          Math.sin(TAU * f * t) * 0.6 +
          Math.sin(TAU * f * detune * t) * 0.4 +
          0.08 * Math.sin(TAU * f * 2 * t);
      });
      const idx = (((Math.floor(start * rate) + i) % len) + len) % len;
      b[idx] += shaped * v * 0.25;
    }
  });
  writeWav('ambient.wav', b, rate);
}
