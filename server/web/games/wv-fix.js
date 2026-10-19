/*
 * 안드로이드 앱(WebView) 보정. 앱의 WebView가 크기를 "내용에 맞춤"으로 잡아서 페이지에는 화면 높이가
 * 0에 가깝게 보입니다(100vh·100% 높이가 0 → 과일 받기 빈 화면, 루오 게임 아주 작음).
 * 실제 보이는 높이를 추정해 html 높이와 --app-h 로 넣어 줍니다. 앱을 고치면 이 파일은 필요 없습니다.
 * 게임 <head>에서 가장 먼저 불러 주세요: <script src="/games/wv-fix.js"></script>
 */
(function () {
  if (!/; wv\)/.test(navigator.userAgent)) return;
  var root = document.documentElement;
  var sent = false;

  // How tall 100vh actually is. In the app's WebView innerHeight is right but 100vh/100% come out ~0.
  function vhPixels() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:0;left:-9999px;width:1px;height:100vh;visibility:hidden';
    root.appendChild(probe);
    var h = probe.offsetHeight;
    root.removeChild(probe);
    return h;
  }

  function visibleHeight() {
    var inner = window.innerHeight;
    if (root.classList.contains('wvfix')) return inner; // once fixed, keep following innerHeight
    if (vhPixels() >= inner * 0.5) return 0; // 100vh works: nothing to fix
    if (inner >= 200) return inner;
    // innerHeight is broken too: the screen minus the status bar and the app's top bar.
    return Math.round((screen.availHeight || screen.height) - 120);
  }

  function apply() {
    var h = visibleHeight();
    if (!h) {
      root.classList.remove('wvfix');
      root.style.removeProperty('--app-h');
      root.style.removeProperty('height');
    } else {
      root.classList.add('wvfix');
      root.style.setProperty('--app-h', h + 'px');
      root.style.height = h + 'px';
      root.classList.toggle('wv-portrait', h >= window.innerWidth);
    }
    if (!sent && document.readyState !== 'loading') {
      sent = true;
      // TEMP diagnostics → server data/game-errors.log
      var id = location.pathname.split('/')[2];
      try {
        fetch('/api/games/' + id + '/errors', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: 'wv-diag',
            where: ['inner', window.innerWidth, window.innerHeight, 'outer', window.outerWidth, window.outerHeight,
              'screen', screen.width, screen.height, screen.availHeight, 'vv', window.visualViewport && Math.round(window.visualViewport.height),
              'dpr', window.devicePixelRatio, 'vh', vhPixels(), 'used', h].join(' '),
          }),
        });
      } catch (e) {}
    }
  }

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('load', apply);
  document.addEventListener('DOMContentLoaded', apply);
})();
