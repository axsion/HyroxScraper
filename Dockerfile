# syntax = docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy all app files
COPY . .

# Install Chromium inside the image (no local .playwright needed)
RUN npx playwright install chromium --with-deps

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:10000/api/health || exit 1

CMD ["node", "index.js"]
