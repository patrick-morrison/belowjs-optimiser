# Browser KTX2 Validation

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

## Newer Encoder Comparison

The shipped WASM is the previously rebuilt Basis Universal 1.50 encoder with a
4GB growing heap. Upstream is now at 2.5:

- [Basis release notes](https://github.com/BinomialLLC/basis_universal/wiki/Release-Notes):
  browser threading and WASM64 support; July 2026 ASTC/XUASTC memory and speed
  improvements. The advertised roughly 2x speedup concerns ASTC/XUASTC, not
  an established ETC1S speedup.
- [glTF BasisU extension](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md):
  the portable output contract remains ETC1S or UASTC.
- [Emscripten threading requirements](https://emscripten.org/docs/porting/pthreads.html):
  shared-memory threading needs COOP/COEP and SharedArrayBuffer.

Next controlled comparison: rebuild 2.5 with standard ETC1S/UASTC output, run
these same 4K/8K inputs at matched quality, record wall time and peak process
memory, then test a separate threaded build and WASM64 capability fallback.
Keep mip levels, dimensions, exported GLB loading, alpha/orientation checks,
and viewer compatibility as release gates. WASM64 raises capacity but does
not itself reduce memory consumption. No newer-encoder speedup is claimed
by this release.
