# Deployment Fix (v2.2.1)

## The Problem

The deployment was failing with:
```
❌ Port 9001 did not become available after 30 attempts (30s)
===> Exited with status 1
```

## Root Cause

The Supergateway child processes were **not spawning at all** because we were passing the MCP server command arguments incorrectly.

### The Bug

```javascript
// WRONG - Concatenated string
const supergatewayCmdString = `${server.command} ${server.args.join(' ')}`;
const supergateawayArgs = [
  '-y',
  'supergateway',
  '--stdio',
  supergatewayCmdString,  // ❌ "npx -y @supabase/mcp-server..."
  ...
];
```

When `spawn('npx', supergateawayArgs)` ran, it tried to execute a command literally called `"npx -y @supabase/mcp-server..."` which doesn't exist!

### Why No Logs?

The spawned process failed immediately (silently), so:
- No stdout/stderr output
- Ports never opened
- Timeout after 30 seconds
- Deployment failed

## The Fix

```javascript
// CORRECT - Separate arguments
const supergateawayArgs = [
  '-y',
  'supergateway',
  '--stdio',
  server.command,    // ✅ 'npx'
  ...server.args,    // ✅ ['-y', '@supabase/mcp-server...']
  ...
];
```

Now each argument is passed separately to the spawn function, which is what it expects.

### Additional Fixes

1. **Increased timeout back to 60s** - First run needs time to download npm packages
2. **Better error logging** - Show the actual command when spawn fails
3. **Improved exit logging** - Distinguish error exits from clean exits

## Testing the Fix

After deploying v2.2.1, you should see in the logs:

```
📦 Starting supabase MCP Server...
   Port: 9001
   Command: npx -y @supabase/mcp-server-supabase...
   Supergateway: npx -y supergateway --stdio npx -y @supabase/mcp-server...

[supabase] [supergateway] Starting...         ← This should appear now!
[supabase] [supergateway] Listening on port 9001
✅ supabase is ready on port 9001
```

## Deploy

```bash
git add .
git commit -m "fix: Correct Supergateway argument passing for deployment (v2.2.1)"
git push
```

## Files Changed

- `server.js` - Fixed spawn arguments, improved logging, increased timeout
- `package.json` - Version 2.2.1
- `CHANGELOG.md` - Release notes
- `DEPLOYMENT_FIX.md` - This document

---

**Status:** Ready to deploy! This should fix the deployment failure.

