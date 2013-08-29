(function (window) {
	var document = window.document;
	var chrome = window.chrome;
	var _m = chrome.i18n.getMessage;
	var __m = _m;

	document.addEventListener('DOMContentLoaded', function () {

		document.title = _m('extName') + ' ' + _m('options');

		var clickNewTab = $('click-new-tab');
		clickNewTab.checked = !!localStorage.leftClickNewTab;
		clickNewTab.addEventListener('change', function () {
			localStorage.leftClickNewTab = clickNewTab.checked ? '1' : '';
		});

		var openNewTabBg = $('open-new-tab-bg');
		openNewTabBg.checked = !!localStorage.middleClickBgTab;
		openNewTabBg.addEventListener('change', function () {
			localStorage.middleClickBgTab = openNewTabBg.checked ? '1' : '';
		});

		var closeUnusedFolders = $('close-unused-folders');
		closeUnusedFolders.checked = !!localStorage.closeUnusedFolders;
		closeUnusedFolders.addEventListener('change', function () {
			localStorage.closeUnusedFolders = closeUnusedFolders.checked ? '1' : '';
		});

		var popupStayOpen = $('popup-stay-open');
		popupStayOpen.checked = !!localStorage.bookmarkClickStayOpen;
		popupStayOpen.addEventListener('change', function () {
			localStorage.bookmarkClickStayOpen = popupStayOpen.checked ? '1' : '';
		});

		var confirmOpenFolder = $('confirm-open-folder');
		confirmOpenFolder.checked = !localStorage.dontConfirmOpenFolder;
		confirmOpenFolder.addEventListener('change', function () {
			localStorage.dontConfirmOpenFolder = confirmOpenFolder.checked ? '' : '1';
		});

		var rememberPrevState = $('remember-prev-state');
		rememberPrevState.checked = !localStorage.dontRememberState;
		rememberPrevState.addEventListener('change', function () {
			localStorage.dontRememberState = rememberPrevState.checked ? '' : '1';
		});

		var onlyShowBMBar = $('only-show-bmbar');
		onlyShowBMBar.checked = !!localStorage.onlyShowBMBar;
		onlyShowBMBar.addEventListener('change', function () {
			localStorage.onlyShowBMBar = onlyShowBMBar.checked ? '1' : '';
		});

		var zoom = $('zoom-input');
		setInterval(function () {
			zoom.value = localStorage.zoom || 100;
		}, 1000);
		zoom.addEventListener('input', function () {
			var val = zoom.value.toInt();
			if (val == 100) {
				localStorage.removeItem('zoom');
			} else {
				localStorage.zoom = val;
			}
		});

		window.onerror = function () {
			chrome.extension.sendRequest({error: [].slice.call(arguments)})
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
		document.getElementById('options-footer-1').innerHTML = '<a href="http://twitter.com/cheeaun">' + __m('optionsFooterText', 'Lim Chee Aun') + '</a>';
		document.getElementById('options-footer-2').innerHTML = '<a href="http://twitter.com/windviki">' + __m('optionsFooterText', 'windviki') + '</a>';
		document.getElementById('options-footer-3').innerHTML = '<a href="http://weibo.com/windviki">Follow @windviki on Weibo</a>';
		document.getElementById('options-footer-4').innerHTML = '<a href="http://windviki.github.com/vBookmarks/">vBookmarks Mainpage (docs and source code)</a>';
	});
})(window);