/**
 * ============================================================
 *  Roche Keep Alive Plugin v3.0.0
 *
 *  完全本地化保活 — 不再依赖任何远程音频
 *
 *  Tier 1: Native startKeepAlive() — APK 内置 20s 静音音频
 *  Tier 2: Native replaceQueue — android.resource:// 本地音频
 *  Fallback: Silent Web Audio loop (Web 环境 / 无 APK)
 *
 *  v3.0 变更:
 *  - 删除远程 jsdelivr 音频回退（不再需要 VPN）
 *  - 添加 waitForNativeAudio() 等待桥接就绪
 *  - 添加状态验证（启动后检查是否真正在播放）
 *  - 添加重试机制
 *  - 更详细的日志输出
 * ============================================================
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'keepalive_enabled';
  var PLUGIN_VERSION = '3.0.0';

  function $id(id) { return document.getElementById(id); }

  // ========== Capability Detection ==========

  function hasNativeAudio() {
    try {
      return !!(window.nativeAudioBridge && window.nativeAudioBridge.__ready);
    } catch (e) {
      return false;
    }
  }

  /**
   * 等待 nativeAudioBridge 就绪
   * 桥接初始化是异步的（等待 Capacitor 加载），
   * 直接检查 __ready 可能在初始化完成前返回 false。
   * 此函数轮询直到就绪或超时。
   */
  function waitForNativeAudio(timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise(function (resolve) {
      if (hasNativeAudio()) { resolve(true); return; }

      var start = Date.now();
      var timer = setInterval(function () {
        if (hasNativeAudio()) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          console.warn('[KeepAlive] waitForNativeAudio timeout after ' + timeoutMs + 'ms');
          resolve(false);
        }
      }, 200);
    });
  }

  function hasWebAudio() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  // ========== Native Audio Bridge (APK) ==========

  var LOCAL_SILENCE_URL = 'android.resource://com.roche.app/raw/silence';

  async function startNativeKeepAlive() {
    if (!hasNativeAudio()) {
      console.warn('[KeepAlive] Native audio bridge not ready');
      return false;
    }

    var bridge = window.nativeAudioBridge;

    // Tier 1: 使用桥接的 startKeepAlive 快捷方法
    if (typeof bridge.startKeepAlive === 'function') {
      try {
        await bridge.startKeepAlive();
        console.log('[KeepAlive] Tier 1 OK: startKeepAlive() (本地 20s 静音)');

        // 验证是否真正在播放
        await sleep(1500);
        var status = await bridge.getStatus();
        if (status && status.isPlaying) {
          console.log('[KeepAlive] 状态验证: 正在播放 ✓');
          return true;
        }
        console.warn('[KeepAlive] 状态验证: 未在播放，尝试 Tier 2');
      } catch (e) {
        console.warn('[KeepAlive] Tier 1 失败:', e);
      }
    }

    // Tier 2: 直接调用 replaceQueue 使用本地 android.resource
    try {
      await bridge.replaceQueue([{
        id: 'keepalive',
        title: 'Roche Keep Alive',
        artist: '',
        cover: '',
        url: LOCAL_SILENCE_URL
      }], 0, 'loop', true);
      console.log('[KeepAlive] Tier 2 OK: replaceQueue 本地音频');

      // 验证
      await sleep(1500);
      var status2 = await bridge.getStatus();
      if (status2 && status2.isPlaying) {
        console.log('[KeepAlive] Tier 2 状态验证: 正在播放 ✓');
        return true;
      }
      console.warn('[KeepAlive] Tier 2 状态验证: 未在播放');
    } catch (e) {
      console.warn('[KeepAlive] Tier 2 失败:', e);
    }

    // 不再有 Tier 3 远程回退 — 完全本地化
    console.error('[KeepAlive] 所有本地 Tier 均失败');
    return false;
  }

  async function stopNativeKeepAlive() {
    if (!hasNativeAudio()) return;
    try {
      await window.nativeAudioBridge.stop();
      console.log('[KeepAlive] Native stop OK');
    } catch (e) {
      console.warn('[KeepAlive] Native stop failed:', e);
    }
  }

  // ========== Web Audio Fallback ==========

  var _audioCtx = null;
  var _silentSource = null;
  var _heartbeatInterval = null;
  var _htmlAudio = null;
  var _htmlAudioInterval = null;

  function createSilentWavBlob() {
    var sampleRate = 8000;
    var numSamples = sampleRate * 20;
    var dataSize = numSamples * 2;
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
      var buffer = _audioCtx.createBuffer(1, sampleRate * 20, sampleRate);
      _silentSource = _audioCtx.createBufferSource();
      _silentSource.buffer = buffer;
      _silentSource.loop = true;
      _silentSource.connect(_audioCtx.destination);
      _silentSource.start();
      _heartbeatInterval = setInterval(function () {
        if (_audioCtx && _audioCtx.state === 'suspended') { _audioCtx.resume(); }
      }, 30000);
      console.log('[KeepAlive] Web Audio 启动 OK');
      return true;
    } catch (e) {
      console.warn('[KeepAlive] Web Audio start failed:', e);
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
      console.log('[KeepAlive] HTML Audio 启动 OK');
      return true;
    } catch (e) {
      console.warn('[KeepAlive] HTML Audio start failed:', e);
      return false;
    }
  }

  function stopHtmlAudioKeepAlive() {
    try {
      if (_htmlAudio) { _htmlAudio.pause(); _htmlAudio.src = ''; _htmlAudio = null; }
    } catch (e) { /* ignore */ }
    if (_htmlAudioInterval) { clearInterval(_htmlAudioInterval); _htmlAudioInterval = null; }
  }

  // ========== Helpers ==========

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ========== Unified Control ==========

  async function startKeepAlive() {
    // 等待桥接就绪（最多 8 秒）
    var nativeReady = await waitForNativeAudio(8000);

    if (nativeReady) {
      console.log('[KeepAlive] 桥接已就绪，尝试 Native 保活');
      var ok = await startNativeKeepAlive();
      if (ok) return true;
      console.warn('[KeepAlive] Native 保活失败，回退到 Web Audio');
    } else {
      console.log('[KeepAlive] 桥接未就绪，使用 Web Audio');
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

  // ========== Storage Helpers ==========

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

  // ========== CSS ==========

  function getCSS() {
    return '.roche-plugin-keepalive{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e0e0e0;background:#1a1a2e;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0;box-sizing:border-box}.roche-plugin-keepalive *,.roche-plugin-keepalive *::before,.roche-plugin-keepalive *::after{box-sizing:border-box}.ka-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#16213e;border-bottom:1px solid #0f3460;position:sticky;top:0;z-index:10}.ka-title{margin:0;font-size:17px;font-weight:600}.ka-close{background:none;border:1px solid #0f3460;color:#e0e0e0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1}.ka-close:hover{background:#0f3460}.ka-body{padding:16px}.ka-card{background:#16213e;border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid #0f3460}.ka-card h3{margin:0 0 6px;font-size:15px;color:#4ecca3}.ka-card p{margin:0 0 8px;font-size:13px;color:#999;line-height:1.5}.ka-status{display:flex;align-items:center;gap:10px;margin-bottom:16px}.ka-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.ka-dot-on{background:#4ecca3;box-shadow:0 0 6px #4ecca3}.ka-dot-off{background:#555}.ka-status-text{font-size:15px;font-weight:500}.ka-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#16213e;border-radius:10px;border:1px solid #0f3460;margin-bottom:12px}.ka-toggle-label{font-size:15px;font-weight:500}.ka-toggle{position:relative;width:48px;height:26px;cursor:pointer}.ka-toggle input{opacity:0;width:0;height:0}.ka-toggle-slider{position:absolute;inset:0;background:#333;border-radius:13px;transition:background .3s}.ka-toggle-slider::before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#e0e0e0;border-radius:50%;transition:transform .3s}.ka-toggle input:checked+.ka-toggle-slider{background:#4ecca3}.ka-toggle input:checked+.ka-toggle-slider::before{transform:translateX(22px)}.ka-actions{display:flex;gap:10px;margin-bottom:16px}.ka-btn{flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .2s}.ka-btn:active{opacity:.7}.ka-btn-primary{background:#4ecca3;color:#000}.ka-btn-danger{background:#e94560;color:#fff}.ka-info-item{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #0f3460}.ka-info-item:last-child{border-bottom:none}.ka-info-key{color:#999}.ka-info-val{color:#4ecca3;font-weight:500}.ka-method{font-size:14px;font-weight:600;margin-bottom:6px}.ka-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-left:6px}.ka-badge-apk{background:#4ecca3;color:#000}.ka-badge-web{background:#e94560;color:#fff}.ka-notice{padding:12px 14px;border-radius:8px;font-size:13px;line-height:1.5;background:#0f3460;color:#aaa;margin-top:12px}.ka-warn{background:#3d1538;color:#e94560}.ka-version{font-size:11px;color:#555;text-align:center;padding:8px}';
  }

  // ========== Render ==========

  function renderMain(container, roche) {
    var nativeAudio = hasNativeAudio();
    var webAudio = hasWebAudio();

    storageGet(roche, STORAGE_KEY, false).then(function (enabled) {

      var h = '<div class="roche-plugin-keepalive">';
      h += '<style>' + getCSS() + '</style>';

      // Header
      h += '<div class="ka-header"><h2 class="ka-title">Keep Alive</h2><button class="ka-close" id="ka-close">&#10005;</button></div>';

      h += '<div class="ka-body">';

      // Status
      h += '<div class="ka-status">';
      h += '<div class="ka-dot ' + (enabled ? 'ka-dot-on' : 'ka-dot-off') + '"></div>';
      h += '<span class="ka-status-text">' + (enabled ? 'Running' : 'Stopped') + '</span>';
      h += '</div>';

      // Method card
      h += '<div class="ka-card">';
      if (nativeAudio) {
        h += '<div class="ka-method">Native Foreground Service <span class="ka-badge ka-badge-apk">APK</span></div>';
        h += '<p>使用 Android 前台媒体服务播放内置静音音频。Android 系统会保持 Roche 存活。</p>';
        h += '<p style="color:#4ecca3">音频来源: APK 内置 (res/raw/silence.wav, 20s)</p>';
      } else {
        h += '<div class="ka-method">Silent Web Audio <span class="ka-badge ka-badge-web">Web</span></div>';
        h += '<p>在浏览器中循环播放静音音频。不如原生 APK 可靠。</p>';
      }
      h += '</div>';

      // Toggle
      h += '<div class="ka-toggle-row"><span class="ka-toggle-label">Enable Keep Alive</span>';
      h += '<label class="ka-toggle"><input type="checkbox" id="ka-toggle"' + (enabled ? ' checked' : '') + '><span class="ka-toggle-slider"></span></label>';
      h += '</div>';

      // Buttons
      h += '<div class="ka-actions">';
      h += '<button class="ka-btn ka-btn-primary" id="ka-start">Start</button>';
      h += '<button class="ka-btn ka-btn-danger" id="ka-stop">Stop</button>';
      h += '</div>';

      // Environment
      h += '<div class="ka-card"><h3>Environment</h3>';
      h += '<div class="ka-info-item"><span class="ka-info-key">nativeAudioBridge</span><span class="ka-info-val">' + (nativeAudio ? 'Ready' : 'Not available') + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">Web Audio</span><span class="ka-info-val">' + (webAudio ? 'Supported' : 'Not supported') + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">Method</span><span class="ka-info-val">' + (nativeAudio ? 'Native Service' : 'Web Audio') + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">Audio Source</span><span class="ka-info-val">' + (nativeAudio ? 'Local (APK)' : 'Generated') + '</span></div>';
      h += '<div class="ka-info-item"><span class="ka-info-key">Status</span><span class="ka-info-val">' + (enabled ? 'Running' : 'Stopped') + '</span></div>';
      h += '</div>';

      // Notice
      if (!nativeAudio) {
        h += '<div class="ka-notice ka-warn">Web 保活不如原生可靠。请使用 APK 获得原生保活。</div>';
      } else {
        h += '<div class="ka-notice">通知栏是 Android 前台服务的要求，保活期间会显示。完全本地化，无需网络。</div>';
      }

      h += '<div class="ka-version">Keep Alive v' + PLUGIN_VERSION + '</div>';
      h += '</div></div>';

      container.innerHTML = h;

      // Events
      $id('ka-close').onclick = function () { roche.ui.closeApp(); };

      var toggle = $id('ka-toggle');
      if (toggle) {
        toggle.onchange = function () {
          if (toggle.checked) {
            startKeepAlive().then(function () {
              storageSet(roche, STORAGE_KEY, true);
              roche.ui.toast('Keep alive started');
              renderMain(container, roche);
            }).catch(function (e) {
              roche.ui.toast('Start failed: ' + e);
              toggle.checked = false;
            });
          } else {
            stopKeepAlive().then(function () {
              storageSet(roche, STORAGE_KEY, false);
              roche.ui.toast('Keep alive stopped');
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
            roche.ui.toast('Keep alive started');
            renderMain(container, roche);
          }).catch(function (e) { roche.ui.toast('Start failed: ' + e); });
        };
      }

      var stopBtn = $id('ka-stop');
      if (stopBtn) {
        stopBtn.onclick = function () {
          stopKeepAlive().then(function () {
            storageSet(roche, STORAGE_KEY, false);
            roche.ui.toast('Keep alive stopped');
            renderMain(container, roche);
          });
        };
      }

      if (enabled) { startKeepAlive().catch(function () {}); }
    });
  }

  // ============================
  //  Plugin Registration
  // ============================

  window.RochePlugin.register({
    id: 'keepalive',
    name: 'Keep Alive',
    version: PLUGIN_VERSION,
    apps: [
      {
        id: 'keepalive-home',
        name: 'Keep Alive',
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

  console.log('[KeepAlive] v' + PLUGIN_VERSION + ' loaded | ' + (hasNativeAudio() ? 'Native Service (Local Audio)' : 'Web Audio (no APK)'));

})();
