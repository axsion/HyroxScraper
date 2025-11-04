# ==========================================================
# HYROX Scraper - Fly.io Compatible Dockerfile
# Includes Playwright Chromium inside the build image
# ==========================================================

# Use official Playwright base image (includes browsers)
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose Fly.io's expected port
ENV PORT=10000
EXPOSE 10000

# Run the scraper server
CMD ["node", "index.js"]
