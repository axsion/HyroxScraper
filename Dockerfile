# syntax = docker/dockerfile:1

# ✅ Playwright image — includes Chromium, Firefox, WebKit, and all dependencies
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=10000

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 10000
CMD ["node", "index.js"]
