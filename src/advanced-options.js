(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    document.addEventListener('DOMContentLoaded', () => {
        // Wait for the storage mirror (chrome.storage.local loaded + migrated)
        store.ready.then(() => {

        document.body.dataset.theme = store.get('theme', 'auto');

        document.title = `${_m('extName')} ${_m('advancedOptions')}`;

        const customIconPreview = $('custom-icon-preview').firstElementChild;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 19;
        const ctx = canvas.getContext('2d');
        let dontLoad = true;
        customIconPreview.onload = () => {
            if (dontLoad) {
                dontLoad = false;
                return;
            }
            ctx.clearRect(0, 0, 19, 19);
            ctx.drawImage(customIconPreview, 0, 0, 19, 19);
            const imageData = ctx.getImageData(0, 0, 19, 19);
            chrome.action.setIcon({
                imageData: imageData
            });
            store.set('customIcon', JSON.stringify(imageData.data));
        };
        if (store.get('customIcon')) {
            const customIcon = JSON.parse(store.get('customIcon'));
            const imageData = ctx.getImageData(0, 0, 19, 19);
            for (const key in customIcon) imageData.data[key] = customIcon[key];
            ctx.putImageData(imageData, 0, 0);
            customIconPreview.src = canvas.toDataURL();
        }

        const customIconFile = $('custom-icon-file');
        customIconFile.addEventListener('change', function () {
            const files = this.files;
            let reader;
            if (files && files.length) {
                const file = files[0];
                if (/image\/[a-z]+/i.test(file.type)) {
                    reader = new FileReader();
                    reader.onload = e => {
                        const result = e.target.result;
                        customIconPreview.src = result;
                    };
                    reader.readAsDataURL(files[0]);
                } else {
                    alert('Not an image. Try another one.');
                }
            }
        });

        const defaultIconButton = $('default-icon-button');
        defaultIconButton.addEventListener('click', () => {
            store.remove('customIcon');
            chrome.action.setIcon({
                path: 'assets/icons/icon.png'
            });
            dontLoad = true;
            customIconPreview.src = '/assets/icons/icon.png';
        });

        const customSeparatorColor = $('custom-separator-color');
        if (store.get('separatorcolor')) customSeparatorColor.value = store.get('separatorcolor');
        customSeparatorColor.addEventListener('change', () => {
            store.set('separatorcolor', customSeparatorColor.value);
        });

        const customSeparatorTitle = $('custom-separator-title');
        if (store.get('separatorTitle')) {
            customSeparatorTitle.value = store.get('separatorTitle');
        } else {
            customSeparatorTitle.value = '|';
        }
        customSeparatorTitle.addEventListener('change', () => {
            store.set('separatorTitle', customSeparatorTitle.value);
        });

        const customSeparatorUrl = $('custom-separator-url');
        if (store.get('separatorURL')) {
            customSeparatorUrl.value = store.get('separatorURL');
        } else {
            customSeparatorUrl.value = 'http://separatethis.com/';
        }
        customSeparatorUrl.addEventListener('change', () => {
            store.set('separatorURL', customSeparatorUrl.value);
        });

        const customSeparatorString = $('custom-separator-string');
        if (store.get('separatorString')) {
            customSeparatorString.value = store.get('separatorString');
        } else {
            customSeparatorString.value = "separatethis.com;"
        }
        customSeparatorString.addEventListener('change', () => {
            store.set('separatorString', customSeparatorString.value);
        });

        const textareaUserstyle = $('userstyle');
        if (store.get('userstyle')) textareaUserstyle.value = store.get('userstyle');
        CodeMirror.fromTextArea(textareaUserstyle, {
            onChange: c => {
                store.set('userstyle', c.getValue());
            }
        });

        $('reset-button').addEventListener('click', () => {
            store.clearAll().then(() => {
                alert('vBookmarks has been reset.');
                location.reload();
            });
        }, false);

        document.getElementById('small-options').innerText = __m('options');
        document.getElementById('ext-name').innerText = __m('extName');
        document.getElementById('advanced-options').innerText = __m('advancedOptions');
        document.getElementById('custom-icon').innerText = __m('customIcon');
        document.getElementById('custom-icon-description').innerText = __m('customIconDescription');
        document.getElementById('default-icon-button').innerText = __m('defaultIconButton');
        document.getElementById('default-icon-button-or').innerText = __m('defaultIconButtonOr');
        document.getElementById('custom-styles').innerText = __m('customStyles');
        document.getElementById('custom-separator-color-description').innerText = __m('customSeparatorColorDescription');
        document.getElementById('custom-separator-title-description').innerText = __m('customSeparatorTitleDescription');
        document.getElementById('custom-separator-url-description').innerText = __m('customSeparatorUrlDescription');
        document.getElementById('custom-separator-string-description').innerText = __m('customSeparatorStringDescription');
        document.getElementById('custom-styles-description').innerText = __m('customStylesDescription');
        document.getElementById('reset-settings').innerText = __m('resetSettings');
        document.getElementById('reset-settings-description').innerText = __m('resetSettingsDescription');
        document.getElementById('reset-button').innerText = __m('resetButton');
        document.getElementById('options-footer-1').innerHTML = '<p>Thanks: Lim Chee Aun</p>';
        document.getElementById('options-footer-3').innerHTML =
            '<a href="https://github.com/windviki">Follow me @windviki on Github</a>';
        document.getElementById('options-footer-4').innerHTML =
            '<a href="https://windviki.github.io/vBookmarks/">vBookmarks Mainpage (docs and source code)</a>';
        });
    });
})(window);