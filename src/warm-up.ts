import { PerspectiveCamera, type World } from '@iwsdk/core';

/** World updates to let pass first, so lights and environment are in place. */
const SETTLE_FRAMES = 3;
const SETTLE_TIMEOUT_MS = 1500;
/** Never keep the scene hidden longer than this, whatever happens. */
const COMPILE_TIMEOUT_MS = 10000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Compiles every shader program the scene needs before the scene is drawn.
 *
 * Left alone, three.js compiles each program the first time it draws with
 * it and blocks the page until the graphics driver is done; with all of them
 * landing on the first frame, the page freezes for seconds (and the browser's
 * shared GPU process with it). Here the scene is kept out of the draw list
 * (camera layers off) while `compileAsync` hands all programs to the driver
 * at once and polls for completion without blocking, so they compile in
 * parallel in the background and the page stays responsive.
 *
 * Uses timers, not requestAnimationFrame, so it also finishes if an immersive
 * session starts meanwhile. Browsers without KHR_parallel_shader_compile fall
 * back to the old behaviour.
 */
export async function warmUpShaders(world: World): Promise<void> {
  const { camera, renderer, scene } = world;
  const mask = camera.layers.mask;
  camera.layers.mask = 0;
  try {
    const startFrame = renderer.info.render.frame;
    const deadline = performance.now() + SETTLE_TIMEOUT_MS;
    while (
      renderer.info.render.frame - startFrame < SETTLE_FRAMES &&
      performance.now() < deadline
    ) {
      await sleep(16);
    }
    // compile() only reads the camera's layers (to pick the lights).
    const probe = new PerspectiveCamera();
    probe.layers.mask = mask;
    await Promise.race([
      renderer.compileAsync(scene, probe),
      sleep(COMPILE_TIMEOUT_MS),
    ]);
  } finally {
    camera.layers.mask = mask;
  }
}
