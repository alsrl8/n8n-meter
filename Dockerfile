FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY core.mjs server.mjs ./
USER node
EXPOSE 7810
CMD ["node", "server.mjs"]
