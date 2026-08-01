import { describe, it, expect, afterEach } from 'vitest';

// dead-proxy.js: the pure parts (parse/marker/PAC text) are asserted
// directly; the chrome wrappers get chrome.* doubles injected on globalThis
// (same recipe as the other ESM suites). fetch is doubled per case for the
// reachability probe — every double records the URLs it saw so the marker
// placement is asserted too.

import {
    PROXY_MARKER, DEFAULT_PROXY_TEST_URL, parseProxyServer, formatProxyServer,
    addProxyMarker, buildPacScript, proxyPermission, requestProxyPermission,
    proxyControllable, startProxySession, endProxySession, testProxyReachable
} from '../src/dead-proxy.js';

const realFetch = globalThis.fetch;
const realChrome = globalThis.chrome;

afterEach(() => {
    globalThis.fetch = realFetch;
    if (realChrome === undefined)
        delete globalThis.chrome;
    else
        globalThis.chrome = realChrome;
});

describe('parseProxyServer', () => {
    it('parses host:port with http as the default scheme', () => {
        expect(parseProxyServer('127.0.0.1:7890'))
            .toEqual({ scheme: 'http', host: '127.0.0.1', port: 7890 });
    });

    it('parses explicit http/https/socks5 schemes and lowercases the host', () => {
        expect(parseProxyServer('http://127.0.0.1:7890').scheme).toBe('http');
        expect(parseProxyServer('https://Proxy.Corp:8443'))
            .toEqual({ scheme: 'https', host: 'proxy.corp', port: 8443 });
        expect(parseProxyServer('socks5://127.0.0.1:1080').scheme).toBe('socks5');
        expect(parseProxyServer('HTTP://h:1').scheme).toBe('http');
    });

    it('keeps bracketed IPv6 hosts bracketed (PAC wants the brackets)', () => {
        expect(parseProxyServer('[::1]:1080'))
            .toEqual({ scheme: 'http', host: '[::1]', port: 1080 });
        expect(parseProxyServer('socks5://[fe80::1]:1080').host).toBe('[fe80::1]');
    });

    it('trims surrounding whitespace', () => {
        expect(parseProxyServer('  127.0.0.1:7890  ').port).toBe(7890);
    });

    it('rejects empty, scheme-less-port-less and out-of-range ports', () => {
        expect(parseProxyServer('')).toBeNull();
        expect(parseProxyServer('   ')).toBeNull();
        expect(parseProxyServer(null)).toBeNull();
        expect(parseProxyServer('localhost')).toBeNull();
        expect(parseProxyServer('h:0')).toBeNull();
        expect(parseProxyServer('h:65536')).toBeNull();
        expect(parseProxyServer('h:abc')).toBeNull();
        expect(parseProxyServer('h:1:2')).toBeNull();
    });

    it('rejects unsupported schemes, credentials and paths', () => {
        expect(parseProxyServer('ftp://h:21')).toBeNull();
        expect(parseProxyServer('socks4://h:1080')).toBeNull();
        expect(parseProxyServer('user:pass@h:1')).toBeNull();
        expect(parseProxyServer('http://user:pass@h:1')).toBeNull();
        expect(parseProxyServer('http://h:1/path')).toBeNull();
        expect(parseProxyServer('h:1?x')).toBeNull();
    });

    it('round-trips through formatProxyServer', () => {
        const server = parseProxyServer('socks5://127.0.0.1:1080');
        expect(formatProxyServer(server)).toBe('socks5://127.0.0.1:1080');
        expect(parseProxyServer(formatProxyServer(server))).toEqual(server);
    });
});

describe('addProxyMarker', () => {
    it('uses ? for query-less URLs and & for ones with a query', () => {
        expect(addProxyMarker('https://a.com/')).toBe(`https://a.com/?${PROXY_MARKER}`);
        expect(addProxyMarker('https://a.com/p?x=1')).toBe(`https://a.com/p?x=1&${PROXY_MARKER}`);
    });

    it('inserts the marker ahead of the fragment', () => {
        expect(addProxyMarker('https://a.com/p#frag')).toBe(`https://a.com/p?${PROXY_MARKER}#frag`);
        expect(addProxyMarker('https://a.com/p?x=1#frag'))
            .toBe(`https://a.com/p?x=1&${PROXY_MARKER}#frag`);
    });
});

describe('buildPacScript', () => {
    it('routes only marker-carrying URLs through the proxy, default DIRECT', () => {
        const pac = buildPacScript({ scheme: 'http', host: '127.0.0.1', port: 7890 });
        expect(pac).toContain(`"${PROXY_MARKER}"`);
        expect(pac).toContain('"PROXY 127.0.0.1:7890"');
        expect(pac).toContain('"DIRECT"');
    });

    it('maps schemes to PAC tokens (https → HTTPS, socks5 → SOCKS5)', () => {
        expect(buildPacScript({ scheme: 'https', host: 'h', port: 1 })).toContain('"HTTPS h:1"');
        expect(buildPacScript({ scheme: 'socks5', host: 'h', port: 2 })).toContain('"SOCKS5 h:2"');
    });

    it('never adds a "; DIRECT" fallback (a dead proxy must not degrade to direct)', () => {
        const pac = buildPacScript({ scheme: 'http', host: 'h', port: 3 });
        expect(pac).not.toContain('PROXY h:3;');
    });
});

// chrome double builder: only the surface the wrappers touch, with call
// records for order assertions.
const makeChrome = (opts = {}) => {
    const calls = [];
    const stub = {
        runtime: {},
        permissions: {
            contains(perms, cb) {
                calls.push(['contains', perms]);
                cb('containsGranted' in opts ? opts.containsGranted : true);
            },
            request(perms, cb) {
                calls.push(['request', perms]);
                cb('requestGranted' in opts ? opts.requestGranted : true);
            }
        },
        proxy: {
            settings: {
                get(details, cb) {
                    calls.push(['get', details]);
                    cb({ levelOfControl: opts.levelOfControl || 'controllable_by_this_extension' });
                },
                set(details, cb) {
                    calls.push(['set', details]);
                    if (opts.setFails)
                        stub.runtime.lastError = { message: 'rejected' };
                    cb();
                    delete stub.runtime.lastError;
                },
                clear(details, cb) {
                    calls.push(['clear', details]);
                    cb();
                }
            }
        }
    };
    globalThis.chrome = stub;
    return { stub, calls };
};

describe('permission + controllability wrappers', () => {
    it('proxyPermission/requestProxyPermission resolve the granted flag', async () => {
        const { calls } = makeChrome({ containsGranted: false, requestGranted: true });
        expect(await proxyPermission()).toBe(false);
        expect(await requestProxyPermission()).toBe(true);
        expect(calls[0]).toEqual(['contains', { permissions: ['proxy'] }]);
        expect(calls[1]).toEqual(['request', { permissions: ['proxy'] }]);
    });

    it('resolves false when chrome.permissions is absent', async () => {
        globalThis.chrome = {};
        expect(await proxyPermission()).toBe(false);
        expect(await requestProxyPermission()).toBe(false);
    });

    it('proxyControllable maps the levelOfControl', async () => {
        makeChrome({ levelOfControl: 'controlled_by_other_extensions' });
        expect(await proxyControllable()).toBe('other-extension');
        makeChrome({ levelOfControl: 'controllable_by_this_extension' });
        expect(await proxyControllable()).toBe('ok');
        makeChrome({ levelOfControl: 'controlled_by_this_extension' });
        expect(await proxyControllable()).toBe('ok');
        globalThis.chrome = {};
        expect(await proxyControllable()).toBe('unavailable');
    });
});

describe('proxy session', () => {
    it('startProxySession installs the marker-PAC at regular scope', async () => {
        const { calls } = makeChrome();
        const server = parseProxyServer('socks5://127.0.0.1:1080');
        expect(await startProxySession(server)).toBe(true);
        const [verb, details] = calls.find(c => c[0] === 'set');
        expect(verb).toBe('set');
        expect(details.scope).toBe('regular');
        expect(details.value.mode).toBe('pac_script');
        expect(details.value.pacScript.data).toBe(buildPacScript(server));
    });

    it('startProxySession resolves false on a rejected write and without the API', async () => {
        makeChrome({ setFails: true });
        expect(await startProxySession(parseProxyServer('h:1'))).toBe(false);
        globalThis.chrome = {};
        expect(await startProxySession(parseProxyServer('h:1'))).toBe(false);
    });

    it('endProxySession clears only this extension\'s regular-scope settings', async () => {
        const { calls } = makeChrome();
        expect(await endProxySession()).toBe(true);
        expect(calls).toContainEqual(['clear', { scope: 'regular' }]);
        globalThis.chrome = {};
        expect(await endProxySession()).toBe(false);
    });
});

describe('testProxyReachable', () => {
    const server = parseProxyServer('http://127.0.0.1:7890');

    it('any HTTP response counts as reachable; the session is torn down after', async () => {
        const { calls } = makeChrome();
        const seen = [];
        globalThis.fetch = url => { seen.push(url); return Promise.resolve({ status: 204 }); };
        expect(await testProxyReachable(server)).toBe(true);
        expect(seen).toEqual([`https://www.gstatic.com/generate_204?${PROXY_MARKER}`]);
        const verbs = calls.map(c => c[0]);
        expect(verbs.indexOf('set')).toBeLessThan(verbs.indexOf('clear'));
    });

    it('honors a custom test URL (marker appended)', async () => {
        makeChrome();
        const seen = [];
        globalThis.fetch = url => { seen.push(url); return Promise.resolve({ status: 404 }); };
        expect(await testProxyReachable(server, { testUrl: 'https://corp.intra/up' })).toBe(true);
        expect(seen).toEqual([`https://corp.intra/up?${PROXY_MARKER}`]);
    });

    it('a network failure means unreachable; the session is still torn down', async () => {
        const { calls } = makeChrome();
        globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        expect(await testProxyReachable(server)).toBe(false);
        expect(calls.map(c => c[0])).toContain('clear');
    });

    it('a hang times out into unreachable', async () => {
        makeChrome();
        globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
        expect(await testProxyReachable(server, { timeoutMs: 20 })).toBe(false);
    });

    it('resolves false without installing anything when the PAC write fails', async () => {
        makeChrome({ setFails: true });
        let fetched = 0;
        globalThis.fetch = () => { fetched++; return Promise.resolve({ status: 200 }); };
        expect(await testProxyReachable(server)).toBe(false);
        expect(fetched).toBe(0);
    });
});
