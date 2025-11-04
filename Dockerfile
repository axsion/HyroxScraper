# syntax = docker/dockerfile:1

# ✅ Match Playwright version to 1.56.1
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

# Run the app
CMD ["node", "index.js"]
