FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./server.js
COPY public ./public
USER node
ENV NODE_ENV=production PORT=8091
EXPOSE 8091
CMD ["node", "server.js"]
