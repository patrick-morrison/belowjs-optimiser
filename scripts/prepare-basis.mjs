import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Applied only to the SHA pinned in build-basis.sh, never to a floating checkout.
const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/prepare-basis.mjs SOURCE');
function patch(path, before, after) {
  const text = readFileSync(path, 'utf8');
  if (text.split(before).length !== 2) throw new Error(`Unexpected upstream source: ${path}`);
  writeFileSync(path, text.replace(before, after));
}
const wrapper = join(root, 'webgl/transcoder/basis_wrappers.cpp');
patch(wrapper, '    basis_compressor_params m_params;',
  '    basis_compressor_params m_params;\n    bool m_release_source_images = false;');
patch(wrapper,
  '        basis_compressor::error_code ec = comp.process();',
  `        // comp.init() deep-copies params. Disposable workers can release the original.
        if (m_release_source_images)
        {
            m_params.m_source_images.clear();
            m_params.m_source_images_hdr.clear();
            m_params.m_source_mipmap_images.clear();
            m_params.m_source_mipmap_images_hdr.clear();
        }
        basis_compressor::error_code ec = comp.process();`);
patch(wrapper,
  '    .function("controlThreading", optional_override',
  `    .function("setReleaseSourceImages", optional_override([](basis_encoder& self, bool enabled) {
      self.m_release_source_images = enabled;
    }))
    .function("controlThreading", optional_override`);
patch(wrapper,
  '            m_params.m_source_images.resize(slice_index + 1);',
  `            m_params.m_source_images.resize(slice_index + 1);

        // Below Optimiser: copy raw RGBA straight to its final source allocation.
        // Avoid a second full-size temporary (256 MiB for an 8192-square image).
        if (img_type == ldr_image_type::cRGBA32)
        {
            const uint64_t bytes = uint64_t(src_image_width) * src_image_height * 4;
            if (!src_image_width || !src_image_height || bytes > 268435456 ||
                src_image_js_val["byteLength"].as<size_t>() != bytes)
                return false;
            image& src_img = m_params.m_source_images[slice_index];
            src_img.resize(src_image_width, src_image_height);
            emscripten::val dst(emscripten::typed_memory_view(size_t(bytes),
                reinterpret_cast<uint8_t*>(src_img.get_ptr())));
            dst.call<void>("set", src_image_js_val);
            return true;
        }`);
patch(wrapper,
  '            max_pixels_thresh = BASISU_ENCODER_MAX_SOURCE_IMAGE_PIXELS_HIGHER_LIMIT;\n        }',
  `            max_pixels_thresh = BASISU_ENCODER_MAX_SOURCE_IMAGE_PIXELS_HIGHER_LIMIT;
        }

        // Raise only the two glTF LDR codecs to our tested 8192-square envelope.
        // Keep the upstream HDR/ASTC limits intact.
        if (m_params.is_etc1s() || m_params.is_uastc_ldr_4x4())
            max_pixels_thresh = 64 * 1024 * 1024;`);
const cmake = join(root, 'webgl/encoder/CMakeLists.txt');
patch(cmake, '-s INITIAL_MEMORY=134217728 -s STACK_SIZE=',
  '-s INITIAL_MEMORY=134217728 -s MAXIMUM_MEMORY=4294967296 -s STACK_SIZE=');
patch(cmake, '-s PTHREAD_POOL_SIZE=32', '-s PTHREAD_POOL_SIZE=4');
