# advisory-service — stakeholder-specific advisories (LLM with template fallback)
# Build context is the repository root:
#   docker build -f services/advisory-service/Dockerfile -t tapmaan-advisory-service .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4004

COPY api/_lib ./api/_lib
COPY api/advisory.js ./api/
COPY services/shared ./services/shared
COPY services/advisory-service ./services/advisory-service

# Numeric UID of the image's "node" user, so Kubernetes runAsNonRoot can verify it.
USER 1000
EXPOSE 4004
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4004/health > /dev/null || exit 1

CMD ["node", "services/advisory-service/server.js"]
