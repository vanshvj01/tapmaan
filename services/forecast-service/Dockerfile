# forecast-service — 7-day heatwave prediction with probability
# Build context is the repository root:
#   docker build -f services/forecast-service/Dockerfile -t tapmaan-forecast-service .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4002

COPY api/_lib ./api/_lib
COPY api/forecast.js ./api/
COPY services/shared ./services/shared
COPY services/forecast-service ./services/forecast-service

# Numeric UID of the image's "node" user, so Kubernetes runAsNonRoot can verify it.
USER 1000
EXPOSE 4002
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4002/health > /dev/null || exit 1

CMD ["node", "services/forecast-service/server.js"]
