# Browser Encoder Upgrade: Basis Universal 2.5

Audit date: 2026-09-23. This is an encoder upgrade, not a change to the preservation originals.
KTX2 derivatives remain lossy. Mipmaps are mandatory. Full resolution is the default;
unchecking the compact Full-res textures control explicitly opts into the 4K cap.

## Source Review

Reviewed the official [release notes](https://github.com/BinomialLLC/basis_universal/wiki/Release-Notes),
[README](https://github.com/BinomialLLC/basis_universal/blob/99f52d63aa6799cbdaecfe977111dc5ec3b31d47/README.md),
WebGL/encoder/transcoder READMEs, encoder CMake, C++ JavaScript bindings,
and the current KTX2 Studio main-page and background-worker implementations.
The old WebGL glTF example describes the obsolete experimental GOOGLE_texture_basis
extension: it is not the interoperability contract for this application.

The contract is [KHR_texture_basisu](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_basisu):
ETC1S with BasisLZ, or UASTC LDR with optional Zstandard. New ASTC/XUASTC/XUBC7 modes
are not drop-in replacements. The advertised July 2026 ~2x WASM improvement is for
ASTC/XUASTC, not a measured ETC1S improvement.

Also checked [glTF Transform textureCompress](https://gltf-transform.dev/modules/functions/functions/textureCompress),
[KTX-Software releases](https://github.com/KhronosGroup/KTX-Software/releases),
[Emscripten pthread guidance](https://emscripten.org/docs/porting/pthreads.html),
and [Safari shared-memory issue 25905](https://github.com/emscripten-core/emscripten/issues/25905).
Browser GPU texture transcoding and offline/native compression are different jobs;
a newer transcoder alone does not speed up browser encoding.

## Reproducible Candidate

Pinned source: `99f52d63aa6799cbdaecfe977111dc5ec3b31d47` (2026-09-01).
Compared with the `v2_50` tag: 22 later commits, almost entirely documentation;
the only non-documentation change makes an XBC7 constant immutable.
The build script verifies the downloaded archive SHA-256 before extraction.
Compiler used for this comparison: Emscripten 4.0.8, Release/O3, strict aliasing disabled.

```sh
bash scripts/build-basis.sh single
bash scripts/build-basis.sh threads
bash scripts/build-basis.sh wasm64
node test/serve.mjs
PORT=8088 ISOLATED=1 node test/serve.mjs
```

Candidates are written to ignored `test/output/basis-candidate`, never installed
into production automatically. Keep the baseline artifacts in
`test/output/basis-baseline` before promotion.

Local modifications are explicit in `scripts/prepare-basis.mjs`:

- WASM32 maximum heap 4 GiB (upstream Emscripten default is lower).
- Four pre-created pthread helpers, not the example's 32.
- Raise only ETC1S/UASTC LDR input guard to 64 Mi texels (67.1 megapixels). The stock wrapper's
  12-megapixel WASM32 guard rejects even a 4096-square input.
- Copy RGBA directly into its source-image allocation, eliminating a full-size
  temporary. This saves one 256 MiB input allocation at 8192-square, not necessarily
  256 MiB of whole-encode peak memory.
- Opt-in `setReleaseSourceImages(true)` releases the wrapper's source copy after
  `comp.init()` has deep-copied it. Ordinary upstream reuse semantics remain the
  default; our disposable worker opts into one-shot ownership explicitly.

WASM64 increases addressable memory; it is not a memory-saving optimisation.
Upstream's stock WASM64 guard is only 16 megapixels and its maximum heap is 15 GiB.
Neither browser support nor an address-space limit guarantees available physical RAM.

## Hosting And Stability

The current GitHub Pages response has neither COOP nor COEP. Therefore the public
site cannot run pthread WASM as-is. A separate single-thread artifact is required.
Do not enable threading by user-agent or hardwareConcurrency alone.
Do not introduce an automatic service-worker reload/isolation workaround silently.

Upstream's worker example requires `mainScriptUrlOrBlob` to point to the encoder
script or pthread startup can hang. Its Safari 26.0-26.2 workaround disables threading.
We keep one texture per disposable worker, transfer the output, and terminate the
worker to release its WASM heap. Running multiple 8K encoders in parallel is not a
memory optimisation.

## Test Gates

Use `/test/ktx2-smoke.html?size=4096&backend=baseline`, then `backend=candidate`.
Omit size for the original 8192-square submarine atlas. `effort=1` tests a separate
ETC1S speed/quality tradeoff; default comparison effort is 2, quality 64.
Use port 8088 and `backend=threads` or `backend=wasm64` for isolated tests.

Record encode time separately from module startup and image input. Heap capacity
is the final non-shrinking WASM linear-memory size, not measured live allocations
or total browser RSS. It excludes JavaScript, canvas, decoder and GPU allocations.
Never describe this number as total peak memory.

Required gates: complete mip chains, valid glTF/KTX2 references, successful GPU
transcoding, alpha, orientation, thumbnail comparison, five full-resolution detail
crops, visual inspection, real GLB round trip, repeated runs, and failure recovery.
Speed comparisons run sequentially, not while another encoder is active.

## Results

Initial macOS Chromium IAB measurements (single observations, not universal claims):

| Build, 4096 square | Encode | Whole worker | Heap capacity | KTX2 bytes | RGB RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Basis 1.50, effort 2 | 30.96 s | 33.24 s | 984 MiB | 1,991,447 | 0.024482 |
| Basis 2.5, effort 2 | 27.77 s | 28.23 s | 1,056 MiB | 1,989,620 | 0.024473 |
| Basis 2.5, 4 helpers, effort 2 | 16.75 s | 17.22 s | 1,063 MiB | 1,957,676 | 0.024805 |
| Basis 2.5, source release, effort 1 | 15.61 s | 16.11 s | 994 MiB | 1,908,143 | 0.028834 |

Both have 13 mip levels and passed orientation, alpha and GPU-decoding checks.
The newer build's larger final heap capacity is a regression to investigate, not
evidence of lower overall memory use. Remaining comparison results are recorded
after validation; candidates are not production releases merely because they compile.

Effort 1 is NOT the new default: it raises thumbnail RGB RMSE by approximately 18%
on this atlas. Lower effort is a quality tradeoff, not a free optimisation.

Initial 8192-square candidate before source-release: 100.21 s encode, 101.94 s
whole worker, 3,861 MiB heap capacity, 7,325,850 bytes, 14 mip levels, RMSE 0.024894.
All five 1:1 crops passed (RMSE 0.0106-0.0161). The overview and centre detail were
also visually inspected. This is too close to the 4 GiB ceiling to ignore memory.

With opt-in source release: 103.35 s encode, 105.01 s whole worker, 3,601 MiB heap
capacity (260 MiB less). Output size and every image metric are unchanged.
SHA-256: `47ddd98b2762d188387551aee37166d83d8ec66028d38e64fb80bb36780794e0`.

Final threaded WASM32 at 8192-square: 65.14 s encode, 66.78 s worker, 3,610 MiB
heap capacity, 7,209,882 bytes, 14 mips, RMSE 0.025465; all crops passed.
SHA-256: `cc7b492999726ef33ec0e6a82a787110e59597780400b862bfa9a93a0909585e`.
Threaded ETC1S is not necessarily byte-identical to the serial encoder.

WASM64 at 4096-square with four helpers and source release: 17.92 s encode,
18.38 s worker, 1,000 MiB heap capacity, 1,957,676 bytes. All image/mipmap checks
passed. It did not improve speed over the earlier threaded WASM32 observation.
It remains a reproducible test target, not an automatically selected production
backend. Larger-than-8K / larger-than-64-Mi-texel inputs are NOT validated or enabled.

Same-session Basis 1.50 8192-square control: 116.13 s encode, 118.69 s worker,
3,869 MiB heap capacity, 7,272,946 bytes, RMSE 0.024852. Compared with that control,
the final new serial observation is about 11% faster in the encoder and uses
268 MiB less WASM heap capacity. These are observations on one machine, not
cross-device guarantees or a statistical multi-run benchmark.

UASTC/Zstd 512x256 RGBA fixture: 0.124 s encode, 3,625 bytes, 10 mips,
RGB RMSE 0.003467, alpha RMSE zero; all detail crops passed and the decoded
quadrants/transparent corner were visually inspected.

## Application Checks

- K XI full-resolution default: 26,093,416-byte exported GLB; one 8192x8192
  KTX2 (7,325,850 bytes), 14 mip levels, one mesh/primitive, required Draco and
  BasisU extensions. No resizing. Original and derivative visually compared in
  BelowJS. The same model also completed the explicit 4K path earlier in the run.
- Forced threaded WASM HTTP 503 on isolated localhost: recovered in a fresh
  single-thread worker, preserving 512x256 dimensions and 10 mip levels.
- The final UI defaults to full resolution, following the user's revised
  requirement. Full-res is checked; `textureSize=4k` or unchecking it explicitly
  enables resizing. The checkbox is 14px in an unframed compact row.
- Awhina full-resolution default: 23,293,880-byte GLB, three meshes/primitives,
  all three source 4096x4096 textures retained, each with 13 mip levels. KTX2
  sizes: 2,274,083 / 2,162,515 / 1,081,629 bytes. Original and derivative visually
  compared in BelowJS, with no failed worker or unconverted texture.
- 6000x2000 duplicate RGBA fixture with explicit `textureSize=4k`: 4096x1364,
  13 mips, one deduplicated texture/primitive, 10,092-byte GLB.
- 513x256 full-resolution fixture: named inline error, no exported output,
  no silent resize. A subsequent valid fixture run completed normally.
- Responsive check at 390x844: checkbox 14x14, row height 28px, no horizontal
  page overflow. This is viewport emulation, not a physical phone test.
- Unit checks verify backend gating, unsafe WebKit/low-memory fallbacks, the
  full-resolution default, and SHA-256/valid WASM for all four shipped artifacts.

Fault reproduction: `PORT=8089 ISOLATED=1 FAIL_THREADS=1 node test/serve.mjs`.
The failure switch affects only this test server, never the application code.

Physical mobile/Quest, Safari and Firefox have not been validated in this run.
