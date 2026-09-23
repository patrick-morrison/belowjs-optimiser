import { read, write } from "https://unpkg.com/ktx-parse@0.7.1/dist/ktx-parse.esm.js";

const DefaultOptions = {
    enableDebug: false,
    isUASTC: true,
    isKTX2File: true,
    isInputSRGB: true,
    generateMipmap: true,
    needSupercompression: true,
    isSetKTX2SRGBTransferFunc: true,
    isHDR: false,
    qualityLevel: 150
};

const BasisTextureType = {
    cBASISTexType2D: 0,
    cBASISTexTypeCubemapArray: 2
};

const SourceType = {
    RAW: 0
};

const HDRSourceType = {
    EXR: 3,
    HDR: 4
};

const warnedMethods = new Set();
function applyInputOptions(options = {}, encoder) {
    options = { ...DefaultOptions, ...options };

    const warnMissing = (primary, fallback) => {
        const key = `${primary}|${fallback ?? ""}`;
        if (warnedMethods.has(key))
            return;
        warnedMethods.add(key);
        const fallbackLabel = fallback ? ` or ${fallback}` : "";
        console.warn(`[ktx2-encoder] Encoder method not found: ${primary}${fallbackLabel}`);
    };

    const call = (primary, fallback, value, guard = true) => {
        if (!guard)
            return;
        const method = (typeof encoder[primary] === "function")
            ? encoder[primary]
            : (fallback && typeof encoder[fallback] === "function" ? encoder[fallback] : null);
        if (method) {
            method.call(encoder, value);
        }
        else {
            warnMissing(primary, fallback);
        }
    };

    const call0 = (methodName, guard = true) => {
        if (!guard)
            return;
        if (typeof encoder[methodName] === "function") {
            encoder[methodName]();
        }
    };

    call("setDebug", null, options.enableDebug, options.enableDebug !== undefined);
    call("setUASTC", null, options.isUASTC, options.isUASTC !== undefined);
    call("setCreateKTX2File", null, options.isKTX2File, options.isKTX2File !== undefined);
    call("setKTX2SRGBTransferFunc", "setKTX2AndBasisSRGBTransferFunc", options.isSetKTX2SRGBTransferFunc, options.isSetKTX2SRGBTransferFunc !== undefined);
    call("setMipGen", null, options.generateMipmap, options.generateMipmap !== undefined);
    call("setMipSRGB", null, options.isInputSRGB, options.isInputSRGB !== undefined);
    call("setYFlip", null, options.isYFlip, options.isYFlip !== undefined);
    call0("setNormalMap", options.isNormalMap === true);
    call("setQualityLevel", null, options.qualityLevel, options.qualityLevel !== undefined);
    call("setCompressionLevel", "setETC1SCompressionLevel", options.compressionLevel, options.compressionLevel !== undefined);
    call("setKTX2UASTCSupercompression", null, options.needSupercompression, options.needSupercompression !== undefined);
    call("setRDOUASTC", null, true, options.enableRDO);
    call("setRDOUASTCQualityScalar", null, options.rdoQualityLevel, options.rdoQualityLevel !== undefined);
    call("setPackUASTCFlags", null, options.uastcLDRQualityLevel, options.uastcLDRQualityLevel !== undefined);

    if (options.isHDR) {
        call("setHDR", null, options.isHDR, true);
        call("setUASTCHDRQualityLevel", null, options.hdrQualityLevel, !!options.hdrQualityLevel);
    }

    call("setPerceptual", null, options.isPerceptual, options.isPerceptual !== undefined);
}

async function decodeImageBitmap(imageBuffer) {
    const bitmap = await createImageBitmap(new Blob([imageBuffer]), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none"
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Unable to create a texture decoding context.");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
        canvas.width = 1;
        canvas.height = 1;
    }
}

let modulePromise = null;
let diagnostics = null;
export function getEncoderDiagnostics() { return diagnostics; }
const scriptLoadPromiseMap = new Map();
const DEFAULT_WASM_URL = new URL("./basis_encoder.wasm", import.meta.url).href;
const DEFAULT_JS_URL = new URL("./basis_encoder.js", import.meta.url).href;

function resolveBasisFactory(mod) {
    if (!mod)
        return null;
    const candidates = [
        mod.default,
        mod.BASIS,
        mod.default?.default,
        mod.default?.BASIS
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "function")
            return candidate;
    }
    return null;
}

function loadClassicScript(url) {
    const cached = scriptLoadPromiseMap.get(url);
    if (cached)
        return cached;

    const promise = new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            reject(new Error("Cannot load BASIS script outside browser document context."));
            return;
        }
        const script = document.createElement("script");
        script.async = true;
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load BASIS script: ${url}`));
        document.head.appendChild(script);
    }).catch((err) => {
        scriptLoadPromiseMap.delete(url);
        throw err;
    });

    scriptLoadPromiseMap.set(url, promise);
    return promise;
}

async function loadEvaluatedScriptFactory(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
        throw new Error(`Failed to fetch BASIS script: ${response.status} ${response.statusText}`);
    }
    const source = await response.text();
    const factory = new Function(`
        var module = { exports: {} };
        var exports = module.exports;
        ${source}
        return module.exports.default || module.exports.BASIS || module.exports || (typeof BASIS === "function" ? BASIS : null);
    `)();
    if (typeof factory === "function") {
        return factory;
    }
    throw new Error(`Unable to evaluate BASIS factory from ${url}.`);
}

async function loadBasisFactory(jsUrl) {
    let importError = null;
    try {
        const imported = await import(/* @vite-ignore */ jsUrl);
        const factory = resolveBasisFactory(imported);
        if (factory)
            return factory;
    }
    catch (err) {
        importError = err;
    }

    if (typeof document === "undefined") {
        return loadEvaluatedScriptFactory(jsUrl);
    }

    await loadClassicScript(jsUrl);
    if (typeof globalThis.BASIS === "function") {
        return globalThis.BASIS;
    }

    if (importError) {
        throw new Error(`Unable to resolve BASIS factory from ${jsUrl}: ${importError instanceof Error ? importError.message : String(importError)}`);
    }

    throw new Error(`Unable to resolve BASIS factory from ${jsUrl}.`);
}

async function initBasisModule(options = {}) {
    if (!modulePromise) {
        const wasmUrl = options?.wasmUrl ?? DEFAULT_WASM_URL;
        const jsUrl = options?.jsUrl ?? DEFAULT_JS_URL;

        modulePromise = Promise.all([
            loadBasisFactory(jsUrl),
            wasmUrl ? fetch(wasmUrl).then((res) => {
                if (!res.ok) throw new Error(`Failed to fetch encoder WASM: ${res.status}`);
                return res.arrayBuffer();
            }) : undefined
        ])
            .then(([BASIS, wasmBinary]) => BASIS({
                wasmBinary,
                mainScriptUrlOrBlob: jsUrl,
                locateFile: (path) => new URL(path, jsUrl).href
            }))
            .then((Module) => {
            Module.initializeBasis();
            return Module;
        }).catch((error) => {
            modulePromise = null;
            throw error;
        });
    }
    return modulePromise;
}

async function encodeInternal(bufferOrBufferArray, options = {}) {
    options = { ...DefaultOptions, ...options };
    const started = performance.now();
    const basisModule = await initBasisModule(options);
    options.onInitialized?.();
    diagnostics = { initMs: Math.round(performance.now() - started), threads: options.threads || 0 };
    const encoder = new basisModule.BasisEncoder();
    try {
        applyInputOptions(options, encoder);
        // Workers dispose this instance after one encode; don't retain a redundant source copy.
        diagnostics.sourceRelease = typeof encoder.setReleaseSourceImages === "function";
        if (diagnostics.sourceRelease) encoder.setReleaseSourceImages(true);
        if (options.threads) {
            if (typeof encoder.controlThreading !== "function") throw new Error("Encoder does not support threading.");
            encoder.controlThreading(true, Math.min(4, options.threads));
        }
        const isCube = Array.isArray(bufferOrBufferArray) && bufferOrBufferArray.length === 6;
        encoder.setTexType(isCube ? BasisTextureType.cBASISTexTypeCubemapArray : BasisTextureType.cBASISTexType2D);

        const bufferArray = Array.isArray(bufferOrBufferArray) ? bufferOrBufferArray : [bufferOrBufferArray];
        let decodedPixels = 0;
        for (let i = 0; i < bufferArray.length; i++) {
            const buffer = bufferArray[i];
            if (options.isHDR) {
                encoder.setSliceSourceImageHDR(i, buffer, 0, 0, options.imageType === "hdr" ? HDRSourceType.HDR : HDRSourceType.EXR, true);
            }
            else {
                const imageData = await options.imageDecoder(buffer);
                decodedPixels += imageData.width * imageData.height;
                const pixels = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
                if (!encoder.setSliceSourceImage(i, pixels, imageData.width, imageData.height, SourceType.RAW)) {
                    throw new Error("Encoder rejected the decoded texture.");
                }
            }
        }

        // ETC1S alpha uses a second block stream; opaque-only sizing can reject RGBA output.
        const bytesPerPixelBudget = options.isHDR ? 4 : (options.isUASTC ? 2 : 1);
        const mipBudget = options.generateMipmap === false ? 1 : 4 / 3;
        const estimatedBytes = Math.ceil(decodedPixels * bytesPerPixelBudget * mipBudget) + (4 * 1024 * 1024);
        const outputBytes = Math.max(
            16 * 1024 * 1024,
            options.outputBytes ?? 0,
            estimatedBytes
        );
        const ktx2FileData = new Uint8Array(outputBytes);
        const encodeStarted = performance.now();
        diagnostics.inputMs = Math.round(encodeStarted - started - diagnostics.initMs);
        diagnostics.heapBeforeEncode = basisModule.HEAP8?.buffer.byteLength ?? null;
        const byteLength = encoder.encode(ktx2FileData);
        diagnostics.encodeMs = Math.round(performance.now() - encodeStarted);
        diagnostics.heapCapacityBytes = basisModule.HEAP8?.buffer.byteLength ?? null;
        diagnostics.outputCapacityBytes = outputBytes;
        if (byteLength === 0) {
            throw new Error(`Encode failed. Output buffer was ${Math.round(outputBytes / (1024 * 1024))} MiB.`);
        }

        let output = new Uint8Array(ktx2FileData.buffer, 0, byteLength);
        if (options.kvData) {
            const container = read(output);
            for (const k in options.kvData) {
                container.keyValue[k] = options.kvData[k];
            }
            output = write(container, { keepWriter: true });
        }

        return output;
    }
    finally {
        if (typeof encoder.delete === "function") {
            encoder.delete();
        }
    }
}

export function encodeToKTX2(imageBuffer, options = {}) {
    options.imageDecoder ??= decodeImageBitmap;
    globalThis.__KTX2_DEBUG__ = options.enableDebug ?? false;
    return encodeInternal(imageBuffer, options);
}
