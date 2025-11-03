# syntax = docker/dockerfile:1

# ✅ Playwright base image — includes Chromium, Firefox, WebKit, and all dependencies
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# Set working directory
WORKDIR /app

# Environment setup
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=10000

# Copy package files first
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy all app files
COPY . .

# Expose Fly.io default Node port
EXPOSE 10000

# Start your scraper server
CMD ["node", "index.js"]
