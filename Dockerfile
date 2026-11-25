FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p public/uploads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server/index.js"]
