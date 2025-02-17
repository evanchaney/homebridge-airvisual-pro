var Service, Characteristic;
var exec = require("child_process").exec;

module.exports = function(homebridge){
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-airvisual-pro", "AirVisualPro", AirVisualProAccessory);
}

function AirVisualProAccessory(log, config) {
	var informationService;
	var carbondioxideService;
	var airqualityService;
	var temperatureService;
	var humidityService;
	
	this.log = log;
	this.ip = config["ip"];
	this.user = config["user"];
	this.pass = config["pass"];
	this.co2_critical = config["co2_critical"];
	this.logging = config["logging"] || false;
	
	this.airdata = '';
	this.aq_status = Characteristic.AirQuality.UNKNOWN;
	
	this.aqi = 0;
	this.pm25 = 0;
	this.pm10 = 0;
	this.temp_c = 0;
	this.hm = 0;
	this.co2 = 0;
	
	setInterval((function () {
		this.refresh();
	}).bind(this), 10000);
}


AirVisualProAccessory.prototype = {
	httpRequest: function(url, method, callback) {
	request({
		url: url,
		method: method
	},
	function (error, response, body) {
		//callback(error, response, body);
	})
},


identify: function(callback) {
	this.log("Identify requested!");
	callback(); // success
},

refresh: function() {
	var that = this;
	if (that.logging) {
		this.log ("Refreshing values...");
	}

	const smbCmd = `smbclient -U ${that.user}%${that.pass} ` +
		`//${that.ip}/airvisual ` +
		// Get the contents of latest_config_measurements.json and write
		// it to stdout.
		"-c 'get latest_config_measurements.json -' " +
		// Avoid NT_STATUS_CONNECTION_DISCONNECTED error. AirVisual Pro
		// does not appear to support SMB2 or SMB3 which are the default
		// protocols supported by Samba circa December 2024.
		"--option='client min protocol=NT1' " +
		// By default, smbclient writes progress messages to stderr and
		// error messages to stdout. To ensure an error message isn't
		// interpreted as data returned from the AirVisual Pro tell
		// smbclient to send both errors and progress messages to stderr
		// instead of stdout.
		'-E'
	
	exec(smbCmd, (error, stdout, stderr) => {
		if (that.logging) {
			that.log("[stdout]: " + JSON.stringify(stdout));
			that.log("[error]: " + JSON.stringify(error));
			that.log("[stderr]: " + JSON.stringify(stderr));
		}

		// smbclient behaves in unconventional ways when it comes to
		// where and when it writes output.
		//
		// For example, by default it appears to write error messages
		// to stdout rather than stderr.
		//
		// As a guard against misleading SyntaxErrors when parsing
		// stdout don't attempt to parse stdout if an error is known
		// to have occurred. Clearly state an error occurred and abort
		// the refresh instead.
		if (error) {
			if (that.logging) {
				that.log("Data refresh failed due to an error")
			}
			return
		}

		if (stdout.trim() === '') {
			if (that.logging) {
				that.log("Data refresh failed because stdout is blank")
			}
			return
		}

		try {
			that.airdata = JSON.parse(stdout);
		} catch (ex) {
			if (that.logging) {
				that.log("Parsing stdout failed:")
				that.log(ex)
			}
		}
	});
	
	if(that.airdata.measurements) {
		var l_pm25_aqius;
		var l_pm25_ugm3;
		var l_pm10_ugm3;
		var l_temperature_C;
		var l_humidity_RH;
		var l_co2_ppm;
		if(Array.isArray(that.airdata.measurements)) {
			l_pm25_aqius = that.airdata.measurements[0].pm25_AQIUS;
			l_pm25_ugm3 = that.airdata.measurements[0].pm25_ugm3;
			l_pm10_ugm3 = that.airdata.measurements[0].pm10_ugm3;
			l_temperature_C = that.airdata.measurements[0].temperature_C;
			l_humidity_RH = that.airdata.measurements[0].humidity_RH;
			l_co2_ppm = that.airdata.measurements[0].co2_ppm;
		} else {
			l_pm25_aqius = that.airdata.measurements.pm25_AQIUS;
			l_pm25_ugm3 = that.airdata.measurements.pm25_ugm3;
			l_pm10_ugm3 = that.airdata.measurements.pm10_ugm3;
			l_temperature_C = that.airdata.measurements.temperature_C;
			l_humidity_RH = that.airdata.measurements.humidity_RH;
			l_co2_ppm = that.airdata.measurements.co2_ppm;
		}

		// Set AQI
		if (that.logging && that.aqi != l_pm25_aqius) {
			that.log ("AQI - " + that.aqi + " -> " + l_pm25_aqius);
		}
		that.aqi = Number(l_pm25_aqius);
		that.setAirQuality(that.aqi);

		// PM2.5 concentration
		if (that.logging && that.pm25 != l_pm25_ugm3) {
			that.log ("PM2.5 (ug/m3) - " + that.pm25 + " -> " + l_pm25_ugm3);
		}
		that.pm25 = Number(l_pm25_ugm3);
		that.setPM25Density();

		// Set PM10 concentration
		if (that.logging && that.pm10 != l_pm10_ugm3) {
			that.log ("PM10 (ug/m3) - " + that.pm10 + " -> " + l_pm10_ugm3);
		}
		that.pm10 = Number(l_pm10_ugm3);
		that.setPM10Density();

		// Set temp
		if (that.logging && that.temp_c != l_temperature_C) {
			that.log ("Temperature (C) - " + that.temp_c + " -> " + l_temperature_C);
		}
		that.temp_c = Number(l_temperature_C);
		that.setCurrentTemperature();

		// Set humidity
		if (that.logging && that.hm != l_humidity_RH) {
			that.log ("Humidity (%) - " + that.hm + " -> " + l_humidity_RH);
		}
		that.hm = Number(l_humidity_RH);
		that.setHumidity();

		// Set CO2
		if (that.logging && that.co2 != l_co2_ppm) {
			that.log ("CO2 (ppm) - " + that.co2 + " -> " + l_co2_ppm);
		}
		that.co2 = Number(l_co2_ppm);
		that.setCarbonDioxide();
		that.setCarbonDioxideDetected();
	}
},

getAirQuality: function (callback) {
	var that = this;
	callback(null, that.aq_status);
},  

setAirQuality: function (aqi) {
	var that = this;

	// Values are aligned to the "Levels of concern" descriptors used in
	// the U.S. EPA air quality index. For example, in the U.S. EPA AQI
	// 0-50 is described as "Good", 51-100 is described as "Moderate",
	// 101-150 is "Unhealthy for sensitive groups" and levels above 150
	// are described as "Unhealthy", "Very unhealthy" and "Hazardous".
	if (aqi === 0) {
		that.aq_status = Characteristic.AirQuality.EXCELLENT
	} else if (aqi > 0 && aqi <= 50) {
		that.aq_status = Characteristic.AirQuality.GOOD;
	} else if (aqi > 50 && aqi <= 100) {
		that.aq_status = Characteristic.AirQuality.FAIR;
	} else if (aqi > 100 && aqi <= 150) { 
		that.aq_status = Characteristic.AirQuality.INFERIOR;
	} else if (aqi > 150) {
		that.aq_status = Characteristic.AirQuality.POOR;
	} else {
		that.aq_status = Characteristic.AirQuality.UNKNOWN;
	}
	that.airqualityService.setCharacteristic(Characteristic.AirQuality, that.aq_status);
},

getCurrentTemperature: function (callback) {
	var that = this;
	callback(null, that.temp_c);
},  

setCurrentTemperature: function() {
	var that = this;
	this.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, that.temp_c);
},

getTemperatureUnits: function (callback) {
	var that = this;
	// 1 = F and 0 = C
	callback (null, 0);
},

getPM25Density: function (callback) {
	var that = this;
	if (that.logging) {
		that.log ("getting PM2.5 Density");
	}
	callback(null, that.pm25);
},  

setPM25Density: function() {
	var that = this;
	that.airqualityService.setCharacteristic(Characteristic.PM2_5Density, that.pm25);
},

getPM10Density: function (callback) {
	var that = this;
	if (that.logging) {
		that.log ("getting PM10 Density");
	}
	callback(null, that.pm10);
},  

setPM10Density: function() {
	var that = this;
	that.airqualityService.setCharacteristic(Characteristic.PM10Density, that.pm10);
},

getHumidity: function (callback) {
	var that = this;
	if (that.logging) {
		that.log ("getting Humidity");
	}
	callback(null, that.hm);
},  

setHumidity: function() {
	var that = this;
	that.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, that.hm);
},

getCarbonDioxide: function (callback) {
	var that = this;
	callback(null, that.co2);
},  

setCarbonDioxide: function() {
	var that = this;
	this.carbondioxideService.setCharacteristic(Characteristic.CarbonDioxideLevel, that.co2);
},

getCarbonDioxideDetected: function (callback) {
	var that = this;
	if(that.co2 > that.co2_critical) {
		callback(null, 1);
	} else {
		callback(null, 0);
	}
},  

setCarbonDioxideDetected: function() {
	var that = this;
	if(that.co2 > that.co2_critical) {
		if (that.logging) {
			that.log ("Carbon Dioxide Detected!");
		}
		that.carbondioxideService.setCharacteristic(Characteristic.CarbonDioxideDetected, 1);
	} else {
		that.carbondioxideService.setCharacteristic(Characteristic.CarbonDioxideDetected, 0);
	}
},

getServices: function() {
	// you can OPTIONALLY create an information service if you wish to override
	// the default values for things like serial number, model, etc.
	this.informationService = new Service.AccessoryInformation();
	this.airqualityService = new Service.AirQualitySensor();
	this.temperatureService = new Service.TemperatureSensor();
	this.carbondioxideService = new Service.CarbonDioxideSensor();
	this.humidityService = new Service.HumiditySensor();
	
	this.informationService
		.setCharacteristic(Characteristic.Manufacturer, "IQAir AirVisual")
		.setCharacteristic(Characteristic.Model, "AirVisual Pro")
		.setCharacteristic(Characteristic.SerialNumber, this.ip)
	
	this.airqualityService
		.getCharacteristic(Characteristic.AirQuality)
		.on('get', this.getAirQuality.bind(this));
	
	this.airqualityService
		.getCharacteristic(Characteristic.PM2_5Density)
		.on('get', this.getPM25Density.bind(this));
	
	this.airqualityService
		.getCharacteristic(Characteristic.PM10Density)
		.on('get', this.getPM10Density.bind(this));
	
	this.carbondioxideService
		.getCharacteristic(Characteristic.CarbonDioxideDetected)
		.on('get', this.getCarbonDioxideDetected.bind(this));
	
	this.carbondioxideService
		.getCharacteristic(Characteristic.CarbonDioxideLevel)
		.on('get', this.getCarbonDioxide.bind(this));
	
	this.temperatureService
		.getCharacteristic(Characteristic.CurrentTemperature)
		.on('get', this.getCurrentTemperature.bind(this));
	
	this.humidityService
		.getCharacteristic(Characteristic.CurrentRelativeHumidity)
		.on('get', this.getHumidity.bind(this));
	
	return [this.informationService, this.airqualityService, this.temperatureService, this.carbondioxideService, this.humidityService];
	}
};
