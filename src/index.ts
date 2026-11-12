import { installFrameLimit } from './frame-limit.js';

/**
 * Bootstrap. Kept tiny on purpose: it checks that the browser can run the
 * game before downloading and parsing the game itself (about 2.5 MB of
 * script), so a browser without WebGL gets a short message instead of a
 * blank page. The loading screen is plain HTML in index.html, so it shows
 * before any script runs.
 */
const boot = document.getElementById('boot');
const bootText = document.getElementById('boot-text');

function showMessage(text: string): void {
  if (bootText) bootText.textContent = text;
  boot?.classList.add('stopped');
}

function hideBoot(): void {
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 600);
}

function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    // Free the test context straight away.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  showMessage(
    'This game needs WebGL 2, which is turned off or not available in this browser. ' +
      'Open it in the Meta Quest Browser, or in a desktop browser with WebGL turned on.',
  );
} else {
  // Cap the flat preview page at 30 fps so desktop GPUs stay quiet; VR is
  // never capped. Must run before the world starts its render loop.
  installFrameLimit();
  import('./app.js')
    .then((app) =>
      app.start(document.getElementById('scene-container') as HTMLDivElement),
    )
    .then(hideBoot)
    .catch((error: unknown) => {
      console.error(error);
      showMessage(
        'The game could not start in this browser. ' +
          'Try reloading, or open it in the Meta Quest Browser.',
      );
    });
}
