function Setting(id, name) {
	this.id = id;
	this.name = name;
	this.options = [];
	this.optionsById = {};
}

function SettingOption(id, name) {
	this.id = id;
	this.name = name;
}

Setting.prototype.addOptions = function(options) {
	for (var id in options) {
		var option = new SettingOption(id, options[id]);
		this.options.push(option);
		this.optionsById[id] = option;
	}
};

var GoProWizard = {
	BASE_URL: 'http://10.5.5.9/gp/gpControl',
	BASE_URL_MEDIA: 'http://10.5.5.9:8080/gp/gpMediaList',
	BASE_URL_THUMB: 'http://10.5.5.9:8080/gp/gpMediaMetadata',

	settingsCache: {},
	prevSettingsCache: {},

	currentState: null,
	controlState: null,

	controlTypes: {},

	dummyMode: false,

	init: function() {
		GoProWizard.fetchCameraAPI();
	},

	fetchCameraAPI: function() {
		$.ajax({
			url: GoProWizard.dummyMode
				? 'dummy-data/gpControl.json?v=' + new Date()
				: GoProWizard.BASE_URL,
			type: 'GET',
			dataType: 'json',
			timeout: 5000,
			success: function(response) {
				GoProWizard.controlState = response;
				GoProWizard.initSettingsTab();
				GoProWizard.fetchCameraStatus();
			}
		});
	},

	fetchCameraStatus: function() {
		$.ajax({
			url: GoProWizard.dummyMode
				? 'dummy-data/gpControl-status.json?v=' + new Date()
				: GoProWizard.BASE_URL + '/status',
			type: 'GET',
			dataType: 'json',
			timeout: 5000,
			success: function(response) {
				GoProWizard.currentState = response;
				GoProWizard.syncCameraInfo();
				GoProWizard.syncStatusTab();
				GoProWizard.syncSettingsTab();
				GoProWizard.fetchMediaList();
			}
		});

		GoProWizard.initSettingsTab();
	},

	fetchMediaList: function() {
		$.ajax({
			url: GoProWizard.dummyMode
				? 'dummy-data/mediaList.json?v=' + new Date()
				: GoProWizard.BASE_URL_MEDIA,
			type: 'GET',
			dataType: 'json',
			timeout: 5000,
			success: function(response) {
				// XXX: only looks one layer deep

				var fileList = [];

				for (var i = 0; i < response.media.length; i++) {
					var dirName = response.media[i].d;
					var files = response.media[i].fs;

					if (!dirName || !files)
						continue;

					for (var j = 0; j < files.length; j++) {
						var filename = dirName + '/' + files[j].n;
						var size = files[j].s;
						var mtime = files[j].mod;
						var date = new Date(0);
						date.setUTCSeconds(mtime);
						fileList.push({filename: filename, size: size, date: date});
					}
				}

				GoProWizard.updateMediaList(fileList);
			},
			error: function(response) {
				alert('Error!');
			}
		});
	},

	updateMediaList: function(fileList) {
		var tab = $('#media-tab');

		tab.html('');

		for (var i = 0; i < fileList.length; i++) {
			var block = $('<span class="gopro-thumbnail"></span>');
			block.append('<img />');
			block.append('<div class="gopro-filedate"></div>');
			block.append('<div class="gopro-filesize"></div>');

			if (GoProWizard.dummyMode)
				block.children('img').attr('src', 'dummy-data/thumb.jpg');
			else
				block.children('img').attr('src',
					GoProWizard.BASE_URL_THUMB + '?p=' + fileList[i].filename);
			block.children('.gopro-filesize').text(humanReadableBytes(fileList[i].size));
			block.children('.gopro-filedate').text(GoProWizard.formatDate(fileList[i].date));

			block.appendTo(tab);
		}
	},

	initSettingsTab: function() {
		var tab = $('#settings-tab');

		tab.html('');

		var list = $('<ul class="goprolist"></ul>')
			.appendTo(tab);

		var displayHints = GoProWizard.controlState.display_hints;

		GoProWizard.controlTypes = {};

		for (var i = 0; i < displayHints.length; i++) {
			for (var j = 0; j < displayHints[i].settings.length; j++) {
				var hint = displayHints[i].settings[j];
				var settingId = hint.setting_id;
				var widgetType = hint.widget_type;
				GoProWizard.controlTypes[settingId] = widgetType;
			}
		}

		for (var i = 0; i < GoProWizard.controlState.modes.length; i++) {
			var mode = GoProWizard.controlState.modes[i];

			if (mode.settings.length == 0)
				continue;

			$('<h3 class="goprolist-section"></h3>')
				.text(mode.display_name)
				.appendTo(list);

			var seenSettings = {};

			for (var j = 0; j < mode.settings.length; j++) {
				let settingId = mode.settings[j].id;

				if (seenSettings[settingId])
					continue;

				seenSettings[settingId] = true;

				var listItem = $('<li></li>').appendTo(list);

				var listName = $('<span class="goprolist-name"></span>')
					.text(mode.settings[j].display_name)
					.appendTo(listItem);

				var listValue = $('<span class="goprolist-setting-value"></span>')
					.appendTo(listItem);

				listValue.append('<img src="images/svg/warning.svg" class="gopro-statusicon gopro-warnicon" title="Failed to update setting" alt="Fail" />');
				listValue.append('<img src="images/svg/undo-arrow-symbol.svg" class="gopro-statusicon gopro-undoicon" title="Undo last change" alt="Undo" />');
				listValue.children('img').hide();

				listValue.children('.gopro-undoicon').click(function() {
					GoProWizard.undoSettingChange(settingId);
				});

				var slist = $('<select></select>');

				for (var k = 0; k < mode.settings[j].options.length; k++) {
					$('<option></option>')
						.attr('value', mode.settings[j].options[k].value)
						.text(mode.settings[j].options[k].display_name)
						.appendTo(slist);
				}

				slist
					.attr('id', 'goprosetting-' + mode.settings[j].id)
					.attr('goprosetting-id', mode.settings[j].id)
					.change(GoProWizard.handleSettingChange)
					.appendTo(listValue);
			}
		}
	},

	syncCameraInfo: function() {
		if (!GoProWizard.controlState)
			return;

		var text1 = $('<div></div>').text('GoPro ' + GoProWizard.controlState.info.model_name);
		var text2 = $('<div></div>').text('Firmware ' + GoProWizard.controlState.info.firmware_version);
		var text3 = $('<div></div>').text('Serial #' + GoProWizard.controlState.info.serial_number);

		$('#gopro-device-info span').append(text1);
		$('#gopro-device-info span').append(text2);
		$('#gopro-device-info span').append(text3);
		$('#gopro-device-info img').attr('src', 'images/models/' + GoProWizard.controlState.info.model_number + '.png');
	},

	syncStatusTab: function() {
		if (!GoProWizard.currentState)
			return;

		var tab = $('#status-tab');
		var state = GoProWizard.currentState.status;

		tab.html('');

		var list = $('<ul class="goprolist"></ul>')
			.appendTo(tab);

		var stateList = [];

		if ('40' in state) {
			var date = GoProWizard.decodeGPDate(state['40']);

			var dateObj = $('<span class="gopro-date"><span></span></span>')
			dateObj.children(0).text(GoProWizard.formatDate(date));
			dateObj.append('<input type="button" value="Sync" />');
			dateObj.children(1).click(GoProWizard.syncDate);

			stateList.push({name: 'Time and Date', value: dateObj});
		}

		if ('1' in state && '2' in state) {
			let name = 'Battery';
			var img, imgObj;

			if (state['1'] == '0') {
				img = '006-no-battery.svg';
			} else {
				if (state['2'] == '1')
					img = '002-low-battery.svg';
				else if (state['2'] == '2')
					img = '003-battery-level.svg';
				else if (state['2'] == '3')
					img = '004-battery-status.svg';
				else if (state['2'] == '4')
					img = '005-battery-charger.svg';
				else
					img = '001-exclamation-mark.svg';
			}

			imgObj = $('<img src="images/svg/' + img + '" class="gopro-statusicon" />');

			stateList.push({name: name, value: imgObj});
		}

		let camMode;

		if ('43' in state) {
			let name = 'Camera mode';
			let val = '?';

			if (state['43'] == '0')
				val = 'Video';
			else if (state['43'] == '1')
				val = 'Photo';
			else if (state['43'] == '2')
				val = 'MultiShot';

			camMode = val;

			stateList.push({name: name, value: val});
		}

		if ('44' in state) {
			let name = 'Camera sub-mode';
			let val = '?';

			if (camMode == 'Video') {
				if (state['44'] == '0')
					val = 'Video';
				else if (state['44'] == '1')
					val = 'Timelapse video';
				else if (state['44'] == '2')
					val = 'Video+photo';
			} else if (camMode == 'Photo') {
				if (state['44'] == '0')
					val = 'Single pic';
				else if (state['44'] == '1')
					val = 'Continuous';
				else if (state['44'] == '2')
					val = 'Night photo';
			} else if (camMode == 'MultiShot') {
				if (state['44'] == '0')
					val = 'Burst';
				else if (state['44'] == '1')
					val = 'Timelapse';
				else if (state['44'] == '2')
					val = 'Nightlapse';
			}

			stateList.push({name: name, value: val});
		}

		if ('13' in state) {
			let name = 'Current video duration';
			let val = state['13'] + ' seconds';

			stateList.push({name: name, value: val});
		}

		if ('39' in state) {
			let name = 'Number of MultiShot photos taken';
			let val = state['39'];

			stateList.push({name: name, value: val});
		}

		if ('31' in state) {
			let name = 'Connected clients';
			let val = state['31'];

			stateList.push({name: name, value: val});
		}

		if ('32' in state) {
			let name = 'Streaming state';
			let val = state['32'];

			if (val == '1')
				val = 'Streaming';
			else
				val = 'Not streaming';

			stateList.push({name: name, value: val});
		}

		if ('33' in state) {
			let name = 'SD card';
			let val = state['33'];

			if (val == '2')
				val = 'Not present';
			else if (val == '0')
				val = 'Inserted';
			else
				val = '?';

			stateList.push({name: name, value: val});
		}

		if ('34' in state) {
			let name = 'Remaining photos';
			let val = state['34'];

			stateList.push({name: name, value: val});
		}

		if ('35' in state) {
			let name = 'Remaining video time';
			let val = state['35'];

			stateList.push({name: name, value: val});
		}

		if ('36' in state) {
			let name = 'Batch photos taken';
			let val = state['36'];

			stateList.push({name: name, value: val});
		}

		if ('37' in state) {
			let name = 'Videos shot';
			let val = state['37'];

			stateList.push({name: name, value: val});
		}

		if ('38' in state) {
			let name = 'ALL photos taken';
			let val = state['38'];

			stateList.push({name: name, value: val});
		}

		if ('39' in state) {
			let name = 'ALL videos shot';
			let val = state['39'];

			stateList.push({name: name, value: val});
		}

		if ('8' in state) {
			let name = 'Recording/processing';
			let val = state['8'];

			if (val == '0')
				val = 'No';
			else if (val == '1')
				val = 'Yes';
			else
				val = '?';

			stateList.push({name: name, value: val});
		}

		if ('54' in state) {
			let name = 'Free space on SD card';
			let val = humanReadableBytes(state['54']);

			stateList.push({name: name, value: val});
		}

		for (var i = 0; i < stateList.length; i++) {
			var listItem = $('<li></li>');
			var listItemValue = $('<span class="goprolist-value"></span>');

			$('<span class="goprolist-name"></span>')
				.append(document.createTextNode(stateList[i].name))
				.appendTo(listItem);

			if (stateList[i].value instanceof Object) {
				listItemValue.append(stateList[i].value);
			} else {
				listItemValue.append(document.createTextNode(stateList[i].value));
			}

			listItemValue.appendTo(listItem);
			listItem.appendTo(list);
		}
	},

	syncSettingsTab: function() {
		if (!GoProWizard.currentState)
			return;

		var newSettings = GoProWizard.currentState.settings;

		var settingsControls = $('.goprolist-setting-value select');

		settingsControls.each(function() {
			var control = $(this);

			var settingId = control.attr('goprosetting-id');

			if (settingId in newSettings) {
				GoProWizard.settingsCache[settingId] = newSettings[settingId];
				control.val(newSettings[settingId]);
			}
		});
	},

	handleSettingChange: function() {
		var settingId = $(this).attr('goprosetting-id');
		var settingValue = $(this).val();
		GoProWizard.updateSettingOnCamera(settingId, settingValue);
	},

	updateSettingOnCamera: function(id, value, undoing = false) {
		var selectElem = $('#goprosetting-' + id);
		selectElem.prop('disabled', true);
		selectElem.removeClass('gopro-setting-error');

		if (undoing) {
			var undoIcon = selectElem.siblings('.gopro-undoicon');
			undoIcon.css('pointer-events', 'none');
			undoIcon.addClass('inactive');
		}

		var _undoing = undoing;

		$.ajax({
			url: GoProWizard.dummyMode
				? 'dummy-data/nothing.json?v=' + new Date()
				: GoProWizard.BASE_URL + '/setting/' + id + '/' + value,
			type: 'GET',
			dataType: 'json',
			timeout: 5000,
			success: function(response) {
				GoProWizard.prevSettingsCache[id] =
					GoProWizard.settingsCache[id];
				GoProWizard.settingsCache[id] = value;

				selectElem.prop('disabled', false);
				selectElem.siblings('.gopro-warnicon').hide();

				var undoIcon = selectElem.siblings('.gopro-undoicon');

				undoIcon.css('pointer-events', '');
				undoIcon.removeClass('inactive');

				if (_undoing) {
					undoIcon.hide();
					delete GoProWizard.prevSettingsCache[id];
				} else {
					undoIcon.show();
				}
			},
			error: function(response) {
				alert('Error!');
				selectElem.val(GoProWizard.settingsCache[id]);
				selectElem.prop('disabled', false);
				selectElem.siblings('.gopro-warnicon').show();

				var undoIcon = selectElem.siblings('.gopro-undoicon');

				undoIcon.css('pointer-events', '');
				undoIcon.removeClass('inactive');
			}
		});
	},

	decodeGPDate: function(gpDate) {
		var parts = gpDate.split('%');

		var date = new Date(
			2000 + parseInt(parts[1], 16),
			parseInt(parts[2], 16) - 1,
			parseInt(parts[3], 16),
			parseInt(parts[4], 16),
			parseInt(parts[5], 16),
			parseInt(parts[6], 16)
		);

		return date;
	},

	encodeGPDate: function(date) {
		if (!(date instanceof Date))
			throw 'Unable to encode date';

		var encodedDate =
			'%' + (date.getFullYear() - 2000).toString(16)
			+ '%' + (1 + date.getMonth()).toString(16)
			+ '%' + (date.getDate()).toString(16)
			+ '%' + date.getHours().toString(16)
			+ '%' + date.getMinutes().toString(16)
			+ '%' + date.getSeconds().toString(16);

		return encodedDate;
	},

	formatDate: function(date) {
		if (!(date instanceof Date))
			throw 'Unable to format date';

		var year = date.getFullYear();
		var month = 1 + date.getMonth();
		var day = date.getDate();
		var hour = date.getHours()
		var min = date.getMinutes();
		var sec = date.getSeconds();

		month = month < 10 ? '0' + month : month;
		day = day < 10 ? '0' + day : day;
		hour = hour < 10 ? '0' + hour : hour;
		min = min < 10 ? '0' + min : min;
		sec = sec < 10 ? '0' + sec : sec;

		var datestr = [ year, month, day ].join('-');
		var timestr = [ hour, min, sec ].join(':');

		return datestr + ' ' + timestr;
	},

	syncDate: function() {
		var button = $(this);
		button.prop('disabled', true);
		var datestr = GoProWizard.encodeGPDate(new Date());
		$.ajax({
			url: GoProWizard.dummyMode
				? 'dummy-data/nothing.json?v=' + new Date()
				: GoProWizard.BASE_URL + '/command/setup/date_time?p=' + datestr,
			type: 'GET',
			dataType: 'json',
			timeout: 5000,
			success: function(response) {
				button.prop('disabled', true);
			},
			error: function() {
				alert('Error!');
			}
		});
	},

	undoSettingChange: function(settingId) {
		var selectElem = $('#goprosetting-' + settingId);
		var prevSetting = GoProWizard.prevSettingsCache[settingId];
		selectElem.val(prevSetting);
		GoProWizard.updateSettingOnCamera(settingId, prevSetting, true);
	}
};

function humanReadableBytes(bytes, si) {
	var thresh = si ? 1000 : 1024;

	if (Math.abs(bytes) < thresh) {
		return bytes + ' B';
	}

	var units = si
		? ['kB','MB','GB','TB','PB','EB','ZB','YB']
		: ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
	var u = -1;
	do {
		bytes /= thresh;
		++u;
	} while (Math.abs(bytes) >= thresh && u < units.length - 1);

	return bytes.toFixed(1) + ' ' + units[u];
}
