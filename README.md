# MCP Gateway Hub

A multi-MCP server gateway built on [Supergateway](https://github.com/supercorp-ai/supergateway). Host multiple MCP servers with a single deployment through one port.

## Features

- 🚀 Host multiple MCP servers simultaneously
- 🔧 Easy configuration via environment variables
- 🌐 Single-port architecture (perfect for Render, Railway, etc.)
- 🔄 Automatic reverse proxy routing
- 📊 Status endpoint showing all available servers
- 🐳 Docker support
- ☁️ Ready for Render deployment

## Architecture

All MCP servers are accessible through a single port with path-based routing:

```
https://your-app.onrender.com/supabase/sse    -> Supabase MCP SSE endpoint
https://your-app.onrender.com/supabase/message -> Supabase MCP message endpoint
https://your-app.onrender.com/fetch/sse        -> Fetch MCP SSE endpoint
https://your-app.onrender.com/fetch/message    -> Fetch MCP message endpoint
```

## Quick Start

### Environment Variables

Configure your MCP servers using the `MCP_SERVERS` environment variable:

```bash
MCP_SERVERS=name:command,name:command
```

**Examples:**
```bash
# Single server
MCP_SERVERS=supabase:npx @modelcontextprotocol/server-supabase

# Multiple servers
MCP_SERVERS=supabase:npx @modelcontextprotocol/server-supabase,fetch:npx mcp-server-fetch,git:uvx mcp-server-git
```

### Local Development

```bash
# Install dependencies
npm install

# Set your MCP servers
export MCP_SERVERS="supabase:npx @modelcontextprotocol/server-supabase"

# Start the server
npm start
```

Visit `http://localhost:8000` to see the status page with all available MCP servers.

### Docker

```bash
# Build the image
docker build -t mcp-gateway-hub .

# Run with configuration
docker run -p 8000:8000 \
  -e MCP_SERVERS="supabase:npx @modelcontextprotocol/server-supabase" \
  mcp-gateway-hub
```

## Adding More MCP Servers

Simply update the `MCP_SERVERS` environment variable:

```bash
export MCP_SERVERS="supabase:npx @modelcontextprotocol/server-supabase,fetch:npx mcp-server-fetch,git:uvx mcp-server-git"
```

Restart your service and the new MCP servers will be available automatically.

## Connecting to Your MCP Servers

Each MCP server exposes two endpoints through the main domain:

- **SSE Endpoint**: `https://your-domain/{server-name}/sse`
- **Message Endpoint**: `https://your-domain/{server-name}/message`

### Example with Claude Desktop

Visit your deployed app's root URL to get the exact configuration. It will show:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "supergateway",
        "--sse",
        "https://your-app.onrender.com/supabase/sse"
      ]
    }
  }
}
```

Copy this into your `claude_desktop_config.json`.

## Deploy to Render

### Option 1: Fork and Deploy
1. Fork this repository
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Create a new Web Service
4. Connect your forked repository
5. Set environment variables:
   - `MCP_SERVERS=supabase:npx @modelcontextprotocol/server-supabase`
6. Click "Create Web Service"

### Option 2: Deploy from this repo
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Create a new Web Service
3. Connect this repository: `https://github.com/ontopventures/mcp-gateway-hub`
4. Set environment variables
5. Deploy!

## Status Endpoint

The root URL provides a status endpoint with configuration examples:

```bash
curl https://your-app.onrender.com
```

Response includes:
- List of all running MCP servers
- Their SSE and message URLs
- Example Claude Desktop configuration
- Documentation links

## Common MCP Servers

```bash
# Supabase
supabase:npx @modelcontextprotocol/server-supabase

# Filesystem
filesystem:npx @modelcontextprotocol/server-filesystem /path

# Fetch (web scraping)
fetch:npx mcp-server-fetch

# Git
git:uvx mcp-server-git

# PostgreSQL
postgres:npx @modelcontextprotocol/server-postgres

# Memory (for AI context)
memory:npx @modelcontextprotocol/server-memory
```

## Environment Variables for MCP Servers

If your MCP servers need additional configuration (API keys, URLs, etc.), add them as environment variables:

```bash
# For Supabase MCP
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key

# For other servers
OPENAI_API_KEY=your-key
POSTGRES_CONNECTION_STRING=postgresql://...
```

## Troubleshooting

### Server not responding
- Check Render logs for errors
- Ensure MCP_SERVERS environment variable is set correctly
- Verify the MCP server command is valid

### Connection refused
- The MCP servers need a few seconds to start
- Check the status endpoint to see if servers are ready

### Command not found errors
- Some MCP servers require `uvx` instead of `npx`
- Check the MCP server's documentation for the correct command

## Contributing

Pull requests welcome! Feel free to:
- Add support for more MCP servers
- Improve error handling
- Add health check endpoints
- Enhance documentation

## License

MIT

## Credits

Built with [Supergateway](https://github.com/supercorp-ai/supergateway) by Supercorp.
