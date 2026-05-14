FROM node:22-alpine
RUN npm install -g pnpm
WORKDIR /app

# Copy workspace root files (build context = repo root on Railway)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/

# Install only api deps
RUN pnpm install --filter api --no-frozen-lockfile --config.allowedBuildScripts=esbuild

# Copy source and build
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
WORKDIR /app/apps/api
RUN pnpm build

EXPOSE 3001
CMD ["node", "dist/index.js"]
