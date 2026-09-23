import { encodeToKTX2 } from "./ktx2-encoder.js?v=20260923";

self.onmessage = async (event) => {
    const { id, imageBuffer, options } = event.data || {};
    try {
        const ktx2Data = await encodeToKTX2(imageBuffer, options || {});
        const output = ktx2Data.byteOffset === 0 && ktx2Data.byteLength === ktx2Data.buffer.byteLength
            ? ktx2Data.buffer
            : ktx2Data.slice().buffer;
        self.postMessage({ id, ok: true, ktx2Buffer: output }, [output]);
    }
    catch (err) {
        self.postMessage({
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        });
    }
};
