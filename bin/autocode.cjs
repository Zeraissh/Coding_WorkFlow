#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

// Determine the absolute path to the project's src/index.ts
const target = path.join(__dirname, '../src/index.ts');

// Determine the absolute path to tsx within the project's node_modules
let tsxPath = path.join(__dirname, '../node_modules/.bin/tsx');
if (process.platform === 'win32') {
  tsxPath += '.cmd';
}

// Pass all command line arguments to tsx and preserve stdio
const result = spawnSync(tsxPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error("Error executing CLI:", result.error);
  process.exit(1);
}

process.exit(result.status || 0);
