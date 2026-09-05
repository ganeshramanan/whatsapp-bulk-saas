# Build & Run with Docker
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=optional

# Copy source and prisma schema
COPY tsconfig.json ./
COPY prisma ./prisma/
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/g' prisma/schema.prisma && npx prisma generate

COPY src ./src/
COPY public ./public/

# Build TypeScript
RUN npm run build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --omit=optional

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["sh", "-c", "sed -i 's/provider = \"sqlite\"/provider = \"postgresql\"/g' prisma/schema.prisma && npx prisma db push && node dist/index.js"]
