# ----------------------------------------------------------
# HYROX Scraper – Fly.io deployment
# Includes Chromium, Firefox, and WebKit out of the box
# ----------------------------------------------------------

FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy app source
COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["node", "index.js"]
