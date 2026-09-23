export const ENCODER_VERSION = 'basis25-20260923';
export const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;

// Shared memory is a hosting capability, not just a browser/version capability.
export function selectEncoderBackend(capabilities) {
    const { isolated, sharedMemory, cores = 2, deviceMemory, userAgent = '' } = capabilities;
    const isWebKit = /AppleWebKit/i.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\//i.test(userAgent);
    const version = userAgent.match(/Version\/(\d+)\.(\d+)/i);
    const buggyWebKit = isWebKit && (!version || (+version[1] === 26 && +version[2] < 3));
    const threads = isolated && sharedMemory && !buggyWebKit && !(deviceMemory && deviceMemory < 8)
        ? Math.max(0, Math.min(4, Math.floor(cores) - 2)) : 0;
    return { kind: threads ? 'threads' : 'single', threads };
}

export function getBrowserEncoderBackend() {
    let sharedMemory = false;
    try {
        sharedMemory = typeof SharedArrayBuffer !== 'undefined' &&
            new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer;
    } catch { /* Single-thread WASM remains available. */ }
    return selectEncoderBackend({
        isolated: globalThis.crossOriginIsolated === true,
        sharedMemory,
        cores: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        userAgent: navigator.userAgent
    });
}

export function encoderURLs(backend) {
    const stem = backend.kind === 'threads' ? 'basis_encoder_threads' : 'basis_encoder';
    return {
        jsUrl: new URL(`./${stem}.js?v=${ENCODER_VERSION}`, import.meta.url).href,
        wasmUrl: new URL(`./${stem}.wasm?v=${ENCODER_VERSION}`, import.meta.url).href,
        threads: backend.threads,
        backend: backend.kind
    };
}
