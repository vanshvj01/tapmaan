# alert-service — early-warning queue and subscriber registration
# Build context is the repository root:
#   docker build -f services/alert-service/Dockerfile -t tapmaan-alert-service .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4005

COPY api/_lib ./api/_lib
COPY api/alerts.js ./api/
COPY api/subscribe.js ./api/
COPY services/shared ./services/shared
COPY services/alert-service ./services/alert-service

# Numeric UID of the image's "node" user, so Kubernetes runAsNonRoot can verify it.
USER 1000
EXPOSE 4005
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4005/health > /dev/null || exit 1

CMD ["node", "services/alert-service/server.js"]
