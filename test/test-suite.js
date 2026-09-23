#!/usr/bin/env node

/**
 * Below Optimiser Test Suite
 *
 * Tests all models in test/models/ with multiple scenarios:
 * 1. Full pack pipeline (GLB → optimised GLB)
 * 2. Unpack → Pack pipeline (GLB → GLTF+textures → optimised GLB)
 * 3. Double optimisation (already optimised → optimise again)
 * 4. Scaled pack on a curated 3-model subset
 *
 * Run with: node test/test-suite.js
 */

import { pack, unpack, inspect } from '../src/index.js';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { existsSync, readdirSync, statSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import chalk from 'chalk';

const MODELS_DIR = join(import.meta.dirname, 'models');
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const SCALE_TEST_FACTOR = 0.01;
const SCALE_TEST_MODEL_NAMES = [
  'providence_island_sailing_canal_boat-test',
  'trial_1622_wreck_site_2021',
  'shipwreck_uunihylky_-_varmbadan_kirkkonummi'
];

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get all GLB files in models directory
function getModels() {
  if (!existsSync(MODELS_DIR)) {
    console.log(chalk.red(`Models directory not found: ${MODELS_DIR}`));
    console.log(chalk.dim('Add GLB files to test/models/ to run the test suite'));
    process.exit(1);
  }

  const files = readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.glb'))
    .map(f => ({
      name: basename(f, '.glb'),
      path: join(MODELS_DIR, f),
      size: statSync(join(MODELS_DIR, f)).size
    }))
    .sort((a, b) => a.size - b.size); // Sort by size (smallest first)

  return files;
}

// Format bytes
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Format duration
function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

// Test result tracking
const results = {
  pack: [],
  unpackPack: [],
  reoptimise: [],
  scaled: []
};

let cachedIo = null;

async function createIO() {
  if (cachedIo) return cachedIo;
  cachedIo = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule()
    });
  return cachedIo;
}

function isUniformScale(scale, factor, epsilon = 1e-6) {
  return (
    Math.abs(scale[0] - factor) < epsilon &&
    Math.abs(scale[1] - factor) < epsilon &&
    Math.abs(scale[2] - factor) < epsilon
  );
}

async function hasScaleWrapper(outputPath, factor) {
  const io = await createIO();
  const document = await io.read(outputPath);

  for (const scene of document.getRoot().listScenes()) {
    for (const rootNode of scene.listChildren()) {
      let found = false;
      rootNode.traverse((node) => {
        if (found) return;
        const nodeName = node.getName() || '';
        if (nodeName.startsWith('belowjs_scale_') && isUniformScale(node.getScale(), factor)) {
          found = true;
        }
      });
      if (found) return true;
    }
  }

  return false;
}

function selectScaleModels(models) {
  const selected = [];
  const seen = new Set();

  for (const name of SCALE_TEST_MODEL_NAMES) {
    const model = models.find((m) => m.name === name);
    if (!model || seen.has(model.name)) continue;
    selected.push(model);
    seen.add(model.name);
  }

  // Fallback for custom model sets: choose small, median, large.
  const fallback = [
    models[0],
    models[Math.floor(models.length / 2)],
    models[models.length - 1]
  ].filter(Boolean);

  for (const model of fallback) {
    if (seen.has(model.name)) continue;
    selected.push(model);
    seen.add(model.name);
    if (selected.length >= 3) break;
  }

  return selected.slice(0, 3);
}

// Run a single test with timing
async function runTest(name, testFn) {
  const start = Date.now();
  try {
    const result = await testFn();
    const duration = Date.now() - start;
    return { success: true, duration, ...result };
  } catch (error) {
    const duration = Date.now() - start;
    return { success: false, duration, error: error.message };
  }
}

// Test 1: Full pack pipeline
async function testPack(model) {
  const outputPath = join(OUTPUT_DIR, `${model.name}-belowjs.glb`);

  const result = await pack(model.path, {
    output: outputPath,
    targetPolygons: 1200000,
    simplify: true,
    onProgress: () => {},
    onStep: () => {}
  });

  // Get output stats
  const outputStats = await inspect(outputPath);

  return {
    inputSize: model.size,
    outputSize: result.outputSize,
    polygonsBefore: result.polygonsBefore,
    polygonsAfter: result.polygonsAfter,
    compression: ((1 - result.outputSize / model.size) * 100).toFixed(1)
  };
}

// Test 2: Unpack → Pack pipeline
async function testUnpackPack(model) {
  const unpackDir = join(OUTPUT_DIR, `${model.name}_edit`);
  const outputPath = join(OUTPUT_DIR, `${model.name}-unpack-belowjs.glb`);

  // Clean up any existing unpack directory
  if (existsSync(unpackDir)) {
    rmSync(unpackDir, { recursive: true });
  }

  // Unpack
  const unpackResult = await unpack(model.path, unpackDir);

  // Pack from unpacked directory
  const packResult = await pack(unpackDir, {
    output: outputPath,
    targetPolygons: 1200000,
    simplify: true,
    onProgress: () => {},
    onStep: () => {}
  });

  return {
    texturesExtracted: unpackResult.textureCount,
    inputSize: model.size,
    outputSize: packResult.outputSize,
    polygonsBefore: packResult.polygonsBefore,
    polygonsAfter: packResult.polygonsAfter,
    compression: ((1 - packResult.outputSize / model.size) * 100).toFixed(1)
  };
}

// Test 3: Re-optimise already optimised model
async function testReoptimise(model) {
  const firstPassPath = join(OUTPUT_DIR, `${model.name}-belowjs.glb`);
  const secondPassPath = join(OUTPUT_DIR, `${model.name}-belowjs-belowjs.glb`);

  // Check if first pass exists (from testPack)
  if (!existsSync(firstPassPath)) {
    throw new Error('First pass not found - run testPack first');
  }

  const firstPassStats = await inspect(firstPassPath);
  const firstPassSize = statSync(firstPassPath).size;

  // Run pack on already optimised file
  const result = await pack(firstPassPath, {
    output: secondPassPath,
    targetPolygons: 1200000,
    simplify: true,
    onProgress: () => {},
    onStep: () => {}
  });

  const secondPassStats = await inspect(secondPassPath);

  return {
    firstPassSize,
    secondPassSize: result.outputSize,
    firstPassPolygons: firstPassStats.polygons,
    secondPassPolygons: secondPassStats.polygons,
    sizeChange: ((result.outputSize / firstPassSize - 1) * 100).toFixed(1)
  };
}

// Test 4: Scaled pack on selected models
async function testScaledPack(model, scaleFactor) {
  const scaleLabel = String(scaleFactor).replace('.', '_');
  const outputPath = join(OUTPUT_DIR, `${model.name}-scale-${scaleLabel}-belowjs.glb`);

  const result = await pack(model.path, {
    output: outputPath,
    targetPolygons: 1200000,
    simplify: true,
    scale: scaleFactor,
    onProgress: () => {},
    onStep: () => {}
  });

  const scaleApplied = await hasScaleWrapper(outputPath, scaleFactor);
  if (!scaleApplied) {
    throw new Error(`Expected scale wrapper not found in output (${scaleFactor}x)`);
  }

  return {
    inputSize: model.size,
    outputSize: result.outputSize,
    polygonsBefore: result.polygonsBefore,
    polygonsAfter: result.polygonsAfter,
    scale: scaleFactor,
    compression: ((1 - result.outputSize / model.size) * 100).toFixed(1)
  };
}

// Main test runner
async function runTestSuite() {
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold(`  Below Optimiser Test Suite v${VERSION}`));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════\n'));

  const models = getModels();

  if (models.length === 0) {
    console.log(chalk.yellow('No GLB files found in test/models/'));
    console.log(chalk.dim('Add models to test/models/ to run the test suite'));
    return;
  }

  console.log(chalk.cyan(`Found ${models.length} model(s) to test:\n`));
  for (const model of models) {
    console.log(chalk.dim(`  • ${model.name} (${formatBytes(model.size)})`));
  }
  console.log('');

  const scaleModels = selectScaleModels(models);

  // ═══════════════════════════════════════════════════════════
  // TEST 1: Full Pack Pipeline
  // ═══════════════════════════════════════════════════════════
  console.log(chalk.bold.cyan('\n┌─────────────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│  TEST 1: Full Pack Pipeline (GLB → Optimised GLB)       │'));
  console.log(chalk.bold.cyan('└─────────────────────────────────────────────────────────┘\n'));

  for (const model of models) {
    process.stdout.write(chalk.dim(`  ${model.name}... `));

    const result = await runTest('pack', () => testPack(model));
    results.pack.push({ model: model.name, ...result });

    if (result.success) {
      console.log(
        chalk.green('✓'),
        chalk.dim(`${formatBytes(result.inputSize)} → ${formatBytes(result.outputSize)}`),
        chalk.green(`(${result.compression}% smaller)`),
        chalk.dim(`[${formatDuration(result.duration)}]`)
      );
      if (result.polygonsBefore !== result.polygonsAfter) {
        console.log(
          chalk.dim('    Polygons:'),
          `${result.polygonsBefore.toLocaleString()} → ${result.polygonsAfter.toLocaleString()}`
        );
      }
    } else {
      console.log(chalk.red('✗'), chalk.red(result.error));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Scaled Pack (Subset)
  // ═══════════════════════════════════════════════════════════
  console.log(chalk.bold.cyan('\n┌─────────────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│  TEST 4: Scaled Pack (3 Model Subset)                   │'));
  console.log(chalk.bold.cyan('└─────────────────────────────────────────────────────────┘\n'));

  console.log(chalk.dim(`  Scale factor: ${SCALE_TEST_FACTOR}x`));
  console.log(chalk.dim(`  Models: ${scaleModels.map(m => m.name).join(', ')}\n`));

  for (const model of scaleModels) {
    process.stdout.write(chalk.dim(`  ${model.name}... `));

    const result = await runTest('scaledPack', () => testScaledPack(model, SCALE_TEST_FACTOR));
    results.scaled.push({ model: model.name, ...result });

    if (result.success) {
      console.log(
        chalk.green('✓'),
        chalk.dim(`${formatBytes(result.inputSize)} → ${formatBytes(result.outputSize)}`),
        chalk.green(`(${result.compression}% smaller, scale ${result.scale}x)`),
        chalk.dim(`[${formatDuration(result.duration)}]`)
      );
    } else {
      console.log(chalk.red('✗'), chalk.red(result.error));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Unpack → Pack Pipeline
  // ═══════════════════════════════════════════════════════════
  console.log(chalk.bold.cyan('\n┌─────────────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│  TEST 2: Unpack → Pack Pipeline (GLB → Edit → GLB)      │'));
  console.log(chalk.bold.cyan('└─────────────────────────────────────────────────────────┘\n'));

  for (const model of models) {
    process.stdout.write(chalk.dim(`  ${model.name}... `));

    const result = await runTest('unpackPack', () => testUnpackPack(model));
    results.unpackPack.push({ model: model.name, ...result });

    if (result.success) {
      console.log(
        chalk.green('✓'),
        chalk.dim(`${result.texturesExtracted} texture(s) →`),
        chalk.dim(`${formatBytes(result.outputSize)}`),
        chalk.green(`(${result.compression}% smaller)`),
        chalk.dim(`[${formatDuration(result.duration)}]`)
      );
    } else {
      console.log(chalk.red('✗'), chalk.red(result.error));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Re-optimise Already Optimised
  // ═══════════════════════════════════════════════════════════
  console.log(chalk.bold.cyan('\n┌─────────────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│  TEST 3: Re-optimise (Optimised → Optimise Again)       │'));
  console.log(chalk.bold.cyan('└─────────────────────────────────────────────────────────┘\n'));

  for (const model of models) {
    process.stdout.write(chalk.dim(`  ${model.name}... `));

    const result = await runTest('reoptimise', () => testReoptimise(model));
    results.reoptimise.push({ model: model.name, ...result });

    if (result.success) {
      const changeIcon = parseFloat(result.sizeChange) > 5 ? chalk.yellow('⚠') : chalk.green('✓');
      console.log(
        changeIcon,
        chalk.dim(`${formatBytes(result.firstPassSize)} → ${formatBytes(result.secondPassSize)}`),
        chalk.dim(`(${result.sizeChange}% change)`),
        chalk.dim(`[${formatDuration(result.duration)}]`)
      );
    } else {
      console.log(chalk.red('✗'), chalk.red(result.error));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold('  TEST SUMMARY'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════\n'));

  const packSuccess = results.pack.filter(r => r.success).length;
  const unpackSuccess = results.unpackPack.filter(r => r.success).length;
  const reoptSuccess = results.reoptimise.filter(r => r.success).length;
  const scaledSuccess = results.scaled.filter(r => r.success).length;
  const total = models.length;
  const scaledTotal = scaleModels.length;

  console.log(`  Pack Pipeline:      ${packSuccess}/${total} passed`);
  console.log(`  Unpack→Pack:        ${unpackSuccess}/${total} passed`);
  console.log(`  Re-optimise:        ${reoptSuccess}/${total} passed`);
  console.log(`  Scaled Pack:        ${scaledSuccess}/${scaledTotal} passed`);
  console.log('');

  // Automated checks
  console.log(chalk.bold('  AUTOMATED CHECKS:\n'));

  let allPassed = true;
  if (unpackSuccess !== total || reoptSuccess !== total) {
    console.log(chalk.red('  Unpack/repack or re-optimise tests failed.'));
    allPassed = false;
  }

  // Check 1: All pack tests should succeed
  if (packSuccess === total) {
    console.log(chalk.green('  ✓ All pack tests passed'));
  } else {
    console.log(chalk.red(`  ✗ ${total - packSuccess} pack test(s) failed`));
    allPassed = false;
  }

  // Check 2: All models should compress by at least 30%
  const lowCompression = results.pack.filter(r => r.success && parseFloat(r.compression) < 30);
  if (lowCompression.length === 0) {
    console.log(chalk.green('  ✓ All models compressed by at least 30%'));
  } else {
    console.log(chalk.yellow(`  ⚠ ${lowCompression.length} model(s) compressed less than 30%:`));
    for (const r of lowCompression) {
      console.log(chalk.dim(`      ${r.model}: ${r.compression}%`));
    }
  }

  // Check 3: Re-optimised files shouldn't grow significantly (>10%)
  const grewTooMuch = results.reoptimise.filter(r => r.success && parseFloat(r.sizeChange) > 10);
  if (grewTooMuch.length === 0) {
    console.log(chalk.green('  ✓ Re-optimised files are stable (no significant growth)'));
  } else {
    console.log(chalk.yellow(`  ⚠ ${grewTooMuch.length} re-optimised file(s) grew >10%:`));
    for (const r of grewTooMuch) {
      console.log(chalk.dim(`      ${r.model}: +${r.sizeChange}%`));
    }
  }

  // Check 4: High polygon models should be simplified
  const notSimplified = results.pack.filter(r =>
    r.success && r.polygonsBefore > 1200000 && r.polygonsAfter > 1300000
  );
  if (notSimplified.length === 0) {
    console.log(chalk.green('  ✓ High polygon models were simplified correctly'));
  } else {
    console.log(chalk.red(`  ✗ ${notSimplified.length} model(s) not simplified properly:`));
    for (const r of notSimplified) {
      console.log(chalk.dim(`      ${r.model}: ${r.polygonsAfter.toLocaleString()} polygons`));
    }
    allPassed = false;
  }

  // Check 5: Scaled output should contain expected wrapper node
  if (scaledSuccess === scaledTotal) {
    console.log(chalk.green(`  ✓ Scaled tests passed (${scaledSuccess}/${scaledTotal})`));
  } else {
    console.log(chalk.red(`  ✗ ${scaledTotal - scaledSuccess} scaled test(s) failed`));
    allPassed = false;
  }

  console.log('');
  console.log(chalk.bold('  OUTPUT FILES:'));
  console.log(chalk.dim(`  ${OUTPUT_DIR}/`));
  console.log(chalk.dim('  Inspect the output files manually to verify quality.\n'));

  if (allPassed) {
    console.log(chalk.bold.green('  ✓ ALL TESTS PASSED\n'));
  } else {
    console.log(chalk.bold.red('  ✗ SOME TESTS FAILED\n'));
    process.exit(1);
  }
}

// Run the test suite
runTestSuite().catch(err => {
  console.error(chalk.red('\nTest suite failed:'), err.message);
  process.exit(1);
});
