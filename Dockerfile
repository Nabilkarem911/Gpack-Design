FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/uploads"]
# Seed the default brand logo into the (possibly empty) uploads volume on first boot,
# then start. cp -n semantics via [ ! -f ]; harmless on redeploys when the file exists.
CMD ["sh", "-c", "if [ ! -f \"/app/uploads/ad38fe27-54cc-497b-933a-528b1d4fc5ea.png\" ]; then cp /app/seed/ad38fe27-54cc-497b-933a-528b1d4fc5ea.png /app/uploads/ 2>/dev/null || true; fi; exec node server.js"]
