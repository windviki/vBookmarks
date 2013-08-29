(function (window) {
	var document = window.document;
	var chrome = window.chrome;
	var localStorage = window.localStorage;
	var _m = chrome.i18n.getMessage;
	var __m = _m;

	document.addEventListener('DOMContentLoaded', function () {
		window.onerror = function () {
			chrome.extension.sendRequest({error: [].slice.call(arguments)})
		};

		// Restore size
		if (localStorage.popupHeight) {
			if (localStorage.popupHeight > 600) {
				localStorage.popupHeight = 600;
			}
			document.body.style.height = localStorage.popupHeight + 'px';
		}

		//document.body.style.height = '600px';
		if (localStorage.popupWidth) {
			document.body.style.width = localStorage.popupWidth + 'px';
		}

	});
})(window);