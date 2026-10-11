# monitoring-service — current conditions classified against IMD criteria
# Build context is the repository root:
#   docker build -f services/monitoring-service/Dockerfile -t tapmaan-monitoring-service .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4001

COPY api/_lib ./api/_lib
COPY api/observations.js ./api/
COPY services/shared ./services/shared
COPY services/monitoring-service ./services/monitoring-service

# Numeric UID of the image's "node" user, so Kubernetes runAsNonRoot can verify it.
USER 1000
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4001/health > /dev/null || exit 1

CMD ["node", "services/monitoring-service/server.js"]
