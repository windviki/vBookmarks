FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
COPY vBookmarks /ext
COPY smoke.js diag.js diag-dead.js verify-keyboard.js shots.js shots-themes.js shots-i18n.js shots-palette.js shots-guide.js /work/
WORKDIR /work
CMD ["node", "/work/smoke.js"]
