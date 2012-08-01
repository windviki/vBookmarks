(function(window) {
	var document = window.document;
	var chrome = window.chrome;
	var _m = chrome.i18n.getMessage;
	var __m = _m;
	var localStorage = window.localStorage;
	
	document.addEventListener('DOMContentLoaded', function () {
		var resp = JSON.parse(localStorage.checkupdate);
		if (resp) {
			document.title = 'New version ' + resp.latest + ' is available!';
			document.getElementById('messages').innerHTML = '<p>' + document.title + '</p>';
			//var updatelogs = document.getElementById("updatelogs");
			document.getElementById('a-updatelogs').href = 'https://raw.github.com/windviki/vBookmarks';
			document.getElementById('a-updatelogs').innerHTML = '<p>Check changelogs</p>';
			//var newversion = document.getElementById("newversion");
			document.getElementById('a-newversion').href = resp.url;
			//document.getElementById('a-newversion').innerHTML = resp.url;
		}
	});
})(window);