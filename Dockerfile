FROM node:20-alpine AS builder
WORKDIR /app
# Prisma's engine needs to detect OpenSSL to pick the right binary — Alpine
# doesn't ship it by default, and without it Prisma silently guesses wrong
# and crashes at runtime ("Could not parse schema engine response").
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Render (Frankfurt) reaching Neon (us-east-2) over IPv6 silently stalls
# after the TCP handshake instead of failing fast — confirmed by the DB
# itself answering the same advisory-lock query in ~230ms when run
# directly against it, while every migrate deploy attempt from this
# container hung for exactly Prisma's 10s ceiling. Forces Node's DNS
# resolution (used by both `prisma migrate deploy` and the running app's
# own DB queries) to prefer IPv4, avoiding the broken path.
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
EXPOSE 3000
# Neon's free tier suspends its compute after a few minutes idle — the
# first connection after a deploy often has to wake it up, which can take
# longer than the ~10s Prisma allows to acquire its migration advisory
# lock (P1002). That's a cold-start latency problem, separate from (and on
# top of) DIRECT_URL avoiding the pooled-connection lock issue: a failed
# first attempt has already reached and woken the compute, so retrying
# lands on an awake database. Fails loudly (exit 1) instead of silently
# starting the app against an unmigrated schema if every attempt fails.
CMD ["sh", "-c", "\
  n=0; \
  until npx prisma migrate deploy; do \
    n=$((n+1)); \
    if [ $n -ge 6 ]; then echo 'prisma migrate deploy failed after 6 attempts'; exit 1; fi; \
    echo \"prisma migrate deploy failed (attempt $n/6) — retrying in 5s, likely just waking the DB...\"; \
    sleep 5; \
  done; \
  node dist/index.js \
"]
