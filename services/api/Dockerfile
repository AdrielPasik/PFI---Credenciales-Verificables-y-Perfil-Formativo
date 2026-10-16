FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY services/api/package.json ./services/api/package.json

RUN npm ci \
    --workspace @credential-intelligence/api \
    --include-workspace-root=false

COPY services/api ./services/api
COPY data/academic_catalog ./data/academic_catalog
COPY infra/terraform/sql ./infra/terraform/sql
# S8: la reconciliacion lee el bloque de deploy del manifest publicado. SOLO los
# manifests de deployment (JSON publico, sin secretos): ni el schema, ni el
# toolchain, ni el README, ni el resto de contracts/.
COPY contracts/deployments/base-sepolia-*.json ./contracts/deployments/

RUN npm run prisma:generate --workspace @credential-intelligence/api \
    && npm run build --workspace @credential-intelligence/api \
    && chmod 0755 /app/services/api/docker/migrator-entrypoint.sh

WORKDIR /app/services/api

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]