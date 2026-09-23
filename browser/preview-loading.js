// A timer alone need not paint; a frame callback alone resumes before painting.
export function afterNextPaint() {
  return new Promise((resolve) => {
    let frame;
    const finish = () => {
      clearTimeout(fallback);
      if (frame !== undefined) cancelAnimationFrame(frame);
      resolve();
    };
    const fallback = setTimeout(finish, 100);
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => setTimeout(finish, 0));
    }
  });
}

export async function preparePreview({ model, renderer, camera, scene, onStage = () => {}, paint = afterNextPaint }) {
  const visible = model.visible;
  model.visible = false;
  const textures = new Set();
  const started = performance.now();
  const uploads = [];
  try {
    model.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
        }
      }
    });
    let index = 0;
    for (const texture of textures) {
      onStage(`Preparing preview texture ${++index}/${textures.size}...`);
      await paint();
      const start = performance.now();
      renderer.initTexture(texture);
      uploads.push({ ms: performance.now() - start, width: texture.image?.width, height: texture.image?.height });
    }
    onStage('Preparing preview shaders...');
    await paint();
    if (typeof renderer.compileAsync === 'function') {
      // compileAsync collects materials synchronously. Hide again before yielding
      // so the render loop cannot trigger an unprepared first frame.
      model.visible = visible;
      const compiling = renderer.compileAsync(model, camera, scene);
      model.visible = false;
      await compiling;
    }
    onStage('Drawing preview...');
    await paint();
  } finally {
    model.visible = visible;
  }
  // Keep the loading indicator until the first prepared frame has been painted.
  await paint();
  return { ms: performance.now() - started, uploads };
}
