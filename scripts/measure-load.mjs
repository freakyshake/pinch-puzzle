#!/usr/bin/env node
/**
 * Cold-load measurement of a built copy of the game, in a clean Chromium
 * profile on the real GPU (not the software renderer).
 *
 *   node scripts/measure-load.mjs [dir-or-url] [--profile] [--shaders] [--screenshot file.png] [--headed]
 *
 * Default target: ./dist (run `npm run build` first). A directory is served
 * from a local static server; a URL is opened as is.
 * `--no-webgl` simulates a browser with WebGL off and reports what it shows.
 * Reports: time to first frame, main-thread blocking (long tasks), frame
 * pacing after load, JS heap, and process memory by type. `--profile` adds
 * the functions with the most CPU self time.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--screenshot') ?? 'dist';
const PROFILE = args.includes('--profile');
const HEADED = args.includes('--headed');
/** Simulates a browser with WebGL turned off. */
const NO_WEBGL = args.includes('--no-webgl');
const SETTLE_MS = 6000;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.uikitml': 'text/plain',
};

function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Runs in the page before any app code: timings the app cannot fake. */
function probe() {
  const p = (window.__probe = { longTasks: [], frames: [], firstFrame: 0, contexts: 0, programs: [] });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) p.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]);
  }).observe({ type: 'longtask', buffered: true });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type)) {
      p.contexts++;
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      p.gpu = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      // Shader programs: which ones exist, and how long the page waited for
      // each one to compile (the first status query blocks until it is done).
      const sources = new WeakMap();
      const names = new WeakMap();
      const shaderSource = ctx.shaderSource;
      ctx.shaderSource = function (shader, src) {
        sources.set(shader, src);
        return shaderSource.call(this, shader, src);
      };
      const attachShader = ctx.attachShader;
      ctx.attachShader = function (program, shader) {
        const src = sources.get(shader) ?? '';
        const name = /#define SHADER_NAME (\S+)/.exec(src)?.[1] ?? /#define SHADER_TYPE (\S+)/.exec(src)?.[1];
        const prev = names.get(program) ?? { name: '', chars: 0, waited: 0, defines: '' };
        if (name && !prev.name) prev.name = name;
        prev.chars += src.length;
        if (/gl_FragColor|pc_fragColor|out highp vec4/.test(src)) {
          prev.defines = (src.match(/#define (USE_SHADOWMAP|USE_ENVMAP|SHADOWMAP_TYPE_\w+|USE_INSTANCING|TONE_MAPPING|USE_TRANSMISSION|USE_CLEARCOAT|USE_MAP)\b/g) ?? [])
            .map((d) => d.slice(8))
            .join(' ');
        }
        names.set(program, prev);
        return attachShader.call(this, program, shader);
      };
      const createProgram = ctx.createProgram;
      ctx.createProgram = function () {
        const program = createProgram.call(this);
        const rec = { name: '', chars: 0, waited: 0, defines: '', at: Math.round(performance.now()) };
        names.set(program, rec);
        p.programs.push(rec);
        return program;
      };
      for (const fn of ['getProgramInfoLog', 'getProgramParameter', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'useProgram']) {
        const original = ctx[fn];
        ctx[fn] = function (program, ...a) {
          // COMPLETION_STATUS_KHR is the non-blocking poll; do not count it.
          if (fn === 'getProgramParameter' && a[0] === 0x91b1) return original.call(this, program, ...a);
          const t = performance.now();
          const out = original.call(this, program, ...a);
          const rec = program && names.get(program);
          if (rec) rec.waited += performance.now() - t;
          return out;
        };
      }
      // First real draw call marks the first rendered frame.
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const draw = ctx[name];
        ctx[name] = function (...a) {
          if (!p.firstFrame) p.firstFrame = performance.now();
          return draw.apply(this, a);
        };
      }
    }
    return ctx;
  };
  let last = 0;
  const tick = (t) => {
    if (last) p.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const server = /^https?:/.test(target) ? null : await serve(target);
const url = server ? `http://127.0.0.1:${server.address().port}/` : target;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinch-load-'));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: !HEADED,
  viewport: { width: 1920, height: 1000 },
  args: NO_WEBGL
    ? ['--disable-3d-apis']
    : ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
let bytes = 0;
const requested = [];
page.on('request', (r) => requested.push(path.basename(new URL(r.url()).pathname) || '/'));
page.on('response', async (r) => {
  const len = Number(r.headers()['content-length']);
  if (Number.isFinite(len)) bytes += len;
  else bytes += (await r.body().catch(() => Buffer.alloc(0))).length;
});
await page.addInitScript(probe);
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
if (PROFILE) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
}

const started = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
if (!NO_WEBGL) {
  await page.waitForFunction(() => window.__probe.firstFrame > 0, null, { timeout: 180000 }).catch(() => {});
}
const firstFrameWall = Date.now() - started;
await page.waitForTimeout(SETTLE_MS);

const p = await page.evaluate(() => {
  const q = window.__probe;
  const recent = q.frames.slice(-150).sort((a, b) => a - b);
  return {
    gpu: q.gpu,
    contexts: q.contexts,
    firstFrame: Math.round(q.firstFrame),
    longTasks: q.longTasks,
    frameP50: recent[Math.floor(recent.length / 2)],
    frameP95: recent[Math.floor(recent.length * 0.95)],
    ready: Math.round(performance.getEntriesByName('pinch-puzzle-ready')[0]?.startTime ?? 0),
    programs: q.programs.map((r) => ({ ...r, waited: Math.round(r.waited) })),
    dpr: devicePixelRatio,
    canvas: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`),
  };
});
const metrics = Object.fromEntries(
  (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
);

let top = [];
if (PROFILE) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const dt = profile.timeDeltas;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anonymous)'}  ${path.basename(f.url || '')}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
}

// Process memory by type (browser, renderer, GPU) from the OS.
const browserCdp = await context.browser()?.newBrowserCDPSession().catch(() => null);
let procs = [];
if (browserCdp) {
  const info = await browserCdp.send('SystemInfo.getProcessInfo');
  const ids = info.processInfo.map((x) => x.id).join(',');
  const out = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $([int]($_.WorkingSet64/1MB)) $([int]($_.PrivateMemorySize64/1MB))" }`],
    { encoding: 'utf8' },
  ).stdout;
  const mem = new Map(out.trim().split(/\r?\n/).map((l) => l.trim().split(' ')).map(([id, ws, pm]) => [Number(id), [ws, pm]]));
  procs = info.processInfo.map((x) => `${x.type}: ${mem.get(x.id)?.[0] ?? '?'} MB working set, ${mem.get(x.id)?.[1] ?? '?'} MB private`);
}

if (NO_WEBGL) {
  const text = await page.evaluate(() => document.getElementById('boot')?.innerText ?? '(no boot screen)');
  console.log(`Without WebGL the page shows: ${JSON.stringify(text)}`);
  console.log(`Files requested: ${requested.join(', ')}`);
}
const blocking = p.longTasks.reduce((s, [, d]) => s + d, 0);
const worst = [...p.longTasks].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`Target:            ${url}`);
console.log(`GPU:               ${p.gpu}`);
console.log(`Downloaded:        ${(bytes / 1e6).toFixed(2)} MB`);
console.log(`First frame drawn: ${p.firstFrame} ms after navigation start (wall ${firstFrameWall} ms)`);
console.log(`Main thread blocked (long tasks): ${blocking} ms in ${p.longTasks.length} tasks`);
console.log(`Worst long tasks [start ms, duration ms]: ${JSON.stringify(worst)}`);
console.log(`Frame interval after load: p50 ${p.frameP50?.toFixed(1)} ms, p95 ${p.frameP95?.toFixed(1)} ms`);
console.log(`Canvas: ${p.canvas.join(', ')} at devicePixelRatio ${p.dpr}; WebGL contexts created: ${p.contexts}`);
console.log(`JS heap used:      ${(metrics.JSHeapUsedSize / 1e6).toFixed(1)} MB (total ${(metrics.JSHeapTotalSize / 1e6).toFixed(1)} MB)`);
console.log(`Script time:       ${(metrics.ScriptDuration * 1000).toFixed(0)} ms; task time ${(metrics.TaskDuration * 1000).toFixed(0)} ms`);
for (const line of procs) console.log(`Process ${line}`);
const waited = p.programs.reduce((sum, r) => sum + r.waited, 0);
console.log(`Shader programs: ${p.programs.length}, page blocked waiting for them: ${waited} ms`);
if (p.ready) {
  const late = p.programs.filter((r) => r.at > p.ready);
  console.log(`Scene shown at:    ${p.ready} ms; programs compiled after that: ${late.length} (${late.reduce((x, r) => x + r.waited, 0)} ms blocked)`);
}
if (args.includes('--shaders')) {
  for (const r of [...p.programs].sort((a, b) => b.waited - a.waited)) {
    console.log(`  ${String(r.waited).padStart(5)} ms  ${r.name.padEnd(28)} ${String(r.chars).padStart(6)} chars  ${r.defines}`);
  }
}
if (errors.length) console.log(`Errors: ${JSON.stringify(errors.slice(0, 5))}`);
if (top.length) {
  console.log('\nTop CPU self time (ms):');
  for (const [k, v] of top) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
}

const shotIdx = args.indexOf('--screenshot');
if (shotIdx >= 0) await page.screenshot({ path: args[shotIdx + 1] });

await context.close();
server?.close();
fs.rmSync(profileDir, { recursive: true, force: true });
