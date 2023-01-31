(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    document.addEventListener('DOMContentLoaded', () => {

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
            localStorage.customIcon = JSON.stringify(imageData.data);
        };
        if (localStorage.customIcon) {
            const customIcon = JSON.parse(localStorage.customIcon);
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
            delete localStorage.customIcon;
            chrome.browserAction.setIcon({
                path: 'icon.png'
            });
            dontLoad = true;
            customIconPreview.src = 'icon.png';
        });

        const customSeparatorColor = $('custom-separator-color');
        if (localStorage.separatorcolor) customSeparatorColor.value = localStorage.separatorcolor;
        customSeparatorColor.addEventListener('change', () => {
            localStorage.separatorcolor = customSeparatorColor.value;
        });

        const customSeparatorTitle = $('custom-separator-title');
        if (localStorage.separatorTitle) {
            customSeparatorTitle.value = localStorage.separatorTitle;
        } else {
            customSeparatorTitle.value = '|';
        }
        customSeparatorTitle.addEventListener('change', () => {
            localStorage.separatorTitle = customSeparatorTitle.value;
        });

        const customSeparatorUrl = $('custom-separator-url');
        if (localStorage.separatorUrl) {
            customSeparatorUrl.value = localStorage.separatorUrl;
        } else {
            customSeparatorUrl.value = 'http://separatethis.com/';
        }
        customSeparatorUrl.addEventListener('change', () => {
            localStorage.separatorUrl = customSeparatorUrl.value;
        });

        const customSeparatorString = $('custom-separator-string');
        if (localStorage.separatorString) {
            customSeparatorString.value = localStorage.separatorString;
        } else {
            customSeparatorString.value = "separatethis.com;"
        }
        customSeparatorString.addEventListener('change', () => {
            localStorage.separatorString = customSeparatorString.value;
        });

        const textareaUserstyle = $('userstyle');
        if (localStorage.userstyle) textareaUserstyle.value = localStorage.userstyle;
        CodeMirror.fromTextArea(textareaUserstyle, {
            onChange: c => {
                localStorage.userstyle = c.getValue();
            }
        });

        $('reset-button').addEventListener('click', () => {
            localStorage.clear();
            alert('vBookmarks has been reset.');
            location.reload();
        }, false);

        window.onerror = function () {
            chrome.extension.sendRequest({
                error: [].slice.call(arguments)
            })
        };

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
})(window);