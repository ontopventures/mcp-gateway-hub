const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8000;

// Configuration for MCP servers
const MCP_SERVERS = [
  {
    name: 'supabase',
    port: 9001,
    command: 'npx',
    args: [
      '-y',
      '@supabase/mcp-server-supabase',
      '--read-only',
      `--project-ref=${process.env.SUPABASE_PROJECT_REF || ''}`
    ],
    env: {
      SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN
    }
  },
  {
    name: 'github',
    port: 9002,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN
    }
  }
  // Add more servers here following the same pattern
];

console.log('🚀 Starting MCP Gateway Hub with Multiple Supergateway Instances\n');

// Store spawned processes
const processes = [];

// Spawn Supergateway instance for each MCP server
MCP_SERVERS.forEach(server => {
  console.log(`📦 Starting ${server.name} MCP Server...`);
  console.log(`   Port: ${server.port}`);
  console.log(`   Command: ${server.command} ${server.args.join(' ')}`);
  
  // Build the full command for Supergateway
  const supergatewayCmdString = `${server.command} ${server.args.join(' ')}`;
  
  const supergateawayArgs = [
    '-y',
    'supergateway',
    '--stdio',
    supergatewayCmdString,
    '--port',
    server.port.toString(),
    '--baseUrl',
    `http://localhost:${server.port}`,
    '--ssePath',
    '/sse',
    '--messagePath',
    '/message',
    '--cors',
    '--logLevel',
    'info'
  ];

  console.log(`   Supergateway: npx ${supergateawayArgs.join(' ')}\n`);

  const proc = spawn('npx', supergateawayArgs, {
    env: {
      ...process.env,
      ...server.env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Prefix logs with server name
  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      console.log(`[${server.name}] ${line}`);
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      console.error(`[${server.name}] ERROR: ${line}`);
    });
  });

  proc.on('error', (err) => {
    console.error(`[${server.name}] Failed to start: ${err.message}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[${server.name}] Exited with code ${code} and signal ${signal}`);
  });

  processes.push({ name: server.name, process: proc });
});

// Give Supergateway instances time to start
setTimeout(() => {
  console.log('\n🌐 Starting Express Reverse Proxy...\n');

  const app = express();

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok',
      servers: MCP_SERVERS.map(s => ({
        name: s.name,
        endpoint: `http://localhost:${PORT}/${s.name}`
      }))
    });
  });

  // Root endpoint with server info
  app.get('/', (req, res) => {
    res.json({
      name: 'MCP Gateway Hub',
      description: 'Multiple MCP servers via Supergateway',
      servers: MCP_SERVERS.map(s => ({
        name: s.name,
        sse: `http://localhost:${PORT}/${s.name}/sse`,
        message: `http://localhost:${PORT}/${s.name}/message`
      }))
    });
  });

  // Create proxy middleware for each MCP server
  MCP_SERVERS.forEach(server => {
    const proxyOptions = {
      target: `http://localhost:${server.port}`,
      changeOrigin: true,
      ws: false, // Supergateway uses SSE, not WebSockets
      pathRewrite: (path) => {
        // Remove the server name prefix from the path
        // e.g., /supabase/sse -> /sse
        return path.replace(`/${server.name}`, '');
      },
      onProxyReq: (proxyReq, req, res) => {
        // Disable buffering for SSE
        proxyReq.setHeader('X-Accel-Buffering', 'no');
      },
      onProxyRes: (proxyRes, req, res) => {
        // Ensure proper SSE headers
        if (req.path.endsWith('/sse')) {
          proxyRes.headers['content-type'] = 'text/event-stream';
          proxyRes.headers['cache-control'] = 'no-cache';
          proxyRes.headers['connection'] = 'keep-alive';
          proxyRes.headers['x-accel-buffering'] = 'no';
        }
      },
      onError: (err, req, res) => {
        console.error(`[${server.name}] Proxy error:`, err.message);
        res.status(502).json({ 
          error: 'Bad Gateway',
          server: server.name,
          message: err.message 
        });
      },
      logLevel: 'silent' // We handle logging ourselves
    };

    const proxy = createProxyMiddleware(proxyOptions);
    app.use(`/${server.name}`, proxy);
    
    console.log(`✅ Proxy route configured: /${server.name}/* → http://localhost:${server.port}`);
  });

  // Start Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎉 MCP Gateway Hub is running!`);
    console.log(`\n📍 Endpoints:`);
    console.log(`   Health Check: http://localhost:${PORT}/health`);
    console.log(`   Server List: http://localhost:${PORT}/`);
    console.log(`\n🔌 MCP Server Endpoints:`);
    
    MCP_SERVERS.forEach(server => {
      console.log(`\n   ${server.name.toUpperCase()}:`);
      console.log(`      SSE: http://localhost:${PORT}/${server.name}/sse`);
      console.log(`      Message: http://localhost:${PORT}/${server.name}/message`);
    });
    
    console.log(`\n💡 To add more MCP servers, edit the MCP_SERVERS array in server.js\n`);
  });

}, 3000); // Wait 3 seconds for Supergateway instances to start

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  processes.forEach(({ name, process }) => {
    console.log(`   Stopping ${name}...`);
    process.kill('SIGTERM');
  });
  
  setTimeout(() => {
    console.log('✅ All processes stopped');
    process.exit(0);
  }, 2000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  shutdown('ERROR');
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  shutdown('ERROR');
});
