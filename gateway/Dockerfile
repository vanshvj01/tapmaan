# gateway — nginx serving the Tapmaan frontend and routing /api/* to services.
# Build context is the repository root:
#   docker build -f gateway/Dockerfile -t tapmaan-gateway .
FROM nginx:1.27-alpine

# Fill ${NGINX_LOCAL_RESOLVERS} from /etc/resolv.conf at start-up.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    SERVICE_SUFFIX=""

COPY gateway/default.conf.template /etc/nginx/templates/default.conf.template
COPY public /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health > /dev/null || exit 1
