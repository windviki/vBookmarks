FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
COPY vBookmarks /ext
COPY smoke.js verify-keyboard.js /work/
COPY suites /work/suites
COPY diag /work/diag
WORKDIR /work
CMD ["node", "/work/smoke.js"]
