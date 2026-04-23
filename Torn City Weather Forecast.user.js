// ==UserScript==
// @name         TORN CITY Weather Forecast
// @namespace    sanxion.tc.weatherforecast
// @version      1.16.0
// @description  Weather forecast for Torn City. 7-day outlook, colour schemes, hover tooltips, random ticker narration, robust sidebar detection.
// @author       Sanxion [2987640]
// @match        https://www.torn.com/profiles.php*
// @updateURL    https://github.com/Quantarallax/Torn-City-Weather-Forecast/raw/refs/heads/main/Torn%20City%20Weather%20Forecast.user.js
// @downloadURL  https://github.com/Quantarallax/Torn-City-Weather-Forecast/raw/refs/heads/main/Torn%20City%20Weather%20Forecast.user.js
// @license      MIT
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.open-meteo.com
// ==/UserScript==

/*
 * Weather Forecast  v1.16.0
 * ---------------------------------------------------------------------------
 * Weather data: public API, no key required.
 * Refreshes every 30 minutes.
 *
 * Source coordinates: 31.2001 N, 29.9187 E  (never displayed in the widget).
 * Time displayed as TCT (Torn City Time).
 *
 * Defaults on first install: Top, minimised, Black & White scheme.
 * All settings persist across page loads.
 *
 * Colour schemes: Default (navy/cyan), Torn (dark warm grey, white content
 * text), Black & White (monochrome).
 *
 * Settings: full layout in popup or Top-mode; compact icon-only button rows
 * in inline Left-mode panel (fits narrow sidebar without labels).
 *
 * Sidebar fix (175%+ zoom): checks widget's own offsetParent + rect.
 * If the widget is inside a hidden container it is re-parented to Top.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  // =========================================================================
  // CONSTANTS
  // =========================================================================

  var WIDGET_ID = 'tc-rtw-widget';
  var STYLES_ID = 'tc-rtw-styles';
  var POPUP_ID = 'tc-rtw-popup';
  var REFRESH_MS = 30 * 60 * 1000;
  var VERSION = '1.16.0';

  var DAYS = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday',
    'Thursday', 'Friday', 'Saturday'
  ];
  var DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  // Source coordinates: 31.2001 N, 29.9187 E.
  // LOCATIONS.home uses dot notation (ESLint dot-notation satisfied).
  // Keys with spaces use bracket notation - dot notation impossible for those keys.
  var LOCATIONS = {
    home: { name: 'Torn City', country: '', lat: 31.2001, lon: 29.9187 },
    mexico: { name: 'Mexico City', country: 'Mexico', lat: 19.4326, lon: -99.1332 },
    'cayman islands': { name: 'George Town', country: 'Cayman Islands', lat: 19.3133, lon: -81.2546 },
    'south africa': { name: 'Johannesburg', country: 'South Africa', lat: -26.2041, lon: 28.0473 },
    switzerland: { name: 'Zurich', country: 'Switzerland', lat: 47.3769, lon: 8.5417 },
    japan: { name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503 },
    china: { name: 'Beijing', country: 'China', lat: 39.9042, lon: 116.4074 },
    uae: { name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708 },
    dubai: { name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708 },
    hawaii: { name: 'Honolulu', country: 'Hawaii, USA', lat: 21.3069, lon: -157.8583 },
    'united kingdom': { name: 'London', country: 'United Kingdom', lat: 51.5074, lon: -0.1278 },
    argentina: { name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lon: -58.3816 },
    canada: { name: 'Toronto', country: 'Canada', lat: 43.6532, lon: -79.3832 }
  };

  var WMO = {
    0: { desc: 'Clear Sky', short: 'Clear' },
    1: { desc: 'Mainly Clear', short: 'Mainly Clear' },
    2: { desc: 'Partly Cloudy', short: 'Partly Cloudy' },
    3: { desc: 'Overcast', short: 'Overcast' },
    45: { desc: 'Foggy', short: 'Fog' },
    48: { desc: 'Rime Fog', short: 'Icy Fog' },
    51: { desc: 'Light Drizzle', short: 'Lt. Drizzle' },
    53: { desc: 'Drizzle', short: 'Drizzle' },
    55: { desc: 'Heavy Drizzle', short: 'Hvy Drizzle' },
    61: { desc: 'Light Rain', short: 'Lt. Rain' },
    63: { desc: 'Rain', short: 'Rain' },
    65: { desc: 'Heavy Rain', short: 'Hvy Rain' },
    71: { desc: 'Light Snow', short: 'Lt. Snow' },
    73: { desc: 'Snow', short: 'Snow' },
    75: { desc: 'Heavy Snow', short: 'Hvy Snow' },
    77: { desc: 'Snow Grains', short: 'Snow Grains' },
    80: { desc: 'Light Showers', short: 'Lt. Showers' },
    81: { desc: 'Rain Showers', short: 'Showers' },
    82: { desc: 'Violent Showers', short: 'Hvy Showers' },
    85: { desc: 'Snow Showers', short: 'Snow Showers' },
    86: { desc: 'Heavy Snow Showers', short: 'Hvy Snow' },
    95: { desc: 'Thunderstorm', short: 'Thunderstorm' },
    96: { desc: 'T-Storm + Hail', short: 'T-Storm/Hail' },
    99: { desc: 'Severe T-Storm', short: 'Sev. T-Storm' }
  };

  // =========================================================================
  // SETTINGS HELPERS
  // =========================================================================

  function getSetting(key, def) {
    var v = GM_getValue(key, null);
    return v === null ? def : v;
  }

  function setSetting(key, val) {
    GM_setValue(key, val);
  }

  // =========================================================================
  // MODULE STATE - Defaults: Top, minimised, B&W
  // =========================================================================

  var _isMinimised = getSetting('isMinimised', true);
  var _isSettingsOpen = false;
  var _cachedData = null;
  var _currentSkyLight = false;
  var _tickCount = 0;
  var _cachedLocation = null;
  var _forcedTop = false;
  var _resizeTimer = null;

  // =========================================================================
  // LOCATION DETECTION
  // =========================================================================

  function detectLocation() {
    if (!document.body) { return LOCATIONS.home; }

    var pageText = document.body.innerText.toLowerCase();
    var url = window.location.href.toLowerCase();
    var keys = Object.keys(LOCATIONS);
    var i, key, loc, slug;

    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      if (key === 'home') { continue; }
      loc = LOCATIONS[key];
      slug = key.replace(/\s+/g, '');
      if (
        url.indexOf(slug) !== -1 ||
        pageText.indexOf('you are in ' + key) !== -1 ||
        pageText.indexOf('currently in ' + key) !== -1 ||
        pageText.indexOf('travelling to ' + key) !== -1 ||
        pageText.indexOf('traveling to ' + key) !== -1 ||
        pageText.indexOf('arrived in ' + key) !== -1
      ) {
        return loc;
      }
    }

    var candidates = document.querySelectorAll(
      '[class*="travel"] span, [class*="abroad"] span, [class*="location"] span, .status-msg'
    );
    var j, k, el, text, lKey;
    for (j = 0; j < candidates.length; j++) {
      el = candidates[j];
      text = el.textContent.toLowerCase().trim();
      if (text.length > 60) { continue; }
      for (k = 0; k < keys.length; k++) {
        lKey = keys[k];
        if (lKey === 'home') { continue; }
        if (text.indexOf(lKey) !== -1) { return LOCATIONS[lKey]; }
      }
    }

    return LOCATIONS.home;
  }

  // =========================================================================
  // WEATHER API
  // =========================================================================

  function fetchWeather(lat, lon) {
    return new Promise(function (resolve, reject) {
      var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + lat + '&longitude=' + lon +
        '&hourly=temperature_2m,relativehumidity_2m,apparent_temperature,' +
        'precipitation_probability,weathercode,windspeed_10m,winddirection_10m' +
        '&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset,' +
        'precipitation_sum,windspeed_10m_max,uv_index_max,precipitation_probability_max' +
        '&current_weather=true&timezone=GMT&forecast_days=7&windspeed_unit=kmh';

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 15000,
        onload: function (r) {
          try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
        },
        onerror: function (e) { reject(e); },
        ontimeout: function () { reject(new Error('Request timed out')); }
      });
    });
  }

  // =========================================================================
  // TIME-OF-DAY, SKY, LIGHT/DARK
  // =========================================================================

  function getTimeOfDay(utcHour, utcMinute, sunriseISO, sunsetISO) {
    var nowMins = utcHour * 60 + utcMinute;
    var sr = new Date(sunriseISO);
    var ss = new Date(sunsetISO);
    var sunriseMins = sr.getUTCHours() * 60 + sr.getUTCMinutes();
    var sunsetMins = ss.getUTCHours() * 60 + ss.getUTCMinutes();

    if (nowMins < sunriseMins - 75) { return 'night'; }
    if (nowMins < sunriseMins - 20) { return 'pre-dawn'; }
    if (nowMins < sunriseMins + 35) { return 'sunrise'; }
    if (nowMins < sunriseMins + 210) { return 'morning'; }
    if (nowMins < 13 * 60) { return 'midday'; }
    if (nowMins < sunsetMins - 100) { return 'afternoon'; }
    if (nowMins < sunsetMins - 25) { return 'golden-hour'; }
    if (nowMins < sunsetMins + 35) { return 'sunset'; }
    if (nowMins < sunsetMins + 90) { return 'dusk'; }
    return 'night';
  }

  function isSkyLight(tod, wmoCode) {
    if (wmoCode >= 45) { return false; }
    return tod === 'morning' || tod === 'midday' || tod === 'afternoon';
  }

  function getSkyStyle(tod, wmoCode) {
    var stormy = wmoCode >= 95 || (wmoCode >= 80 && wmoCode <= 82);
    var raining = wmoCode >= 51 && wmoCode <= 65;
    var cloudy = wmoCode >= 3 && wmoCode <= 48;

    if (stormy) { return 'linear-gradient(180deg,#121520 0%,#1e2030 40%,#2a2d40 100%)'; }
    if (raining) { return 'linear-gradient(180deg,#1a2030 0%,#253040 50%,#304050 100%)'; }

    var overcastMidday = cloudy
      ? 'linear-gradient(180deg,#5a8faa 0%,#88bdd0 50%,#b8d8e8 100%)'
      : 'linear-gradient(180deg,#0e74cc 0%,#3aa0f0 55%,#8ad4ff 100%)';

    // Hyphenated keys require bracket notation - dot notation impossible.
    var palettes = {
      night: 'linear-gradient(180deg,#010309 0%,#030818 50%,#070d22 100%)',
      'pre-dawn': 'linear-gradient(180deg,#0a0820 0%,#1c0e36 50%,#3a1248 100%)',
      sunrise: 'linear-gradient(180deg,#1a0730 0%,#7c2d5a 30%,#d4623c 65%,#f7aa30 100%)',
      morning: 'linear-gradient(180deg,#3a9ecf 0%,#72c4e8 55%,#d8f0ff 100%)',
      midday: overcastMidday,
      afternoon: 'linear-gradient(180deg,#1a88dd 0%,#4db0f5 55%,#c0e8ff 100%)',
      'golden-hour': 'linear-gradient(180deg,#1a4a7a 0%,#c07a28 55%,#f5c040 100%)',
      sunset: 'linear-gradient(180deg,#2a1258 0%,#c03528 45%,#e8702a 75%,#f5b030 100%)',
      dusk: 'linear-gradient(180deg,#180838 0%,#4a1858 45%,#8a3818 100%)'
    };

    // Variable key - dot notation impossible. Fallback palettes.night is dot notation.
    return palettes[tod] || palettes.night;
  }

  function isNightTod(tod) {
    return tod === 'night' || tod === 'pre-dawn' || tod === 'dusk';
  }

  // =========================================================================
  // SVG WEATHER ICONS
  // =========================================================================

  function sunRays(cx, cy, r, count, stroke, sw) {
    var rays = '';
    var i, angle, x1, y1, x2, y2;
    for (i = 0; i < count; i++) {
      angle = (i / count) * Math.PI * 2;
      x1 = (cx + (r + 3) * Math.cos(angle)).toFixed(1);
      y1 = (cy + (r + 3) * Math.sin(angle)).toFixed(1);
      x2 = (cx + (r + 7) * Math.cos(angle)).toFixed(1);
      y2 = (cy + (r + 7) * Math.sin(angle)).toFixed(1);
      rays += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"' +
        ' stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
    }
    return rays;
  }

  function cloudPath(ox, oy, fill) {
    return '<path d="M' + ox + ' ' + (oy + 10) +
      ' Q' + ox + ' ' + (oy + 2) + ' ' + (ox + 8) + ' ' + (oy + 2) +
      ' Q' + (ox + 9.5) + ' ' + (oy - 4) + ' ' + (ox + 18) + ' ' + (oy - 4) +
      ' Q' + (ox + 27) + ' ' + (oy - 4) + ' ' + (ox + 27) + ' ' + (oy + 4) +
      ' Q' + (ox + 32) + ' ' + (oy + 4) + ' ' + (ox + 32) + ' ' + (oy + 10) +
      ' Q' + (ox + 32) + ' ' + (oy + 16) + ' ' + (ox + 25) + ' ' + (oy + 16) +
      ' L' + (ox + 7) + ' ' + (oy + 16) +
      ' Q' + ox + ' ' + (oy + 16) + ' ' + ox + ' ' + (oy + 10) + 'Z"' +
      ' fill="' + fill + '"/>';
  }

  function svgOpen(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" fill="none">';
  }

  var SVG_CLOSE = '</svg>';

  function getIcon(wmo, night, size) {
    if (size === undefined) { size = 44; }
    var i, fl, f, d, fx, fy, fw, dx, dy, fx2, fy2;
    var stars, starPos, sunPart, fogData, fogSvg, drops, rainSvg, flakes, snowSvg;

    if (wmo === 0 || wmo === 1) {
      if (night) {
        starPos = [[36, 10], [40, 18], [32, 28], [10, 34], [42, 34], [38, 42], [14, 14]];
        stars = '';
        for (i = 0; i < starPos.length; i++) {
          stars += '<circle cx="' + starPos[i][0] + '" cy="' + starPos[i][1] + '"' +
            ' r="' + (i % 2 === 0 ? '1.1' : '0.7') + '" fill="white" opacity="0.6"/>';
        }
        return svgOpen(size) + '<circle cx="18" cy="22" r="10" fill="#e8d060" opacity="0.9"/>' +
          '<circle cx="27" cy="13" r="9" fill="#0a1628"/>' + stars + SVG_CLOSE;
      }
      return svgOpen(size) + '<circle cx="24" cy="24" r="9" fill="#FFD730"/>' +
        sunRays(24, 24, 9, 8, '#FFD730', 2.5) + SVG_CLOSE;
    }

    if (wmo === 2) {
      sunPart = night
        ? '<circle cx="14" cy="20" r="7" fill="#e8d060" opacity="0.85"/><circle cx="20" cy="14" r="6" fill="#0a1628"/>'
        : '<circle cx="14" cy="19" r="7" fill="#FFD730"/>' + sunRays(14, 19, 7, 8, '#FFD730', 1.8);
      return svgOpen(size) + sunPart + cloudPath(10, 18, '#c0d0dc') + SVG_CLOSE;
    }

    if (wmo === 3) {
      return svgOpen(size) + cloudPath(2, 16, '#7898ac') + cloudPath(8, 22, '#c0d0dc') + SVG_CLOSE;
    }

    if (wmo === 45 || wmo === 48) {
      fogData = [[8, 16, 38], [10, 22, 36], [8, 28, 40], [12, 34, 32]];
      fogSvg = '';
      for (fl = 0; fl < fogData.length; fl++) {
        fx = fogData[fl][0]; fy = fogData[fl][1]; fw = fogData[fl][2];
        fogSvg += '<line x1="' + fx + '" y1="' + fy + '" x2="' + (fx + fw) + '" y2="' + fy + '"' +
          ' stroke="#a0b8c8" stroke-width="2.5" stroke-linecap="round" opacity="0.75"/>';
      }
      return svgOpen(size) + fogSvg + SVG_CLOSE;
    }

    if ((wmo >= 51 && wmo <= 65) || (wmo >= 80 && wmo <= 82)) {
      drops = (wmo === 65 || wmo === 82 || wmo === 63 || wmo === 81)
        ? [[15, 38], [21, 41], [27, 38], [33, 41], [18, 35], [24, 37], [30, 35]]
        : [[17, 39], [23, 42], [29, 39], [20, 36], [26, 36]];
      rainSvg = cloudPath(6, 18, '#7898ac');
      for (d = 0; d < drops.length; d++) {
        dx = drops[d][0]; dy = drops[d][1];
        rainSvg += '<line x1="' + dx + '" y1="' + (dy - 5) + '" x2="' + (dx - 2) + '" y2="' + dy + '"' +
          ' stroke="#60b8e8" stroke-width="1.8" stroke-linecap="round" opacity="0.9"/>';
      }
      return svgOpen(size) + rainSvg + SVG_CLOSE;
    }

    if ((wmo >= 71 && wmo <= 77) || wmo === 85 || wmo === 86) {
      flakes = [[15, 38], [21, 41], [27, 38], [33, 41], [18, 35], [24, 37], [30, 35]];
      snowSvg = cloudPath(6, 17, '#b8ccd8');
      for (f = 0; f < flakes.length; f++) {
        fx2 = flakes[f][0]; fy2 = flakes[f][1];
        snowSvg += '<circle cx="' + fx2 + '" cy="' + fy2 + '" r="1.5" fill="white" opacity="0.9"/>' +
          '<line x1="' + (fx2 - 3) + '" y1="' + fy2 + '" x2="' + (fx2 + 3) + '" y2="' + fy2 + '"' +
          ' stroke="white" stroke-width="1" opacity="0.7"/>' +
          '<line x1="' + fx2 + '" y1="' + (fy2 - 3) + '" x2="' + fx2 + '" y2="' + (fy2 + 3) + '"' +
          ' stroke="white" stroke-width="1" opacity="0.7"/>';
      }
      return svgOpen(size) + snowSvg + SVG_CLOSE;
    }

    if (wmo >= 95) {
      return svgOpen(size) + cloudPath(4, 14, '#4a5568') +
        '<polygon points="22,33 17,43 23,43 18,52 31,38 24,38 29,33" fill="#FFD730"/>' + SVG_CLOSE;
    }

    return svgOpen(size) + cloudPath(6, 16, '#c0d0dc') + SVG_CLOSE;
  }

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  function fmtTemp(celsius, unit) {
    if (unit === 'F') { return Math.round(celsius * 9 / 5 + 32) + '\u00b0F'; }
    return Math.round(celsius) + '\u00b0C';
  }

  function windDir(deg) {
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function parseHHMM(isoStr) {
    var d = new Date(isoStr);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  function utcNow() {
    var n = new Date();
    return {
      dayShort: DAYS3[n.getUTCDay()], dayFull: DAYS[n.getUTCDay()],
      date: n.getUTCDate(), month: MONTHS[n.getUTCMonth()],
      hh: pad2(n.getUTCHours()), mm: pad2(n.getUTCMinutes()),
      h: n.getUTCHours(), min: n.getUTCMinutes()
    };
  }

  // All time display uses TCT (Torn City Time) label instead of UTC
  function clockHTML(light) {
    var t = utcNow();
    var col = light ? '#0070aa' : '#00d4ff';
    return t.dayShort + ' ' + t.date + ' ' + t.month +
      '&nbsp;&nbsp;' + t.hh + ':' + t.mm +
      ' <span style="color:' + col + ';font-size:8px;letter-spacing:.5px">TCT</span>';
  }

  function starsHTML(count) {
    var html = '';
    var i, x, y, sz, dl, dr;
    for (i = 0; i < count; i++) {
      x = (Math.random() * 92 + 2).toFixed(1);
      y = (Math.random() * 55 + 2).toFixed(1);
      sz = (Math.random() * 1.4 + 0.4).toFixed(1);
      dl = (Math.random() * 3).toFixed(1);
      dr = (Math.random() * 2 + 1.2).toFixed(1);
      html += '<div class="tcw-star" style="left:' + x + '%;top:' + y + '%;width:' + sz +
        'px;height:' + sz + 'px;animation-delay:' + dl + 's;animation-duration:' + dr + 's;"></div>';
    }
    return html;
  }

  function wmoDesc(code) { return WMO[code] ? WMO[code].desc : 'Variable'; }
  function wmoShort(code) { return WMO[code] ? WMO[code].short : 'Variable'; }

  // Random picker for varied ticker sentences
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // =========================================================================
  // TEMPERATURE COMPARISON
  // =========================================================================

  function tempCategory(allMaxC, idx) {
    var temp = allMaxC[idx];
    var total = 0;
    var minC = allMaxC[0];
    var maxC = allMaxC[0];
    var i;
    for (i = 0; i < allMaxC.length; i++) {
      total += allMaxC[i];
      if (allMaxC[i] < minC) { minC = allMaxC[i]; }
      if (allMaxC[i] > maxC) { maxC = allMaxC[i]; }
    }
    var avg = total / allMaxC.length;
    var range = maxC - minC;
    if (range < 3) { return 'typical'; }
    if (temp >= maxC - 0.5) { return 'hottest'; }
    if (temp <= minC + 0.5) { return 'coolest'; }
    if (temp > avg + range * 0.25) { return 'warmer'; }
    if (temp < avg - range * 0.25) { return 'cooler'; }
    return 'typical';
  }

  function tempCompNote(category) {
    if (category === 'hottest') { return ', the warmest of the week'; }
    if (category === 'coolest') { return ', the coolest of the forecast'; }
    if (category === 'warmer') { return ', warmer than most days this week'; }
    if (category === 'cooler') { return ', cooler than the rest of the week'; }
    return '';
  }

  // =========================================================================
  // WEATHER NARRATIVE TICKER
  // Plain text only (no emoji). Wide gaps between day announcements.
  // Random presenter sentences for variety on each 30-min refresh.
  // =========================================================================

  function buildTicker(data, location, unit) {
    var daily = data.daily;
    var allMaxC = daily.temperature_2m_max;
    var isHome = location.name === 'Torn City';
    var place = isHome ? 'across Torn City' : 'in ' + location.name + ', ' + location.country;
    var streets = isHome ? 'on the streets of Torn' : 'in ' + location.name;
    var lines = [];
    var i, dt, dname, wmo, desc, maxT, minT, rain, wind, msg, cat, note;
    var intensity, showerStr, snowType;

    for (i = 0; i < daily.time.length; i++) {
      dt = new Date(daily.time[i] + 'T00:00:00Z');
      dname = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : DAYS[dt.getUTCDay()]);
      wmo = daily.weathercode[i];
      desc = wmoDesc(wmo);
      maxT = fmtTemp(allMaxC[i], unit);
      minT = fmtTemp(daily.temperature_2m_min[i], unit);
      rain = daily.precipitation_probability_max[i];
      wind = Math.round(daily.windspeed_10m_max[i]);
      cat = tempCategory(allMaxC, i);
      note = tempCompNote(cat);

      if (wmo === 0) {
        msg = pickOne([
          dname + ': beautifully clear skies ' + place + '. A high of ' + maxT + note + ', lows ' + minT + '. A perfect day to be ' + streets + '.',
          'Glorious sunshine expected ' + dname + ' ' + place + '. Temperatures reach ' + maxT + note + '. Get out and enjoy it ' + streets + '.',
          dname + ' brings clear blue skies ' + place + ', topping out at ' + maxT + note + '. Overnight, down to ' + minT + '.'
        ]);
      } else if (wmo === 1) {
        msg = pickOne([
          dname + ' looks mainly clear ' + place + '. High of ' + maxT + note + '. ' + (rain < 20 ? 'Virtually no chance of rain.' : 'A slight ' + rain + '% chance of a shower.'),
          'Good conditions on ' + dname + ' ' + place + ' - mostly clear with a high of ' + maxT + note + '. ' + (rain < 20 ? 'Stay dry.' : rain + '% rain chance - keep an eye out.'),
          dname + ': mostly clear ' + place + '. Expecting ' + maxT + note + '. ' + (rain < 20 ? 'Dry throughout.' : 'Slight shower risk at ' + rain + '%.')
        ]);
      } else if (wmo === 2) {
        msg = pickOne([
          'Partly cloudy ' + dname + ' ' + place + '. High of ' + maxT + note + ', lows ' + minT + '. ' + (rain > 40 ? 'Umbrella recommended.' : 'Largely dry.'),
          dname + ' brings a mix of cloud and clear spells ' + place + '. Top temperature ' + maxT + note + '. ' + (rain > 40 ? 'Some showers possible.' : 'Should stay dry.'),
          'A cloudy picture ' + dname + ' ' + place + ', peaking at ' + maxT + note + '. ' + (rain > 40 ? 'Rain chance at ' + rain + '%.' : 'Rain unlikely.')
        ]);
      } else if (wmo === 3) {
        msg = pickOne([
          'An overcast ' + dname + ' ' + place + '. High of only ' + maxT + note + '. ' + (rain > 50 ? 'Showers likely - grab your jacket.' : 'Dry but gloomy.'),
          'Grey skies throughout ' + dname + ' ' + place + '. Temperatures barely reaching ' + maxT + note + '. ' + (rain > 50 ? 'Wet spells expected.' : 'At least it stays dry.'),
          dname + ' sees heavy cloud cover ' + place + ', topping at ' + maxT + note + '. ' + (rain > 50 ? rain + '% rain chance.' : 'Dry if dull.')
        ]);
      } else if (wmo === 45 || wmo === 48) {
        msg = pickOne([
          'Foggy conditions expected ' + dname + ' ' + place + '. High of ' + maxT + note + '. Visibility reduced - take care ' + streets + '.',
          dname + ' brings thick fog ' + place + '. Drive carefully. High ' + maxT + note + '.',
          'A murky start to ' + dname + ' ' + place + ' with fog affecting visibility. High of ' + maxT + note + '.'
        ]);
      } else if (wmo >= 51 && wmo <= 55) {
        msg = pickOne([
          dname + ': drizzly weather ' + place + '. High of ' + maxT + note + '. A coat is advised ' + streets + '.',
          'Light drizzle on ' + dname + ' ' + place + ', reaching ' + maxT + note + '. Not the worst, but keep covered.',
          dname + ' sees some drizzle ' + place + '. Tops at ' + maxT + note + '. Umbrella handy.'
        ]);
      } else if (wmo >= 61 && wmo <= 65) {
        if (wmo === 65) { intensity = 'heavy downpours'; }
        else if (wmo === 63) { intensity = 'steady rainfall'; }
        else { intensity = 'light rain'; }
        msg = pickOne([
          'Rain on the cards for ' + dname + ' ' + place + '. Expect ' + intensity + ', high of ' + maxT + note + ', lows ' + minT + '. Streets will be slick.',
          dname + ' brings ' + intensity + ' ' + place + '. High ' + maxT + note + '. Stay dry wherever you can.',
          'A wet ' + dname + ' ' + place + ' with ' + intensity + '. Temperatures peaking at ' + maxT + note + ', falling to ' + minT + ' overnight.'
        ]);
      } else if (wmo >= 71 && wmo <= 77) {
        snowType = wmo >= 75 ? 'heavy snowfall' : 'light to moderate snow';
        msg = pickOne([
          'Snow falling on ' + dname + ' ' + place + '! ' + snowType + ', high of ' + maxT + note + '. Wrap up warm ' + streets + '.',
          dname + ' brings ' + snowType + ' ' + place + '. Bitter conditions, max only ' + maxT + note + '.',
          'Winter conditions ' + dname + ' ' + place + '. ' + snowType + ' expected. High ' + maxT + note + '.'
        ]);
      } else if (wmo >= 80 && wmo <= 82) {
        if (wmo === 82) { showerStr = 'violent'; }
        else if (wmo === 81) { showerStr = 'moderate'; }
        else { showerStr = 'light'; }
        msg = pickOne([
          dname + ': ' + showerStr + ' showers ' + place + '. High ' + maxT + note + ', lows ' + minT + '. Gusts up to ' + wind + ' km/h.',
          'Showery ' + dname + ' ' + place + ' with ' + showerStr + ' bursts of rain. Tops at ' + maxT + note + '.',
          dname + ' sees ' + showerStr + ' shower activity ' + place + '. High ' + maxT + note + ', windy at ' + wind + ' km/h.'
        ]);
      } else if (wmo >= 95) {
        msg = pickOne([
          'Storm alert for ' + dname + ' ' + place + '! Thunderstorms expected' + (wmo >= 96 ? ', with hail possible' : '') + '. High only ' + maxT + note + '. Stay indoors if you can.',
          dname + ' brings severe weather ' + place + '. Thunderstorm risk' + (wmo >= 96 ? ' and hail' : '') + '. High ' + maxT + note + '.',
          'Dangerous conditions forecast for ' + dname + ' ' + place + '. Thunderstorms' + (wmo >= 96 ? ' and hail' : '') + '. Max ' + maxT + note + '.'
        ]);
      } else {
        msg = dname + ' ' + place + ': ' + desc + '. High ' + maxT + note + ', low ' + minT + '. Wind ' + wind + ' km/h.';
      }

      lines.push(msg);
    }

    // Wide em-space gaps between day announcements - plain text, no images
    return lines.join('\u2003\u2003\u2003---\u2003\u2003\u2003');
  }

  // =========================================================================
  // CSS INJECTION
  // =========================================================================

  function injectStyles() {
    if (document.getElementById(STYLES_ID)) { return; }
    var s = document.createElement('style');
    s.id = STYLES_ID;
    var css = '';

    css += '@import url(https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap);';

    // ---- BASE ----
    css += '#' + WIDGET_ID + '{font-family:"Rajdhani",sans-serif;background:linear-gradient(155deg,#1c2a3a 0%,#1e3048 55%,#1a2c44 100%);border:1px solid rgba(0,212,255,.3);border-radius:8px;overflow:hidden;box-shadow:0 6px 28px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.07);width:100%;box-sizing:border-box;}';
    css += '#' + WIDGET_ID + ' *{box-sizing:border-box;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left{margin:6px 0 10px 0;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top{margin:0 0 8px 0;}';

    // ================================================================
    // COLOUR SCHEME: TORN (warm grey, gold chrome, white main content)
    // ================================================================
    css += '#' + WIDGET_ID + '.tcw-theme-torn{background:linear-gradient(155deg,#1c1a18 0%,#201e1a 55%,#1e1c19 100%);border-color:rgba(200,168,88,.22);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-hdr{background:rgba(200,168,88,.09);border-bottom-color:rgba(200,168,88,.18);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-title{color:#c8a858;}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-hbtn{background:rgba(200,168,88,.1);border-color:rgba(200,168,88,.34);color:#c8a858;}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-hbtn:hover{background:rgba(200,168,88,.22);border-color:rgba(200,168,88,.6);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-hbtn.active{background:rgba(200,168,88,.26);}';
    // Main content text stays white in Torn theme
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-dc-dname{color:#c8a858;}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-dc-hi{color:rgba(255,255,255,.9);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-dc-lo{color:rgba(255,255,255,.55);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-dc-rain{color:rgba(255,255,255,.62);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-dc-wind{color:rgba(255,255,255,.48);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-stat b{color:rgba(255,255,255,.85);}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-ticker-lbl{color:#c8a858;}';
    css += '#' + WIDGET_ID + '.tcw-theme-torn .tcw-abroad{color:#d4a060;border-bottom-color:rgba(212,160,96,.28);background:rgba(212,160,96,.08);}';
    // Settings in Torn theme
    css += '.tcw-theme-torn .tcw-sp-ttl{color:#c8a858;border-bottom-color:rgba(200,168,88,.18);}';
    css += '.tcw-theme-torn .tcw-credits{background:rgba(200,168,88,.07);border-color:rgba(200,168,88,.18);}';
    css += '.tcw-theme-torn .tcw-credits a{color:#c8a858;}';
    css += '.tcw-theme-torn .tcw-toggle{border-color:rgba(200,168,88,.3);}';
    css += '.tcw-theme-torn .tcw-tbtn.on{background:rgba(200,168,88,.2);color:#c8a858;}';
    css += '.tcw-theme-torn .tcw-sp-close{border-color:rgba(200,168,88,.28);color:#c8a858;}';
    css += '.tcw-theme-torn .tcw-sp-ver{color:rgba(200,168,88,.5);}';
    css += '#' + POPUP_ID + '.tcw-theme-torn{border-color:rgba(200,168,88,.35);}';

    // ================================================================
    // COLOUR SCHEME: B&W (monochrome)
    // ================================================================
    css += '#' + WIDGET_ID + '.tcw-theme-bw{background:linear-gradient(155deg,#000 0%,#0c0c0c 55%,#060606 100%);border-color:rgba(255,255,255,.32);}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-hdr{background:rgba(255,255,255,.08);border-bottom-color:rgba(255,255,255,.14);}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-title{color:#f0f0f0;}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-hbtn{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.3);color:#f0f0f0;}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-hbtn:hover{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.55);}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-hbtn.active{background:rgba(255,255,255,.22);}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-dc-dname{color:#e8e8e8;}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-dc-hi{color:#ddd;}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-dc-lo{color:rgba(255,255,255,.52);}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-dc-rain{color:#aaa;}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-stat b{color:rgba(255,255,255,.85);}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-ticker-lbl{color:#e0e0e0;}';
    css += '#' + WIDGET_ID + '.tcw-theme-bw .tcw-abroad{color:#c8c8c8;border-bottom-color:rgba(255,255,255,.22);background:rgba(255,255,255,.07);}';
    css += '.tcw-theme-bw .tcw-sp-ttl{color:#f0f0f0;border-bottom-color:rgba(255,255,255,.16);}';
    css += '.tcw-theme-bw .tcw-credits{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.16);}';
    css += '.tcw-theme-bw .tcw-credits a{color:#e0e0e0;}';
    css += '.tcw-theme-bw .tcw-toggle{border-color:rgba(255,255,255,.26);}';
    css += '.tcw-theme-bw .tcw-tbtn.on{background:rgba(255,255,255,.18);color:#fff;}';
    css += '.tcw-theme-bw .tcw-sp-close{border-color:rgba(255,255,255,.24);color:#e0e0e0;}';
    css += '.tcw-theme-bw .tcw-sp-ver{color:rgba(255,255,255,.38);}';
    css += '#' + POPUP_ID + '.tcw-theme-bw{border-color:rgba(255,255,255,.34);background:linear-gradient(145deg,#000 0%,#0d0d0d 100%);}';

    // ---- HEADER ----
    css += '.tcw-hdr{display:flex;align-items:center;justify-content:space-between;padding:5px 8px;gap:5px;background:rgba(0,212,255,.12);border-bottom:1px solid rgba(0,212,255,.2);}';
    css += '.tcw-title{font-family:"Share Tech Mono",monospace;font-size:10px;font-weight:700;color:#00d4ff;letter-spacing:.8px;text-transform:uppercase;line-height:1.4;flex:1;min-width:0;overflow:hidden;}';
    css += '.tcw-title small{display:block;font-size:8px;color:rgba(255,255,255,.6);letter-spacing:.3px;font-weight:400;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
    css += '.tcw-hdr-r{display:flex;align-items:center;gap:4px;flex-shrink:0;}';
    css += '.tcw-clock{font-family:"Share Tech Mono",monospace;font-size:9px;color:rgba(255,255,255,.78);white-space:nowrap;line-height:1.45;}';
    css += '.tcw-hbtn{background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.38);border-radius:4px;color:#00d4ff;cursor:pointer;font-size:13px;padding:1px 5px;line-height:1;transition:all .18s;user-select:none;flex-shrink:0;}';
    css += '.tcw-hbtn:hover{background:rgba(0,212,255,.26);border-color:rgba(0,212,255,.65);}';
    css += '.tcw-hbtn.active{background:rgba(0,212,255,.28);border-color:rgba(0,212,255,.7);}';

    // ---- ABROAD ----
    css += '.tcw-abroad{padding:3px 8px;font-family:"Share Tech Mono",monospace;font-size:8px;color:#ffa040;text-transform:uppercase;letter-spacing:.5px;background:rgba(255,160,64,.12);border-bottom:1px solid rgba(255,160,64,.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';

    // ---- MINI-BAR ----
    css += '.tcw-mini-bar{display:none;align-items:center;gap:8px;padding:5px 10px;background:rgba(0,0,0,.15);border-top:1px solid rgba(0,212,255,.1);overflow:hidden;}';
    css += '.tcw-mini-icon{flex-shrink:0;}';
    css += '.tcw-mini-temp{font-size:20px;font-weight:700;color:#fff;line-height:1;flex-shrink:0;white-space:nowrap;}';
    css += '.tcw-mini-detail{font-size:9.5px;color:rgba(255,255,255,.72);line-height:1.5;flex:1;min-width:0;overflow:hidden;}';
    css += '.tcw-mini-row{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}';
    css += '.tcw-mini-detail b{color:rgba(0,212,255,.9);font-size:8px;font-weight:700;text-transform:uppercase;}';
    css += '#' + WIDGET_ID + '.tcw-minimised .tcw-mini-bar{display:flex;}';
    css += '#' + WIDGET_ID + '.tcw-minimised .tcw-main{display:none;}';
    css += '#' + WIDGET_ID + '.tcw-minimised .tcw-settings-panel{display:none;}';

    // ---- INLINE SETTINGS ----
    css += '.tcw-settings-panel{display:none;}';
    css += '#' + WIDGET_ID + '.tcw-settings-open .tcw-settings-panel{display:block;}';
    css += '#' + WIDGET_ID + '.tcw-settings-open .tcw-main{display:none;}';
    css += '#' + WIDGET_ID + '.tcw-settings-open .tcw-mini-bar{display:none;}';
    css += '.tcw-sp-inner{padding:10px;border-bottom:1px solid rgba(0,212,255,.1);background:rgba(0,0,0,.16);max-width:100%;overflow:hidden;}';

    // ---- SETTINGS SHARED ----
    css += '.tcw-sp-ttl{font-family:"Share Tech Mono",monospace;font-size:10px;color:#00d4ff;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(0,212,255,.18);}';
    css += '.tcw-credits{background:rgba(0,212,255,.09);border:1px solid rgba(0,212,255,.2);border-radius:6px;padding:8px;margin-bottom:10px;text-align:center;}';
    css += '.tcw-credits p{font-size:10px;color:rgba(255,255,255,.65);margin:0 0 3px 0;}';
    css += '.tcw-credits a{color:#00d4ff;text-decoration:none;font-size:12px;font-weight:600;transition:color .18s;}';
    css += '.tcw-credits a:hover{color:#fff;}';
    css += '.tcw-disclaimer{font-size:9px;color:rgba(255,255,255,.62);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:6px 8px;margin-bottom:10px;line-height:1.4;word-break:break-word;}';
    // Full row layout (popup / top-mode): label on left, toggle on right
    css += '.tcw-srow{display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:8px;margin-bottom:8px;overflow:hidden;}';
    css += '.tcw-srow-lbl{font-size:11px;color:rgba(255,255,255,.85);font-weight:600;white-space:nowrap;flex-shrink:0;}';
    css += '.tcw-toggle{display:flex;border:1px solid rgba(0,212,255,.35);border-radius:4px;overflow:hidden;flex-shrink:0;}';
    css += '.tcw-tbtn{background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;font-family:"Rajdhani",sans-serif;font-size:12px;font-weight:700;padding:3px 10px;transition:all .18s;white-space:nowrap;}';
    css += '.tcw-tbtn.on{background:rgba(0,212,255,.22);color:#00d4ff;}';
    css += '.tcw-tbtn:hover:not(.on){background:rgba(255,255,255,.08);color:rgba(255,255,255,.75);}';
    css += '.tcw-sp-ver{text-align:center;font-size:9px;color:rgba(0,212,255,.6);margin-top:8px;font-family:"Share Tech Mono",monospace;}';
    css += '.tcw-sp-close{width:100%;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.3);border-radius:5px;color:#00d4ff;cursor:pointer;font-family:"Rajdhani",sans-serif;font-size:12px;font-weight:700;padding:5px;margin-top:6px;transition:all .18s;letter-spacing:.8px;text-transform:uppercase;display:block;}';
    css += '.tcw-sp-close:hover{background:rgba(0,212,255,.2);border-color:rgba(0,212,255,.6);}';

    // ---- POPUP (left-aligned rows) ----
    css += '#' + POPUP_ID + '{position:fixed;z-index:999999;width:300px;max-width:calc(100vw - 20px);background:linear-gradient(145deg,#1c2838 0%,#1e3048 100%);border:1px solid rgba(0,212,255,.38);border-radius:8px;padding:14px;box-shadow:0 16px 48px rgba(0,0,0,.85);font-family:"Rajdhani",sans-serif;}';
    css += '#' + POPUP_ID + ' .tcw-srow{justify-content:flex-start;}';

    // ================================================================
    // SKY / TODAY CARD
    // ================================================================
    css += '.tcw-today-sky{position:absolute;inset:0;transition:background 4s ease;}';
    css += '.tcw-today-dim{position:absolute;inset:0;background:rgba(0,0,0,.10);}';
    css += '.tcw-star{position:absolute;background:white;border-radius:50%;animation:tcw-twinkle ease-in-out infinite;}';
    css += '@keyframes tcw-twinkle{0%,100%{opacity:.25}50%{opacity:1}}';
    css += '.tcw-today-icon{flex-shrink:0;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45));}';
    css += '.tcw-today-r{flex:1;min-width:0;overflow:hidden;}';
    css += '.tcw-today-lbl{font-family:"Share Tech Mono",monospace;font-size:7.5px;color:rgba(255,255,255,.72);text-transform:uppercase;letter-spacing:.6px;line-height:1.3;word-break:break-word;}';
    css += '.tcw-today-desc{font-size:12px;font-weight:600;color:rgba(255,255,255,.92);margin-bottom:4px;overflow:hidden;}';

    // Light sky overrides (after theme overrides - always wins)
    css += '.tcw-today.tcw-light-sky .tcw-today-lbl{color:rgba(0,0,0,.65);}';
    css += '.tcw-today.tcw-light-sky .tcw-today-temp{color:#111;text-shadow:none;}';
    css += '.tcw-today.tcw-light-sky .tcw-today-desc{color:rgba(0,0,0,.82);}';
    css += '.tcw-today.tcw-light-sky .tcw-stat{background:rgba(0,0,0,.12);color:#111;}';
    css += '.tcw-today.tcw-light-sky .tcw-stat b{color:#005588;}';
    css += '.tcw-today.tcw-light-sky .tcw-sun{color:rgba(0,0,0,.62);}';
    css += '.tcw-today.tcw-light-sky .tcw-today-dim{background:rgba(255,255,255,.08);}';

    css += '.tcw-stat{background:rgba(255,255,255,.13);border-radius:3px;padding:1px 4px;font-size:8.5px;color:rgba(255,255,255,.9);white-space:nowrap;display:inline-flex;align-items:baseline;gap:2px;cursor:default;}';
    css += '.tcw-stat b{color:rgba(0,212,255,.95);font-size:7.5px;font-weight:600;text-transform:uppercase;flex-shrink:0;}';
    css += '.tcw-sun{font-size:9px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:2px;white-space:nowrap;cursor:default;}';

    // ================================================================
    // LEFT MODE
    // ================================================================
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-body{padding:6px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-today{border-radius:6px;overflow:hidden;margin-bottom:6px;position:relative;min-height:110px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-fcast{display:flex;gap:2px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-today-inner{position:relative;z-index:1;padding:8px 9px;display:flex;gap:8px;align-items:flex-start;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-today-temp{font-size:30px;font-weight:700;color:#fff;line-height:1;margin:2px 0 1px;text-shadow:0 2px 10px rgba(0,0,0,.5);white-space:nowrap;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-stats{display:flex;flex-wrap:wrap;gap:3px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-sunrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-left .tcw-dc{flex:1;min-width:0;overflow:hidden;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:4px 2px;text-align:center;transition:all .18s;}';

    // ================================================================
    // TOP MODE
    // ================================================================
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-body{display:flex;flex-direction:row;gap:4px;padding:5px 6px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-today{flex:2.5;min-width:0;border-radius:6px;overflow:hidden;position:relative;margin-bottom:0;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-fcast{flex:5.5;display:flex;gap:3px;align-items:stretch;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-today-inner{position:relative;z-index:1;padding:6px 8px;display:flex;gap:7px;align-items:flex-start;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-today-temp{font-size:26px;font-weight:700;color:#fff;line-height:1;margin:1px 0;text-shadow:0 2px 10px rgba(0,0,0,.5);white-space:nowrap;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-today-lbl{font-size:7px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-today-desc{font-size:11px;margin-bottom:3px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-stats{display:flex;flex-wrap:wrap;gap:2px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-stat{font-size:7.5px;padding:1px 3px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-sunrow{display:none;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc{flex:1;min-width:0;overflow:hidden;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:4px 2px;text-align:center;transition:all .18s;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-cond{display:none;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-wind{display:none;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-dname{font-size:8px;margin-bottom:1px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-date{font-size:7px;margin-bottom:2px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-hi{font-size:10px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-lo{font-size:8px;}';
    css += '#' + WIDGET_ID + '.tcw-pos-top .tcw-dc-rain{font-size:7px;}';
    css += '#' + WIDGET_ID + ' .tcw-dc:hover{background:rgba(0,212,255,.1);border-color:rgba(0,212,255,.28);}';

    // ================================================================
    // DAY CARD SHARED
    // ================================================================
    css += '.tcw-dc-dname{font-family:"Share Tech Mono",monospace;font-size:8px;color:#00d4ff;text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
    css += '.tcw-dc-date{font-size:7px;color:rgba(255,255,255,.58);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
    css += '.tcw-dc-icon{display:flex;justify-content:center;margin:2px 0;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4));}';
    css += '.tcw-dc-cond{font-size:7px;color:rgba(255,255,255,.78);line-height:1.2;min-height:14px;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
    css += '.tcw-dc-hi{font-size:10px;font-weight:700;color:#ffa040;white-space:nowrap;overflow:hidden;}';
    css += '.tcw-dc-lo{font-size:8px;color:rgba(255,255,255,.62);white-space:nowrap;overflow:hidden;}';
    css += '.tcw-dc-rain{font-size:7px;color:#68bce8;margin-top:1px;white-space:nowrap;overflow:hidden;}';
    css += '.tcw-dc-wind{font-size:6.5px;color:rgba(255,255,255,.55);margin-top:1px;white-space:nowrap;overflow:hidden;}';

    // ================================================================
    // TICKER
    // ================================================================
    css += '.tcw-ticker{border-top:1px solid rgba(0,212,255,.15);padding:5px 10px 6px;background:rgba(0,0,0,.18);overflow:hidden;}';
    css += '.tcw-ticker-lbl{font-family:"Share Tech Mono",monospace;font-size:8px;color:#00d4ff;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;}';
    css += '.tcw-ticker-wrap{overflow:hidden;}';
    css += '.tcw-ticker-txt{white-space:nowrap;font-size:12px;font-weight:500;color:rgba(255,255,255,.92);display:inline-block;padding-left:100%;animation:tcw-scroll linear infinite;}';
    css += '@keyframes tcw-scroll{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}';

    // ================================================================
    // LOADING / ERROR
    // ================================================================
    css += '.tcw-loading{padding:14px;text-align:center;font-family:"Share Tech Mono",monospace;font-size:10px;color:rgba(255,255,255,.68);}';
    css += '.tcw-loading b{display:block;color:#00d4ff;font-size:11px;margin-bottom:4px;}';

    s.textContent = css;
    document.head.appendChild(s);
  }

  // =========================================================================
  // APPLY COLOUR THEME
  // =========================================================================

  function applyTheme(w) {
    var scheme = getSetting('colourScheme', 'bw');
    var themes = ['tcw-theme-default', 'tcw-theme-torn', 'tcw-theme-bw'];
    var popup = document.getElementById(POPUP_ID);
    var i, cls;
    for (i = 0; i < themes.length; i++) {
      cls = themes[i];
      if (w) { w.classList.remove(cls); }
      if (popup) { popup.classList.remove(cls); }
    }
    if (w) { w.classList.add('tcw-theme-' + scheme); }
    if (popup) { popup.classList.add('tcw-theme-' + scheme); }
  }

  // =========================================================================
  // SETTINGS CONTENT
  // compact=true: left inline mode - no row labels, compact button text only.
  // compact=false: popup / top mode - full layout with labels.
  // =========================================================================

  function buildSettingsContent(unit, pos, compact) {
    var scheme = getSetting('colourScheme', 'bw');
    var html = '';

    html += '<div class="tcw-sp-ttl">&#9881; Weather Settings</div>';
    html += '<div class="tcw-credits">';
    html += '<p>Today\'s Weatherwoman is</p>';
    html += '<a href="https://www.torn.com/profiles.php?XID=2987640" target="_blank" rel="noopener">Sanxion [2987640]</a>';
    html += '</div>';

    if (compact) {
      // Compact layout: all three toggle groups in one flex-wrap row, no labels.
      // Buttons use minimal text; title attributes provide full descriptions.
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;align-items:center;">';

      html += '<div class="tcw-toggle" title="Temperature unit">';
      html += '<button class="tcw-tbtn' + (unit === 'C' ? ' on' : '') + '" data-sk="tempUnit" data-sv="C" title="Celsius">&deg;C</button>';
      html += '<button class="tcw-tbtn' + (unit === 'F' ? ' on' : '') + '" data-sk="tempUnit" data-sv="F" title="Fahrenheit">&deg;F</button>';
      html += '</div>';

      html += '<div class="tcw-toggle" title="Widget position">';
      html += '<button class="tcw-tbtn' + (pos === 'left' ? ' on' : '') + '" data-sk="widgetPos" data-sv="left" title="Left sidebar">L</button>';
      html += '<button class="tcw-tbtn' + (pos === 'top' ? ' on' : '') + '" data-sk="widgetPos" data-sv="top" title="Top bar">T</button>';
      html += '</div>';

      html += '<div class="tcw-toggle" title="Colour scheme">';
      html += '<button class="tcw-tbtn' + (scheme === 'default' ? ' on' : '') + '" data-sk="colourScheme" data-sv="default" title="Default colour scheme">Def</button>';
      html += '<button class="tcw-tbtn' + (scheme === 'torn' ? ' on' : '') + '" data-sk="colourScheme" data-sv="torn" title="Torn City colour scheme">Trn</button>';
      html += '<button class="tcw-tbtn' + (scheme === 'bw' ? ' on' : '') + '" data-sk="colourScheme" data-sv="bw" title="Black &amp; White">B&amp;W</button>';
      html += '</div>';

      html += '</div>';
    } else {
      // Full layout: label on left, toggle buttons on right
      html += '<div class="tcw-disclaimer">This script is real weather, adjusted for where Torn City is geographically. Please remember to plan your day accordingly.</div>';

      html += '<div class="tcw-srow"><div class="tcw-srow-lbl">Temperature</div>';
      html += '<div class="tcw-toggle">';
      html += '<button class="tcw-tbtn' + (unit === 'C' ? ' on' : '') + '" data-sk="tempUnit" data-sv="C">&deg;C</button>';
      html += '<button class="tcw-tbtn' + (unit === 'F' ? ' on' : '') + '" data-sk="tempUnit" data-sv="F">&deg;F</button>';
      html += '</div></div>';

      html += '<div class="tcw-srow"><div class="tcw-srow-lbl">Position</div>';
      html += '<div class="tcw-toggle">';
      html += '<button class="tcw-tbtn' + (pos === 'left' ? ' on' : '') + '" data-sk="widgetPos" data-sv="left">Left</button>';
      html += '<button class="tcw-tbtn' + (pos === 'top' ? ' on' : '') + '" data-sk="widgetPos" data-sv="top">Top</button>';
      html += '</div></div>';

      html += '<div class="tcw-srow"><div class="tcw-srow-lbl">Colour Scheme</div>';
      html += '<div class="tcw-toggle">';
      html += '<button class="tcw-tbtn' + (scheme === 'default' ? ' on' : '') + '" data-sk="colourScheme" data-sv="default">Default</button>';
      html += '<button class="tcw-tbtn' + (scheme === 'torn' ? ' on' : '') + '" data-sk="colourScheme" data-sv="torn">Torn</button>';
      html += '<button class="tcw-tbtn' + (scheme === 'bw' ? ' on' : '') + '" data-sk="colourScheme" data-sv="bw">B&amp;W</button>';
      html += '</div></div>';
    }

    html += '<div class="tcw-sp-ver">Weather Forecast v' + VERSION + ' &middot; MIT</div>';
    html += '<button class="tcw-sp-close">Done</button>';

    return html;
  }

  // =========================================================================
  // BUILD WIDGET HTML
  // =========================================================================

  function buildWidget(data, location, unit, pos) {
    var daily = data.daily;
    var current = data.current_weather;
    var hourly = data.hourly;
    var t = utcNow();
    var isAbroad = location.name !== 'Torn City';
    var isTop = pos === 'top';
    var now = new Date();
    var i, hIdx, hd;
    var hi, lo, wmo, dt, dname, ddate, cond, icon, rain, wind, cardTip;

    hIdx = 0;
    for (i = 0; i < hourly.time.length; i++) {
      hd = new Date(hourly.time[i]);
      if (hd.getUTCDate() === now.getUTCDate() && hd.getUTCHours() === now.getUTCHours()) {
        hIdx = i;
        break;
      }
    }

    var curTemp = hourly.temperature_2m[hIdx];
    var feelsLike = hourly.apparent_temperature[hIdx];
    var humidity = hourly.relativehumidity_2m[hIdx];
    var windSpd = hourly.windspeed_10m[hIdx];
    var windDg = hourly.winddirection_10m[hIdx];
    var precProb = hourly.precipitation_probability[hIdx];
    var curWmo = current.weathercode;
    var srISO = daily.sunrise[0];
    var ssISO = daily.sunset[0];
    var srStr = parseHHMM(srISO);
    var ssStr = parseHHMM(ssISO);
    var tod = getTimeOfDay(t.h, t.min, srISO, ssISO);
    var night = isNightTod(tod);
    var lightSky = isSkyLight(tod, curWmo);
    var sky = getSkyStyle(tod, curWmo);
    var hiToday = fmtTemp(daily.temperature_2m_max[0], unit);
    var loToday = fmtTemp(daily.temperature_2m_min[0], unit);
    var uv = daily.uv_index_max[0];
    var ticker = buildTicker(data, location, unit);
    var tickDur = Math.max(45, ticker.length * 0.13);

    var todayIconSize = isTop ? 36 : 44;
    var dayIconSize = isTop ? 20 : 24;
    var uvRating = uv <= 2 ? 'Low' : (uv <= 5 ? 'Moderate' : (uv <= 7 ? 'High' : (uv <= 10 ? 'Very High' : 'Extreme')));

    // Six-day forecast cards with tooltips
    var cards = '';
    for (i = 1; i < 7; i++) {
      dt = new Date(daily.time[i] + 'T00:00:00Z');
      wmo = daily.weathercode[i];
      hi = fmtTemp(daily.temperature_2m_max[i], unit);
      lo = fmtTemp(daily.temperature_2m_min[i], unit);
      rain = daily.precipitation_probability_max[i];
      wind = Math.round(daily.windspeed_10m_max[i]);
      dname = DAYS3[dt.getUTCDay()].toUpperCase();
      ddate = dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()];
      cond = wmoShort(wmo);
      icon = getIcon(wmo, false, dayIconSize);
      cardTip = DAYS[dt.getUTCDay()] + ', ' + ddate + ': ' + wmoDesc(wmo) +
        '. High ' + hi + ', Low ' + lo + '. Rain ' + rain + '%, Wind ' + wind + ' km/h.';

      cards += '<div class="tcw-dc" title="' + cardTip + '">' +
        '<div class="tcw-dc-dname">' + dname + '</div>' +
        '<div class="tcw-dc-date">' + ddate + '</div>' +
        '<div class="tcw-dc-icon">' + icon + '</div>' +
        '<div class="tcw-dc-cond">' + cond + '</div>' +
        '<div class="tcw-dc-hi">' + hi + '</div>' +
        '<div class="tcw-dc-lo">' + lo + '</div>' +
        '<div class="tcw-dc-rain">' + rain + '% rain</div>' +
        '<div class="tcw-dc-wind">' + wind + ' km/h</div>' +
        '</div>';
    }

    // Source city never shown; abroad sub-label only when abroad
    // Abroad banner removed; destination still used in ticker and title sub-label.
    var locSmall = isAbroad ? '<small>' + location.name + ', ' + location.country + '</small>' : '';
    var todayClass = 'tcw-today' + (lightSky ? ' tcw-light-sky' : '');
    var minLabel = _isMinimised ? '&#9633;' : '&#8722;';
    var gearActive = _isSettingsOpen ? ' active' : '';

    var html = '';

    html += '<div class="tcw-hdr">';
    html += '<div class="tcw-title" title="Weather Forecast - 7-day outlook">Weather Forecast' + locSmall + '</div>';
    html += '<div class="tcw-hdr-r">';
    html += '<div class="tcw-clock" id="tcw-clock" title="Current Torn City Time (TCT)">' + clockHTML(lightSky) + '</div>';
    html += '<button class="tcw-hbtn" id="tcw-minimise" title="Minimise / Restore">' + minLabel + '</button>';
    html += '<button class="tcw-hbtn' + gearActive + '" id="tcw-gear" title="Open settings">&#9881;</button>';
    html += '</div></div>';

    // Inline settings: compact=true (left mode, no row labels)
    html += '<div class="tcw-settings-panel"><div class="tcw-sp-inner">';
    html += buildSettingsContent(unit, pos, true);
    html += '</div></div>';

    // Mini-bar
    html += '<div class="tcw-mini-bar" title="Current conditions - restore to see full forecast">';
    html += '<div class="tcw-mini-icon">' + getIcon(curWmo, night, 26) + '</div>';
    html += '<div class="tcw-mini-temp">' + fmtTemp(curTemp, unit) + '</div>';
    html += '<div class="tcw-mini-detail">';
    html += '<div class="tcw-mini-row">' + wmoDesc(curWmo) + '</div>';
    html += '<div class="tcw-mini-row"><b>Feels</b>&nbsp;' + fmtTemp(feelsLike, unit);
    html += '&nbsp;&nbsp;<b>Hi</b>&nbsp;' + hiToday + '&nbsp;<b>Lo</b>&nbsp;' + loToday;
    html += '&nbsp;&nbsp;<b>Wind</b>&nbsp;' + Math.round(windSpd) + 'km/h&nbsp;' + windDir(windDg);
    html += '</div></div></div>';

    // Main forecast section
    html += '<div class="tcw-main">';
    html += '<div class="tcw-body">';
    html += '<div class="' + todayClass + '" title="Current conditions as of ' + t.hh + ':' + t.mm + ' TCT">';
    html += '<div class="tcw-today-sky" style="background:' + sky + ';"></div>';
    html += '<div class="tcw-today-dim"></div>';
    html += night ? starsHTML(18) : '';
    html += '<div class="tcw-today-inner">';
    html += '<div class="tcw-today-icon">' + getIcon(curWmo, night, todayIconSize) + '</div>';
    html += '<div class="tcw-today-r">';
    // Time label uses TCT instead of UTC
    html += '<div class="tcw-today-lbl">Today - ' + t.dayFull + ' ' + t.date + ' ' + t.month + ' - ' + t.hh + ':' + t.mm + ' TCT</div>';
    html += '<div class="tcw-today-temp">' + fmtTemp(curTemp, unit) + '</div>';
    html += '<div class="tcw-today-desc">' + wmoDesc(curWmo) + '</div>';
    html += '<div class="tcw-stats">';
    html += '<div class="tcw-stat" title="Apparent temperature (wind chill / heat index)"><b>Feels</b>&nbsp;' + fmtTemp(feelsLike, unit) + '</div>';
    html += '<div class="tcw-stat" title="Relative humidity percentage"><b>Humid</b>&nbsp;' + humidity + '%</div>';
    html += '<div class="tcw-stat" title="Wind speed and direction"><b>Wind</b>&nbsp;' + Math.round(windSpd) + 'km/h&nbsp;' + windDir(windDg) + '</div>';
    html += '<div class="tcw-stat" title="Probability of precipitation"><b>Precip</b>&nbsp;' + precProb + '%</div>';
    html += '<div class="tcw-stat" title="UV Index ' + uv + ' - ' + uvRating + '"><b>UV</b>&nbsp;' + uv + '</div>';
    html += '<div class="tcw-stat" title="Today\'s forecast high and low"><b>Hi</b>&nbsp;' + hiToday + '&nbsp;<b>Lo</b>&nbsp;' + loToday + '</div>';
    html += '</div>';
    html += '<div class="tcw-sunrow">';
    html += '<div class="tcw-sun" title="Sunrise time (TCT)">Rise&nbsp;' + srStr + '</div>';
    html += '<div class="tcw-sun" title="Sunset time (TCT)">Set&nbsp;' + ssStr + '</div>';
    html += '</div></div></div></div>';
    html += '<div class="tcw-fcast">' + cards + '</div>';
    html += '</div>';
    html += '<div class="tcw-ticker" title="7-day weather forecast report">';
    html += '<div class="tcw-ticker-lbl">Weather Report</div>';
    html += '<div class="tcw-ticker-wrap">';
    html += '<div class="tcw-ticker-txt" style="animation-duration:' + tickDur + 's">' + ticker + '</div>';
    html += '</div></div>';
    html += '</div>';

    return html;
  }

  // =========================================================================
  // SETTINGS MANAGEMENT
  // =========================================================================

  function canUseInlineSettings() {
    var pos = getSetting('widgetPos', 'top');
    return pos === 'left' && !_isMinimised && !_forcedTop;
  }

  function closeSettings() {
    _isSettingsOpen = false;
    var popup = document.getElementById(POPUP_ID);
    if (popup) { popup.remove(); }
    applyState();
  }

  // Factory outside all loops - ESLint no-loop-func safe.
  function makeToggleBtnHandler(sk, sv) {
    return function () {
      var defaultVal;
      if (sk === 'tempUnit') {
        defaultVal = 'C';
      } else if (sk === 'colourScheme') {
        defaultVal = 'bw';
      } else {
        defaultVal = 'top';
      }
      if (sv === getSetting(sk, defaultVal)) { return; }
      setSetting(sk, sv);
      closeSettings();
      if (sk === 'widgetPos') {
        _forcedTop = false;
        injectWidget();
      } else {
        refreshWidget();
      }
    };
  }

  function attachSettingsHandlers(container) {
    var closeBtn = container.querySelector('.tcw-sp-close');
    if (closeBtn) { closeBtn.addEventListener('click', closeSettings); }

    var btns = container.querySelectorAll('.tcw-tbtn');
    var i, btn, sk, sv;
    for (i = 0; i < btns.length; i++) {
      btn = btns[i];
      sk = btn.getAttribute('data-sk');
      sv = btn.getAttribute('data-sv');
      btn.addEventListener('click', makeToggleBtnHandler(sk, sv));
    }
  }

  function openSettingsPopup() {
    var existingPopup = document.getElementById(POPUP_ID);
    if (existingPopup) { existingPopup.remove(); }

    var unit = getSetting('tempUnit', 'C');
    var pos = getSetting('widgetPos', 'top');

    var popup = document.createElement('div');
    popup.id = POPUP_ID;

    var w = document.getElementById(WIDGET_ID);
    var rect = w ? w.getBoundingClientRect() : null;
    var popupH = 420;
    var popupW = 300;
    var topPos = rect ? rect.bottom + 6 : 60;
    var leftPos = rect ? rect.left : 10;

    if (topPos + popupH > window.innerHeight) {
      topPos = rect ? Math.max(6, rect.top - popupH - 6) : 60;
    }
    if (leftPos + popupW > window.innerWidth) {
      leftPos = Math.max(6, window.innerWidth - popupW - 10);
    }

    popup.style.cssText = 'top:' + topPos + 'px;left:' + leftPos + 'px;';
    // Popup uses full (non-compact) settings layout
    popup.innerHTML = buildSettingsContent(unit, pos, false);
    document.body.appendChild(popup);
    applyTheme(document.getElementById(WIDGET_ID));
    attachSettingsHandlers(popup);

    setTimeout(function () {
      document.addEventListener('click', function onOutside(e) {
        var p = document.getElementById(POPUP_ID);
        var gear = document.getElementById('tcw-gear');
        if (!p) { document.removeEventListener('click', onOutside); return; }
        if (!p.contains(e.target) && e.target !== gear) {
          closeSettings();
          document.removeEventListener('click', onOutside);
        }
      });
    }, 120);
  }

  function toggleSettings() {
    if (canUseInlineSettings()) {
      _isSettingsOpen = !_isSettingsOpen;
      applyState();
    } else {
      var existingPopup = document.getElementById(POPUP_ID);
      if (existingPopup) {
        closeSettings();
      } else {
        _isSettingsOpen = true;
        openSettingsPopup();
        applyState();
      }
    }
  }

  // =========================================================================
  // APPLY STATE + THEME
  // =========================================================================

  function applyState() {
    var w = document.getElementById(WIDGET_ID);
    if (!w) { return; }

    if (_isMinimised) { w.classList.add('tcw-minimised'); }
    else { w.classList.remove('tcw-minimised'); }

    if (_isSettingsOpen && canUseInlineSettings()) { w.classList.add('tcw-settings-open'); }
    else { w.classList.remove('tcw-settings-open'); }

    var minBtn = document.getElementById('tcw-minimise');
    if (minBtn) { minBtn.innerHTML = _isMinimised ? '&#9633;' : '&#8722;'; }

    var gearBtn = document.getElementById('tcw-gear');
    if (gearBtn) {
      if (_isSettingsOpen) { gearBtn.classList.add('active'); }
      else { gearBtn.classList.remove('active'); }
    }

    applyTheme(w);
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  function attachHandlers() {
    var minimiseBtn = document.getElementById('tcw-minimise');
    if (minimiseBtn) {
      minimiseBtn.addEventListener('click', function () {
        _isMinimised = !_isMinimised;
        setSetting('isMinimised', _isMinimised);
        if (_isMinimised) { closeSettings(); }
        applyState();
      });
    }

    // Gear works in all states (routes to popup when minimised or top mode)
    var gearBtn = document.getElementById('tcw-gear');
    if (gearBtn) {
      gearBtn.addEventListener('click', function () { toggleSettings(); });
    }

    var w = document.getElementById(WIDGET_ID);
    if (w) { attachSettingsHandlers(w); }
  }

  // =========================================================================
  // SIDEBAR DETECTION - 175%+ ZOOM FIX
  //
  // Primary: checks the widget's own offsetParent + getBoundingClientRect.
  // If the widget is inside a hidden container (any ancestor display:none,
  // or zero-dimension element), offsetParent===null or rect has no size.
  // Secondary: isSidebarVisible() for the restore decision.
  // =========================================================================

  function findLeftTarget() {
    var sels = [
      '.sidebar-cont', '.sidebar', '#sidebar', '.sidebar-sections',
      '.sidebar-inner', '.sidebar-left', '.content-col-left',
      '.left-col', '.left-panel', '#panel-sidebar', '[id="sidebar"]'
    ];
    var i, el;
    for (i = 0; i < sels.length; i++) {
      el = document.querySelector(sels[i]);
      if (el) { return el; }
    }
    return null;
  }

  function findTopTarget() {
    var sels = [
      '#content', '.content-wrapper', '.content-col-right',
      '.main-wrapper', '.page-content', '#main-content',
      '#mainContainer', '.main-content', '#main'
    ];
    var i, el;
    for (i = 0; i < sels.length; i++) {
      el = document.querySelector(sels[i]);
      if (el) { return el; }
    }
    return document.body;
  }

  function isWidgetHidden(w) {
    if (!w) { return true; }
    if (w.offsetParent === null) { return true; }
    var rect = w.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { return true; }
    return rect.right <= 0 || rect.left >= window.innerWidth;
  }

  function isSidebarVisible() {
    var sb = findLeftTarget();
    if (!sb) { return false; }
    try {
      var cs = window.getComputedStyle(sb);
      if (cs.display === 'none') { return false; }
      if (cs.visibility === 'hidden') { return false; }
      if (parseFloat(cs.width) < 10) { return false; }
    } catch (e) { return false; }
    var rect = sb.getBoundingClientRect();
    return rect.width > 10 && rect.height > 10 && rect.right > 0;
  }

  function checkLayout() {
    var posPref = getSetting('widgetPos', 'top');
    if (posPref !== 'left') { _forcedTop = false; return; }

    var w = document.getElementById(WIDGET_ID);
    if (!w) { return; }

    if (!_forcedTop) {
      if (isWidgetHidden(w)) {
        _forcedTop = true;
        w.classList.remove('tcw-pos-left');
        w.classList.add('tcw-pos-top');
        var topTgt = findTopTarget();
        if (topTgt) { topTgt.prepend(w); }
        applyTheme(w);
        if (_isSettingsOpen && !document.getElementById(POPUP_ID)) {
          _isSettingsOpen = false;
          applyState();
        }
      }
    } else {
      if (isSidebarVisible()) {
        _forcedTop = false;
        w.classList.remove('tcw-pos-top');
        w.classList.add('tcw-pos-left');
        var leftTgt = findLeftTarget();
        if (leftTgt) { leftTgt.prepend(w); }
        applyTheme(w);
      }
    }
  }

  function setupLayoutWatchers() {
    var sb = findLeftTarget();

    new MutationObserver(function (mutations) {
      var i;
      for (i = 0; i < mutations.length; i++) {
        if (mutations[i].type === 'attributes') {
          if (_resizeTimer) { clearTimeout(_resizeTimer); }
          _resizeTimer = setTimeout(checkLayout, 200);
          break;
        }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

    if (sb) {
      new MutationObserver(function () {
        if (_resizeTimer) { clearTimeout(_resizeTimer); }
        _resizeTimer = setTimeout(checkLayout, 200);
      }).observe(sb, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () {
        if (_resizeTimer) { clearTimeout(_resizeTimer); }
        _resizeTimer = setTimeout(checkLayout, 250);
      }).observe(document.body);
    }
  }

  // =========================================================================
  // INJECTION AND REFRESH
  // =========================================================================

  function refreshWidget() {
    var w = document.getElementById(WIDGET_ID);
    if (!w || !_cachedData) { return; }
    var unit = getSetting('tempUnit', 'C');
    var pos = getSetting('widgetPos', 'top');
    var effectivePos = _forcedTop ? 'top' : pos;
    w.innerHTML = buildWidget(_cachedData, _cachedLocation, unit, effectivePos);
    applyState();
    attachHandlers();
    syncSkyContrast();
  }

  function loadingHTML(abroadLabel) {
    var html = '<div class="tcw-hdr">';
    html += '<div class="tcw-title">Weather Forecast';
    if (abroadLabel) { html += '<small>' + abroadLabel + '</small>'; }
    html += '</div><div class="tcw-hdr-r">';
    html += '<div class="tcw-clock" id="tcw-clock">' + clockHTML(false) + '</div>';
    html += '<button class="tcw-hbtn" id="tcw-minimise">&#8722;</button>';
    html += '<button class="tcw-hbtn" id="tcw-gear">&#9881;</button>';
    html += '</div></div>';
    html += '<div class="tcw-main"><div class="tcw-loading">';
    html += '<b>&#128225; Contacting weather satellite&hellip;</b>';
    html += 'Awaiting satellite data...';
    html += '</div></div>';
    return html;
  }

  function errorHTML() {
    return '<div class="tcw-loading" style="color:rgba(255,140,100,.85);">' +
      '<b style="color:#ff8060;">Satellite link lost</b>' +
      'Unable to receive satellite data. Retrying on next refresh.' +
      '</div>';
  }

  function injectWidget() {
    closeSettings();

    var old = document.getElementById(WIDGET_ID);
    if (old) { old.remove(); }

    injectStyles();

    var pos = getSetting('widgetPos', 'top');
    var unit = getSetting('tempUnit', 'C');
    var location = detectLocation();
    var isAbroad = location.name !== 'Torn City';
    var abroadLabel = isAbroad ? location.name + ', ' + location.country : '';

    var w = document.createElement('div');
    w.id = WIDGET_ID;

    var effectivePos = pos;
    if (pos === 'left') {
      _forcedTop = !isSidebarVisible();
      if (_forcedTop) { effectivePos = 'top'; }
    } else {
      _forcedTop = false;
    }

    w.className = effectivePos === 'top' ? 'tcw-pos-top' : 'tcw-pos-left';

    var target;
    if (effectivePos === 'top') {
      target = findTopTarget();
    } else {
      target = findLeftTarget();
      if (!target) {
        _forcedTop = true;
        effectivePos = 'top';
        w.className = 'tcw-pos-top';
        target = findTopTarget();
      }
    }

    target.prepend(w);
    w.innerHTML = loadingHTML(abroadLabel);
    applyState();
    attachHandlers();

    // Post-placement check: if widget is immediately hidden, move to top
    setTimeout(function () {
      var fresh = document.getElementById(WIDGET_ID);
      if (fresh && getSetting('widgetPos', 'top') === 'left' && isWidgetHidden(fresh) && !_forcedTop) {
        _forcedTop = true;
        fresh.classList.remove('tcw-pos-left');
        fresh.classList.add('tcw-pos-top');
        findTopTarget().prepend(fresh);
        applyTheme(fresh);
      }
    }, 300);

    fetchWeather(location.lat, location.lon).then(function (data) {
      _cachedData = data;
      _cachedLocation = location;
      var fresh = document.getElementById(WIDGET_ID);
      if (!fresh) { return; }
      fresh.innerHTML = buildWidget(data, location, unit, _forcedTop ? 'top' : effectivePos);
      applyState();
      attachHandlers();
      syncSkyContrast();
    }).catch(function (err) {
      console.error('[TC Weather] Fetch failed:', err);
      var fresh = document.getElementById(WIDGET_ID);
      if (!fresh) { return; }
      var hdr = fresh.querySelector('.tcw-hdr');
      fresh.innerHTML = (hdr ? hdr.outerHTML : loadingHTML(abroadLabel)) +
        '<div class="tcw-main">' + errorHTML() + '</div>';
      attachHandlers();
    });
  }

  // =========================================================================
  // LIVE CLOCK (TCT label)
  // =========================================================================
  // DYNAMIC SKY CONTRAST
  // Updates the today-card light/dark text class and sky gradient every 60s
  // so text always contrasts against the current background.
  // =========================================================================

  function syncSkyContrast() {
    if (!_cachedData) { return; }
    var t = utcNow();
    var srISO = _cachedData.daily.sunrise[0];
    var ssISO = _cachedData.daily.sunset[0];
    var tod = getTimeOfDay(t.h, t.min, srISO, ssISO);
    var curWmo = _cachedData.current_weather.weathercode;
    var light = isSkyLight(tod, curWmo);
    _currentSkyLight = light;
    var skyEl = document.querySelector('#' + WIDGET_ID + ' .tcw-today-sky');
    if (skyEl) { skyEl.style.background = getSkyStyle(tod, curWmo); }
    var todayEl = document.querySelector('#' + WIDGET_ID + ' .tcw-today');
    if (todayEl) {
      if (light) {
        todayEl.classList.add('tcw-light-sky');
      } else {
        todayEl.classList.remove('tcw-light-sky');
      }
    }
  }

  function tickClock() {
    var el = document.getElementById('tcw-clock');
    if (el) { el.innerHTML = clockHTML(_currentSkyLight); }
    _tickCount++;
    if (_tickCount % 60 === 0) { syncSkyContrast(); }
  }

  // =========================================================================
  // STATCOUNTER (1x1 pixel, fires on window.load, { once: true })
  // =========================================================================

  function fireStatCounter() {
    var img = document.createElement('img');
    img.src = 'https://c.statcounter.com/13223765/0/67b1fe3b/1/';
    img.width = 1;
    img.height = 1;
    img.alt = '';
    img.style.cssText = 'position:absolute;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(img);
  }

  // =========================================================================
  // INIT
  // =========================================================================

  function init() {
    injectWidget();
    setTimeout(checkLayout, 500);
    setInterval(tickClock, 1000);
    setInterval(injectWidget, REFRESH_MS);
    setupLayoutWatchers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 1600); });
  } else {
    setTimeout(init, 1600);
  }

  if (document.readyState === 'complete') { fireStatCounter(); }
  else { window.addEventListener('load', fireStatCounter, { once: true }); }

  var _lastUrl = window.location.href;
  new MutationObserver(function () {
    var cur = window.location.href;
    if (cur !== _lastUrl) {
      _lastUrl = cur;
      setTimeout(function () {
        if (!document.getElementById(WIDGET_ID)) { injectWidget(); }
      }, 1800);
    }
  }).observe(document, { subtree: true, childList: true });

  window.addEventListener('resize', function () {
    if (_resizeTimer) { clearTimeout(_resizeTimer); }
    _resizeTimer = setTimeout(checkLayout, 250);
  });

})();
