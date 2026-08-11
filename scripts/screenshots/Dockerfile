FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
# Vector CJK font so the headless Chromium renders Chinese text crisply —
# the base image's WenQuanYi Zen Hei falls back to bitmap glyphs at popup
# text sizes, which made localized dialogs look smudged in the screenshots.
# Best-effort only: this build sandbox has no network, so apk silently no-ops
# and the run keeps the base CJK font.
RUN apk add --no-cache font-noto-cjk || true
COPY vBookmarks /ext
COPY smoke.js verify-keyboard.js verify-scrollbars.js verify-menu-overflow.js verify-menu-collapse.js verify-menu-extreme.js /work/
COPY suites /work/suites
COPY diag /work/diag
WORKDIR /work
CMD ["node", "/work/smoke.js"]
