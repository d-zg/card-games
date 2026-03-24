FROM node:22-slim

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace config and lockfile first (better caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

# Build client
RUN pnpm --filter @card-games/client run build

# Expose port
EXPOSE 3000

# Data directory for SQLite
VOLUME /app/data
ENV DB_PATH=/app/data/card-games.db

# Start server
CMD ["pnpm", "--filter", "@card-games/server", "run", "start"]
