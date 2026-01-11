# Aster LSP WebSocket Server
# Standalone LSP service for Monaco editor integration

FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and only LSP-related dependencies (skip postinstall/prisma)
RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod --ignore-scripts

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 asteruser

# Copy necessary files
COPY --from=deps /app/node_modules ./node_modules
COPY package.json lsp-server.ts ./

# Install tsx for TypeScript execution
RUN corepack enable pnpm && pnpm add -D tsx --ignore-scripts

# Create .asteri directory for LSP workspace index
RUN mkdir -p /app/.asteri && chown asteruser:nodejs /app/.asteri

# Use non-root user
USER asteruser

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Run the LSP server
CMD ["node", "--import", "tsx", "lsp-server.ts"]
