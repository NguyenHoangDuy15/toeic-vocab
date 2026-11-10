FROM node:20-alpine AS base
WORKDIR /app

FROM base AS builder
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
RUN npm install
COPY apps/api ./apps/api
COPY data ./data
RUN npm run build -w apps/api

FROM base AS runner
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm install --omit=dev
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY data ./data

EXPOSE 3000
CMD ["npm", "start", "-w", "apps/api"]

