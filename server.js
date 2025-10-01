// Simple wrapper to run Supergateway directly
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8000;
const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';

console.log('Starting Supergateway for Supabase MCP...');
console.log(`Port: ${PORT}`);
console.log(`Project Ref: ${SUPABASE_PROJECT_REF}`);
console.log(`Access Token: ${SUPABASE_ACCESS_TOKEN ? 'Set ✓' : 'MISSING ✗'}`);

// Run Supergateway directly
const args = [
  '-y',
  'supergateway',
  '--stdio',
  `npx -y @supabase/mcp-server-supabase --read-only --project-ref=${SUPABASE_PROJECT_REF}`,
  '--port',
  PORT.toString(),
  '--cors',
  '--logLevel',
  'info'
];

console.log('\nStarting Supergateway with command:');
console.log(`npx ${args.join(' ')}\n`);

const proc = spawn('npx', args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    SUPABASE_ACCESS_TOKEN // Ensure token is passed to child process
  }
});

proc.on('error', (err) => {
  console.error('Failed to start Supergateway:', err);
  process.exit(1);
});

proc.on('exit', (code, signal) => {
  console.log(`Supergateway exited with code ${code} and signal ${signal}`);
  process.exit(code || 0);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  proc.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  proc.kill('SIGINT');
});
