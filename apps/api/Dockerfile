FROM node:22-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY package.json ./
RUN pnpm install
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
EXPOSE 3001
CMD ["node", "dist/index.js"]
