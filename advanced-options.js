(function(window) {
	var document = window.document;
	var chrome = window.chrome;
	var _m = chrome.i18n.getMessage;
	var __m = _m;
	
	document.addEventListener('DOMContentLoaded', function () {
		
	document.title = _m('extName') + ' ' + _m('advancedOptions');
	
	var customIconPreview = $('custom-icon-preview').firstElementChild;
	var canvas = document.createElement('canvas');
	canvas.width = canvas.height = 19;
	var ctx = canvas.getContext('2d');
	var dontLoad = true;
	customIconPreview.onload = function(){
		if (dontLoad){
			dontLoad = false;
			return;
		}
		ctx.clearRect(0, 0, 19, 19);
		ctx.drawImage(customIconPreview, 0, 0, 19, 19);
		var imageData = ctx.getImageData(0, 0, 19, 19);
		chrome.browserAction.setIcon({imageData: imageData});
		localStorage.customIcon = JSON.stringify(imageData.data);
	};
	if (localStorage.customIcon){
		var customIcon = JSON.parse(localStorage.customIcon);
		var imageData = ctx.getImageData(0, 0, 19, 19);
		for (var key in customIcon) imageData.data[key] = customIcon[key];
		ctx.putImageData(imageData, 0, 0);
		customIconPreview.src = canvas.toDataURL();
	}
	
	var customIconFile = $('custom-icon-file');
	customIconFile.addEventListener('change', function(){
		var files = this.files;
		if (files && files.length){
			var file = files[0];
			if (/image\/[a-z]+/i.test(file.type)){
				reader = new FileReader();
				reader.onload = function(e){
					var result = e.target.result;
					customIconPreview.src = result;
				};
				reader.readAsDataURL(files[0]);
			} else {
				alert('Not an image. Try another one.');
			}
		}
	});
	
	var defaultIconButton = $('default-icon-button');
	defaultIconButton.addEventListener('click', function(){
		delete localStorage.customIcon;
		chrome.browserAction.setIcon({path: 'icon.png'});
		dontLoad = true;
		customIconPreview.src = 'icon.png';
	});
	
	var customSeparatorColor = $('custom-separator-color');
	if (localStorage.separatorcolor) customSeparatorColor.value = localStorage.separatorcolor;
	customSeparatorColor.addEventListener('change', function(){
		localStorage.separatorcolor = customSeparatorColor.value;
	});
	
	var customSeparatorTitle = $('custom-separator-title');
	if (localStorage.separatorTitle) {
		customSeparatorTitle.value = localStorage.separatorTitle;
	} else {
		customSeparatorTitle.value = '|';
	}
	customSeparatorTitle.addEventListener('change', function(){
		localStorage.separatorTitle = customSeparatorTitle.value;
	});
	
	var customSeparatorUrl = $('custom-separator-url');
	if (localStorage.separatorUrl) {
		customSeparatorUrl.value = localStorage.separatorUrl;
	} else {
		customSeparatorUrl.value = 'http://separatethis.com/';
	}
	customSeparatorUrl.addEventListener('change', function(){
		localStorage.separatorUrl = customSeparatorUrl.value;
	});
	
	var customSeparatorString = $('custom-separator-string');
	if (localStorage.separatorString) customSeparatorString.value = localStorage.separatorString;
	customSeparatorString.addEventListener('change', function(){
		localStorage.separatorString = customSeparatorString.value;
	});
	
	var textareaUserstyle = $('userstyle');
	if (localStorage.userstyle) textareaUserstyle.value = localStorage.userstyle;
	CodeMirror.fromTextArea(textareaUserstyle, {
		onChange: function(c){
			localStorage.userstyle = c.getValue();
		}
	});
	
	$('reset-button').addEventListener('click', function(){
		localStorage.clear();
		alert('vBookmarks has been reset.');
		location.reload();
	}, false);
		
	window.onerror = function(){chrome.extension.sendRequest({error: [].slice.call(arguments)}) };

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
	document.getElementById('options-footer-1').innerHTML = '<a href="http://twitter.com/cheeaun">' + __m('optionsFooterText', 'Lim Chee Aun') + '</a>';
	document.getElementById('options-footer-2').innerHTML = '<a href="http://twitter.com/windviki">' + __m('optionsFooterText', 'windviki') + '</a>';
	document.getElementById('options-footer-3').innerHTML = '<a href="http://weibo.com/windviki">Follow @windviki on Weibo</a>';
	document.getElementById('options-footer-4').innerHTML = '<a href="http://windviki.github.com/vBookmarks/">vBookmarks Mainpage (docs and source code)</a>';
	});
})(window);