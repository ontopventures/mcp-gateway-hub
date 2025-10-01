# MCP Gateway Hub

A multi-MCP server gateway built on [mcp-gateway](https://github.com/acehoss/mcp-gateway). Host multiple MCP servers with a single deployment through one port.

## Features

- 🚀 Host multiple MCP servers simultaneously
- 🔧 Easy YAML configuration
- 🌐 Single-port architecture (perfect for Render, Railway, etc.)
- 🔄 Path-based routing (`/supabase`, `/git`, `/github`, etc.)
- 📊 Session management for multiple clients
- 🐳 Docker support
- 🔐 Optional authentication (Bearer tokens or Basic Auth)
- ☁️ Ready for Render deployment

## Architecture

All MCP servers are accessible through a single port with path-based routing:

```
https://your-app.onrender.com/supabase    -> Supabase MCP Server
https://your-app.onrender.com/git         -> Git MCP Server
https://your-app.onrender.com/github      -> GitHub MCP Server
```

Each server maintains its own SSE connection at `/{server-name}/sse` and message endpoint at `/{server-name}/message`.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Set environment variables
export SUPABASE_PROJECT_REF=your-project-ref
export SUPABASE_ACCESS_TOKEN=your-access-token

# Start the gateway
npm start
```

Visit `http://localhost:8000` to see the gateway status.

### Deploy to Render

1. Fork this repository
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Create a new Web Service
4. Connect your forked repository
5. Set environment variables:
   - `SUPABASE_PROJECT_REF` - Your Supabase project reference ID
   - `SUPABASE_ACCESS_TOKEN` - Your Supabase personal access token
   - Add any other tokens for additional MCP servers
6. Click "Create Web Service"

## Configuration

Edit `config.yaml` to configure your MCP servers:

```yaml
hostname: "0.0.0.0"
port: ${PORT:-8000}

servers:
  supabase:
    command: npx
    args:
      - -y
      - "@supabase/mcp-server-supabase"
      - "--read-only"
      - "--project-ref=${SUPABASE_PROJECT_REF}"
    env:
      SUPABASE_ACCESS_TOKEN: "${SUPABASE_ACCESS_TOKEN}"
  
  github:
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

## Adding More MCP Servers

1. Edit `config.yaml` and add your server under the `servers` section
2. Add required environment variables to Render
3. Redeploy (automatic if auto-deploy is enabled)

### Popular MCP Servers

```yaml
# Filesystem access
filesystem:
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-filesystem"
    - "/tmp"

# Git repository access
git:
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-git"

# PostgreSQL database
postgres:
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-postgres"
  env:
    POSTGRES_CONNECTION_STRING: "${POSTGRES_CONNECTION_STRING}"

# Web scraping
fetch:
  command: npx
  args:
    - -y
    - "mcp-server-fetch"
```

Browse more at [MCP Servers Directory](https://github.com/modelcontextprotocol/servers)

## Using with n8n

In your n8n MCP Client node:

- **Endpoint**: `https://your-app.onrender.com/supabase` (or any other server name)
- **Authentication**: None (unless you enable it in config)
- **Tools to Include**: All

## Using with Claude Desktop

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "supergateway",
        "--sse",
        "https://your-app.onrender.com/supabase"
      ]
    }
  }
}
```

## Authentication (Optional)

To secure your gateway, uncomment the auth section in `config.yaml`:

```yaml
auth:
  bearer:
    enabled: true
    tokens:
      - "${MCP_AUTH_TOKEN}"
```

Then set `MCP_AUTH_TOKEN` in your Render environment variables.

Clients must include the Bearer token:
```
Authorization: Bearer your-token-here
```

## Environment Variables

- `PORT` - Port to listen on (Render sets this automatically)
- `SUPABASE_PROJECT_REF` - Your Supabase project ID
- `SUPABASE_ACCESS_TOKEN` - Your Supabase personal access token
- `MCP_AUTH_TOKEN` - (Optional) Bearer token for gateway authentication
- Add any other tokens required by your MCP servers

## Troubleshooting

### Server not starting
- Check Render logs for errors
- Verify all environment variables are set correctly
- Ensure the MCP server command is valid

### Connection refused from n8n
- Verify the endpoint URL is correct (`/servername`, not `/servername/sse`)
- Check if authentication is required
- Look at Render logs for connection attempts

### MCP server fails to start
- Check if required environment variables are set
- Verify the npm package name is correct
- Some MCP servers require additional dependencies

## How It Works

1. **Render starts the service** → runs `npm start`
2. **server.js processes config.yaml** → replaces environment variables
3. **mcp-gateway starts** → spawns all configured MCP servers
4. **Each MCP server** → gets its own SSE endpoint at `/{name}`
5. **Clients connect** → via path-based routing to the server they need

## Credits

Built with [mcp-gateway](https://github.com/acehoss/mcp-gateway) by [@acehoss](https://github.com/acehoss)

## License

MIT
