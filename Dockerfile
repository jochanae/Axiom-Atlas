FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

EXPOSE 3000

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
