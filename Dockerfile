FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

# Generate the Prisma client at build time (schema is stable).
RUN npx prisma generate

# At runtime: apply pending migrations against the (persistent) Postgres
# database referenced by DATABASE_URL, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx react-router-serve ./build/server/index.js"]
