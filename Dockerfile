FROM node:20-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    DOCUMENT_STORAGE_DRIVER=local \
    DOCUMENT_STORAGE_ROOT=/app/storage \
    PDF_FONT_ZH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc \
    PDF_FONT_ZH_BOLD=/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc \
    PDF_FONT_EN=/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf \
    PDF_FONT_EN_BOLD=/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation fonts-noto-cjk openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

RUN export DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    && npm run db:postgres:schema \
    && npx prisma generate --schema prisma/postgresql/schema.prisma \
    && npm run build \
    && mkdir -p /app/storage \
    && chown -R node:node /app

ENV NODE_ENV=production PORT=3000 PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npm run env:check:production && npm run db:postgres:deploy && npm start"]
