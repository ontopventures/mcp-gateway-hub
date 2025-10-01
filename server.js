const fs = require('fs');
const yaml = require('js-yaml');
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting MCP Gateway Hub...\n');

// Read and process config file
const configPath = process.env.CONFIG_PATH || path.join(__dirname, 'config.yaml');
console.log(`📄 Loading config from: ${configPath}`);

let configContent = fs.readFileSync(configPath, 'utf8');

// Replace environment variables in config
// Supports ${VAR} and ${VAR:-default} syntax
configContent = configContent.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (match, varName, defaultValue) => {
  const value = process.env[varName.trim()];
  if (value !== undefined) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  console.warn(`⚠️  Warning: Environment variable ${varName} is not set and has no default`);
  return match;
});

// Write processed config to temporary file
const processedConfigPath = path.join(__dirname, '.config.processed.yaml');
fs.writeFileSync(processedConfigPath, configContent);

// Parse to validate and show what we're running
const config = yaml.load(configContent);

console.log('\n📋 Configuration:');
console.log(`   Port: ${config.port || 8000}`);
console.log(`   Hostname: ${config.hostname || '0.0.0.0'}`);
console.log(`   Log Level: ${config.debug?.level || 'info'}`);
console.log(`\n🔧 Configured MCP Servers:`);

Object.keys(config.servers || {}).forEach(serverName => {
  const server = config.servers[serverName];
  console.log(`   • ${serverName}`);
  console.log(`     Command: ${server.command} ${server.args?.join(' ') || ''}`);
  if (server.env) {
    const envVars = Object.keys(server.env).filter(k => server.env[k] && server.env[k] !== '');
    if (envVars.length > 0) {
      console.log(`     Env vars: ${envVars.join(', ')}`);
    }
  }
});

console.log('\n🌐 SSE Endpoints will be available at:');
Object.keys(config.servers || {}).forEach(serverName => {
  const port = config.port || 8000;
  console.log(`   https://mcp-gateway-hub.onrender.com/${serverName}`);
});

console.log('\n💡 To add more servers, edit config.yaml and redeploy\n');
console.log('─'.repeat(60));
console.log('\n🎬 Starting mcp-gateway...\n');

// Start mcp-gateway with the processed config
const gatewayProcess = spawn('npx', [
  'mcp-gateway',
  '--config', processedConfigPath
], {
  stdio: 'inherit',
  env: process.env
});

gatewayProcess.on('error', (err) => {
  console.error('❌ Failed to start mcp-gateway:', err);
  process.exit(1);
});

gatewayProcess.on('exit', (code, signal) => {
  console.log(`\n⚠️  mcp-gateway exited with code ${code} and signal ${signal}`);
  // Clean up processed config
  try {
    fs.unlinkSync(processedConfigPath);
  } catch (e) {
    // Ignore cleanup errors
  }
  process.exit(code || 0);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  gatewayProcess.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  gatewayProcess.kill('SIGINT');
});
