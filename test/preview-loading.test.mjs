import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePreview, afterNextPaint } from '../browser/preview-loading.js';

function fixture() {
  const texture = { isTexture: true, image: { width: 8192, height: 8192 } };
  const second = { isTexture: true, image: { width: 4096, height: 4096 } };
  const model = { visible: true, traverse: (fn) => {
    fn({ material: { map: texture } });
    fn({ material: [{ map: texture, normalMap: second }] });
  } };
  return { model, texture, second };
}

test('uploads unique textures with a paint before each, preserving source data', async () => {
  const { model, texture, second } = fixture();
  const events = [];
  const renderer = {
    initTexture: (t) => { assert.equal(model.visible, false); events.push(t); },
    compileAsync: () => { assert.equal(model.visible, true); events.push('compile'); return Promise.resolve(); }
  };
  const result = await preparePreview({ model, renderer, paint: async () => { events.push('paint'); } });
  assert.deepEqual(events, ['paint', texture, 'paint', second, 'paint', 'compile', 'paint', 'paint']);
  assert.equal(model.visible, true);
  assert.equal(result.uploads.length, 2);
  assert.equal(texture.image.width, 8192);
});

test('restores visibility after failed upload or shader preparation', async () => {
  for (const failure of ['upload', 'shader']) {
    const { model } = fixture();
    await assert.rejects(preparePreview({ model, paint: async () => {}, renderer: {
      initTexture: () => { if (failure === 'upload') throw new Error('upload'); },
      compileAsync: async () => { throw new Error('shader'); }
    } }), new RegExp(failure));
    assert.equal(model.visible, true);
  }
});

test('supports renderers without parallel shader preparation', async () => {
  const { model } = fixture();
  model.visible = false;
  await preparePreview({ model, renderer: { initTexture() {} }, paint: async () => {} });
  assert.equal(model.visible, false);
});

test('paint wait also completes without a frame scheduler', async () => {
  await afterNextPaint();
});

test('paint wait resumes in a task after the frame callback', async () => {
  const previousFrame = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let callback;
  globalThis.requestAnimationFrame = (fn) => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    let resumed = false;
    const waiting = afterNextPaint().then(() => { resumed = true; });
    callback();
    await Promise.resolve();
    assert.equal(resumed, false);
    await waiting;
    assert.equal(resumed, true);
  } finally {
    if (previousFrame) globalThis.requestAnimationFrame = previousFrame;
    else delete globalThis.requestAnimationFrame;
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel;
    else delete globalThis.cancelAnimationFrame;
  }
});
