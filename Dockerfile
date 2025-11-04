# ==========================================================
#  HYROX SCRAPER - Playwright + Node 18 + Fly.io compatible
# ==========================================================
# Uses the official Playwright base image with Chromium 1.56 preinstalled.
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the entire project (including index.js, events.txt, etc.)
COPY . .

# Expose the correct Fly.io port
EXPOSE 10000

# Define environment variables for consistent behavior
ENV NODE_ENV=production
ENV PORT=10000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Verify Chromium path (this will exist inside this image)
RUN ls -l /ms-playwright/chromium-*/chrome-linux/chrome

# Start the app
CMD ["node", "index.js"]
