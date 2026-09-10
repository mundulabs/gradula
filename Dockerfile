# Gradula — two layers: build the board, then the service.
FROM node:22-alpine AS board
WORKDIR /board/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# The board reads the SERVICE's vocabulary (web/src/vocabulary.ts imports
# ../../src/spec.mjs) — one list of words for the service, the CLI and the
# surface. So the build needs that one file beside it, and the working
# directory is one level deeper so the relative path still holds. A copy in
# web/ would drift, and a gate in tests/surface.test.mjs refuses one.
COPY src/spec.mjs /board/src/spec.mjs
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first, then the source: that way the layer with the npm run
# stays in the cache as long as the lock does not change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY bin ./bin
COPY mcp ./mcp
COPY --from=board /board/web/dist ./web/dist

# Not as root. The image holds no state — that lies in Postgres.
USER node

EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3200/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
