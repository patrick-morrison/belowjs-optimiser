import { encodeToKTX2, getEncoderDiagnostics } from "./ktx2-encoder.js?v=20260923-basis25";

self.onmessage = async (event) => {
    const { id, imageBuffer, options } = event.data || {};
    try {
        const ktx2Data = await encodeToKTX2(imageBuffer, {
            ...options,
            onInitialized: () => self.postMessage({ id, phase: 'initialized' })
        });
        const output = ktx2Data.byteOffset === 0 && ktx2Data.byteLength === ktx2Data.buffer.byteLength
            ? ktx2Data.buffer
            : ktx2Data.slice().buffer;
        self.postMessage({ id, ok: true, ktx2Buffer: output, diagnostics: getEncoderDiagnostics() }, [output]);
    }
    catch (err) {
        self.postMessage({
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        });
    }
};
