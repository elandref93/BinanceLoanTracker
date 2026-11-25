# syntax=docker/dockerfile:1.7
FROM node:26.12.1-alpine
RUN apk add --no-cache openssl nginx
WORKDIR /app
COPY nginx.conf /etc/nginx/nginx.conf
RUN sed -i 's/\r$//' /etc/nginx/nginx.conf
COPY acme.mjs server.mjs ./
EXPOSE 80 443
CMD ["node", "server.mjs"]
