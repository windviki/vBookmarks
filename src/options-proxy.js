/**
 * Options-page dead-link proxy server management — the "Dead-link proxy
 * server" row of the Dead scan group (pages/options.html). Replaces the old
 * relay-template input (deadProxyTemplate, retired): type an address, Test &
 * save probes it and persists only a reachable server; the row also shows the
 * saved server and clears it. The add flow mirrors the dead-links view's
 * inline panel exactly (parse → `proxy` permission → controllability →
 * reachability, all from src/dead-proxy.js), so the two surfaces stay in
 * lockstep — this one exists because the view's strip can be hidden.
 *
 * ES module loaded after /src/store.js (a classic script), so
 * window.getSetting/setSetting/removeSetting are available; the key
 * (`deadProxyServer`, chrome.storage.local) is the same one the scan's
 * service worker and the dead-links view read.
 */

import {
    parseProxyServer, formatProxyServer,
    proxyPermission, requestProxyPermission,
    proxyControllable, testProxyReachable
} from './dead-proxy.js';

const $ = id => document.getElementById(id);
const _m = chrome.i18n.getMessage;

const init = async () => {
    const label = $('option-dead-proxy-server');
    const input = $('dead-proxy-server-input');
    const saveBtn = $('dead-proxy-server-save');
    const valueEl = $('dead-proxy-server-value');
    const clearBtn = $('dead-proxy-server-clear');
    const hintEl = $('dead-proxy-server-hint');
    const errorEl = $('dead-proxy-server-error');
    if (!input || !saveBtn || !label || !valueEl || !clearBtn || !hintEl || !errorEl)
        return; // the Dead scan group is present on this page

    label.innerText = _m('optionDeadProxyServer');
    saveBtn.innerText = _m('deadProxyTestSave');
    clearBtn.innerText = _m('deadProxyClear');
    hintEl.innerText = _m('deadProxyServerHint');

    // "Show the proxy hint in the dead-links view": the dead view's no-server
    // hint strip (add button + nudge + ×) can be dismissed in place; this
    // checkbox is its restore switch, so the view never becomes a dead end.
    // A saved server always keeps its manage row in the view regardless.
    const stripCheck = $('dead-proxy-strip-visible');
    if (stripCheck) {
        const stripLabel = $('option-dead-proxy-strip');
        const stripHint = $('dead-proxy-strip-hint');
        stripLabel.innerText = _m('optionDeadProxyStrip');
        stripHint.innerText = _m('optionDeadProxyStripHint');
        stripCheck.checked = (await getSetting('hideDeadProxyStrip', '')) !== '1';
        stripCheck.addEventListener('change', async () => {
            if (stripCheck.checked)
                await removeSetting('hideDeadProxyStrip');
            else
                await setSetting('hideDeadProxyStrip', '1');
        });
    }

    const refresh = async () => {
        const value = await getSetting('deadProxyServer', '');
        valueEl.textContent = value || _m('deadProxyNone');
        clearBtn.disabled = !value;
    };
    await refresh();

    clearBtn.addEventListener('click', async () => {
        await removeSetting('deadProxyServer');
        errorEl.textContent = '';
        input.value = '';
        await refresh();
    });

    let busy = false;
    const setMessage = (key, ok) => {
        errorEl.textContent = key ? _m(key) : '';
        errorEl.classList.toggle('ok', !!ok);
    };

    saveBtn.addEventListener('click', async () => {
        if (busy)
            return;
        const server = parseProxyServer(input.value.trim());
        if (!server) {
            setMessage('deadProxyInvalid');
            input.focus();
            return;
        }
        busy = true;
        saveBtn.disabled = true;
        saveBtn.textContent = _m('deadProxyTesting');
        setMessage('');
        try {
            // The `proxy` permission is install-time required — contains() is
            // the real gate, request() a never-prompting fallback.
            const granted = await proxyPermission()
                .then(have => have || requestProxyPermission());
            if (!granted) {
                setMessage('deadProxyDenied');
                return;
            }
            const control = await proxyControllable();
            if (control !== 'ok') {
                setMessage(control === 'other-extension' ? 'deadProxyControlled' : 'deadProxyUnavailable');
                return;
            }
            const reachable = await testProxyReachable(server, { timeoutMs: 8000 });
            if (!reachable) {
                setMessage('deadProxyUnreachable');
                return;
            }
            await setSetting('deadProxyServer', formatProxyServer(server));
            input.value = '';
            setMessage('deadProxySaved', true);
            await refresh();
        } finally {
            busy = false;
            saveBtn.disabled = false;
            saveBtn.textContent = _m('deadProxyTestSave');
        }
    });
};

init();
