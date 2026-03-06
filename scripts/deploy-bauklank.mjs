#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const appRoot = process.cwd();
const defaultTargetRoot = path.resolve(appRoot, '..', 'bauklank-micros', 'web', 'serial-logger-app');
const targetRoot = process.env.BAUKLANK_DEPLOY_TARGET
  ? path.resolve(process.env.BAUKLANK_DEPLOY_TARGET)
  : defaultTargetRoot;

const candidateDistRoots = [
  path.resolve(appRoot, 'dist', 'serial-logger', 'browser'),
  path.resolve(appRoot, 'dist', 'serial-logger'),
];

const sourceRoot = candidateDistRoots.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
if (!sourceRoot) {
  console.error('❌ No Angular build output found. Run `npm run build:prod` first.');
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
