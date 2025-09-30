const express = require('express');
const { spawn } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
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

// Check if a port is listening
function checkPort(port, callback) {
  const options = {
    host: 'localhost',
    port: port,
    path: '/sse',
    method: 'GET',
    timeout: 1000
  };

  const req = http.request(options, (res) => {
    callback(true);
    req.abort();
  });

  req.on('error', () => {
    callback(false);
  });

  req.on('timeout', () => {
    callback(false);
    req.abort();
  });

  req.end();
}

// Update server status
function updateServerStatus(serverName, port) {
  const serverIndex = servers.findIndex(s => s.name === serverName);
  if (serverIndex === -1) return;

  checkPort(port, (isRunning) => {
    servers[serverIndex].status = isRunning ? 'ready' : 'starting';
    if (isRunning) {
      console.log(`[${serverName}] Status: READY ✓`);
    }
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
    const output = data.toString().trim();
    console.log(`[${config.name}] ${output}`);
    
    // Check if server is ready
    if (output.includes('Listening on port') || output.includes('SSE endpoint')) {
      setTimeout(() => updateServerStatus(config.name, config.port), 2000);
    }
  });

  proc.stderr.on('data', (data) => {
    console.error(`[${config.name}] ERROR: ${data.toString().trim()}`);
  });

  proc.on('close', (code) => {
    console.log(`[${config.name}] Process exited with code ${code}`);
    const serverIndex = servers.findIndex(s => s.name === config.name);
    if (serverIndex !== -1) {
      servers[serverIndex].status = 'stopped';
    }
  });

  proc.on('error', (err) => {
    console.error(`[${config.name}] Failed to start: ${err.message}`);
    const serverIndex = servers.findIndex(s => s.name === config.name);
    if (serverIndex !== -1) {
      servers[serverIndex].status = 'error';
    }
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

  // Check status periodically
  const statusInterval = setInterval(() => {
    updateServerStatus(config.name, config.port);
  }, 10000); // Check every 10 seconds

  // Store interval for cleanup
  processes[processes.length - 1].statusInterval = statusInterval;
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
    onProxyReq: (proxyReq, req, res) => {
      // Update status on successful proxy
      updateServerStatus(config.name, config.port);
    },
    onError: (err, req, res) => {
      console.error(`[${config.name}] Proxy error:`, err.message);
      const serverIndex = servers.findIndex(s => s.name === config.name);
      if (serverIndex !== -1) {
        servers[serverIndex].status = 'error';
      }
      res.status(503).json({ error: 'MCP server not ready', details: err.message });
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
      res.status(503).json({ error: 'MCP server not ready', details: err.message });
    }
  }));

  console.log(`Proxy routes configured for ${config.name}:`);
  console.log(`  - /${config.name}/sse -> ${target}/sse`);
  console.log(`  - /${config.name}/message -> ${target}/message`);
}

// Status endpoint
app.get('/', (req, res) => {
  const host = req.get('host') || `localhost:${MAIN_PORT}`;
  // Force HTTPS for onrender.com domains
  const protocol = host.includes('onrender.com') ? 'https' : req.protocol;
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
  const readyServers = servers.filter(s => s.status === 'ready').length;
  const allReady = servers.length > 0 && readyServers === servers.length;
  
  res.json({ 
    status: allReady ? 'ready' : 'starting',
    servers: servers.length,
    ready: readyServers,
    details: servers.map(s => ({ name: s.name, status: s.status }))
  });
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
  processes.forEach(({ config, proc, statusInterval }) => {
    console.log(`Stopping ${config.name}...`);
    if (statusInterval) clearInterval(statusInterval);
    proc.kill();
  });
  process.exit(0);
});
