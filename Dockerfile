# syntax = docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app

# copy and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# copy all code (including events.txt)
COPY . .

# environment
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

# fly.io expects app to listen on 0.0.0.0:$PORT
CMD ["node", "index.js"]
