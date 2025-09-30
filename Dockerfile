FROM node:20-slim

# Install necessary tools
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY server.js .

# Expose ports (main status port + MCP server ports)
EXPOSE 8000 8001 8002 8003 8004 8005

# Start the application
CMD ["npm", "start"]
