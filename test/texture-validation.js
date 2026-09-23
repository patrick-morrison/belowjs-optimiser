import * as THREE from 'https://esm.sh/three@0.179.1';
import { KTX2Loader } from 'https://esm.sh/three@0.179.1/examples/jsm/loaders/KTX2Loader.js';

// Compare the actual GPU-transcoded output with the source using identical sampling.
export async function validateTexture(sourceBytes, ktxBytes, container) {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(384, 384);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const loader = new KTX2Loader()
        .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.179.1/examples/jsm/libs/basis/')
        .detectSupport(renderer);
    const bitmap = await createImageBitmap(new Blob([sourceBytes]), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none'
    });
    const source = new THREE.Texture(bitmap);
    source.flipY = false;
    source.colorSpace = THREE.SRGBColorSpace;
    source.needsUpdate = true;
    const encoded = await new Promise((resolve, reject) => loader.parse(ktxBytes, resolve, reject));
    const expectedLevels = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
    if (container.pixelWidth !== bitmap.width || container.pixelHeight !== bitmap.height) {
        throw new Error('Encoded dimensions do not match the source.');
    }
    if (container.levels.length !== expectedLevels || encoded.mipmaps.length !== expectedLevels) {
        throw new Error('Missing mip levels in the container or transcoded texture.');
    }
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const material = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    const target = new THREE.WebGLRenderTarget(384, 384);
    const gallery = document.createElement('div');
    gallery.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap';
    document.querySelector('main').append(gallery);
    const render = (texture, label) => {
        material.map = texture;
        material.needsUpdate = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(384 * 384 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 384, 384, pixels);
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        const figure = document.createElement('figure');
        figure.style.margin = '0';
        const image = document.createElement('img');
        image.src = renderer.domElement.toDataURL();
        image.style.cssText = 'width:384px;max-width:100%;height:auto';
        const caption = document.createElement('figcaption');
        caption.textContent = label;
        figure.append(image, caption);
        gallery.append(figure);
        return pixels;
    };
    try {
        const original = render(source, 'Source');
        const decoded = render(encoded, 'Decoded KTX2');
        let squaredError = 0;
        let flippedError = 0;
        let energy = 0;
        let alphaError = 0;
        for (let y = 0; y < 384; y++) {
            for (let x = 0; x < 384; x++) {
                const alpha = (y * 384 + x) * 4 + 3;
                alphaError += (original[alpha] - decoded[alpha]) ** 2;
                for (let c = 0; c < 3; c++) {
                    const i = (y * 384 + x) * 4 + c;
                    const flipped = ((383 - y) * 384 + x) * 4 + c;
                    squaredError += (original[i] - decoded[i]) ** 2;
                    flippedError += (original[i] - decoded[flipped]) ** 2;
                    energy += decoded[i] ** 2;
                }
            }
        }
        const rmse = Math.sqrt(squaredError / (384 * 384 * 3)) / 255;
        const alphaRmse = Math.sqrt(alphaError / (384 * 384)) / 255;
        if (energy === 0 || rmse > 0.12 || alphaRmse > 0.03 || flippedError + 1 < squaredError) {
            throw new Error(`Texture comparison failed: RMSE=${rmse}, flip ratio=${flippedError / squaredError}`);
        }
        return { rmse, alphaRmse, expectedLevels, decodedLevels: encoded.mipmaps.length, flipErrorRatio: flippedError / Math.max(1, squaredError) };
    } finally {
        source.dispose();
        encoded.dispose();
        bitmap.close();
        loader.dispose();
        geometry.dispose();
        material.dispose();
        target.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
    }
}
