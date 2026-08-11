FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
# Vector CJK font so the headless Chromium renders Chinese text crisply —
# the base image's WenQuanYi Zen Hei falls back to bitmap glyphs at popup
# text sizes, which made localized dialogs look smudged in the screenshots.
# Best-effort only: this build sandbox has no network, so apk silently no-ops
# and the run keeps the base CJK font.
RUN apk add --no-cache font-noto-cjk || true
COPY vBookmarks /ext
# Real-browser verify gate + smoke (image CMD); the screenshot suites share
# the same image (screenshots/run.sh runs only /work/shots-*.js).
COPY smoke.js verify-keyboard.js verify-scrollbars.js verify-menu-overflow.js verify-menu-collapse.js verify-menu-extreme.js /work/
COPY shots.js shots-matrix.js shots-i18n.js shots-palette.js shots-guide.js shots-tabgroups.js /work/
COPY diag /work/diag
WORKDIR /work
CMD ["node", "/work/smoke.js"]
