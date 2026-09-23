import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { selectEncoderBackend, encoderURLs } from '../browser/encoder-backend.js';

const capable = { isolated: true, sharedMemory: true, cores: 12, deviceMemory: 16, userAgent: 'Chrome/140' };
test('threading is gated by isolation, memory, cores and WebKit safety', () => {
    assert.deepEqual(selectEncoderBackend(capable), { kind: 'threads', threads: 4 });
    for (const changes of [
        { isolated: false }, { sharedMemory: false }, { cores: 2 }, { deviceMemory: 4 },
        { userAgent: 'AppleWebKit Version/26.2 Safari' },
        { userAgent: 'AppleWebKit CriOS/140 Mobile Safari' }
    ]) assert.deepEqual(selectEncoderBackend({ ...capable, ...changes }), { kind: 'single', threads: 0 });
    assert.equal(selectEncoderBackend({ ...capable, cores: 4 }).threads, 2);
    assert.equal(selectEncoderBackend({ ...capable, userAgent: 'AppleWebKit Version/26.3 Safari' }).threads, 4);
});
test('separate artifacts are selected, never WASM64 by assumption', () => {
    assert.match(encoderURLs({ kind: 'single', threads: 0 }).jsUrl, /\/basis_encoder\.js\?/);
    assert.match(encoderURLs({ kind: 'threads', threads: 4 }).jsUrl, /\/basis_encoder_threads\.js\?/);
});
test('shipped encoder artifacts match the pinned build manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../browser/basis-build.json', import.meta.url)));
    for (const [file, sha] of Object.entries(manifest.sha256)) {
        const bytes = readFileSync(new URL(`../browser/${file}`, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, file);
        if (file.endsWith('.wasm')) assert.equal(WebAssembly.validate(bytes), true, file);
    }
});
test('the full-resolution texture control is checked by default', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<input type="checkbox" id="preserveFullResTextures" checked>/);
    assert.match(html, /\['full', 'full-res', 'fullres', 'source', 'preserve', 'default'\]/);
});
