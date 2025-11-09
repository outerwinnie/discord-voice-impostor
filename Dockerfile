# Use the official Node.js LTS image with Python and build tools
FROM node:18-bullseye-slim

# Install Python and build essentials
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Set build arguments
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Bundle app source
COPY . .

# Expose health check port
EXPOSE 8080

# Run the bot
CMD [ "node", "index.js" ]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').request('http://localhost:3000/health', console.log).on('error', process.exit(1)).end()" || exit 1
