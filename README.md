# belowjs-optimiser

Optimises photogrammetry GLB models for WebXR on Meta Quest by applying:

- Draco mesh compression (20-bit)
- KTX2 texture compression
- texture resizing (max 4096x4096)
- automatic mesh simplification above polygon limits
- optional uniform scene scaling (`--scale`)

The original bash script (v1) is kept in `legacy/below-optimiser.sh`.

## Install

```sh
npm install -g belowjs-optimiser
```

Or run ad-hoc:

```sh
npx belowjs-optimiser pack model.glb
```

## Experimental browser option

You can also try the browser-based optimiser (experimental):

https://patrick-morrison.github.io/belowjs-optimiser/

Browser optimisation defaults to a 4096px texture cap. Enable **Full-res
textures** in the Optimise controls to keep source dimensions. Both modes
produce KTX2 with mipmaps; full-resolution encoding needs more memory and time.
KTX2 compression is lossy even when dimensions are preserved, so retain the
original model as the preservation master.

Browser implementation and repeatable checks: [browser/methods.md](browser/methods.md).

## Required dependency: KTX-Software

`ktx` must be available on PATH.

```sh
# macOS
brew install ktx-software

# Windows / Linux
# https://github.com/KhronosGroup/KTX-Software/releases
```

## CLI usage

Optimise a GLB:

```sh
belowjs-optimiser pack model.glb
```

Optimise many files:

```sh
belowjs-optimiser pack models/*.glb
```

Skip simplification:

```sh
belowjs-optimiser pack model.glb --no-simplify
```

Custom polygon target:

```sh
belowjs-optimiser pack model.glb --polygon 800000
```

Custom output suffix:

```sh
belowjs-optimiser pack model.glb --suffix '_ar'
```

Apply uniform scene scaling:

```sh
belowjs-optimiser pack model.glb --scale 0.01
```

Unpack for texture edits:

```sh
belowjs-optimiser unpack model.glb
# creates model_edit/
```

Repack an unpacked directory:

```sh
belowjs-optimiser pack model_edit/
```

Inspect model stats:

```sh
belowjs-optimiser info model.glb
```

`below-optimiser` is still supported as a compatibility alias.

## Scaling behavior

- Default behavior: geometry/object scale is unchanged (`--scale 1`).
- Use `--scale <factor>` to apply uniform scene scaling.
- Scene hierarchy is wrapped with a scale node; mesh data is not rewritten.
- Texture dimensions may still be resized (down to max 4096x4096).

## Programmatic API

```js
import { pack, unpack, inspect } from 'belowjs-optimiser';

const packed = await pack('model.glb', {
  output: 'model-belowjs.glb',
  targetPolygons: 1200000,
  scale: 1,
  simplify: true
});

const extracted = await unpack('model.glb');
const stats = await inspect('model.glb');

console.log(packed.outputSize, extracted.textureCount, stats.polygons);
```

## Real Test Results (From Scratch Run)

The numbers below are from a real run on **February 7, 2026**:

```sh
rm -rf test/output/* && node test/test-suite.js
```

Summary:

- Pack pipeline: `23/23` passed
- Unpack -> Pack: `23/23` passed
- Re-optimise: `23/23` passed
- Low-compression edge cases found: `3` models (`0.6%`, `0.7%`, `20.2%`)

Curated 12-model sample (manually selected from the same run):

| Model | Original | Optimised | Compression | Polygons |
|---|---:|---:|---:|---:|
| `providence_island_sailing_canal_boat-test` | 7.7 MB | 7.6 MB | 0.6% | 186,311 -> 186,311 |
| `04 Koz VII` | 39.6 MB | 39.3 MB | 0.7% | 819,403 -> 819,403 |
| `adrasan copy` | 91.9 MB | 73.3 MB | 20.2% | 1,200,000 -> 1,200,000 |
| `blackwall_reach_barge` | 36.2 MB | 14.8 MB | 59.2% | 564,587 -> 564,587 |
| `new_hope_shipwreck_bow_section_15445_version_3.0` | 64.0 MB | 26.2 MB | 59.0% | 1,547,406 -> 1,199,996 |
| `trial_1622_wreck_site_2021` | 90.4 MB | 25.9 MB | 71.3% | 2,076,707 -> 1,199,984 |
| `shipwreck_hopkins_2018` | 135.0 MB | 24.2 MB | 82.1% | 3,999,999 -> 1,199,993 |
| `test-junee-quest` | 163.7 MB | 21.4 MB | 86.9% | 10,707,222 -> 1,199,816 |
| `shipwreck_jarvenkari_haapasaaret` | 226.8 MB | 29.2 MB | 87.1% | 6,851,343 -> 1,199,971 |
| `shipwreck_uunihylky_-_varmbadan_kirkkonummi` | 348.5 MB | 33.0 MB | 90.5% | 9,996,908 -> 821,982 |
| `junee` | 249.2 MB | 17.9 MB | 92.8% | 10,707,222 -> 1,199,822 |
| `dunderberg` | 283.2 MB | 17.9 MB | 93.7% | 7,999,999 -> 823,229 |

Full run table is in
[`test/TESTING_RESULTS.md`](https://github.com/patrick-morrison/belowjs-optimiser/blob/main/test/TESTING_RESULTS.md).

## Release checklist

```sh
npm test
npm run test:help
npm run release:check
```

## Documentation

- Project guide: https://belowjs.com/guides/optimisation.html
- Full benchmark log: https://github.com/patrick-morrison/belowjs-optimiser/blob/main/test/TESTING_RESULTS.md

## License

GPL-3.0
