# syntax=docker/dockerfile:1.7
FROM node:26.12.1-alpine
RUN apk add --no-cache openssl nginx
WORKDIR /app
# nginx.conf is a template: server.mjs substitutes EDGE_HOSTNAME into it and
# writes /etc/nginx/nginx.conf before nginx starts. It lives next to the code
# rather than in /etc so the image ships one unrendered copy.
COPY nginx.conf /app/nginx.conf.template
RUN sed -i 's/\r$//' /app/nginx.conf.template
COPY acme.mjs server.mjs ./
EXPOSE 80 443
CMD ["node", "server.mjs"]
