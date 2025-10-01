# MCP Gateway Hub

A multi-MCP server gateway using **Supergateway** and **Express** reverse proxy. Host multiple Model Context Protocol (MCP) servers on a single deployment with path-based routing.

**Based on the proven pattern from [central-mcp-proxy](https://github.com/odgrim/central-mcp-proxy)**, adapted for single-server deployment on Render.

## 🎯 Features

- 🚀 **Multiple MCP Servers** - Run as many MCP servers as you need
- 🌐 **Single Port** - All servers accessible through one port (perfect for Render, Railway, etc.)
- 🔄 **Path-Based Routing** - Each server has its own path: `/supabase`, `/github`, `/git`
- 📡 **SSE Support** - Full Server-Sent Events support through reverse proxy
- 🔧 **Easy Configuration** - Add new servers by editing one array
- ✅ **Proven Pattern** - Based on production-ready Supergateway + reverse proxy architecture

## 🏗️ Architecture

```
Single Render Service (Port 8000)
│
├── Express Reverse Proxy (Port 8000)
│   ├── /supabase/* → Supergateway Instance 1 (Port 9001)
│   ├── /github/* → Supergateway Instance 2 (Port 9002)
│   └── /git/* → Supergateway Instance 3 (Port 9003)
│
└── Supergateway Processes
    ├── Port 9001: Supabase MCP Server
    ├── Port 9002: GitHub MCP Server
    └── Port 9003: Git MCP Server
```

Each MCP server runs in its own Supergateway instance on a unique internal port. The Express reverse proxy routes external requests to the correct internal server based on the path.

## 🚀 Quick Start

### Deploy to Render

1. **Fork this repository**

2. **Create a new Web Service on Render**
   - Connect your forked repository
   - Build Command: `npm install`
   - Start Command: `npm start`

3. **Set Environment Variables**
   ```
   SUPABASE_PROJECT_REF=your-project-ref
   SUPABASE_ACCESS_TOKEN=your-access-token
   GITHUB_TOKEN=your-github-token
   ```

4. **Deploy!**
   - Render will automatically deploy your service
   - Your MCP servers will be available at:
     - `https://your-app.onrender.com/supabase/sse`
     - `https://your-app.onrender.com/github/sse`

### Local Development

```bash
# Install dependencies
npm install

# Set environment variables
export SUPABASE_PROJECT_REF=your-project-ref
export SUPABASE_ACCESS_TOKEN=your-access-token
export GITHUB_TOKEN=your-github-token

# Start the gateway
npm start
```

Visit `http://localhost:8000` to see available servers.

## 📋 Available Endpoints

### Service Endpoints
- **Health Check**: `GET /health`
- **Server List**: `GET /`

### MCP Server Endpoints
Each server has two endpoints:

**Supabase MCP Server:**
- SSE: `http://your-app.onrender.com/supabase/sse`
- Message: `POST http://your-app.onrender.com/supabase/message`

**GitHub MCP Server:**
- SSE: `http://your-app.onrender.com/github/sse`
- Message: `POST http://your-app.onrender.com/github/message`

## ➕ Adding New MCP Servers

To add a new MCP server, edit the `MCP_SERVERS` array in `server.js`:

```javascript
const MCP_SERVERS = [
  // ... existing servers ...
  {
    name: 'git',           // Server name (used in URL path)
    port: 9003,            // Unique internal port
    command: 'npx',        // Command to run
    args: [                // Command arguments
      '-y',
      'mcp-server-git',
      '--repository',
      '/path/to/repo'
    ],
    env: {                 // Environment variables for this server
      GIT_API_KEY: process.env.GIT_API_KEY
    }
  }
];
```

**Steps:**
1. Add your server configuration to the `MCP_SERVERS` array
2. Assign a unique port number (9003, 9004, etc.)
3. Add required environment variables to Render
4. Commit and push - auto-deployment will handle the rest!

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Port for the Express server (Render sets this automatically) | No (default: 8000) |
| `SUPABASE_PROJECT_REF` | Your Supabase project reference ID | Yes (for Supabase) |
| `SUPABASE_ACCESS_TOKEN` | Your Supabase personal access token | Yes (for Supabase) |
| `GITHUB_TOKEN` | Your GitHub personal access token | Yes (for GitHub) |

Add additional environment variables as needed for your MCP servers.

## 📡 Using with n8n

In your n8n MCP Client node:

- **Transport**: SSE
- **SSE URL**: `https://your-app.onrender.com/supabase/sse` (or any other server)
- **Message URL**: `https://your-app.onrender.com/supabase/message`
- **Authentication**: None (unless you add it)

## 🖥️ Using with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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
    },
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "supergateway",
        "--sse",
        "https://your-app.onrender.com/github/sse"
      ]
    }
  }
}
```

## 🔍 Popular MCP Servers to Add

Here are some popular MCP servers you can easily add:

### Filesystem Access
```javascript
{
  name: 'filesystem',
  port: 9004,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: {}
}
```

### PostgreSQL Database
```javascript
{
  name: 'postgres',
  port: 9005,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-postgres'],
  env: {
    POSTGRES_CONNECTION_STRING: process.env.POSTGRES_CONNECTION_STRING
  }
}
```

### Web Scraping
```javascript
{
  name: 'fetch',
  port: 9006,
  command: 'npx',
  args: ['-y', 'mcp-server-fetch'],
  env: {}
}
```

Browse more at [MCP Servers Directory](https://github.com/modelcontextprotocol/servers)

## 🐛 Troubleshooting

### Check Server Status
Visit `https://your-app.onrender.com/health` to see if all servers are configured correctly.

### View Logs
In the Render dashboard:
1. Go to your service
2. Click on "Logs"
3. Look for `[server-name]` prefixed messages

### Common Issues

**Server not starting:**
- Verify environment variables are set correctly
- Check the MCP server package name is correct
- Ensure the command and args are valid

**Connection refused:**
- Wait 3-5 seconds after deployment for Supergateway instances to start
- Check Render logs for startup errors

**SSE connection drops:**
- This is normal - Render's free tier has connection limits
- Consider upgrading to a paid plan for production use

## 🔐 Security Notes

This setup does not include authentication by default. For production use:
- Add authentication middleware to Express
- Use environment variables for tokens
- Enable HTTPS (Render does this automatically)
- Consider rate limiting

## 📚 How It Works

1. **server.js spawns multiple child processes**, each running Supergateway
2. **Each Supergateway instance** connects to one MCP stdio server
3. **Express reverse proxy** routes incoming requests to the correct Supergateway instance
4. **SSE connections** are properly handled with disabled buffering and keep-alive

This architecture is proven to work in production (see [central-mcp-proxy](https://github.com/odgrim/central-mcp-proxy)).

## 🙏 Credits

- **Pattern**: Based on [central-mcp-proxy](https://github.com/odgrim/central-mcp-proxy) by [@odgrim](https://github.com/odgrim)
- **Supergateway**: Built with [Supergateway](https://github.com/supercorp-ai/supergateway) by [@supercorp-ai](https://github.com/supercorp-ai)
- **MCP Protocol**: [Model Context Protocol](https://modelcontextprotocol.io)

## 📄 License

MIT

---

**Need help?** Open an issue or check the [Render documentation](https://render.com/docs).
