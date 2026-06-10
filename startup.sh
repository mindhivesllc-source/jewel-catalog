#!/bin/sh
# Railway startup — ensures DB is on volume and runs migrations

echo "[init] === Volume check ==="
ls -la /app/prisma/ 2>&1 || echo "Volume not available"

echo "[init] DB path: /app/prisma/dev.sqlite (DATABASE_URL=$DATABASE_URL)"

if [ -f /app/prisma/dev.sqlite ]; then
  echo "[init] DB EXISTS — $(wc -c < /app/prisma/dev.sqlite) bytes"
else
  echo "[init] DB missing — will be created by prisma migrate"
fi

echo "[init] Running prisma generate..."
npx prisma generate

echo "[init] Running prisma migrate deploy..."
npx prisma migrate deploy

echo "[init] Starting server..."
exec npx react-router-serve ./build/server/index.js
