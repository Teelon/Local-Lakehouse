FROM node:20-alpine AS base

WORKDIR /app

ENV NODE_ENV=development

# Install dependencies with legacy-peer-deps
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "dev"]
