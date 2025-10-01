# Changelog

## Version 2.2.1 - DEPLOYMENT FIX: Correct Supergateway Argument Passing

### Critical Deployment Fix

**Fixed Supergateway spawning that prevented the service from starting!**

The spawn command was passing the MCP server command as a single concatenated string instead of separate arguments. This caused Supergateway to fail to start, leading to port timeout errors and deployment failures.

**Changes:**
- ✅ **Fixed argument passing** - Use array spread to pass each arg separately
- ✅ **Increased startup timeout** - Back to 60s to allow for npm package downloads
- ✅ **Better error logging** - Show the actual command when spawn fails
- ✅ **Improved exit logging** - Distinguish error exits from clean exits

**Before (broken):**
```javascript
const cmd = `npx -y @supabase/mcp-server...`;  // Single string
supergateawayArgs = ['--stdio', cmd];  // ❌ Wrong!
```

**After (fixed):**
```javascript
supergateawayArgs = ['--stdio', 'npx', '-y', '@supabase/mcp-server...'];  // ✅ Correct!
```

## Version 2.2.0 - CRITICAL FIX: Enable n8n/MCP Client Connection

### Critical Bug Fix

**Fixed POST body proxying that prevented n8n and other MCP clients from connecting!**

The Express JSON middleware was consuming the request body stream before the proxy could forward it. This caused "socket hang up" errors when clients tried to send MCP protocol messages via POST to `/message` endpoints.

**Changes:**
- ✅ **Fixed JSON middleware scope** - Only parse JSON for `/health` and `/` endpoints
- ✅ **Let /message bodies stream through untouched** - Required for proper proxying
- ✅ **Improved proxy header handling** - Better host/connection header management
- ✅ **Enhanced POST request logging** - Log Content-Type and Content-Length
- ✅ **Better error handling** - Track request stream errors

**Impact:** n8n and other MCP clients can now successfully:
- Connect to SSE endpoints ✅
- Send POST requests to /message endpoints ✅
- Complete MCP initialize handshake ✅
- List and execute tools ✅

## Version 2.1.0 - Multiple MCP Gateway Improvements

### Fixed Issues

1. **Protocol Detection Fixed (HTTP vs HTTPS)**
   - The endpoints were showing `http://` instead of `https://` when accessed via Render
   - Added proper `X-Forwarded-Proto` header detection for reverse proxy scenarios
   - Now correctly detects HTTPS when behind Render's proxy
   - Applied to both `/health` and `/` endpoints

2. **Environment Variable Validation**
   - Added startup validation to warn about missing environment variables
   - Shows clear warnings for missing credentials (SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, GITHUB_TOKEN)
   - Helps catch configuration issues early before servers fail

3. **Improved Error Handling**
   - Enhanced proxy error messages with detailed error information
   - Added helpful context when backends fail (e.g., "may still be starting up")
   - Better error logging with error codes, syscall info, and port details

4. **Request Logging**
   - Added request logging middleware to track all incoming requests
   - Logs timestamp, method, path, and user-agent for debugging
   - Makes it easier to troubleshoot SSE connection issues

5. **Optimized Startup Performance**
   - Reduced port check timeout from 2000ms to 1000ms intervals
   - Reduced max attempts from 60 to 30 (faster failure detection)
   - Reduced socket timeout from 1000ms to 500ms
   - Overall faster startup time on Render

6. **Trust Proxy Configuration**
   - Added `app.set('trust proxy', true)` for proper Express behavior behind Render's proxy
   - Ensures `req.protocol` and other proxy-aware features work correctly

7. **Enhanced Health Check**
   - Added version number to health check response
   - Improved server status information
   - Shows running status for each configured server

8. **Better Startup Information**
   - Added summary of configured servers at startup
   - Shows number of servers and their ports
   - Makes configuration verification easier

### Current Status

✅ **The system is working correctly!** 

Testing shows:
- Both Supabase and GitHub MCP servers are running
- SSE endpoints are responding correctly
- Health check endpoint returns proper status
- Server info endpoint shows all configured servers
- All proxy routes are configured correctly

### Architecture Confirmation

The multi-MCP gateway architecture is functioning as designed:

```
Render Service (Port 8000)
│
├── Express Reverse Proxy (0.0.0.0:8000)
│   ├── /supabase/* → Supergateway Instance 1 (localhost:9001)
│   └── /github/* → Supergateway Instance 2 (localhost:9002)
│
└── Supergateway Processes
    ├── Port 9001: Supabase MCP Server
    └── Port 9002: GitHub MCP Server
```

### Usage

The service is live at: `https://mcp-gateway-hub.onrender.com`

**Available Endpoints:**
- Health: `https://mcp-gateway-hub.onrender.com/health`
- Server Info: `https://mcp-gateway-hub.onrender.com/`
- Supabase SSE: `https://mcp-gateway-hub.onrender.com/supabase/sse`
- Supabase Message: `https://mcp-gateway-hub.onrender.com/supabase/message`
- GitHub SSE: `https://mcp-gateway-hub.onrender.com/github/sse`
- GitHub Message: `https://mcp-gateway-hub.onrender.com/github/message`

### Next Steps

To add more MCP servers:
1. Add a new entry to the `MCP_SERVERS` array in `server.js`
2. Assign a unique port (9003, 9004, etc.)
3. Set required environment variables in Render
4. Commit and push - auto-deploy will handle the rest!

### References

- [Supergateway](https://github.com/supercorp-ai/supergateway) - The underlying gateway library
- [Render MCP Guide](https://dev.to/datitran/secure-mcp-server-with-nginx-supergateway-render-4i80) - Deployment guide

