FROM node:24-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

EXPOSE 3000

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
