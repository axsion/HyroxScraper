# ----------------------------------------------------------
# HYROX Scraper – Fly.io deployment (Playwright 1.56.1)
# ----------------------------------------------------------

FROM mcr.microsoft.com/playwright:v1.56.1-jammy   # ← updated tag

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["node", "index.js"]
