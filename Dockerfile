FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3010

# zero third-party runtime deps: package.json has no dependencies
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/accounts /app/files

EXPOSE 3010

# accounts/ and files/ are mounted from the host; credentials never bake into the image
CMD ["node", "src/server.mjs", "3010"]
