# data-service — Data Acquisition Layer (Open-Meteo, cache, fallback)
# Build context is the repository root:
#   docker build -f services/data-service/Dockerfile -t tapmaan-data-service .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4000

COPY api/_lib ./api/_lib
COPY services/shared ./services/shared
COPY services/data-service ./services/data-service

# Numeric UID of the image's "node" user, so Kubernetes runAsNonRoot can verify it.
USER 1000
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health > /dev/null || exit 1

CMD ["node", "services/data-service/server.js"]
