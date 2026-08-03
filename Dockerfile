ARG NODE_IMAGE=node:24.11.1-alpine3.22

# ---------- build stage ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
# The lockfile was created without installing optional peer dependencies.
RUN npm ci --legacy-peer-deps

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- production dependency stage ----------
FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts && npm cache clean --force

# ---------- runtime stage ----------
FROM ${NODE_IMAGE} AS runtime

WORKDIR /app
RUN apk add --no-cache curl

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json /app/package-lock.json ./

USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]