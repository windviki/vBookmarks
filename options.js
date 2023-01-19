(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    document.addEventListener('DOMContentLoaded', () => {

        document.title = `${_m('extName')} ${_m('options')}`;

        const clickNewTab = $('click-new-tab');
        clickNewTab.checked = !!localStorage.leftClickNewTab;
        clickNewTab.addEventListener('change', () => {
            localStorage.leftClickNewTab = clickNewTab.checked ? '1' : '';
        });

        const openNewTabBg = $('open-new-tab-bg');
        openNewTabBg.checked = !!localStorage.middleClickBgTab;
        openNewTabBg.addEventListener('change', () => {
            localStorage.middleClickBgTab = openNewTabBg.checked ? '1' : '';
        });

        const closeUnusedFolders = $('close-unused-folders');
        closeUnusedFolders.checked = !!localStorage.closeUnusedFolders;
        closeUnusedFolders.addEventListener('change', () => {
            localStorage.closeUnusedFolders = closeUnusedFolders.checked ? '1' : '';
        });

        const popupStayOpen = $('popup-stay-open');
        popupStayOpen.checked = !!localStorage.bookmarkClickStayOpen;
        popupStayOpen.addEventListener('change', () => {
            localStorage.bookmarkClickStayOpen = popupStayOpen.checked ? '1' : '';
        });

        const confirmOpenFolder = $('confirm-open-folder');
        confirmOpenFolder.checked = !localStorage.dontConfirmOpenFolder;
        confirmOpenFolder.addEventListener('change', () => {
            localStorage.dontConfirmOpenFolder = confirmOpenFolder.checked ? '' : '1';
        });

        const rememberPrevState = $('remember-prev-state');
        rememberPrevState.checked = !localStorage.dontRememberState;
        rememberPrevState.addEventListener('change', () => {
            localStorage.dontRememberState = rememberPrevState.checked ? '' : '1';
        });

        const onlyShowBMBar = $('only-show-bmbar');
        onlyShowBMBar.checked = !!localStorage.onlyShowBMBar;
        onlyShowBMBar.addEventListener('change', () => {
            localStorage.onlyShowBMBar = onlyShowBMBar.checked ? '1' : '';
        });

        const zoom = $('zoom-input');
        setInterval(() => {
            zoom.value = localStorage.zoom || 100;
        }, 1000);
        zoom.addEventListener('input', () => {
            const val = zoom.value.toInt();
            if (val === 100) {
                localStorage.removeItem('zoom');
            } else {
                localStorage.zoom = val;
            }
        });

        window.onerror = function () {
            chrome.extension.sendRequest({
                error: [].slice.call(arguments)
            })
        };

        document.getElementById('advanced-options').innerText = __m('advancedOptions');
        document.getElementById('ext-name').innerText = __m('extName');
        document.getElementById('small-options').innerText = __m('options');
        document.getElementById('general').innerText = __m('general');
        document.getElementById('option-click-new-tab').innerText = __m('optionClickNewTab');
        document.getElementById('option-open-new-tab-bg').innerText = __m('optionOpenNewTab');
        document.getElementById('option-close-unused-folders').innerText = __m('optionCloseUnusedFolders');
        document.getElementById('option-popup-stay-open').innerText = __m('optionPopupStays');
        document.getElementById('option-confirm-open-folder').innerText = __m('optionConfirmOpenFolder');
        document.getElementById('option-remember-prev-state').innerText = __m('optionRememberPrevState');
        document.getElementById('option-only-show-bmbar').innerText = __m('optionOnlyShowBookmarkBar');
        document.getElementById('accessibility').innerText = __m('accessibility');
        document.getElementById('option-zoom').innerText = __m('optionZoom');
        document.getElementById('options-footer-1').innerHTML = '<p>Thanks: Lim Chee Aun</p>';
        //document.getElementById('options-footer-2').innerHTML = `<a href="http://twitter.com/windviki">${__m('optionsFooterText', 'windviki')}</a>`;
        document.getElementById('options-footer-3').innerHTML =
            '<a href="https://github.com/windviki">Follow me @windviki on Github</a>';
        document.getElementById('options-footer-4').innerHTML =
            '<a href="http://windviki.github.com/vBookmarks/">vBookmarks Mainpage (docs and source code)</a>';
    });
})(window);