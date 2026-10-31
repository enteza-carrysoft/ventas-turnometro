FROM node:22-alpine
ARG APP
ENV APP=${APP}
WORKDIR /app
COPY apps/${APP}/server.mjs ./server.mjs
USER node
CMD ["node", "server.mjs"]
