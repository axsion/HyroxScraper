# ==========================================================
# HYROX Scraper v4.6 - Fly.io Optimized Dockerfile
# ==========================================================
# ✅ Node 20 LTS with system tools
# ✅ Playwright 1.56.1 + Chromium baked in
# ✅ Runs on port 10000 (Fly proxy compatible)
# ✅ Fast startup, stable memory footprint
# ==========================================================

FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# --- Create working directory ---
WORKDIR /app

# --- Copy package files first for caching ---
COPY package*.json ./

# --- Install dependencies (omit dev) ---
RUN npm install --omit=dev

# --- Copy project files ---
COPY . .

# --- Ensure data directory exists ---
RUN mkdir -p /data

# --- Bake Chromium binary path for Playwright-core ---
ENV CHROMIUM_PATH="/usr/bin/chromium"

# --- Environment settings ---
ENV NODE_ENV=production
ENV PORT=10000

# --- Expose app port ---
EXPOSE 10000

# --- Start the server ---
CMD ["node", "index.js"]
