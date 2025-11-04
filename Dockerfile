# syntax = docker/dockerfile:1

# ✅ Base image with Chromium preinstalled
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# Set workdir
WORKDIR /app

# Copy dependency manifests and install
COPY package*.json ./
RUN npm install --omit=dev

# Copy all project files
COPY . .

# Environment variables
ENV NODE_ENV=production
ENV PORT=10000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Expose app port
EXPOSE 10000

# Start the app
CMD ["node", "index.js"]
