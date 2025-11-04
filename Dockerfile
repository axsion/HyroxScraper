# syntax = docker/dockerfile:1

# --- Base image with Playwright + Chromium preinstalled ---
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# --- Set working directory ---
WORKDIR /app

# --- Copy package files and install dependencies ---
COPY package*.json ./
RUN npm install --omit=dev

# --- Copy application code (including .playwright folder for baked Chromium) ---
COPY . .
# Make sure the chromium binary folder is part of the image
# (it should exist in your repo at .playwright/chromium-1194/chrome-linux/chrome)
COPY .playwright .playwright

# --- Environment configuration ---
ENV NODE_ENV=production
ENV PORT=10000

# --- Expose HTTP port ---
EXPOSE 10000

# --- Health check for Fly.io smoke tests ---
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:10000/api/health || exit 1

# --- Run the app ---
CMD ["node", "index.js"]
