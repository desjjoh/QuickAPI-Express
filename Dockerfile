# Node.js 24.22.1 LTS on Alpine Linux 3.24.
# Keep the tag in this comment readable; the digest is the immutable image identity.
ARG NODE_IMAGE=node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
ARG ALPINE_IMAGE=alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

# ---------- build stage ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable npm && corepack prepare npm@11.4.2 --activate

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- production dependency stage ----------
FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
RUN corepack enable npm && corepack prepare npm@11.4.2 --activate

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- runtime stage ----------
FROM ${ALPINE_IMAGE} AS runtime

WORKDIR /app
RUN apk add --no-cache libstdc++ curl \
    && apk upgrade --no-cache \
    && addgroup -S -g 1000 node \
    && adduser -D -u 1000 -G node -s /bin/sh node

# Copy Node alone; npm, npx, Yarn, Corepack, and their caches stay in build images.
COPY --from=production-dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json /app/package-lock.json ./

USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
