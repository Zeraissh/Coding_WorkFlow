/**
 * Standalone Dashboard launcher — starts only the web UI server
 * without requiring an API key or launching the full CLI.
 *
 * Usage: npx tsx start_dashboard.ts [port]
 */

import { startServer } from './src/server/index.js';

const port = parseInt(process.argv[2] || '3000', 10);

startServer(port);

console.log(`\n✅  Dashboard is running at  http://localhost:${port}\n`);
console.log('   Open the URL above in your browser.\n');
console.log('   Press Ctrl+C to stop the server.\n');

// Keep the process alive
process.stdin.resume();
