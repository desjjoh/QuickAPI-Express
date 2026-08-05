# Node.js 24.11.1 LTS on Alpine Linux 3.22.
# Keep the tag in this comment readable; the digest is the immutable image identity.
ARG NODE_IMAGE=node:24.11.1-alpine3.22@sha256:2867d550cf9d8bb50059a0fff528741f11a84d985c732e60e19e8e75c7239c43

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
FROM ${NODE_IMAGE} AS runtime

WORKDIR /app
RUN corepack enable npm && corepack prepare npm@11.4.2 --activate
RUN apk add --no-cache curl

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json /app/package-lock.json ./

USER node
EXPOSE 3000

CMD ["npm", "start"]