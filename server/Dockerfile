FROM node:20-slim

WORKDIR /app

# Prisma needs openssl for the query engine
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN npx tsc -p tsconfig.json

# Prisma migrate + seed on first boot, then start the server.
ENV DATABASE_URL="file:/app/data/twin.db"
ENV PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

CMD ["sh", "-c", "node dist/db/seed.js; node dist/index.js"]

