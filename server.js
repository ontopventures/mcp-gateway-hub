const express = require('express');
const { spawn } = require('child_process');
const app = express();

// Parse MCP server configurations from environment variables
// Format: MCP_SERVERS=supabase:8001:npx @modelcontextprotocol/server-supabase,fetch:8002:npx mcp-server-fetch
const MCP_SERVERS = process.env.MCP_SERVERS || 'supabase:8001:npx @modelcontextprotocol/server-supabase';
const MAIN_PORT = process.env.PORT || 8000;

const servers = [];
const processes = [];

// Parse server configurations
function parseServers() {
  return MCP_SERVERS.split(',').map(config => {
    const [name, port, command] = config.split(':');
    return {
      name: name.trim(),
      port: parseInt(port.trim()),
      command: command.trim()
    };
  });
}

// Start a Supergateway instance for each MCP server
function startMcpServer(config) {
  console.log(`Starting MCP server: ${config.name} on port ${config.port}`);
  console.log(`Command: ${config.command}`);

  const args = [
    '-y',
    'supergateway',
    '--stdio',
    config.command,
    '--port',
    config.port.toString(),
    '--cors',
    '--logLevel',
    'info'
  ];

  const proc = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  proc.stdout.on('data', (data) => {
    console.log(`[${config.name}] ${data.toString().trim()}`);
  });

  proc.stderr.on('data', (data) => {
    console.error(`[${config.name}] ERROR: ${data.toString().trim()}`);
  });

  proc.on('close', (code) => {
    console.log(`[${config.name}] Process exited with code ${code}`);
  });

  proc.on('error', (err) => {
    console.error(`[${config.name}] Failed to start: ${err.message}`);
  });

  processes.push({ config, proc });
  servers.push({
    name: config.name,
    port: config.port,
    sseUrl: `http://localhost:${config.port}/sse`,
    messageUrl: `http://localhost:${config.port}/message`,
    status: 'starting'
  });
}

// Status endpoint
app.get('/', (req, res) => {
  const host = req.get('host') || `localhost:${MAIN_PORT}`;
  const protocol = req.protocol;
  
  const serverList = servers.map(s => ({
    name: s.name,
    port: s.port,
    sseUrl: `${protocol}://${host.split(':')[0]}:${s.port}/sse`,
    messageUrl: `${protocol}://${host.split(':')[0]}:${s.port}/message`,
    status: s.status
  }));

  res.json({
    message: 'MCP Gateway Hub',
    servers: serverList,
    documentation: 'https://github.com/supercorp-ai/supergateway'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servers: servers.length });
});

// Start all configured MCP servers
const serverConfigs = parseServers();
console.log(`Configuring ${serverConfigs.length} MCP server(s)...`);

serverConfigs.forEach(config => {
  startMcpServer(config);
});

// Start the status server
app.listen(MAIN_PORT, () => {
  console.log(`\n=================================`);
  console.log(`MCP Gateway Hub running on port ${MAIN_PORT}`);
  console.log(`Status endpoint: http://localhost:${MAIN_PORT}`);
  console.log(`=================================\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  processes.forEach(({ config, proc }) => {
    console.log(`Stopping ${config.name}...`);
    proc.kill();
  });
  process.exit(0);
});
