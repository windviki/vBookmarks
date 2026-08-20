/**
 * Version-info metadata for the /version palette command (4.0.8).
 *
 * Pure helpers only — no chrome/DOM access — so the browser-string parsing
 * and the JSON shape are unit-testable in node. The palette collects the
 * live page globals (navigator, manifest, announce cache) and passes them in;
 * dialogs.js renders the returned object and copies it as JSON.
 */

// Parse "Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0" style UA strings.
// The precedence order matters: Edge ships both Edg/ and Chrome/.
export const parseBrowser = ua => {
    const s = String(ua || '');
    let m = /Edg\/([\d.]+)/.exec(s);
    if (m)
        return { name: 'Edge', version: m[1] };
    m = /OPR\/([\d.]+)/.exec(s);
    if (m)
        return { name: 'Opera', version: m[1] };
    m = /Chrome\/([\d.]+)/.exec(s);
    if (m)
        return { name: 'Chrome', version: m[1] };
    m = /Firefox\/([\d.]+)/.exec(s);
    if (m)
        return { name: 'Firefox', version: m[1] };
    m = /Version\/([\d.]+).*Safari\//.exec(s);
    if (m)
        return { name: 'Safari', version: m[1] };
    return { name: 'Unknown', version: '' };
};

// The object shown in the modal and copied to the clipboard. Keep keys
// stable — the copied JSON is the public shape of this command.
export const collectVersionMeta = ({
    version = '',
    announce = '',
    channel = 'popup',
    userAgent = '',
    platform = '',
    language = '',
    manifestVersion = 3
} = {}) => {
    const browser = parseBrowser(userAgent);
    return {
        app: 'vBookmarks',
        version,
        manifestVersion,
        channel,
        announce,
        browser: browser.name,
        browserVersion: browser.version,
        os: platform,
        language,
        userAgent
    };
};
