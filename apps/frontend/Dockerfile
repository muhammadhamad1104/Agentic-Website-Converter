FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./

ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_API_URL
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_API_URL=$VITE_API_URL

# Using --legacy-peer-deps to avoid React 19 resolution issues
RUN npm install --legacy-peer-deps

COPY . .

# Build the React/Vite app
RUN npm run build

# --- Production Image ---
FROM nginx:alpine

# Copy nginx config to handle SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts to nginx public folder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
