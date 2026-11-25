# Gestor Documental: UNA sola imagen con la interfaz compilada y el backend.
#
# Etapa 1 compila la SPA (Vite) y la etapa 2 deja solo el backend de Node con la
# carpeta dist al lado: index.js la sirve como archivos estáticos. Un único
# Cloud Run atiende la API y la interfaz, sin nginx ni balanceador.
FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js tailwind.config.js postcss.config.js jsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24.22.1-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json backend/.npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend ./
COPY --from=build /app/dist /app/dist
EXPOSE 8080
CMD ["node", "index.js"]
