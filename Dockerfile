FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json server.js ./
COPY lib ./lib
COPY scripts ./scripts
COPY config ./config
COPY content ./content
COPY gtfs ./gtfs
COPY public ./public
RUN mkdir -p state && chown -R node:node /app
USER node
EXPOSE 8090
CMD ["npm", "start"]
