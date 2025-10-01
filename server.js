const express = require('express');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

const PORT = process.env.PORT || 8000;

// Validate environment variables
function validateEnv() {
  const warnings = [];
  const errors = [];
  
  if (!process.env.SUPABASE_PROJECT_REF) {
    warnings.push('⚠️  SUPABASE_PROJECT_REF not set - Supabase server may not work correctly');
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    warnings.push('⚠️  SUPABASE_ACCESS_TOKEN not set - Supabase server may not work correctly');
  }
  if (!process.env.GITHUB_TOKEN) {
    warnings.push('⚠️  GITHUB_TOKEN not set - GitHub server may not work correctly');
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  Environment Variable Warnings:');
    warnings.forEach(w => console.log(`   ${w}`));
    console.log('');
  }
  
  return errors.length === 0;
}

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

// Validate environment variables
validateEnv();

// Show configured servers
console.log(`📋 Configured MCP Servers (${MCP_SERVERS.length}):`);
MCP_SERVERS.forEach(server => {
  console.log(`   • ${server.name} (port ${server.port})`);
});
console.log('');

// Store spawned processes
const processes = [];

// Helper function to check if a port is listening
function checkPort(port, maxAttempts = 60, interval = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const check = () => {
      attempts++;
      const socket = new net.Socket();
      
      socket.setTimeout(500);
      
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
        reject(new Error(`Port ${port} did not become available after ${maxAttempts} attempts (${maxAttempts * interval / 1000}s)`));
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
  const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const fullTargetPath = targetPath + queryString;
  
  console.log(`[${serverName}] Proxying ${req.method} ${req.path}${queryString} → http://localhost:${targetPort}${fullTargetPath}`);
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log(`[${serverName}] Content-Type: ${req.get('content-type')}, Content-Length: ${req.get('content-length')}`);
  }

  // Prepare headers - remove host and connection that need to be overridden
  const headers = {...req.headers};
  delete headers['host'];
  delete headers['connection'];
  
  const options = {
    hostname: 'localhost',
    port: targetPort,
    path: fullTargetPath,
    method: req.method,
    headers: {
      ...headers,
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
    console.error(`[${serverName}] Error details:`, {
      code: err.code,
      syscall: err.syscall,
      address: err.address,
      port: err.port
    });
    if (!res.headersSent) {
      res.status(502).json({ 
        error: 'Bad Gateway',
        server: serverName,
        message: err.message,
        details: 'The MCP server backend is not responding. It may still be starting up.'
      });
    } else {
      res.end();
    }
  });

  // Forward request body for POST/PUT
  if (req.method === 'POST' || req.method === 'PUT') {
    // Pipe the request body to the backend
    req.pipe(proxyReq);
    
    // Handle errors during piping
    req.on('error', (err) => {
      console.error(`[${serverName}] Request stream error:`, err.message);
      proxyReq.destroy();
    });
  } else {
    proxyReq.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[${serverName}] Client disconnected`);
    if (!proxyReq.destroyed) {
      proxyReq.destroy();
    }
  });
}

// Spawn Supergateway instance for each MCP server
MCP_SERVERS.forEach(server => {
  console.log(`📦 Starting ${server.name} MCP Server...`);
  console.log(`   Port: ${server.port}`);
  console.log(`   Command: ${server.command} ${server.args.join(' ')}`);
  
  // Build the MCP server command as a SINGLE string (required by --stdio flag)
  const mcpServerCmd = `${server.command} ${server.args.join(' ')}`;
  
  // CRITICAL: When using shell:true, must pass ENTIRE command as single string
  // Escape double quotes in the command to prevent injection
  const escapedCmd = mcpServerCmd.replace(/"/g, '\\"');
  
  // Properly quote the --stdio argument which contains spaces
  const fullCommand = `npx -y supergateway --stdio "${escapedCmd}" --port ${server.port} --baseUrl http://localhost:${server.port} --ssePath /sse --messagePath /message --cors --logLevel info`;

  console.log(`   Supergateway command: ${fullCommand}\n`);

  // CRITICAL: When using shell:true, pass command as first arg, empty array as second
  const proc = spawn('/bin/sh', ['-c', fullCommand], {
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
    console.error(`[${server.name}] Failed to start process: ${err.message}`);
    console.error(`[${server.name}] Command was: ${fullCommand}`);
  });

  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[${server.name}] Process exited with code ${code} and signal ${signal}`);
    } else {
      console.log(`[${server.name}] Process exited with code ${code} and signal ${signal}`);
    }
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

  // CRITICAL: Trust proxy for Render deployment
  app.set('trust proxy', true);

  // CRITICAL: Disable ALL automatic buffering in Express
  app.disable('view cache');
  app.disable('etag');
  app.disable('x-powered-by');

  // Request logging middleware
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.get('user-agent') || 'unknown'}`);
    next();
  });

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

  // Parse JSON ONLY for non-proxied endpoints (health, root)
  // DO NOT parse JSON for /message or /sse endpoints that need to be proxied
  app.use((req, res, next) => {
    // Only parse JSON for our own endpoints, not proxied ones
    if (req.path === '/health' || req.path === '/') {
      express.json()(req, res, next);
    } else {
      next();
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    // Fix protocol detection - Render uses X-Forwarded-Proto
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    
    // Check if backend ports are still listening
    const serverStatus = processes.map(({ name, port }) => {
      return {
        name,
        port,
        endpoint: `${protocol}://${req.get('host')}/${name}`,
        status: 'running' // Could be enhanced with actual health checks
      };
    });
    
    res.json({ 
      status: 'ok',
      version: '2.2.3',
      servers: serverStatus
    });
  });

  // Root endpoint with server info
  app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    // Fix protocol detection - Render uses X-Forwarded-Proto
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const baseUrl = `${protocol}://${req.get('host')}`;
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
