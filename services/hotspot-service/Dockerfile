# hotspot-service — hotspot scoring and regional aggregation
# Build context is the repository root:
#   docker build -f services/hotspot-service/Dockerfile -t tapmaan-hotspot-service .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4003

COPY api/_lib ./api/_lib
COPY api/hotspots.js ./api/
COPY services/shared ./services/shared
COPY services/hotspot-service ./services/hotspot-service

# Numeric UID of the image's "node" user, so Kubernetes runAsNonRoot can verify it.
USER 1000
EXPOSE 4003
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4003/health > /dev/null || exit 1

CMD ["node", "services/hotspot-service/server.js"]
