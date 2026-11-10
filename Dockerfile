# syntax=docker/dockerfile:1
# Single-service image: Express serves the API under /api and the built React client at /.
# All configuration (MONGODB_URI, JWT_*, CLIENT_URL, ...) comes from the host's env — never bake secrets.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
# --ignore-scripts: skips the husky `prepare` hook (no .git in the build context).
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/package.json ./client/
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5050}/api/health" > /dev/null || exit 1
CMD ["node", "server/src/index.js"]
