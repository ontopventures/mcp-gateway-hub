const express = require('express');
const { spawn } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();

// Parse MCP server configurations from environment variables
// Format: MCP_SERVERS=supabase:npx -y @supabase/mcp-server-supabase --read-only --project-ref=${SUPABASE_PROJECT_REF}
const MCP_SERVERS = process.env.MCP_SERVERS || `supabase:npx -y @supabase/mcp-server-supabase --read-only --project-ref=${process.env.SUPABASE_PROJECT_REF || ''}`;
const MAIN_PORT = process.env.PORT || 8000;
const BASE_INTERNAL_PORT = 9000; // Internal ports start here

const servers = [];
const processes = [];
let portCounter = 0;

// Parse server configurations
function parseServers() {
  return MCP_SERVERS.split(',').map(config => {
    const colonIndex = config.indexOf(':');
    const name = config.substring(0, colonIndex).trim();
    const command = config.substring(colonIndex + 1).trim();
    return {
      name,
      command,
      port: BASE_INTERNAL_PORT + portCounter++
    };
  });
}

// Start a Supergateway instance for each MCP server
function startMcpServer(config) {
  console.log(`Starting MCP server: ${config.name} on internal port ${config.port}`);
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
  
  // Setup proxy routes for this MCP server
  setupProxyRoutes(config);
  
  servers.push({
    name: config.name,
    port: config.port,
    path: `/${config.name}`,
    status: 'starting'
  });
}

// Setup proxy routes for an MCP server
function setupProxyRoutes(config) {
  const target = `http://localhost:${config.port}`;
  
  // Proxy SSE endpoint
  app.use(`/${config.name}/sse`, createProxyMiddleware({
    target,
    pathRewrite: { [`^/${config.name}/sse`]: '/sse' },
    changeOrigin: true,
    ws: false,
    onError: (err, req, res) => {
      console.error(`[${config.name}] Proxy error:`, err.message);
      res.status(500).json({ error: 'MCP server not ready' });
    }
  }));
  
  // Proxy message endpoint
  app.use(`/${config.name}/message`, createProxyMiddleware({
    target,
    pathRewrite: { [`^/${config.name}/message`]: '/message' },
    changeOrigin: true,
    ws: false,
    onError: (err, req, res) => {
      console.error(`[${config.name}] Proxy error:`, err.message);
      res.status(500).json({ error: 'MCP server not ready' });
    }
  }));

  console.log(`Proxy routes configured for ${config.name}:`);
  console.log(`  - /${config.name}/sse -> ${target}/sse`);
  console.log(`  - /${config.name}/message -> ${target}/message`);
}

// Status endpoint
app.get('/', (req, res) => {
  const host = req.get('host') || `localhost:${MAIN_PORT}`;
  const protocol = req.protocol;
  const baseUrl = `${protocol}://${host}`;
  
  const serverList = servers.map(s => ({
    name: s.name,
    sseUrl: `${baseUrl}/${s.name}/sse`,
    messageUrl: `${baseUrl}/${s.name}/message`,
    status: s.status
  }));

  res.json({
    message: 'MCP Gateway Hub',
    servers: serverList,
    usage: {
      claudeDesktop: `Add this to your claude_desktop_config.json:\n\n${JSON.stringify({
        mcpServers: Object.fromEntries(serverList.map(s => [
          s.name,
          {
            command: 'npx',
            args: ['-y', 'supergateway', '--sse', s.sseUrl]
          }
        ]))
      }, null, 2)}`
    },
    documentation: 'https://github.com/supercorp-ai/supergateway'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servers: servers.length });
});

// Parse and start all configured MCP servers
const serverConfigs = parseServers();
console.log(`\nConfiguring ${serverConfigs.length} MCP server(s)...\n`);

serverConfigs.forEach(config => {
  startMcpServer(config);
});

// Start the main server
app.listen(MAIN_PORT, () => {
  console.log(`\n=================================`);
  console.log(`MCP Gateway Hub running on port ${MAIN_PORT}`);
  console.log(`Status endpoint: http://localhost:${MAIN_PORT}`);
  console.log(`=================================`);
  console.log(`\nAvailable MCP servers:`);
  servers.forEach(s => {
    console.log(`  - ${s.name}: http://localhost:${MAIN_PORT}/${s.name}/sse`);
  });
  console.log(`\n`);
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
