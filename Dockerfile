# syntax = docker/dockerfile:1

# ✅ Use the official Playwright base image (includes Chromium + deps)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS base

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package files first
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy your application code
COPY . .

# Fly.io uses port 10000 by default for Node apps
ENV PORT=10000
EXPOSE 10000

# ✅ Start your server (index.js should start Express)
CMD ["node", "index.js"]
