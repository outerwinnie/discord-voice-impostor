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

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Bundle app source
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD [ "node", "index.js" ]
