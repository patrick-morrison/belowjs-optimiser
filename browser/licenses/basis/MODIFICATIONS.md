# Basis Universal Vendor Notice

Basis Universal 2.5, Binomial LLC, source commit
`99f52d63aa6799cbdaecfe977111dc5ec3b31d47`.

Below Optimiser modifies `webgl/transcoder/basis_wrappers.cpp` and
`webgl/encoder/CMakeLists.txt` before compiling the distributed JavaScript/WASM:

- Direct RGBA input copy into the source allocation.
- Optional release of source images after the compressor copies them.
- 64-Mi-texel (67.1-megapixel) limit for ETC1S and UASTC LDR only.
- Four helper threads and a 4 GiB WASM32 maximum heap.

Exact changes: `scripts/prepare-basis.mjs`. Rebuild: `scripts/build-basis.sh`.
See `docs/BASIS_BROWSER_UPGRADE.md` for provenance, tests and limitations.
Upstream copyright and license notices are retained in this directory.
