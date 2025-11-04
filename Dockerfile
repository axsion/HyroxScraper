# syntax = docker/dockerfile:1

# ✅ Playwright v1.56.1 (latest as of Nov 2025)
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the source
COPY . .

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

# Start the app
CMD ["node", "index.js"]
