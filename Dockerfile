# syntax=docker/dockerfile:1
#
# Container for the truck-show floorplan webapp INCLUDING the server-side CAD
# conversion route (/api/convert), which shells out to libredwg's `dwgread` and
# python3. Build context is the repo root.
#
#   docker build -t truckshow \
#     --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_APP_ID=... .
#   docker run -p 3000:3000 -v truckshow-backups:/app/backups truckshow
#
# (NEXT_PUBLIC_* are public Firebase client keys, inlined into the client bundle at
# build time — they must be supplied as build args, not at runtime.)

# ---------------------------------------------------------------------------
# 1) Build libredwg from source as a static binary (so the runtime image only
#    needs the single `dwgread` executable, no shared libs to chase).
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS libredwg
# python3 is needed by libredwg's build scripts even when bindings are disabled.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates build-essential autoconf automake libtool \
      pkg-config texinfo perl python3 \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/LibreDWG/libredwg.git /src \
 && cd /src \
 && sh autogen.sh \
 && ./configure --disable-shared --enable-static --disable-bindings \
 && make -j"$(nproc)" \
 && make install \
 && strip /usr/local/bin/dwgread

# ---------------------------------------------------------------------------
# 2) Build the Next.js app (standalone output).
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS build
WORKDIR /app
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci
COPY webapp/ ./

# Public Firebase config is baked into the client bundle at build time.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_ENABLE_GUEST
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_ENABLE_GUEST=$NEXT_PUBLIC_ENABLE_GUEST \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------------------
# 3) Runtime: slim node + python3 + the dwgread binary + the standalone server.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# python3 is required by the conversion script (stdlib only); dwgread does the DWG read.
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=libredwg /usr/local/bin/dwgread /usr/local/bin/dwgread

# Standalone server bundle + static assets + public files + the python script.
# process.cwd() at runtime is /app, so the convert route finds /app/scripts.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts

# Backups are written here at runtime — mount a volume to persist them.
RUN mkdir -p /app/backups && chown -R node:node /app/backups

# Don't parse untrusted CAD input as root: dwgread is a C parser fed user uploads.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
