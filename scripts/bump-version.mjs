#!/usr/bin/env node
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncVersionMetadata } from './version-metadata.mjs';

const appRoot = process.cwd();
const nextVersion = process.argv[2];

if (!nextVersion) {
  console.error('Usage: npm run bump:version -- <new-version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  console.error(`❌ Invalid version "${nextVersion}". Expected format: X.Y.Z`);
  process.exit(1);
}

execFileSync('npm', ['version', nextVersion, '--no-git-tag-version'], {
  cwd: appRoot,
  stdio: 'inherit',
});

syncVersionMetadata(appRoot);
console.log(`✅ Frontend version bumped to ${nextVersion}`);
console.log(`ℹ️ Next steps: update ../../CHANGELOG.md, run npm run build / npm run deploy:bauklank-studio, then commit.`);
