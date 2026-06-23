/**
 * ============================================================
 *  Roche 鍚庡彴淇濇椿鎻掍欢 v2.3.0
 *
 *  鏍稿績鏂规锛欰PK 鍘熺敓鍓嶅彴 Service锛坣ativeAudioBridge锛? *  澶囩敤鏂规锛歐eb 闈欓粯闊抽寰幆锛堟棤 APK 鏃惰嚜鍔ㄥ惎鐢級
 * ============================================================
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'keepalive_enabled';

  function $id(id) { return document.getElementById(id); }

  // ========== 鐜妫€娴?==========

  function hasNativeAudio() {
    try { return !!(window.nativeAudioBridge && window.nativeAudioBridge.__ready); } catch (e) { return false; }
  }

  function hasWebAudio() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  // ========== 鍘熺敓 Audio Bridge锛圓PK 淇濇椿锛屾牳蹇冩柟妗堬級 ==========

  var SILENCE_URL = 'https://raw.githubusercontent.com/yechen1844/char-task-monitor/main/silence.wav';

  async function startNativeKeepAlive() {
    if (!hasNativeAudio()) return false;
    try {
      if (window.nativeAudioBridge.startKeepAlive) {
        await window.nativeAudioBridge.startKeepAlive();
        return true;
      }
      await window.nativeAudioBridge.replaceQueue([{
        id: 'keepalive',
        title: 'Roche淇濇椿',
        artist: '',
        cover: '',
        url: SILENCE_URL
      }], 0, 'loop', true);
      return true;
    } catch (e) {
      console.warn('[KeepAlive] 鍘熺敓淇濇椿鍚姩澶辫触:', e);
      return false;
    }
  }

  async function stopNativeKeepAlive() {
    if (!hasNativeAudio()) return;
    try { await window.nativeAudioBridge.stop(); } catch (e) { /* ignore */ }
  }

  // ========== Web Audio 闈欓粯闊抽锛堝鐢ㄦ柟妗堬級 ==========

  var _audioCtx = null;
  var _silentSource = null;
  var _heartbeatInterval = null;
  var _htmlAudio = null;
  var _htmlAudioInterval = null;

  function createSilentWavBlob() {
    var sampleRate = 8000;
    var numSamples = sampleRate * 20; // 20 绉?    var dataSize = numSamples * 2;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);
    function writeString(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    for (var i = 0; i < numSamples; i++) { view.setInt16(44 + i * 2, 0, true); }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function startWebAudioKeepAlive() {
    if (!hasWebAudio()) return false;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new AudioCtx();
      var sampleRate = _audioCtx.sampleRate;
      var buffer = _audioCtx.createBuffer(1, sampleRate * 20, sampleRate); // 20 绉?      _silentSource = _audioCtx.createBufferSource();
      _silentSource.buffer = buffer;
      _silentSource.loop = true;
      _silentSource.connect(_audioCtx.destination);
      _silentSource.start();
      _heartbeatInterval = setInterval(function () {
        if (_audioCtx && _audioCtx.state === 'suspended') { _audioCtx.resume(); }
      }, 30000);
      return true;
    } catch (e) {
      console.warn('[KeepAlive] Web Audio 鍚姩澶辫触:', e);
      return false;
    }
  }

  function stopWebAudioKeepAlive() {
    try {
      if (_silentSource) { _silentSource.stop(); _silentSource.disconnect(); _silentSource = null; }
      if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
    } catch (e) { /* ignore */ }
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  }

  function startHtmlAudioKeepAlive() {
    try {
      var blob = createSilentWavBlob();
      var url = URL.createObjectURL(blob);
      _htmlAudio = new Audio(url);
      _htmlAudio.loop = true;
      _htmlAudio.volume = 0.01;
      _htmlAudio.play().catch(function () {});
      _htmlAudioInterval = setInterval(function () {
        if (_htmlAudio && _htmlAudio.paused) { _htmlAudio.play().catch(function () {}); }
      }, 25000);
      return true;
    } catch (e) {
      console.warn('[KeepAlive] HTML Audio 鍚姩澶辫触:', e);
      return false;
    }
  }

  function stopHtmlAudioKeepAlive() {
    try {
      if (_htmlAudio) { _htmlAudio.pause(); _htmlAudio.src = ''; _htmlAudio = null; }
    } catch (e) { /* ignore */ }
    if (_htmlAudioInterval) { clearInterval(_htmlAudioInterval); _htmlAudioInterval = null; }
  }

  // ========== 缁熶竴鍚仠 ==========

  async function startKeepAlive() {
    if (hasNativeAudio()) {
      var ok = await startNativeKeepAlive();
      if (ok) return true;
    }
    var ok2 = await startWebAudioKeepAlive();
    if (ok2) return true;
    return startHtmlAudioKeepAlive();
  }

  async function stopKeepAlive() {
    await stopNativeKeepAlive();
    stopWebAudioKeepAlive();
    stopHtmlAudioKeepAlive();
  }

  // ========== Storage ==========

  function storageGet(roche, key, fallback) {
    try {
      return roche.storage.get(key).then(function (v) {
        return v !== null && v !== undefined ? v : fallback;
      }).catch(function () { return fallback; });
    } catch (e) { return Promise.resolve(fallback); }
  }

  function storageSet(roche, key, value) {
    try { return roche.storage.set(key, value); } catch (e) { return Promise.resolve(); }
  }

  // ========== CSS锛堢畝娲?+ 鍙粴鍔級 ==========

  function getCSS() {
    return '.roche-plugin-keepalive{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e0e0e0;background:#1a1a2e;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0;box-sizing:border-box}.roche-plugin-keepalive *,.roche-plugin-keepalive *::before,.roche-plugin-keepalive *::after{box-sizing:border-box}.ka-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#16213e;border-bottom:1px solid #0f3460;position:sticky;top:0;z-index:10}.ka-title{margin:0;font-size:17px;font-weight:600}.ka-close{background:none;border:1px solid #0f3460;color:#e0e0e0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1}.ka-close:hover{background:#0f3460}.ka-body{padding:16px}.ka-card{background:#16213e;border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid #0f3460}.ka-card h3{margin:0 0 6px;font-size:15px;color:#4ecca3}.ka-card p{margin:0 0 8px;font-size:13px;color:#999;line-height:1.5}.ka-status{display:flex;align-items:center;gap:10px;margin-bottom:16px}.ka-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.ka-dot-on{background:#4ecca3;box-shadow:0 0 6px #4ecca3}.ka-dot-off{background:#555}.ka-status-text{font-size:15px;font-weight:500}.ka-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#16213e;border-radius:10px;border:1px solid #0f3460;margin-bottom:12px}.ka-toggle-label{font-size:15px;font-weight:500}.ka-toggle{position:relative;width:48px;height:26px;cursor:pointer}.ka-toggle input{opacity:0;width:0;height:0}.ka-toggle-slider{position:absolute;inset:0;background:#333;border-radius:13px;transition:background .3s}.ka-toggle-slider::before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#e0e0e0;border-radius:50%;transition:transform .3s}.ka-toggle input:checked+.ka-toggle-slider{background:#4ecca3}.ka-toggle input:checked+.ka-toggle-slider::before{transform:translateX(22px)}.ka-notice{background:#2c2e20;border:1px solid #4ecca3;border-radius:8px;padding:10px;font-size:12px;color:#999;line-height:1.5;margin-bottom:12px}.ka-warn{background:#3d201d;border-color:#e74c3c}.ka-btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500;transition:background .2s}.ka-btn-primary{background:#4ecca3;color:#1a1a2e}.ka-btn-primary:hover{background:#3db88d}.ka-btn-danger{background:#c0392b;color:#e0e0e0}.ka-btn-danger:hover{background:#a93226}.ka-actions{display:flex;gap:8px;margin-top:12px}.ka-info-item{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #0f3460;font-size:12px}.ka-info-item:last-child{border-bottom:none}.ka-info-key{color:#666}.ka-info-val{color:#e0e0e0;font-weight:500}.ka-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;margin-left:4px}.ka-badge-apk{background:#4ecca3;color:#1a1a2e}.ka-badge-web{background:#3498db;color:#fff}.ka-method{font-size:14px;font-weight:600;margin-bottom:4px}';
  }

  // ========== 娓叉煋 ==========

  function renderMain(container, roche) {
    var nativeAudio = hasNativeAudio();
    var webAudio = hasWebAudio();

    storageGet(roche, STORAGE_KEY, false).then(function (enabled) {

      var h = '<div class="roche-plugin-keepalive">';
      h += '<style>' + getCSS() + '</style>';

      // Header
      h += '<div class="ka-header"><h2 class="ka-title">鍚庡彴淇濇椿</h2><button class="ka-close" id="ka-close">\u2715</button></div>';

      h += '<div class="ka-body">';

      // 鐘舵€?      h += '<div class="ka-status">';
      h += '<div class="ka-dot ' + (enabled ? 'ka-dot-on' : 'ka-dot-off') + '"></div>';
      h += '<span class="ka-status-text">' + (enabled ? '淇濇椿杩愯涓? : '淇濇椿鏈惎鍔?) + '</span>';
      h += '</div>';

      // 淇濇椿鏂瑰紡
      h += '<div class="ka-card">';
      if (nativeAudio) {
        h += '<div class="ka-method">鍘熺敓鍓嶅彴 Service <span class="ka-badge ka-badge-apk">APK</span></div>';
        h += '<p>閫氱煡鏍忔樉绀?姝ｅ湪鎾斁"锛岀郴缁熶笉浼氭潃 Roche銆?/p>';
      } else {
        h += '<div class="ka-method">Web 闈欓粯闊抽 <span class="ka-badge ka-badge-web">Web</span></div>';
        h += '<p>寰幆鎾斁鏃犲０闊抽锛岄檷浣庤鏉€姒傜巼銆傛晥鏋滀笉濡?APK 鍘熺敓鏂规銆?/p>';
      }
      h += '</div>';

      // 寮€鍏?      h += '<div class="ka-toggle-row"><span class="ka-toggle-label">鍚敤淇濇椿</span>';
      h += '<label class="ka-toggle"><input type="checkbox" id="ka-toggle"' + (enabled ? ' checked' : '') + '><span class="ka-toggle-slider"></span></label>';
      h += '</div>';

      // 鎸夐挳
      h += '<div class="ka-actions">';
      h += '<button class="ka-btn ka-btn-primary" id="ka-start">鍚姩</button>';
      h += '<button class="ka-btn ka-btn-danger" id="ka-stop">鍋滄</button>';
      h += '</div>';

      // 鐜淇℃伅
      h += '<div class="ka-card"><h3>鐜</h3>';
      h += '<div class="ka-info-item"><span class="ka-info-key">nativeAudioBridge</span><span class="ka-info-val">' + (nativeAudio ? '宸叉敞鍐? : '鏈敞鍐?) + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">Web Audio</span><span class="ka-info-val">' + (webAudio ? '鏀寔' : '涓嶆敮鎸?) + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">淇濇椿鏂瑰紡</span><span class="ka-info-val">' + (nativeAudio ? '鍘熺敓 Service' : 'Web 闊抽') + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">鐘舵€?/span><span class="ka-info-val">' + (enabled ? '杩愯涓? : '鏈惎鍔?) + '</span></div>';
      h += '</div>';

      // 鎻愮ず
      if (!nativeAudio) {
        h += '<div class="ka-notice ka-warn">Web 淇濇椿鏁堟灉鏈夐檺锛屽缓璁墦鍖?APK 鑾峰緱鍘熺敓淇濇椿銆?/div>';
      } else {
        h += '<div class="ka-notice">閫氱煡鏍?Roche淇濇椿"鏄?Android 鍓嶅彴 Service 鐨勮姹傘€?/div>';
      }

      h += '</div></div>';

      container.innerHTML = h;

      // 浜嬩欢
      $id('ka-close').onclick = function () { roche.ui.closeApp(); };

      var toggle = $id('ka-toggle');
      if (toggle) {
        toggle.onchange = function () {
          if (toggle.checked) {
            startKeepAlive().then(function () {
              storageSet(roche, STORAGE_KEY, true);
              roche.ui.toast('淇濇椿宸插惎鍔?);
              renderMain(container, roche);
            }).catch(function (e) {
              roche.ui.toast('鍚姩澶辫触: ' + e);
              toggle.checked = false;
            });
          } else {
            stopKeepAlive().then(function () {
              storageSet(roche, STORAGE_KEY, false);
              roche.ui.toast('淇濇椿宸插仠姝?);
              renderMain(container, roche);
            });
          }
        };
      }

      var startBtn = $id('ka-start');
      if (startBtn) {
        startBtn.onclick = function () {
          startKeepAlive().then(function () {
            storageSet(roche, STORAGE_KEY, true);
            roche.ui.toast('淇濇椿宸插惎鍔?);
            renderMain(container, roche);
          }).catch(function (e) { roche.ui.toast('鍚姩澶辫触: ' + e); });
        };
      }

      var stopBtn = $id('ka-stop');
      if (stopBtn) {
        stopBtn.onclick = function () {
          stopKeepAlive().then(function () {
            storageSet(roche, STORAGE_KEY, false);
            roche.ui.toast('淇濇椿宸插仠姝?);
            renderMain(container, roche);
          });
        };
      }

      if (enabled) { startKeepAlive().catch(function () {}); }
    });
  }

  // ============================
  //  鎻掍欢娉ㄥ唽
  // ============================

  window.RochePlugin.register({
    id: 'keepalive',
    name: '鍚庡彴淇濇椿',
    version: '2.3.0',
    apps: [
      {
        id: 'keepalive-home',
        name: '鍚庡彴淇濇椿',
        icon: 'battery_charging_full',
        iconImage: '',
        async mount(container, roche) {
          renderMain(container, roche);
        },
        async unmount(container, roche) {
          container.replaceChildren();
        }
      }
    ]
  });

  console.log('[KeepAlive] v2.2.0 | ' + (hasNativeAudio() ? 'APK 鍘熺敓 Service' : 'Web 闈欓粯闊抽'));

})();