# syntax=docker/dockerfile:1
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000

# Install Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libxss1 libasound2 fonts-liberation libatk-bridge2.0-0 \
    libgtk-3-0 libx11-xcb1 libxcomposite1 libxrandr2 libxdamage1 \
    libgbm1 xvfb wget curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Install Playwright browsers (Chromium only)
RUN npx playwright install chromium --with-deps

# Copy all source code
COPY . .

EXPOSE 10000
CMD ["npm", "start"]
