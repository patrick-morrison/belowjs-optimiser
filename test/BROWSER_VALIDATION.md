# Browser KTX2 Validation

Historical 1.50 release checks are below. The newer Basis 2.5 results and revised
full-resolution default are in [the upgrade report](../docs/BASIS_BROWSER_UPGRADE.md).

## Import Responsiveness (2026-09-23)

The import path now paints loading feedback before reading/resetting a model,
prepares each unique texture separately with a paint between uploads, and uses
Three.js `compileAsync` before revealing the preview. These are the documented
[renderer preparation APIs](https://threejs.org/docs/pages/WebGLRenderer.html).
Source texture dimensions, pixels, and encoder settings are unchanged.

Measured in desktop Chromium on the actual local models (single observations,
not controlled cross-device benchmarks):

- K XI before: longest import task 709 ms; CPU profile attributed about 645 ms
  to `texSubImage2D`.
- K XI after: first post-frame loading acknowledgement 6.8 ms; ready about
  1.24 s after file selection; 8192x8192 upload 484 ms, plus a 120 ms decode/
  processing task. The texture and wreck appearance were visually checked.
- Awhina drop after: acknowledgement 12.8 ms; ready about 1.08 s; three
  4096x4096 uploads in separate tasks of 144, 133, and 123 ms. A 305 ms
  decode/processing task remains. Visually checked all three textures.
- Dispatching a second drop and a focus event during Awhina import completed
  one preparation sequence, with no competing load or browser error.
- Replacing K XI with Awhina now reframes the camera for the new file. Switching
  original/optimised previews retains the existing camera behavior.

A single large GPU upload is still synchronous. This improves feedback and
separates stages, but does not promise a stall-free browser or change the WASM
memory ceiling. OBJ/FBX synchronous parsing has not been moved to a worker.

Reproduce with `npm run test:browser-serve`, open `index.html?test=1`, and drop
the local K XI/Awhina models. A PerformanceObserver for `longtask` and a DevTools
CPU profile can distinguish parsing from GPU upload. With `test=1`,
`window.__belowOptimiserPreviewPreparation` records each upload's dimensions
and elapsed time. `npm run test:browser-unit` covers staged unique uploads,
visibility restoration on failure, optional shader preparation, and paint waits.

## Reproduce

From the repository root:

```sh
npm ci
node test/create-browser-fixture.js
node test/create-browser-fixture.js 6000 2000
node test/create-browser-fixture.js 513 256
python3 -m http.server 8087 --bind 127.0.0.1
```

The real-model checks require the local, gitignored
`test/models/dutch_submarine_hnlms_kxi.glb` fixture.

- `test/ktx2-smoke.html?size=4096`: real texture at 4K.
- `test/ktx2-smoke.html`: real texture at full 8192x8192.
- `test/ktx2-smoke.html?model=/test/output/browser-fixture-512x256.glb&uastc=1`: non-square RGBA UASTC.
- `index.html?model=/test/models/dutch_submarine_hnlms_kxi.glb&optimize=1&test=1`: complete default pipeline.
- Add `&textureSize=full` for full-resolution output.
- `index.html?model=/test/output/browser-fixture-6000x2000.glb&optimize=1&test=1`: rectangular downscale and duplicate textures.
- `index.html?model=/test/output/browser-fixture-513x256.glb&textureSize=full&optimize=1`: expected inline failure, with source retained and retry available.

The worker test checks dimensions, complete mip chains, successful GPU
transcoding, RGB/alpha error, and orientation. It displays source and decoded
KTX2 side by side for visual inspection. The app validates dimensions and mip
levels before writing the GLB. With `test=1`, inspect the exported artifact:

```js
const { inspectGlb } = await import('./test/inspect-browser-glb.js');
inspectGlb(window.__belowOptimiserTestOutput);
```

## Verified 2026-09-23

Chromium in the Codex browser on macOS; timings are single runs, not benchmarks.

| Check | Result |
| --- | --- |
| Real 4K ETC1S texture | 4096x4096, 13 mips, RGB RMSE 0.0247, about 33 seconds |
| Real full-resolution ETC1S texture | 8192x8192, 14 mips, RGB RMSE 0.0249, about 138 seconds |
| Full app, default cap | 20,746,272-byte GLB; 4096x4096 KTX2, 13 mips |
| Full app, full resolution | 26,040,512-byte GLB; 8192x8192 KTX2, 14 mips |
| Change resolution after optimisation | Previous derivative invalidated; source restored; full-res re-encode succeeded |
| Rectangular 6000x2000 RGBA, duplicate textures | One 4096x1364 KTX2, 13 mips; one output primitive; 9,868-byte GLB |
| Non-square UASTC RGBA | 512x256, 10 mips; RGB RMSE 0.00347; alpha RMSE 0 |
| Invalid 513x256 full-resolution input | Expected inline error; no invalid export; next valid model optimised successfully |
| Desktop visuals | Source and decoded textures, plus source/optimised submarine previews inspected; no flipped or mangled texture regions |
| Mobile layout | 390x844; resolution control and download reachable; overlapping viewer controls corrected |

Original GLBs are retained. Full resolution means unchanged dimensions, not
lossless texture compression. Safari, Firefox, mobile devices, and inputs larger
than 8K were not covered by this browser run.

The CLI suite also passed 25/25 pack, 25/25 unpack/repack, 25/25 re-optimise,
and 3/3 scale checks (78 total). After installing the security-patched lockfile,
the real submarine fixture passed pack, inspect, unpack, and repack again:
1,000,000 polygons and one texture. The installed dependency audit reported
zero known vulnerabilities. CLI help and package dry-run checks passed.

## Basis 2.5 Upgrade

The original tests above used the rebuilt Basis Universal 1.50 encoder with a
4 GiB growing heap. The subsequent Basis 2.5 audit, reproducible build, A/B results,
threading policy and release gates are recorded in
[BASIS_BROWSER_UPGRADE.md](../docs/BASIS_BROWSER_UPGRADE.md).

Reference material used for that comparison:

- [Basis release notes](https://github.com/BinomialLLC/basis_universal/wiki/Release-Notes):
  browser threading and WASM64 support; July 2026 ASTC/XUASTC memory and speed
  improvements. The advertised roughly 2x speedup concerns ASTC/XUASTC, not
  an established ETC1S speedup.
- [glTF BasisU extension](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md):
  the portable output contract remains ETC1S or UASTC.
- [Emscripten threading requirements](https://emscripten.org/docs/porting/pthreads.html):
  shared-memory threading needs COOP/COEP and SharedArrayBuffer.

The comparison retains standard ETC1S/UASTC output, mipmaps, source dimensions,
and matched quality/effort. Measured WASM heap capacity is not total process peak
memory. WASM64 raises capacity but does not itself reduce memory consumption.
