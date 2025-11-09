# Use the official Node.js LTS image
FROM node:18-alpine

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

# Expose any necessary ports (though Discord bot doesn't need any)
# EXPOSE 3000

# Run the bot
CMD [ "node", "index.js" ]
