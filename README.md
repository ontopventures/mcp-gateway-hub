# MCP Gateway Hub

A multi-MCP server gateway built on [Supergateway](https://github.com/supercorp-ai/supergateway). Host multiple MCP servers on different ports with a single deployment.

## Features

- 🚀 Host multiple MCP servers simultaneously
- 🔧 Easy configuration via environment variables
- 🌐 CORS enabled for web access
- 📊 Status endpoint showing all available servers
- 🐳 Docker support
- ☁️ Ready for Render deployment

## Quick Start

### Environment Variables

Configure your MCP servers using the `MCP_SERVERS` environment variable:

```bash
MCP_SERVERS=name:port:command,name:port:command
```

**Example:**
```bash
MCP_SERVERS=supabase:8001:npx @modelcontextprotocol/server-supabase,fetch:8002:npx mcp-server-fetch
```

### Local Development

```bash
# Install dependencies
npm install

# Set your MCP servers
export MCP_SERVERS="supabase:8001:npx @modelcontextprotocol/server-supabase"

# Start the server
npm start
```

Visit `http://localhost:8000` to see the status page with all available MCP servers.

### Docker

```bash
# Build the image
docker build -t mcp-gateway-hub .

# Run with configuration
docker run -p 8000:8000 -p 8001:8001 \
  -e MCP_SERVERS="supabase:8001:npx @modelcontextprotocol/server-supabase" \
  mcp-gateway-hub
```

## Adding More MCP Servers

Simply update the `MCP_SERVERS` environment variable:

```bash
export MCP_SERVERS="supabase:8001:npx @modelcontextprotocol/server-supabase,fetch:8002:npx mcp-server-fetch,git:8003:uvx mcp-server-git"
```

## Connecting to Your MCP Servers

Each MCP server exposes two endpoints:

- **SSE Endpoint**: `http://your-domain:PORT/sse` (subscribe to events)
- **Message Endpoint**: `http://your-domain:PORT/message` (send messages)

### Example with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "supergateway",
        "--sse",
        "https://your-app.onrender.com:8001/sse"
      ]
    }
  }
}
```

## Deploy to Render

1. Fork this repository
2. Create a new Web Service on Render
3. Connect your forked repository
4. Set environment variables:
   - `MCP_SERVERS=supabase:8001:npx @modelcontextprotocol/server-supabase`
5. Deploy!

Render will automatically detect the Dockerfile and deploy.

## Status Endpoint

The main port (8000 by default) provides a status endpoint:

```bash
curl http://your-app.onrender.com:8000
```

Response:
```json
{
  "message": "MCP Gateway Hub",
  "servers": [
    {
      "name": "supabase",
      "port": 8001,
      "sseUrl": "http://your-app.onrender.com:8001/sse",
      "messageUrl": "http://your-app.onrender.com:8001/message",
      "status": "running"
    }
  ]
}
```

## Common MCP Servers

```bash
# Supabase
supabase:8001:npx @modelcontextprotocol/server-supabase

# Filesystem
filesystem:8002:npx @modelcontextprotocol/server-filesystem /path

# Fetch (web scraping)
fetch:8003:npx mcp-server-fetch

# Git
git:8004:uvx mcp-server-git

# PostgreSQL
postgres:8005:npx @modelcontextprotocol/server-postgres
```

## License

MIT
