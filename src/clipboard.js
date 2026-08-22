/**
 * Clipboard writes + folder-list formatting (velvet staging §6.3/§6.5).
 *
 * `writeText(text)` is the clipboard path extracted from actions.js (P1
 * "操作即模块"): the write can happen inside an async callback long after
 * the user gesture, where execCommand('copy') is silently rejected —
 * navigator.clipboard.writeText (backed by the manifest's clipboardWrite
 * permission) does not care, with the hidden-textarea execCommand fallback
 * for environments without the async API.
 *
 * The three formatters turn a flat `{title, url}` list (recursive folder
 * contents, depth-first tree order — the caller collects) into the shared
 * plain/markdown/JSON export shapes. Faithful to the tree: NO dedupe (that
 * is the dupes view's job).
 */

export const writeText = async text => {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) { /* focus lost etc. — try the execCommand path */ }
    }
    if (typeof document !== 'undefined' && document.createElement) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        let done = false;
        try {
            done = document.execCommand('copy');
        } catch (e) { /* no clipboard path available */ }
        ta.remove();
        return done;
    }
    return false;
};

// Plain text: title line + URL line per bookmark, blank line between entries.
export const formatAsText = items => {
    const out = [];
    for (const it of items || [])
        out.push(`${it.title || it.url}\n${it.url}`);
    return out.join('\n\n');
};

// Markdown list: `- [title](url)`; brackets escaped, newlines fold to spaces
// (a newline inside a link text would break the list item).
export const formatAsMarkdown = items => (items || [])
    .map(it => {
        const title = (it.title || it.url).replace(/([\[\]])/g, '\\$1').replace(/\r?\n/g, ' ');
        const url = String(it.url).replace(/([\(\)])/g, '\\$1').replace(/\r?\n/g, ' ');
        return `- [${title}](${url})`;
    })
    .join('\n');

// JSON: flat array of {title, url}, 2-space indent.
export const formatAsJson = items => JSON.stringify(
    (items || []).map(it => ({ title: it.title || it.url, url: it.url })),
    null,
    2
);

export const FORMATTERS = {
    text: formatAsText,
    markdown: formatAsMarkdown,
    json: formatAsJson
};
