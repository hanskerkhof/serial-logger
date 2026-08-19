#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { syncVersionMetadata } from './version-metadata.mjs';

const appRoot = process.cwd();

// --- 1. Sync build-info.ts and ngsw-config.json from package.json version ---
syncVersionMetadata(appRoot);

// --- 2. Build ---
// Served by nginx at /studio/ (alongside bauklank-apps at site root and
// esp-audio-fx at /audio-fx/, see deploy/raspberrypi/nginx/cmdr-studio.conf),
// so the build needs a matching --base-href.
console.log('🔨 Building (base-href /studio/)...');
execSync('npx ng build --base-href /studio/', { cwd: appRoot, stdio: 'inherit' });

// --- 3. Copy dist to bauklank-micros ---
const inRepoMarker = path.resolve(appRoot, '..', '..', 'CMDR_hello_api.py');
const defaultTargetRoot = fs.existsSync(inRepoMarker)
  ? path.resolve(appRoot, '..', '..', 'web', 'serial-logger-app')
  : path.resolve(appRoot, '..', 'bauklank-micros', 'web', 'serial-logger-app');
const targetRoot = process.env.BAUKLANK_DEPLOY_TARGET
  ? path.resolve(process.env.BAUKLANK_DEPLOY_TARGET)
  : defaultTargetRoot;

const candidateDistRoots = [
  path.resolve(appRoot, 'dist', 'serial-logger', 'browser'),
  path.resolve(appRoot, 'dist', 'serial-logger'),
];

const sourceRoot = candidateDistRoots.find((candidate) =>
  fs.existsSync(path.join(candidate, 'index.html')),
);
if (!sourceRoot) {
  console.error('❌ No Angular build output found.');
  process.exit(1);
}

if (!fs.existsSync(targetRoot)) {
  fs.mkdirSync(targetRoot, { recursive: true });
}

const normalizedTarget = targetRoot.replace(/\\/g, '/');
if (!normalizedTarget.includes('/bauklank-micros/')) {
  console.error(`❌ Refusing to deploy outside bauklank-micros: ${targetRoot}`);
  process.exit(1);
}

for (const entry of fs.readdirSync(targetRoot)) {
  fs.rmSync(path.join(targetRoot, entry), { recursive: true, force: true });
}

fs.cpSync(sourceRoot, targetRoot, { recursive: true, force: true });

const entries = fs.readdirSync(targetRoot);
console.log('✅ BAUKLANK deploy complete');
console.log(`- source: ${sourceRoot}`);
console.log(`- target: ${targetRoot}`);
console.log(`- files: ${entries.length}`);
console.log('- verify: index.html present =', fs.existsSync(path.join(targetRoot, 'index.html')));
