(function (window) {
	var document = window.document;
	var chrome = window.chrome;
	var _m = chrome.i18n.getMessage;
	var __m = _m;
	var localStorage = window.localStorage;

	document.addEventListener('DOMContentLoaded', function () {

		var reportError = function (msg, url, line) {
			var txt = '_s=84615e81d50c4ddabff522aee3c4b734&_r=img'
				+ '&Msg=' + escape(msg)
				+ '&URL=' + escape(url)
				+ '&Line=' + line
				+ '&Platform=' + escape(navigator.platform)
				+ '&UserAgent=' + escape(navigator.userAgent);
			var i = document.createElement('img');
			i.setAttribute('src', (('https:' == document.location.protocol) ? 'https://errorstack.appspot.com' : 'http://www.errorstack.com') + '/submit?' + txt);
			document.body.appendChild(i);
			i.onload = function () {
				document.body.removeChild(i);
			};
		};

		window.onerror = reportError;

		chrome.extension.onRequest.addListener(function (request) {
			if (request.error) reportError.apply(null, request.error);
		});

		if (chrome.omnibox) {
			var setSuggest = function (description) {
				chrome.omnibox.setDefaultSuggestion({
					description: description
				});
			};

			var omniboxValue = null;
			var firstResult = null;
			var resetSuggest = function () {
				omniboxValue = null;
				firstResult = null;
				setSuggest('<url><match>*</match></url> ' + chrome.i18n.getMessage('searchBookmarks'));
			};
			resetSuggest();

			var xmlEncode = function (text) {
				return text.replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/\'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			};

			var matcher = function (text, value) {
				var matched = false;
				var exp = new RegExp(value.replace(/\s+/g, '|'), 'ig');
				var matchedText = text.replace(exp, function (m) {
					matched = true;
					return '<match>' + m + '</match>';
				});
				return {
					text: matchedText,
					matched: matched
				};
			};

			chrome.omnibox.onInputChanged.addListener(function (value, suggest) {
				if (!value) {
					resetSuggest();
					return;
				}
				omniboxValue = value;
				chrome.bookmarks.search(value, function (results) {
					if (!results.length) {
						resetSuggest();
						return;
					}
					var v = value.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
					var vPattern = new RegExp('^' + v.replace(/\s+/g, '.*'), 'ig');
					if (results.length > 1) {
						results.sort(function (a, b) {
							var aTitle = a.title;
							var bTitle = b.title;
							var aIndexTitle = aTitle.toLowerCase().indexOf(v);
							var bIndexTitle = bTitle.toLowerCase().indexOf(v);
							if (aIndexTitle >= 0 || bIndexTitle >= 0) {
								if (aIndexTitle < 0) aIndexTitle = Infinity;
								if (bIndexTitle < 0) bIndexTitle = Infinity;
								return aIndexTitle - bIndexTitle;
							}
							var aTestTitle = vPattern.test(aTitle);
							var bTestTitle = vPattern.test(bTitle);
							if (aTestTitle && !bTestTitle) return -1;
							if (!aTestTitle && bTestTitle) return 1;
							return b.dateAdded - a.dateAdded;
						});
						results = results.slice(0, 6);
					}
					var resultsLen = results.length;
					firstResult = results.shift();
					var firstTitle = matcher(xmlEncode(firstResult.title), v);
					var firstURL = {text: xmlEncode(firstResult.url)};
					if (!firstTitle.matched) firstURL = matcher(firstURL.text, v);
					setSuggest(firstTitle.text + ' <dim>-</dim> <url>' + firstURL.text + '</url>');
					var suggestions = [];
					for (var i = 0, l = results.length; i < l; i++) {
						var result = results[i];
						var title = matcher(xmlEncode(result.title), v);
						var URL = result.url;
						var url = {text: xmlEncode(URL)};
						if (!title.matched) url = matcher(url.text, v);
						suggestions.push({
							content: URL,
							description: title.text + ' <dim>-</dim> <url>' + url.text + '</url>'
						});
					}
					suggest(suggestions);
					suggestions = null;
					results = null;
					vPattern = null;
				});
			});

			chrome.omnibox.onInputEntered.addListener(function (text) {
				if (!text || !firstResult) {
					resetSuggest();
					return;
				}
				var url = (text == omniboxValue) ? firstResult.url : text;
				chrome.tabs.getSelected(null, function (tab) {
					chrome.tabs.update(tab.id, {
						url: url,
						selected: true
					});
				});
			});
		}

		if (localStorage.customIcon) {
			var canvas = document.createElement('canvas');
			var ctx = canvas.getContext('2d');
			var customIcon = JSON.parse(localStorage.customIcon);
			var imageData = ctx.getImageData(0, 0, 19, 19);
			for (var key in customIcon) imageData.data[key] = customIcon[key];
			chrome.browserAction.setIcon({imageData: imageData});
		}

		function getExtensionVersion(callback) {
			var xmlhttp = new XMLHttpRequest();
			xmlhttp.open('GET', 'manifest.json');
			xmlhttp.onload = function (e) {
				var manifest = JSON.parse(xmlhttp.responseText);
				callback(manifest.version);
			};
			xmlhttp.send(null);
		}

		// parse version to dictionary
		var parseVersion = function (strversion) {
			var v = {};
			var keys = [ 'major', 'minor' ];
			var matches = strversion.match(/([\d]+)\.([\d]+)/i);
			if (!matches)
				return v;
			matches.slice(1).forEach(function (m, i) {
				v[keys[i]] = m.toInt();
			});
			return v;
		};

		var myversion;
		getExtensionVersion(function (ver) {
			myversion = parseVersion(ver);
		});

		var xhr = new XMLHttpRequest();
		xhr.open("GET", "https://raw.github.com/windviki/vBookmarks/master/checkupdate.json", true);
		//xhr.open("GET", "checkupdate.json");
		xhr.setRequestHeader("Accept", "application/json");
		xhr.onreadystatechange = function () {
			if (xhr.readyState == 4 && xhr.status == 200) {
				var resp = JSON.parse(xhr.responseText);
				var latestversion = parseVersion(resp.latest);
				if (!latestversion || !latestversion['major'] || !latestversion['minor']) {
					return;
				}
				if ((latestversion['major'] > myversion['major']) ||
					((latestversion['major'] == myversion['major']) && (latestversion['minor'] > myversion['minor']))) {
					//save
					localStorage.checkupdate = xhr.responseText;
					var notification = webkitNotifications.createHTMLNotification('notification.html');
					notification.onclose = function () {
						localStorage.checkupdate = '';
					};
					//notification.onclick = function() { }
					notification.show();
				}
			}
		};
		xhr.send(null);
	});
})(window);