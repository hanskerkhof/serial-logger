import { spawnSync } from 'node:child_process';

const version = process.argv[2];

if (!version) {
  console.error('Usage: npm run bump:build -- <version>');
  process.exit(1);
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run('npm', ['run', 'bump:version', '--', version]);
run('npm', ['run', 'deploy:bauklank-studio']);
