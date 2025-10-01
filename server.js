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

// FIXED: Proper SSE proxy with full CORS support
function proxySSE(serverName, targetPort, req, res) {
  const targetPath = req.path.replace(`/${serverName}`, '');
  
  console.log(`[${serverName}] Proxying ${req.method} ${req.path} → http://localhost:${targetPort}${targetPath}`);

  const options = {
    hostname: 'localhost',
    port: targetPort,
    path: targetPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''),
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${targetPort}`,
      connection: 'keep-alive'
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    console.log(`[${serverName}] Backend responded with status: ${proxyRes.statusCode}`);

    // CRITICAL: Preserve ALL headers from backend including CORS
    const headers = { ...proxyRes.headers };

    // Ensure CORS headers are present (Supergateway should send these, but ensure they're there)
    if (!headers['access-control-allow-origin']) {
      headers['access-control-allow-origin'] = '*';
    }
    if (!headers['access-control-allow-methods']) {
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    }
    if (!headers['access-control-allow-headers']) {
      headers['access-control-allow-headers'] = 'Content-Type, Authorization, Accept';
    }
    
    // Add additional SSE-specific headers
    headers['cache-control'] = 'no-cache, no-transform';
    headers['connection'] = 'keep-alive';
    headers['x-accel-buffering'] = 'no';

    // If this is an SSE endpoint, ensure proper Content-Type
    if (req.path.endsWith('/sse') && !headers['content-type']) {
      headers['content-type'] = 'text/event-stream';
    }

    // Write headers from backend response
    res.writeHead(proxyRes.statusCode, headers);

    // CRITICAL: Disable TCP buffering at socket level
    if (res.socket) {
      res.socket.setNoDelay(true);
      res.socket.setKeepAlive(true);
    }

    // CRITICAL: Forward each chunk immediately as it arrives
    proxyRes.on('data', (chunk) => {
      try {
        res.write(chunk);
        // Force flush if available
        if (res.flush) res.flush();
      } catch (err) {
        console.error(`[${serverName}] Error writing chunk:`, err.message);
      }
    });

    proxyRes.on('end', () => {
      console.log(`[${serverName}] Backend connection ended`);
      res.end();
    });

    proxyRes.on('error', (err) => {
      console.error(`[${serverName}] Backend stream error:`, err.message);
      res.end();
    });
  });

  // Handle proxy request errors
  proxyReq.on('error', (err) => {
    console.error(`[${serverName}] Proxy request error:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ 
        error: 'Bad Gateway',
        server: serverName,
        message: err.message 
      });
    } else {
      res.end();
    }
  });

  // Forward request body for POST/PUT
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

  // CRITICAL: Disable ALL automatic buffering in Express
  app.disable('view cache');
  app.disable('etag');
  app.disable('x-powered-by');

  // CRITICAL: Global CORS middleware for ALL requests
  app.use((req, res, next) => {
    // Handle OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
      res.header('Access-Control-Max-Age', '86400'); // 24 hours
      return res.status(200).end();
    }
    next();
  });

  // Parse JSON for non-SSE requests only
  app.use((req, res, next) => {
    if (!req.path.endsWith('/sse')) {
      express.json()(req, res, next);
    } else {
      next();
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
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
    res.header('Access-Control-Allow-Origin', '*');
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

  // CRITICAL: Disable server timeouts for long-lived SSE connections
  httpServer.setTimeout(0);
  httpServer.keepAliveTimeout = 0;
  httpServer.headersTimeout = 0;

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
