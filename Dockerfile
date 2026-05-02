# Stage 1: Builder
FROM node:20-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy dependency files and Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Clean install all dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Generate Prisma client and build the TypeScript code
RUN npx prisma generate
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Define Production Environment
ENV NODE_ENV=production

# Copy dependency files and Prisma schema from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma/

# Clean install ONLY production dependencies
RUN npm ci --omit=dev

# Generate Prisma client for production
RUN npx prisma generate

# Copy the compiled output from the builder stage
COPY --from=builder /app/dist ./dist/

# Security: Run as non-root user 'node'
USER node

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "dist/server.js"]
