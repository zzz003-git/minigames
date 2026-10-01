/**
 * 게임 진입 로딩 화면 — 시안 v3.2 (2026-10-01 · 하단 로고를 CI Kit v1.1 원본으로 교체)
 *   v3.1: 빛 고리 회전 1.4초 → 2.8초
 *
 * 적용: 각 게임 index.html 의 <body …> 바로 다음 줄에 이 파일을 불러오는 script 태그 한 줄.
 *   (async·defer·type=module 을 붙이지 않는다) game.js · run.js · base.css 는 고치지 않는다.
 *
 * v2 와 같은 것: 닫히는 규칙 (최소 0.5초 · 시작 버튼 준비 · 오류 즉시 · 최대 2초), 광고 없음.
 * v3 에서 더한 것:
 *   - 배경: 게임 아이콘과 포인트 색 빛방울이 천천히 떠오른다 (캔버스 1장, 입자 26개)
 *   - 아이콘: 튀어 오르며 등장 → 둘레를 도는 빛 고리 + 퍼지는 물결
 *   - 게임 이름: 한 글자씩 올라온다
 *   - 진행 막대: 빛이 훑고 지나간다
 *   - 닫힐 때: 아이콘이 살짝 커지며 빛방울이 터지듯 흩어진다
 *   - 하단 로고: CI Kit v1.1 「01_logo/transparent/easy2njoy_horizontal_ondark.svg」 원본 그대로 (글자 외곽선 · 2N 오렌지).
 *     너비 190~260px (Kit 최소 120px 충족). 그림자·테두리를 더하지 않는다 (Kit 「지켜 주실 것」)
 *   - 아이콘을 못 찾을 때 대신 쓰는 심볼: CI Kit 「03_app_icon/easy2njoy_appicon.svg」
 *   - 움직임 줄이기 설정이면 효과를 모두 끈다
 */
(function () {
  "use strict";

  var MIN_MS = 500;
  var MAX_MS = 2000;
  var FONT_WAIT_MS = 1200;
  var FADE_MS = 320;

  var body = document.body;
  if (!body || document.querySelector(".splash")) return;

  var t0 = Date.now();
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // CI Kit v1.1 원본 — 손대지 않는다 (가로세로 비율·색·간격 고정)
  var LOGO_H = '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="easy2Njoy" viewBox="0 0 749 200"><g transform="translate(0,0)"><rect x="40" y="40" width="120" height="120" rx="27" fill="#E07A1F"/><g transform="translate(58,58) scale(3.5)"><path d="M6 17V7l6 10V7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M13 17V7l5 10V7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.55"/></g><path fill="#FFFFFF" transform="translate(196.00,125.00) scale(0.052000,-0.052000)" d="M642.0 -30.0Q476.0 -30.0 349.5 41.5Q223.0 113.0 151.5 238.5Q80.0 364.0 80.0 526.0Q80.0 703.0 150.0 834.0Q220.0 965.0 343.0 1037.5Q466.0 1110.0 626.0 1110.0Q796.0 1110.0 915.0 1030.0Q1034.0 950.0 1091.0 805.0Q1148.0 660.0 1131.0 464.0H862.0V564.0Q862.0 729.0 809.5 801.5Q757.0 874.0 638.0 874.0Q499.0 874.0 433.5 789.5Q368.0 705.0 368.0 540.0Q368.0 389.0 433.5 306.5Q499.0 224.0 626.0 224.0Q706.0 224.0 763.0 259.0Q820.0 294.0 850.0 360.0L1122.0 282.0Q1061.0 134.0 929.5 52.0Q798.0 -30.0 642.0 -30.0ZM284.0 464.0V666.0H1000.0V464.0Z"/><path fill="#FFFFFF" transform="translate(256.19,125.00) scale(0.052000,-0.052000)" d="M440.0 -30.0Q324.0 -30.0 243.5 14.5Q163.0 59.0 121.5 133.5Q80.0 208.0 80.0 298.0Q80.0 373.0 103.0 435.0Q126.0 497.0 177.5 544.5Q229.0 592.0 316.0 624.0Q376.0 646.0 459.0 663.0Q542.0 680.0 647.0 695.5Q752.0 711.0 878.0 730.0L780.0 676.0Q780.0 772.0 734.0 817.0Q688.0 862.0 580.0 862.0Q520.0 862.0 455.0 833.0Q390.0 804.0 364.0 730.0L118.0 808.0Q159.0 942.0 272.0 1026.0Q385.0 1110.0 580.0 1110.0Q723.0 1110.0 834.0 1066.0Q945.0 1022.0 1002.0 914.0Q1034.0 854.0 1040.0 794.0Q1046.0 734.0 1046.0 660.0V0.0H808.0V222.0L842.0 176.0Q763.0 67.0 671.5 18.5Q580.0 -30.0 440.0 -30.0ZM498.0 184.0Q573.0 184.0 624.5 210.5Q676.0 237.0 706.5 271.0Q737.0 305.0 748.0 328.0Q769.0 372.0 772.5 430.5Q776.0 489.0 776.0 528.0L856.0 508.0Q735.0 488.0 660.0 474.5Q585.0 461.0 539.0 450.0Q493.0 439.0 458.0 426.0Q418.0 410.0 393.5 391.5Q369.0 373.0 357.5 351.0Q346.0 329.0 346.0 302.0Q346.0 265.0 364.5 238.5Q383.0 212.0 417.0 198.0Q451.0 184.0 498.0 184.0Z"/><path fill="#FFFFFF" transform="translate(314.82,125.00) scale(0.052000,-0.052000)" d="M562.0 -30.0Q358.0 -30.0 232.5 62.5Q107.0 155.0 80.0 324.0L358.0 366.0Q375.0 290.0 433.5 247.0Q492.0 204.0 582.0 204.0Q656.0 204.0 696.0 232.5Q736.0 261.0 736.0 312.0Q736.0 344.0 720.0 363.5Q704.0 383.0 648.5 402.0Q593.0 421.0 476.0 452.0Q344.0 486.0 265.0 528.0Q186.0 570.0 151.0 628.5Q116.0 687.0 116.0 770.0Q116.0 874.0 169.0 950.5Q222.0 1027.0 318.5 1068.5Q415.0 1110.0 546.0 1110.0Q673.0 1110.0 771.0 1071.0Q869.0 1032.0 929.5 960.0Q990.0 888.0 1004.0 790.0L726.0 740.0Q719.0 800.0 674.0 835.0Q629.0 870.0 552.0 876.0Q477.0 881.0 431.5 856.0Q386.0 831.0 386.0 784.0Q386.0 756.0 405.5 737.0Q425.0 718.0 486.5 698.0Q548.0 678.0 674.0 646.0Q797.0 614.0 871.5 571.5Q946.0 529.0 980.0 469.5Q1014.0 410.0 1014.0 326.0Q1014.0 160.0 894.0 65.0Q774.0 -30.0 562.0 -30.0Z"/><path fill="#FFFFFF" transform="translate(367.63,125.00) scale(0.052000,-0.052000)" d="M278.0 -480.0 486.0 92.0 490.0 -76.0 20.0 1080.0H302.0L618.0 262.0H554.0L868.0 1080.0H1140.0L530.0 -480.0Z"/><path fill="#F0A050" transform="translate(424.91,125.00) scale(0.052000,-0.052000)" d="M100.0 2.0V238.0L704.0 774.0Q772.0 834.0 800.0 887.0Q828.0 940.0 828.0 986.0Q828.0 1052.0 801.0 1103.5Q774.0 1155.0 725.0 1184.5Q676.0 1214.0 610.0 1214.0Q541.0 1214.0 488.5 1182.5Q436.0 1151.0 407.0 1099.5Q378.0 1048.0 380.0 988.0H100.0Q100.0 1136.0 165.0 1244.0Q230.0 1352.0 346.0 1411.0Q462.0 1470.0 616.0 1470.0Q757.0 1470.0 868.5 1408.5Q980.0 1347.0 1044.0 1237.0Q1108.0 1127.0 1108.0 982.0Q1108.0 875.0 1078.0 804.5Q1048.0 734.0 989.0 674.5Q930.0 615.0 844.0 540.0L454.0 198.0L432.0 258.0H1108.0V2.0Z"/><path fill="#F0A050" transform="translate(485.73,125.00) scale(0.052000,-0.052000)" d="M140.0 0.0V1440.0H416.0L1042.0 480.0V1440.0H1318.0V0.0H1042.0L416.0 960.0V0.0Z"/><path fill="#FFFFFF" transform="translate(559.54,125.00) scale(0.052000,-0.052000)" d="M-20.0 -480.0V-226.0H28.0Q121.0 -226.0 155.5 -184.0Q190.0 -142.0 190.0 -64.0V1080.0H462.0V-196.0Q462.0 -325.0 381.5 -402.5Q301.0 -480.0 164.0 -480.0ZM190.0 1230.0V1470.0H462.0V1230.0Z"/><path fill="#FFFFFF" transform="translate(588.85,125.00) scale(0.052000,-0.052000)" d="M626.0 -30.0Q463.0 -30.0 340.0 43.0Q217.0 116.0 148.5 244.5Q80.0 373.0 80.0 540.0Q80.0 709.0 150.0 837.5Q220.0 966.0 343.0 1038.0Q466.0 1110.0 626.0 1110.0Q789.0 1110.0 912.5 1037.0Q1036.0 964.0 1105.0 835.5Q1174.0 707.0 1174.0 540.0Q1174.0 372.0 1104.5 243.5Q1035.0 115.0 911.5 42.5Q788.0 -30.0 626.0 -30.0ZM626.0 224.0Q757.0 224.0 821.5 312.5Q886.0 401.0 886.0 540.0Q886.0 684.0 820.5 770.0Q755.0 856.0 626.0 856.0Q537.0 856.0 480.0 816.0Q423.0 776.0 395.5 705.0Q368.0 634.0 368.0 540.0Q368.0 395.0 433.5 309.5Q499.0 224.0 626.0 224.0Z"/><path fill="#FFFFFF" transform="translate(649.98,125.00) scale(0.052000,-0.052000)" d="M278.0 -480.0 486.0 92.0 490.0 -76.0 20.0 1080.0H302.0L618.0 262.0H554.0L868.0 1080.0H1140.0L530.0 -480.0Z"/></g></svg>';
  var LOGO_APP = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="230" fill="#E07A1F"/><g transform="translate(192,192) scale(26.67)"><path d="M6 17V7l6 10V7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M13 17V7l5 10V7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.55"/></g></svg>';

  var css =
    ".splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
    "background:var(--bg,#0f1420);color:var(--text-main,#e8ecf4);font-family:var(--sans,sans-serif);" +
    "opacity:1;transition:opacity " + FADE_MS + "ms ease," + "visibility 0s linear " + FADE_MS + "ms;overflow:hidden}" +
    ".splash.is-out{opacity:0;visibility:hidden;pointer-events:none}" +
    ".splash__fx{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}" +
    ".splash__glow{position:absolute;left:50%;top:44%;width:420px;height:420px;transform:translate(-50%,-50%);" +
    "background:radial-gradient(circle,var(--accent-20,rgba(127,216,192,.2)) 0%,transparent 60%);pointer-events:none;" +
    "animation:splash-breathe 2.4s ease-in-out infinite}" +
    ".splash__center{position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;margin-top:-6vh}" +
    // 아이콘 무대: 빛 고리 + 물결 두 겹 + 아이콘 상자
    ".splash__stage{position:relative;width:132px;height:132px;display:grid;place-items:center}" +
    ".splash__ring{position:absolute;inset:0;border-radius:50%;" +
    "background:conic-gradient(from 0deg,transparent 0 55%,var(--accent,#7fd8c0) 85%,transparent 100%);" +
    "-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));" +
    "mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));" +
    "opacity:.9;animation:splash-spin 2.8s linear infinite}" +
    ".splash__wave{position:absolute;left:50%;top:50%;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:28px;" +
    "border:2px solid var(--accent,#7fd8c0);opacity:0;animation:splash-wave 1.8s ease-out infinite}" +
    ".splash__wave+.splash__wave{animation-delay:.9s}" +
    ".splash__icon{position:relative;width:96px;height:96px;border-radius:28px;display:grid;place-items:center;font-size:50px;line-height:1;" +
    "background:linear-gradient(160deg,var(--surface,#1a2231),var(--surface-2,#161d2b));border:1px solid var(--accent-20,rgba(127,216,192,.2));" +
    "box-shadow:0 14px 36px rgba(0,0,0,.4),0 0 32px var(--accent-14,rgba(127,216,192,.14));" +
    "animation:splash-pop .55s cubic-bezier(.34,1.56,.64,1) both,splash-bob 1.6s ease-in-out .55s infinite}" +
    ".splash__icon>span{opacity:0;transform:scale(.5) rotate(-12deg);transition:opacity .2s ease,transform .45s cubic-bezier(.34,1.56,.64,1)}" +
    ".splash__icon.is-in>span{opacity:1;transform:none}" +
    ".splash__icon svg{width:58px;height:58px;border-radius:12px}" +
    ".splash.is-out .splash__stage{transform:scale(1.18);transition:transform " + FADE_MS + "ms cubic-bezier(.2,.8,.2,1)}" +
    // 게임 이름: 한 글자씩
    ".splash__title{font-size:21px;font-weight:700;letter-spacing:-.01em;min-height:1.4em;text-align:center;padding:0 24px;white-space:pre-wrap}" +
    ".splash__title>span{display:inline-block;opacity:0;transform:translateY(10px);animation:splash-rise .42s cubic-bezier(.2,.8,.2,1) forwards}" +
    // 진행 막대 + 훑는 빛
    ".splash__bar{position:relative;width:148px;height:5px;border-radius:999px;background:var(--border-mid,rgba(255,255,255,.08));overflow:hidden;margin-top:2px}" +
    ".splash__bar>i{display:block;height:100%;border-radius:inherit;background:var(--accent,#7fd8c0);" +
    "box-shadow:0 0 10px var(--accent-45,rgba(127,216,192,.45));transform-origin:left center;transform:scaleX(0)}" +
    ".splash__bar.is-done>i{transition:transform .15s ease-out}" +
    ".splash__bar::after{content:'';position:absolute;top:0;bottom:0;width:40%;left:-40%;" +
    "background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);animation:splash-shine 1.1s ease-in-out infinite}" +
    // 하단 로고 — 화면에 맞춰 커진다
    ".splash__brand{position:absolute;left:0;right:0;bottom:calc(clamp(20px,5vh,40px) + env(safe-area-inset-bottom,0px));display:flex;" +
    "justify-content:center;opacity:0;animation:splash-fade .5s ease .25s forwards}" +
    ".splash__brand svg{display:block;width:clamp(190px,60vw,260px);height:auto;max-width:calc(100% - 32px)}" +
    "@keyframes splash-pop{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}" +
    "@keyframes splash-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}" +
    "@keyframes splash-spin{to{transform:rotate(360deg)}}" +
    "@keyframes splash-wave{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.7);opacity:0}}" +
    "@keyframes splash-breathe{0%,100%{opacity:.75;transform:translate(-50%,-50%) scale(.94)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.06)}}" +
    "@keyframes splash-rise{to{opacity:1;transform:none}}" +
    "@keyframes splash-shine{0%{left:-40%}100%{left:110%}}" +
    "@keyframes splash-fade{to{opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.splash *,.splash *::after{animation:none!important;transition:none!important}" +
    ".splash__title>span,.splash__brand{opacity:1;transform:none}.splash__wave,.splash__ring,.splash__fx,.splash__bar::after{display:none}}";

  var style = document.createElement("style");
  style.textContent = css;
  (document.head || body).appendChild(style);

  var title = (document.title || "").trim();
  var root = document.createElement("div");
  root.className = "splash";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", (title ? title + " " : "") + "불러오는 중");
  root.innerHTML =
    '<canvas class="splash__fx" aria-hidden="true"></canvas>' +
    '<div class="splash__glow"></div>' +
    '<div class="splash__center">' +
    '<div class="splash__stage" aria-hidden="true"><div class="splash__ring"></div>' +
    '<div class="splash__wave"></div><div class="splash__wave"></div>' +
    '<div class="splash__icon"><span></span></div></div>' +
    '<div class="splash__title" aria-hidden="true"></div>' +
    '<div class="splash__bar"><i></i></div>' +
    "</div>" +
    '<div class="splash__brand">' + LOGO_H + "</div>";

  // 게임 이름을 한 글자씩
  var titleEl = root.querySelector(".splash__title");
  Array.prototype.forEach.call(Array.from ? Array.from(title) : title.split(""), function (ch, i) {
    var s = document.createElement("span");
    s.textContent = ch;
    s.style.animationDelay = 180 + i * 45 + "ms";
    titleEl.appendChild(s);
  });
  body.insertBefore(root, body.firstChild);

  var iconBox = root.querySelector(".splash__icon");
  var iconSlot = iconBox.firstChild;
  var bar = root.querySelector(".splash__bar");
  var fill = bar.firstChild;
  var glyph = "";

  // ── 아이콘: renderHeader 가 헤더에 그리는 아이콘을 그대로 가져온다 ─────
  function grabIcon() {
    var src = document.querySelector(".topbar__icon");
    if (!src || !src.textContent.trim()) return false;
    glyph = src.textContent.trim();
    iconSlot.textContent = glyph;
    iconBox.classList.add("is-in");
    return true;
  }
  var iconObs = null;
  if (!grabIcon() && window.MutationObserver) {
    iconObs = new MutationObserver(function () {
      if (grabIcon()) { iconObs.disconnect(); iconObs = null; }
    });
    iconObs.observe(document.documentElement, { childList: true, subtree: true });
  }
  function iconFallback() {
    if (iconBox.classList.contains("is-in")) return;
    if (iconObs) { iconObs.disconnect(); iconObs = null; }
    iconSlot.innerHTML = LOGO_APP;
    iconBox.classList.add("is-in");
  }

  // ── 배경 입자: 게임 아이콘 몇 개 + 포인트 색 빛방울 ────────────────
  var cv = root.querySelector(".splash__fx");
  var ctx = cv.getContext && cv.getContext("2d");
  var accent = (getComputedStyle(body).getPropertyValue("--accent") || "#7fd8c0").trim() || "#7fd8c0";
  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var parts = [];
  var burst = [];
  function resize() {
    W = root.clientWidth || innerWidth; H = root.clientHeight || innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function spawn(p, fresh) {
    p.emoji = p.kind === "emoji";
    p.x = rand(0, W);
    p.y = fresh ? rand(0, H) : H + rand(10, 60);
    p.vy = p.emoji ? rand(14, 26) : rand(18, 42);
    p.sway = rand(6, 18); p.phase = rand(0, 6.28);
    p.size = p.emoji ? rand(16, 28) : rand(1.5, 3.6);
    p.alpha = p.emoji ? rand(0.10, 0.20) : rand(0.25, 0.7);
    p.rot = rand(-0.4, 0.4);
    return p;
  }
  if (ctx && !reduce) {
    resize();
    window.addEventListener("resize", resize);
    for (var k = 0; k < 26; k++) parts.push(spawn({ kind: k < 7 ? "emoji" : "dot" }, true));
  }
  var last = 0;
  function draw(now) {
    if (!ctx || reduce) return;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    var t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.y -= p.vy * dt;
      if (p.y < -40) spawn(p, false);
      var x = p.x + Math.sin(t * 0.9 + p.phase) * p.sway;
      // 위로 갈수록 흐려진다
      var fade = Math.max(0, Math.min(1, p.y / (H * 0.35)));
      if (p.emoji) {
        if (!glyph) continue;
        ctx.save();
        ctx.globalAlpha = p.alpha * fade;
        ctx.translate(x, p.y); ctx.rotate(p.rot + Math.sin(t + p.phase) * 0.15);
        ctx.font = p.size + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(glyph, 0, 0);
        ctx.restore();
      } else {
        var tw = 0.6 + 0.4 * Math.sin(t * 3 + p.phase);
        ctx.globalAlpha = p.alpha * fade * tw;
        ctx.fillStyle = accent;
        ctx.shadowColor = accent; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x, p.y, p.size, 0, 6.283); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    // 닫힐 때 터지는 빛방울
    for (var j = 0; j < burst.length; j++) {
      var b = burst[j];
      b.life -= dt;
      if (b.life <= 0) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.94; b.vy *= 0.94;
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    if (root.parentNode) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  function popBurst() {
    if (!ctx || reduce) return;
    var r = iconBox.getBoundingClientRect(), rr = root.getBoundingClientRect();
    var cx = r.left - rr.left + r.width / 2, cy = r.top - rr.top + r.height / 2;
    for (var i = 0; i < 22; i++) {
      var a = (i / 22) * 6.283 + rand(-0.15, 0.15), sp = rand(260, 520);
      burst.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(2, 4), life: 0.45, max: 0.45 });
    }
  }

  // ── 진행 막대: 실제 % 를 모르므로 90% 까지 다가가다 준비되면 채운다 ──
  var closing = false;
  function tick() {
    if (closing) return;
    var p = 0.9 * (1 - Math.exp(-(Date.now() - t0) / 700));
    fill.style.transform = "scaleX(" + p.toFixed(3) + ")";
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── 닫기 ────────────────────────────────────────────────────────
  var signalled = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function signal() {
    if (signalled) return;
    signalled = true;
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([fonts, sleep(FONT_WAIT_MS)])
      .then(function () { return sleep(Math.max(0, MIN_MS - (Date.now() - t0))); })
      .then(close);
  }

  function close() {
    if (closing) return;
    closing = true;
    iconFallback();
    bar.classList.add("is-done");
    fill.style.transform = "scaleX(1)";
    setTimeout(function () {
      popBurst();
      root.classList.add("is-out");
      setTimeout(function () {
        window.removeEventListener("resize", resize);
        if (root.parentNode) root.parentNode.removeChild(root);
      }, FADE_MS + 40);
    }, 150);
  }

  window.addEventListener("game:ready", signal);
  // 상한은 글꼴·최소 시간을 기다리지 않고 바로 닫는다
  setTimeout(close, MAX_MS);

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.querySelector(".topbar__icon")) setTimeout(iconFallback, 400);

    var btn = document.getElementById("startBtn");
    if (btn && btn.disabled && window.MutationObserver) {
      new MutationObserver(signal).observe(btn, {
        attributes: true, attributeFilter: ["disabled"], childList: true, characterData: true, subtree: true,
      });
    } else if (document.readyState === "complete") {
      signal();
    } else {
      window.addEventListener("load", signal);
    }

    // 오류 토스트가 뜨면 기다리지 않는다
    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (document.querySelector(".toast-host")) signal();
      }).observe(body, { childList: true });
    }
  });
})();
