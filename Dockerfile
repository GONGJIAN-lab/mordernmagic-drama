# BIG STAR Drama Backend
# Railway Docker deployment

FROM node:18-slim

# Install openssl for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY backend/package*.json ./
RUN npm ci

# Copy prisma schema and source
COPY backend/prisma ./prisma
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Generate Prisma client and build TypeScript
RUN npx prisma generate
RUN npm run build

# Railway provides PORT env var at runtime
EXPOSE 3000

# Run migrations then start server
CMD ["npm", "start"]
