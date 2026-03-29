# 1) Bazni sloj
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

# 2) Build sloj
FROM base AS build
RUN apt-get update -qq && apt-get install --no-install-recommends -y \
  build-essential node-gyp pkg-config python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
COPY . .

# 3) Finalni sloj (runtime)
FROM base

# >>> DODATO: Chromium + fontovi + certs (da PDF render bude OK)
RUN apt-get update -qq && apt-get install --no-install-recommends -y \
  chromium \
  ca-certificates \
  fonts-liberation \
  fonts-noto-color-emoji \
  fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# >>> DODATO: reci Puppeteer-u da NE skida Chrome i gde je Chromium
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=build /app /app

VOLUME ["/app/logs"]
EXPOSE 4000
CMD ["npm", "run", "start"]
