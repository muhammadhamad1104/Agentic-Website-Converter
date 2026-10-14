FROM node:20-slim AS builder

WORKDIR /app

# Install build tools in case they are needed for native modules
RUN apt-get update && apt-get install -y python3 make g++ openssl && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --legacy-peer-deps --no-audit --no-fund

# Copy Prisma schema and generate client before copying source (for layer caching)
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the rest of the source code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# --- Production Image ---
FROM node:20-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund

# Copy generated Prisma client and built output
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
RUN node -e "const fs=require('node:fs'); fs.mkdirSync('node_modules/.bin',{recursive:true}); fs.symlinkSync('../prisma/build/index.js','node_modules/.bin/prisma');"
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

# Expose port and run
EXPOSE 5000 5001

# Start command
CMD ["node", "dist/server.js"]
