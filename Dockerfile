# Portable image: no .git directory, organization accounts or bundled project.
FROM node:22-alpine AS board
WORKDIR /build
COPY web/package*.json ./web/
RUN npm --prefix web ci --no-audit --no-fund
COPY web ./web
COPY src/spec.mjs src/heralds.mjs ./src/
RUN npm --prefix web run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY bin ./bin
COPY mcp ./mcp
COPY --from=board /build/web/dist ./web/dist
USER node
EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3200/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
