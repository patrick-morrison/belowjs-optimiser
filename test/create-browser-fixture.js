import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const document = new Document();
const buffer = document.createBuffer();
const width = Number(process.argv[2]) || 512;
const height = Number(process.argv[3]) || 256;
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const colors = [[230, 30, 20], [20, 210, 40], [30, 50, 235], [240, 220, 30]];
        pixels.set(colors[(x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0)], i);
        pixels[i + 3] = x < 48 && y < 48 ? 0 : 255;
    }
}
const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
const scene = document.createScene();
for (let n = 0; n < 2; n++) {
    // Separate but identical textures exercise candidate refresh after deduplication.
    const texture = document.createTexture('quadrants-' + n).setImage(png).setMimeType('image/png');
    const material = document.createMaterial('material-' + n)
        .setBaseColorTexture(texture).setAlphaMode('MASK').setDoubleSided(true).setRoughnessFactor(1);
    const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
        .setArray(new Float32Array([-1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0]));
    const uv = document.createAccessor().setType('VEC2').setBuffer(buffer)
        .setArray(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]));
    const indices = document.createAccessor().setType('SCALAR').setBuffer(buffer)
        .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
    const primitive = document.createPrimitive().setAttribute('POSITION', position)
        .setAttribute('TEXCOORD_0', uv).setIndices(indices).setMaterial(material);
    const mesh = document.createMesh().addPrimitive(primitive);
    scene.addChild(document.createNode().setMesh(mesh).setTranslation([n * 2.2, 0, 0]));
}
await mkdir('test/output', { recursive: true });
const path = `test/output/browser-fixture-${width}x${height}.glb`;
await new NodeIO().write(path, document);
console.log(`Created ${path} (non-square RGBA, duplicate textures).`);
