FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

# Save prisma schema + migrations to static location
# (volume mounts at /app/prisma at runtime, overwriting the directory)
RUN mkdir -p /app/prisma-static && cp -r prisma/schema.prisma prisma/migrations /app/prisma-static/

# Startup: copy schema into volume, then run prisma & app
CMD ["sh", "-c", "\
  echo '[boot] === Volume contents ===' && \
  ls -laR /app/prisma/ 2>&1 | head -30 && \
  echo '[boot] === Copying schema + migrations ===' && \
  cp /app/prisma-static/schema.prisma /app/prisma/ && \
  cp -r /app/prisma-static/migrations /app/prisma/ && \
  echo '[boot] DB path: /app/prisma/dev.sqlite' && \
  if [ -f /app/prisma/dev.sqlite ]; then \
    echo '[boot] DB EXISTS' && \
    ls -lh /app/prisma/dev.sqlite && \
    echo '[boot] DB row count:' && \
    sqlite3 /app/prisma/dev.sqlite 'SELECT count(*) FROM SupplierProduct;' 2>/dev/null || echo '  (no sqlite3, skipping count)'; \
  else \
    echo '[boot] DB will be created fresh'; \
  fi && \
  npx prisma generate && \
  npx prisma migrate deploy && \
  npx react-router-serve ./build/server/index.js \
"]
