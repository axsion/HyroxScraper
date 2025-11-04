# ------------------------------------------
# HYROX SCRAPER v4.4 — Fly.io Playwright Build (v1.56.1)
# ------------------------------------------

# Use the official Playwright base image that already includes Chromium 119
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install Node dependencies (without dev)
RUN npm install --omit=dev

# Copy the app source
COPY . .

# Environment variables for port & chromium path
ENV PORT=10000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CHROMIUM_PATH=/ms-playwright/chromium-1194/chrome-linux/chrome

# Expose app port for Fly.io
EXPOSE 10000

# Launch the scraper
CMD ["node", "index.js"]
