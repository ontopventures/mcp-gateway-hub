FROM node:20-slim

# Install necessary tools
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY server.js .
COPY config.yaml .

# Expose main port (mcp-gateway handles all routing internally)
EXPOSE 8000

# Start the application
CMD ["npm", "start"]
