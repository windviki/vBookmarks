FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
COPY vBookmarks /ext
COPY smoke.js diag.js shots.js shots-themes.js /work/
WORKDIR /work
CMD ["node", "/work/smoke.js"]
