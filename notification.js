(function(window) {
	var document = window.document;
	var chrome = window.chrome;
	var _m = chrome.i18n.getMessage;
	var __m = _m;
	var localStorage = window.localStorage;
	
	var linkHandler = function(e) {
		e.preventDefault();
		if (e.button != 0)
			return; // force left-click
		var el = e.target;
		var elParent = el.parentNode;
		if (elParent && elParent.tagName == 'A') {
			var url = elParent.href;
			chrome.tabs.create({
				url : url,
				selected : true
			});
		}
	};
		
	document.addEventListener('DOMContentLoaded', function () {
		var resp = JSON.parse(localStorage.checkupdate);
		if (resp) {
			document.title = 'New version ' + resp.latest + ' is available! 发现新版本';
			document.getElementById('titlemessage').innerHTML = '<h1>' + document.title + '</h1>';
			document.getElementById('messages').innerHTML = resp.message;
			var updatelogs = document.getElementById('a-updatelogs');
			updatelogs.href = 'http://windviki.github.com/vBookmarks/';
			updatelogs.innerHTML = '<p>Changelogs 更新记录</p>';
			var newversion = document.getElementById('a-newversion');
			newversion.href = resp.url;
			newversion.innerHTML = '<p>Download!! 下载地址</p>';
			var links = document.getElementById('links');
			links.addEventListener('click', linkHandler);
		}
	});
})(window);