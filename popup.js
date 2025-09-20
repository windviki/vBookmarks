(window => {
    const document = window.document;
    const chrome = window.chrome;
    const localStorage = window.localStorage;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    document.addEventListener('DOMContentLoaded', () => {
        // Restore size
        if (localStorage.popupHeight) {
            if (localStorage.popupHeight > 600) {
                localStorage.popupHeight = 600;
            }
            document.body.style.height = `${localStorage.popupHeight}px`;
        }

        //document.body.style.height = '600px';
        if (localStorage.popupWidth) {
            document.body.style.width = `${localStorage.popupWidth}px`;
        }

        // Setup donation close button
        const donationClose = document.getElementById('donation-close');
        const donationDiv = document.getElementById('donation');
        if (donationClose && donationDiv) {
            donationClose.addEventListener('click', () => {
                donationDiv.style.display = 'none';
                // Optionally save preference to localStorage
                localStorage.donationDismissed = 'true';
            });
        }

        // Check if donation was previously dismissed
        if (localStorage.donationDismissed === 'true') {
            const donationDiv = document.getElementById('donation');
            if (donationDiv) {
                donationDiv.style.display = 'none';
            }
        }

    });
})(window);