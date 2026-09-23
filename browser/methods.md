# Browser Optimisation - Technical Documentation

## Scope

This document reflects the current browser implementation in `index.html` and `browser/ktx2-encoder.js`.

---

## Runtime Dependency Map

### Import map modules (ESM)

- `three` -> `https://esm.sh/three@0.179.1`
- `belowjs` -> `./browser/belowjs.js` (published 1.9.1, JS and CSS together)
- `@gltf-transform/core` -> `https://esm.sh/@gltf-transform/core@4.4.2`
- `@gltf-transform/extensions` -> 4.4.2 with core externalized to the import map
- `@gltf-transform/functions` -> 4.4.2 with core and extensions externalized to the import map (avoids duplicate document registries)
- `meshoptimizer` -> `https://esm.sh/meshoptimizer@0.21.0`
- Three.js loaders, exporters, and Basis transcoder assets are pinned to 0.179.1.
- The disposable module worker imports `./browser/ktx2-encoder.js?v=20260923`.
- `ktx-parse` -> `https://unpkg.com/ktx-parse@0.7.1/dist/ktx-parse.esm.js`

### UMD globals (script tags)

- `https://unpkg.com/draco3dgltf@1.5.7/draco_encoder_gltf_nodejs.js`
- `https://unpkg.com/draco3dgltf@1.5.7/draco_decoder_gltf_nodejs.js`

These provide global `DracoEncoderModule` / `DracoDecoderModule`.

Note: `browser/draco_encoder.js` exists in the repo, but the active browser runtime path currently uses the unpkg UMD scripts above.

---

## Encoder Files Used By Browser KTX2 Path

### Basis Universal

- Local files used at runtime:
  - `browser/basis_encoder.js`
  - `browser/basis_encoder.wasm`
- Original prebuilt upstream files used before the large-texture browser rebuild:
  - `https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.js`
  - `https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.wasm`
- Current browser files are rebuilt from Binomial Basis Universal `v1_50_0_2`, matching the previous vendored WASM version, with:
  - `-s ALLOW_MEMORY_GROWTH=1`
  - `-s MAXIMUM_MEMORY=4GB`
  - `-s EXPORTED_RUNTIME_METHODS=['HEAP8']`
- The 4GB build is required for full-resolution 8192x8192 ETC1S KTX2 with mipmaps in browser mode. The older prebuilt wrapper capped the heap at 2GB.

### Local browser wrapper

- Active wrapper module: `browser/ktx2-encoder.js`
- Export used by app: `encodeToKTX2()`

What it does:

- Loads Basis factory via ESM `import()` first, then classic script fallback.
- Caches loaded module (`modulePromise`) across calls.
- Supports retry for failed script loads (failed script promise is evicted).
- Applies encoder options with v1/v2 method fallbacks:
  - `setKTX2SRGBTransferFunc` -> fallback `setKTX2AndBasisSRGBTransferFunc`
  - `setCompressionLevel` -> fallback `setETC1SCompressionLevel`
- Decodes input through `createImageBitmap` and a 2D OffscreenCanvas, then closes both.
- Passes a typed-array view to WASM without duplicating the full RGBA pixel buffer.
- Deletes the encoder even on failure and terminates the worker after every texture.
- Uses each material slot's color space for transfer metadata, perceptual encoding, and mip generation.

---

## Draco Usage

Draco is configured via glTF-Transform `draco()` and the UMD modules above.

- Encoder + decoder are registered on `WebIO`.
- `locateFile()` resolves WASM from unpkg.
- Quantization is explicitly set to 20-bit for:
  - `quantizePosition`
  - `quantizeNormal`
  - `quantizeColor`
  - `quantizeTexcoord`
  - `quantizeGeneric`
- Method is `sequential` to preserve vertex order.

---

## Browser Optimisation Pipeline (Actual Order)

Dropped `.obj` and `.fbx` files are first imported through three.js and exported to an in-memory GLB with `GLTFExporter`. OBJ imports can include an associated `.mtl` file and texture files in the same drag/drop or file picker selection. The generated GLB then follows the same browser path as native `.glb` and `.gltf` inputs.

If an OBJ is loaded without an `.mtl`, the browser keeps the original OBJ file in memory and shows a warning. Dropping the missing `.mtl` plus any texture image files later reloads that OBJ with the new material inputs.

If an FBX references external texture files that were not included in the drop/selection, the browser tracks the missing texture filenames and shows a warning with the missing count/list. Dropping those image files later reloads the original FBX with the added texture inputs.

Browser OBJ/FBX imports use the `OBJ/FBX source up` selector. `Y-up` preserves source coordinates; `Z-up` applies a -90 degree X rotation before exporting the imported object to GLB.

Within `optimizeModel()`:

1. `dedup()`
2. `weld()`
3. `join()`
4. `simplify()` only if triangles > 1.2M
5. Texture dimension inspection:
   - Default mode downscales textures over 4096px sequentially before KTX2.
   - Full-res mode preserves source dimensions and skips the downscale pass.
6. Optional sequential texture downscale to 4096px cap.
7. `draco(...)` with 20-bit quantization
8. KTX2 conversion (sequential, one texture at a time) via a disposable module Worker and `encodeToKTX2(...)`
9. `io.writeBinary(...)`

Candidates are refreshed after deduplication. Each encoded texture must retain its prepared dimensions and complete mip chain before the GLB is written. A failed texture fails the operation rather than silently leaving an uncompressed source.

---

## Texture Policy In Browser Path

### Candidate formats for KTX2 conversion

- `image/jpeg`
- `image/png`
- `image/webp`

### Limits/policy

- Default browser mode caps source textures at 4096px before KTX2 encoding.
- The resize uses a sequential 2D canvas pass, rounds dimensions to multiples of four, and uses lossless PNG as the intermediate. This avoids an extra lossy JPEG generation.
- Full source dimensions are preserved only when the `Full-res textures` option is enabled.
- Mipmaps remain enabled for browser KTX2 output.
- The browser Basis encoder is a 4GB-memory rebuild of the version-matched upstream encoder.
- No automatic padding and no automatic WASM-cap downscale during sequential encode step.

If a texture in the KTX2 step is:

- above practical browser/WASM memory capacity -> optimisation fails with the texture name and dimensions
- not multiple-of-4 in width/height -> optimisation fails with the texture name and dimensions

Result: browser path defaults to a memory-lower 4096px KTX2 path, while full-resolution preservation remains available as an explicit option.

Full-resolution means source dimensions are retained; ETC1S and UASTC texture compression are still lossy. Keep the original model as the preservation master.

---

## Progress / UI Behavior

- Overlay modes:
  - spinner mode (load paths)
  - progress mode (optimise + texture operations)
- Optimisation progress is shown by:
  - transform step completion
  - per-texture KTX2 `start` and `done` events
- KTX2 status now updates immediately when each texture starts encoding.
- Warning note is shown during optimise mode, including:
  - experimental/browser-limit warning
  - can take a few minutes note
  - keep tab focused note

### View orientation hotkeys

- `1` / `Numpad1`: front view
- `3` / `Numpad3`: right view
- `7` / `Numpad7`: top view
- `Ctrl+1`, `Ctrl+3`, `Ctrl+7`: back, left, bottom views

These shortcuts are ignored while typing in form fields and while optimisation is running.

---

## Known Caveats

- Browser memory constraints still apply; very large models/textures may fail.
- Full-resolution KTX2 encoding still depends on browser and WASM memory capacity, even with the 4GB encoder build.
- Source-map 404 warnings from third-party packages do not affect runtime behavior.

---

## Updating Local Encoder Assets

To refresh local Basis files from upstream:

```bash
# Legacy prebuilt 2GB encoder, kept only for reference:
# curl -L -o browser/basis_encoder.js "https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.js"
# curl -L -o browser/basis_encoder.wasm "https://unpkg.com/ktx2-encoder@0.5.1/dist/basis/basis_encoder.wasm"
```

After update:

1. Validate browser optimise flow end-to-end.
2. Confirm KTX2 conversion still works for:
   - standard textures
   - skipped textures (WASM cap / non-4x4)
3. Confirm progress UI still updates through Draco -> KTX2 -> write stages.

---

## References

- glTF-Transform docs: `https://gltf-transform.dev/`
- Basis Universal: `https://github.com/BinomialLLC/basis_universal`
- Draco: `https://github.com/google/draco`
- Meshoptimizer: `https://github.com/zeux/meshoptimizer`
