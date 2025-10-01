const express = require('express');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

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

// Helper function to check if a port is listening
function checkPort(port, maxAttempts = 60, interval = 2000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const check = () => {
      attempts++;
      const socket = new net.Socket();
      
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        retry();
      });
      
      socket.on('error', (err) => {
        socket.destroy();
        retry();
      });
      
      socket.connect(port, '127.0.0.1');
    };
    
    const retry = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`Port ${port} did not become available after ${maxAttempts} attempts`));
      } else {
        setTimeout(check, interval);
      }
    };
    
    check();
  });
}

// Manual SSE proxy function
function proxySSE(serverName, targetPort, req, res) {
  // Remove the server name prefix from the path
  const targetPath = req.path.replace(`/${serverName}`, '');
  
  console.log(`[${serverName}] Proxying ${req.method} ${req.path} → http://localhost:${targetPort}${targetPath}`);

  const options = {
    hostname: 'localhost',
    port: targetPort,
    path: targetPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''),
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${targetPort}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Set SSE headers
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Stream the response directly
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.error(`[${serverName}] Proxy response error:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ 
          error: 'Bad Gateway',
          server: serverName,
          message: err.message 
        });
      }
    });
  });

  // Handle request errors
  proxyReq.on('error', (err) => {
    console.error(`[${serverName}] Proxy request error:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ 
        error: 'Bad Gateway',
        server: serverName,
        message: err.message 
      });
    }
  });

  // Forward request body if present
  if (req.method === 'POST' || req.method === 'PUT') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[${serverName}] Client disconnected`);
    proxyReq.destroy();
  });
}

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
      // Don't log "running on stdio" messages as errors
      if (line.includes('running on stdio')) {
        console.log(`[${server.name}] ${line}`);
      } else {
        console.error(`[${server.name}] ${line}`);
      }
    });
  });

  proc.on('error', (err) => {
    console.error(`[${server.name}] Failed to start: ${err.message}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[${server.name}] Exited with code ${code} and signal ${signal}`);
  });

  processes.push({ name: server.name, process: proc, port: server.port });
});

// Wait for all Supergateway instances to be listening
console.log('\n⏳ Waiting for all Supergateway instances to start...\n');

Promise.all(
  processes.map(({ name, port }) => {
    console.log(`   Checking ${name} on port ${port}...`);
    return checkPort(port)
      .then(() => {
        console.log(`   ✅ ${name} is ready on port ${port}`);
      })
      .catch(err => {
        console.error(`   ❌ ${name} failed to start: ${err.message}`);
        throw err;
      });
  })
).then(() => {
  console.log('\n🌐 All Supergateway instances are ready! Starting Express Reverse Proxy...\n');

  const app = express();

  // Disable Express's view cache
  app.disable('view cache');
  
  // Disable etag for SSE responses
  app.disable('etag');

  // Parse JSON for non-SSE requests
  app.use((req, res, next) => {
    if (!req.path.endsWith('/sse')) {
      express.json()(req, res, next);
    } else {
      next();
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok',
      servers: MCP_SERVERS.map(s => ({
        name: s.name,
        endpoint: `${req.protocol}://${req.get('host')}/${s.name}`
      }))
    });
  });

  // Root endpoint with server info
  app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      name: 'MCP Gateway Hub',
      description: 'Multiple MCP servers via Supergateway',
      servers: MCP_SERVERS.map(s => ({
        name: s.name,
        sse: `${baseUrl}/${s.name}/sse`,
        message: `${baseUrl}/${s.name}/message`
      }))
    });
  });

  // Create routes for each MCP server using manual SSE proxy
  MCP_SERVERS.forEach(server => {
    // Route all requests for this server through our manual proxy
    app.all(`/${server.name}/*`, (req, res) => {
      proxySSE(server.name, server.port, req, res);
    });
    
    console.log(`✅ Proxy route configured: /${server.name}/* → http://localhost:${server.port}`);
  });

  // Start Express server
  const httpServer = app.listen(PORT, '0.0.0.0', () => {
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

  // Increase timeout for SSE connections
  httpServer.setTimeout(0); // No timeout
  httpServer.keepAliveTimeout = 0; // Keep connections alive indefinitely

}).catch(err => {
  console.error('\n❌ Failed to start MCP Gateway Hub:', err.message);
  console.error('   Shutting down...\n');
  processes.forEach(({ name, process }) => {
    console.log(`   Stopping ${name}...`);
    process.kill('SIGTERM');
  });
  process.exit(1);
});

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
