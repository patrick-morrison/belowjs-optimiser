import { read } from 'https://unpkg.com/ktx-parse@0.7.1/dist/ktx-parse.esm.js';

export function inspectGlb(buffer) {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(8, true) !== buffer.byteLength) {
        throw new Error('Invalid GLB header.');
    }
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
    const binStart = 20 + jsonLength + 8;
    const textures = (json.images || []).map((image) => {
        if (image.mimeType !== 'image/ktx2') throw new Error('Unconverted output texture.');
        const bufferView = json.bufferViews[image.bufferView];
        const bytes = new Uint8Array(buffer, binStart + (bufferView.byteOffset || 0), bufferView.byteLength);
        const ktx = read(bytes);
        const expected = Math.floor(Math.log2(Math.max(ktx.pixelWidth, ktx.pixelHeight))) + 1;
        if (ktx.levels.length !== expected || ktx.levels.some((level) => !level.levelData.byteLength)) {
            throw new Error('Incomplete exported mip chain.');
        }
        return { width: ktx.pixelWidth, height: ktx.pixelHeight, levels: ktx.levels.length, bytes: bytes.length };
    });
    if (textures.length && !json.extensionsRequired.includes('KHR_texture_basisu')) {
        throw new Error('Missing required BasisU extension.');
    }
    for (const texture of json.textures || []) {
        if (!textures[texture.extensions?.KHR_texture_basisu?.source]) throw new Error('Broken texture reference.');
    }
    return {
        bytes: buffer.byteLength,
        textures,
        meshes: json.meshes?.length || 0,
        primitives: (json.meshes || []).reduce((count, mesh) => count + mesh.primitives.length, 0),
        extensions: json.extensionsRequired
    };
}
