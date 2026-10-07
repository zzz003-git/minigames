/**
 * 배경음악 — 화면 폴더의 bgm.mp3 를 끊김 없이 반복하고, 상단 바에 소리 버튼을 단다.
 * 게임 31종과 오늘의 나 3종(타로·선택·사주)이 쓴다.
 *
 * 연결: index.html 의 화면 스크립트(game.js · tarot.js …) 다음 줄에
 *   <script type="module" src="../../shared/bgm.js"></script>   (게임 — /games/<게임>/)
 *   <script type="module" src="../shared/bgm.js"></script>      (오늘의 나 — /tarot/ 등)
 * 화면 스크립트가 먼저 돌아 #header 가 그려진 뒤여야 버튼이 붙는다(모듈은 적힌 순서대로 실행된다).
 *
 * <audio loop> 가 아니라 Web Audio 인 이유: <audio> 는 반복할 때마다 MP3 앞뒤의
 * 인코더 무음이 끼어 이음새에서 툭 끊긴다. 곡 파일은 이음새를 맞춰 잘라 둔 것이라
 * AudioBufferSourceNode.loop 로 버퍼째 돌려야 그 작업이 산다.
 *
 * 기본값은 켜짐(2026-10-07 Master 지시). 브라우저는 첫 터치 전에는 소리를 내주지
 * 않으므로 「켜짐」 = 첫 탭에 시작이다. 끄면 localStorage 에 기억한다.
 * 꺼 둔 사람에게는 곡 파일을 받지도 않는다 — 폰 데이터를 아낀다.
 */

const KEY = "bgm-muted";
const VOLUME = 0.6; // 효과음(클로버·세 칸 쌓기·톡톡)이 묻히지 않을 만큼

let muted = false;
try { muted = localStorage.getItem(KEY) === "1"; } catch { /* 사생활 보호 모드 — 켜짐으로 */ }

let ctx = null;
let loading = null;

function load() {
  ctx ??= new (window.AudioContext ?? window.webkitAudioContext)();
  loading ??= fetch(new URL("bgm.mp3", location.href))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
    .then((buf) => ctx.decodeAudioData(buf))
    .then((audio) => {
      const gain = ctx.createGain();
      gain.gain.value = VOLUME;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = audio;
      src.loop = true;
      src.connect(gain);
      src.start();
    })
    .catch(() => { loading = null; }); // 곡이 없거나 못 받아도 게임은 그대로
  return loading;
}

function play() {
  if (muted) return;
  load();
  ctx.resume();
}

const stop = () => ctx?.suspend();

// 첫 터치에 시작. 막힌 채로 만든 AudioContext 는 사용자 제스처 안에서 resume 해야 풀린다.
// pointerdown 이 아닌 이유: iOS Safari 는 손이 닿는 순간(touchstart)을 소리 허가로 쳐주지
// 않고 떼는 순간(touchend·click)만 쳐준다. 드래그 게임(클로버)은 click 이 안 나서 touchend 도 둔다
const GESTURES = ["click", "touchend", "keydown"];
const unlock = () => {
  play();
  if (ctx?.state === "running" || muted) GESTURES.forEach((t) => removeEventListener(t, unlock, true));
};
GESTURES.forEach((t) => addEventListener(t, unlock, true));

// 앱을 벗어나면 멈추고 돌아오면 잇는다 — 백그라운드에서 혼자 울리지 않게
document.addEventListener("visibilitychange", () => (document.hidden ? stop() : ctx && play()));

const header = document.getElementById("header");
if (header) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "topbar__back topbar__sound";
  const paint = () => {
    btn.textContent = muted ? "🔇" : "🔊";
    btn.setAttribute("aria-label", muted ? "배경음악 켜기" : "배경음악 끄기");
    btn.setAttribute("aria-pressed", String(!muted));
  };
  paint();
  btn.addEventListener("click", () => {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* 기억만 못 할 뿐 */ }
    paint();
    muted ? stop() : play();
  });
  header.append(btn);
}
