/**
 * ㉛ 행운의 클로버 찾기
 *
 * 붙어 있는 클로버를 손가락으로 쓸어 담아 합을 10으로 맞춥니다. 조작이 **드래그 궤적**이라
 * 아케이드 규격(탭 1종류)을 벗어납니다 — docs/clover-game.md.
 *
 * ── 서버와 나누는 것 ──────────────────────────────────────────────────────
 * 서버는 **첫 판을 시드**하고, 끝에 **「10을 몇 번 맞췄는가」**만 받습니다(REQ-10 결정 ㉒).
 * 판정·낙하·리필은 전부 여기서 합니다 — 한 수마다 왕복하면 판 복귀 278ms 예산 위에
 * 네트워크가 그대로 얹혀 템포가 죽습니다(기획 28절).
 *
 * ── 손이 화면에 닿아 있는 게임입니다 ─────────────────────────────────────
 * ⑳ 슥슥 긁기에서 세 건이 나온 자리입니다. 여기서 지키는 것 셋:
 *   ① 판이 끝나는 순간 `armScreen` 으로 다음 화면을 400ms 잠급니다 — 잔여 궤적이
 *      「이어하기」를 눌러 광고가 의도 없이 열리는 것을 막습니다
 *   ② `touch-action: none` 으로 드래그가 스크롤로 새지 않게 합니다(base.css)
 *   ③ 숨은 화면을 재지 않습니다 — 판 크기는 화면이 뜬 뒤에만 잽니다
 */

import { ApiFail } from "../../shared/api.js";
import { $, showScreen, toast, renderHeader, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown, armScreen,
} from "../../shared/run.js";

const GAME = "CLOVER";
// config.ARCADE.CLOVER 와 같은 값입니다. 화면에만 쓰는 값이라 여기 둡니다.
const AD_ATTEMPTS_PER_DAY = 5;
const LOCK_MS = 400; // 0-H 입력 잠금
const HINT_MS = 4000;
const COMBO_MS = 2000;
const GAP = 4;
const MIN_TILE = 30;
const MERGE_MS = 90; // 고른 것이 모여 판이 메워지기까지 — 짧을수록 다음 조합을 빨리 찾습니다
const MERGE_VIEW = 620; // 합쳐진 「10」이 화면에 있는 시간
const FALL_BASE = 110;
const FALL_STEP = 12;
const FALL_CAP = 4;
const WAY_MAX_LEN = 5;

const formatBest = (metric) => `${Math.max(0, -metric)}장`;

// ══════════════════════════════════════════════════════════════
// 그림 — 기본·담김은 렌더본(PNG), 성공만 아직 코드로 그립니다
// ══════════════════════════════════════════════════════════════

/**
 * 성공(네잎+꼬리) 렌더는 아직 없습니다 — REQ-09 가 오면 `img/lucky.v1.png` 로 갈아 끼우고
 * 이 함수를 지웁니다. 그때까지 게임은 이 코드 그림으로 그대로 돕니다.
 *
 * 형태 규칙은 렌더본과 같습니다 — 잎을 겹쳐 한 덩이로 만들고 **가운데에 원을 그리지
 * 않습니다.** 원을 그리면 숫자가 「올려놓은 스티커」로 읽힙니다(2026-09-07 Master 지시).
 */
function luckySVG() {
  const c = { a: "#ffffff", b: "#e4f9f1", c: "#aadecd", d: "#7cbfa9", line: "#5ba18c" };
  const W = 30, H = 52, CORE = 29;
  const f = (x) => Math.round(x * 10) / 10;
  const leaf =
    `M0 0 C ${f(-W)} ${f(-H * 0.45)}, ${f(-W * 1.06)} ${f(-H * 0.94)}, ${f(-W * 0.42)} ${f(-H)}` +
    ` C ${f(-W * 0.12)} ${f(-H * 1.03)}, 0 ${f(-H * 0.9)}, 0 ${f(-H * 0.7)}` +
    ` C 0 ${f(-H * 0.9)}, ${f(W * 0.12)} ${f(-H * 1.03)}, ${f(W * 0.42)} ${f(-H)}` +
    ` C ${f(W * 1.06)} ${f(-H * 0.94)}, ${f(W)} ${f(-H * 0.45)}, 0 0 Z`;

  const angles = [45, 135, 225, 315];
  const body = angles
    .map((a) => `<path transform="translate(60,60) rotate(${a})" d="${leaf}"/>`)
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><defs>` +
    `<radialGradient id="g" cx="34%" cy="24%" r="80%">` +
    `<stop offset="0" stop-color="${c.a}"/><stop offset=".38" stop-color="${c.b}"/>` +
    `<stop offset=".74" stop-color="${c.c}"/><stop offset="1" stop-color="${c.d}"/></radialGradient>` +
    // 숫자 자리 — 테두리 없는 그늘. 바깥으로 서서히 사라져 윤곽이 생기지 않습니다
    `<radialGradient id="s" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#0d2a16" stop-opacity=".26"/>` +
    `<stop offset=".55" stop-color="#0d2a16" stop-opacity=".14"/>` +
    `<stop offset="1" stop-color="#0d2a16" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="k">${body}</clipPath>` +
    `<radialGradient id="mg" cx="50%" cy="50%" r="50%">` +
    `<stop offset=".55" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
    `<mask id="m"><rect width="120" height="120" fill="#fff"/>` +
    `<circle cx="60" cy="60" r="${CORE + 10}" fill="url(#mg)"/></mask>` +
    `<filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>` +
    `<filter id="c" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>` +
    `</defs>` +
    `<g fill="url(#g)">${body}</g>` +
    `<g clip-path="url(#k)" fill="none" stroke="${c.line}" stroke-opacity=".42" stroke-width="2.4" ` +
    `stroke-linejoin="round" mask="url(#m)">${body}</g>` +
    `<g clip-path="url(#k)"><ellipse cx="38" cy="29" rx="22" ry="12" fill="#fff" opacity=".32" filter="url(#b)" transform="rotate(-24 38 29)"/></g>` +
    `<g clip-path="url(#k)"><circle cx="60" cy="60" r="${CORE + 9}" fill="url(#s)" filter="url(#c)"/></g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const STEM =
  '<svg class="cv-stem" viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden="true">' +
  '<defs><linearGradient id="cvsg" x1="0" y1="0" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#4e9c88"/><stop offset=".40" stop-color="#cdf3e6"/>' +
  '<stop offset="1" stop-color="#79c4ad"/></linearGradient></defs>' +
  '<path d="M22 0 C14 24 12 50 17 70 C20 82 25 90 28 99 C21 93 13 82 10 68 C5 46 8 20 13 0Z" fill="url(#cvsg)"/>' +
  '<path d="M16 8 C11 30 11 52 16 70" fill="none" stroke="rgba(255,255,255,.40)" stroke-width="3" stroke-linecap="round"/>' +
  "</svg>";

const IMG_LUCKY = luckySVG();
// ⚠ **절대 경로여야 합니다.** 커스텀 속성 안의 상대 URL 은 그 값을 **쓰는 스타일시트**
//    (`shared/base.css`)를 기준으로 풀립니다 — 화면 파일이 아닙니다.
//    `img/base.v1.png` 로 두면 `/shared/img/base.v1.png` 를 찾아가 조용히 404 가 나고,
//    클로버가 하나도 안 보이는 채로 게임은 정상 동작합니다.
document.documentElement.style.setProperty("--cv-img-base", 'url("/games/clover/img/base.v1.png")');
document.documentElement.style.setProperty("--cv-img-pick", 'url("/games/clover/img/picked.v1.png")');
document.documentElement.style.setProperty("--cv-img-lucky", `url("${IMG_LUCKY}")`);
document.body.classList.add("game--clover");

// ══════════════════════════════════════════════════════════════
// 판 상태
// ══════════════════════════════════════════════════════════════

const board = {
  cells: [],       // 각 칸의 값 (0 = 비어 있음)
  cols: 8,
  rows: 10,
  target: 10,
};

const play = {
  running: false,
  clock: null,     // countdown 핸들
  segMs: 0,        // 이번 구간 길이
  total: 0,        // 서버가 들고 있는 누적 점수
  seg: 0,          // 이번 구간에 맞춘 횟수
  comboBest: 0,
  combo: 0,
  lastClear: 0,
  lastAction: 0,
  sel: [],
  sum: 0,
  hint: [],
  lucky: [],
  ptr: null,
  down: false,
  rings: [],
  audio: null,
};

const gridEl = $("#cvGrid");
const stageEl = $("#cvStage");
const fx = $("#cvFx");
const fctx = fx.getContext("2d");
const trail = $("#cvTrail");
const tctx = trail.getContext("2d");

const idx = (c, r) => r * board.cols + c;
const vib = (m) => navigator.vibrate?.(m);

function neighbors(i) {
  const c = i % board.cols;
  const r = Math.floor(i / board.cols);
  const out = [];
  if (c > 0) out.push(i - 1);
  if (c < board.cols - 1) out.push(i + 1);
  if (r > 0) out.push(i - board.cols);
  if (r < board.rows - 1) out.push(i + board.cols);
  return out;
}

/**
 * 합이 10이 되는 길 — **2칸 짝만 찾지 않습니다.**
 * 작은 수 가중 판에서 짝만 세면 길이 넉넉한데도 「막혔다」고 잘못 판정합니다.
 */
function ways(limit = 0) {
  const found = [];
  const seen = new Set();
  const walk = (path, sum) => {
    if (sum === board.target) {
      const key = [...path].sort((a, b) => a - b).join(",");
      if (!seen.has(key)) { seen.add(key); found.push([...path]); }
      return;
    }
    if (path.length >= WAY_MAX_LEN || sum > board.target) return;
    if (limit && found.length >= limit) return;
    for (const j of neighbors(path[path.length - 1])) {
      const v = board.cells[j];
      if (!v || path.includes(j) || sum + v > board.target) continue;
      path.push(j);
      walk(path, sum + v);
      path.pop();
      if (limit && found.length >= limit) return;
    }
  };
  for (let i = 0; i < board.cells.length; i++) {
    const v = board.cells[i];
    if (!v || v > board.target) continue;
    walk([i], v);
    if (limit && found.length >= limit) break;
  }
  return found;
}

// ══════════════════════════════════════════════════════════════
// 크기 — 화면이 뜬 뒤에만 잽니다
// ══════════════════════════════════════════════════════════════

/**
 * 판이 쓸 수 있는 실제 크기.
 *
 * ⚠ 재기 전에 높이를 0 으로 눌러 둡니다. 그냥 되돌리기만 하면 **판이 스스로를 밀어올려**
 *    남는 높이가 부풀려집니다(배너를 넣자 드러난 결함 · 2026-09-08).
 */
function stageBox() {
  if (!stageEl) return null;
  stageEl.style.flex = "1 1 0";
  stageEl.style.height = "0px";
  const r = stageEl.getBoundingClientRect();
  const cs = getComputedStyle(stageEl);
  // 숨은 화면은 0×0 입니다. 그 값으로 계산하면 칸이 20px 로 굳습니다
  if (!r.width || !r.height) return null;
  if (r.width < 40 || r.height < 40) return null;
  return {
    cs,
    w: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

function fitGrid() {
  const b = stageBox();
  if (!b) return;
  const tw = (b.w - (board.cols - 1) * GAP) / board.cols;
  const th = (b.h - (board.rows - 1) * GAP) / board.rows;
  const tile = Math.max(20, Math.floor(Math.min(tw, th) * 10) / 10);

  const root = document.documentElement.style;
  root.setProperty("--cv-tile", `${tile}px`);
  root.setProperty("--cv-gap", `${GAP}px`);
  root.setProperty("--cv-cols", String(board.cols));

  // 판에 딱 맞춰 줄입니다. 여기서 `flex: none` 이 되는 순간 남는 높이가 생기고,
  // 그때 스타일시트의 `margin-top: auto` 가 그것을 **판 위쪽**으로 몰아 줍니다 —
  // 한 손 엄지로 쓸어 담는 게임이라 판이 아래에 있어야 윗줄까지 닿습니다(REQ-11 3-4).
  const pv = parseFloat(b.cs.paddingTop) + parseFloat(b.cs.paddingBottom);
  stageEl.style.flex = "none";
  stageEl.style.height = `${Math.ceil(board.rows * tile + (board.rows - 1) * GAP + pv + 2)}px`;

  if (tile < MIN_TILE) {
    // 판은 8×10 고정이라 행을 줄이지 않습니다(순위가 판 크기에 걸려 있습니다).
    // 대신 알아 두어야 할 상태라 로그로 남깁니다.
    console.warn(`[clover] 칸이 ${tile}px 로 하한(${MIN_TILE}px) 아래입니다`);
  }
  sizeCanvas();
}

function sizeCanvas() {
  const d = Math.min(devicePixelRatio || 1, 3);
  fx.width = innerWidth * d;
  fx.height = innerHeight * d;
  fx.style.width = `${innerWidth}px`;
  fx.style.height = `${innerHeight}px`;
  fctx.setTransform(d, 0, 0, d, 0, 0);

  const r = trail.getBoundingClientRect();
  trail.width = Math.max(1, r.width * d);
  trail.height = Math.max(1, r.height * d);
  tctx.setTransform(d, 0, 0, d, 0, 0);
}

addEventListener("resize", fitGrid);
addEventListener("orientationchange", () => setTimeout(fitGrid, 120));

// ══════════════════════════════════════════════════════════════
// 그리기
// ══════════════════════════════════════════════════════════════

function buildGrid() {
  gridEl.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < board.cells.length; i++) {
    const cell = document.createElement("div");
    cell.className = "cv-cell";
    cell.dataset.i = String(i);
    cell.innerHTML = STEM;
    const face = document.createElement("div");
    face.className = "cv-face";
    face.append(document.createElement("b"));
    cell.append(face);
    frag.append(cell);
  }
  gridEl.append(frag);
  paint();
}

const faceOf = (cell) => cell.querySelector(".cv-face");

function paint() {
  for (let i = 0; i < board.cells.length; i++) {
    const cell = gridEl.children[i];
    if (!cell) continue;
    faceOf(cell).firstChild.textContent = board.cells[i] || "";
    cell.classList.toggle("is-sel", play.sel.includes(i));
    cell.classList.toggle("is-lucky", play.lucky.includes(i));
    cell.classList.toggle("is-hint", play.hint.includes(i));
    cell.classList.toggle("is-hidden", !board.cells[i]);
  }
}

/**
 * 칸의 화면 좌표. **잴 수 없으면 좌표를 만들지 않고 `null` 을 돌려줍니다.**
 *
 * ⑳ 에서 물린 자리입니다 — 화면이 바뀌는 순간 숨은 요소의 rect 는 0×0 이고,
 * 그 값으로 좌표를 만들면 보간이 Infinity 로 새어 루프가 멈추지 않습니다.
 */
function centerOf(i) {
  const r = gridEl.children[i]?.getBoundingClientRect();
  if (!r || !r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width };
}

function drawFx() {
  fctx.clearRect(0, 0, innerWidth, innerHeight);

  // 손가락을 따라가는 줄 — 클로버 **뒤**에 깔아 숫자를 가리지 않습니다
  const br = trail.getBoundingClientRect();
  if (!br.width) { requestAnimationFrame(drawFx); return; }
  tctx.clearRect(0, 0, br.width, br.height);
  if (play.sel.length) {
    const pts = play.sel.map(centerOf).filter(Boolean);
    if (play.ptr) pts.push({ x: play.ptr.x, y: play.ptr.y });
    const local = pts.map((q) => ({ x: q.x - br.left, y: q.y - br.top }));
    if (local.length) {
    tctx.save();
    tctx.lineCap = "round";
    tctx.lineJoin = "round";
    tctx.strokeStyle = "rgba(127,216,192,.20)";
    tctx.lineWidth = 30;
    strokeLine(local);
    tctx.strokeStyle = `rgba(127,216,192,${0.5 + 0.45 * (play.sum / board.target)})`;
    tctx.lineWidth = 13;
    strokeLine(local);
    tctx.restore();
    }
  }

  // 사라진 자리의 파문
  const now = performance.now();
  for (let i = play.rings.length - 1; i >= 0; i--) {
    const r = play.rings[i];
    const a = (now - r.t) / 300;
    if (a >= 1) { play.rings.splice(i, 1); continue; }
    if (a < 0) continue;
    fctx.strokeStyle = `rgba(160,232,210,${(1 - a) * 0.75})`;
    fctx.lineWidth = 4 * (1 - a) + 1;
    fctx.beginPath();
    fctx.arc(r.x, r.y, r.s * 0.42 + a * r.s * 1.3, 0, Math.PI * 2);
    fctx.stroke();
  }
  requestAnimationFrame(drawFx);
}

function strokeLine(pts) {
  tctx.beginPath();
  tctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) tctx.lineTo(pts[i].x, pts[i].y);
  tctx.stroke();
}

// ══════════════════════════════════════════════════════════════
// 소리 — 파일 없이 짧은 합성음. 담을수록 음이 올라갑니다
// ══════════════════════════════════════════════════════════════

function beep(freq, dur = 0.09, type = "sine", gain = 0.09) {
  try {
    play.audio ??= new (window.AudioContext ?? window.webkitAudioContext)();
    const ctx = play.audio;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  } catch {
    /* 소리는 없어도 게임은 성립합니다 */
  }
}

function clearSound() {
  const base = 440 * Math.pow(1.06, Math.min(play.combo, 8));
  [1, 1.26, 1.5].forEach((m, k) => setTimeout(() => beep(base * m, 0.13, "triangle", 0.1), k * 90));
}

// ══════════════════════════════════════════════════════════════
// 입력 — 누른 채 인접 칸을 이어 지나갑니다
// ══════════════════════════════════════════════════════════════

function hit(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest?.(".cv-cell");
  if (!cell) return -1;
  const i = Number(cell.dataset.i);
  if (play.lucky.includes(i)) return -1; // 날아가는 중인 칸은 다시 못 잡습니다
  return board.cells[i] ? i : -1;
}

gridEl.addEventListener("pointerdown", (e) => {
  if (!play.running) return;
  gridEl.setPointerCapture(e.pointerId);
  play.down = true;
  play.sel = [];
  play.sum = 0;
  play.hint = [];
  play.lastAction = performance.now();
  play.ptr = { x: e.clientX, y: e.clientY };
  const i = hit(e.clientX, e.clientY);
  if (i >= 0) {
    play.sel.push(i);
    play.sum = board.cells[i];
    vib(5);
    beep(300 + play.sum * 26, 0.07, "triangle", 0.07);
  }
  syncTray();
  paint();
});

gridEl.addEventListener("pointermove", (e) => {
  if (!play.down || !play.running) return;
  play.ptr = { x: e.clientX, y: e.clientY };
  const i = hit(e.clientX, e.clientY);
  if (i < 0) return;

  if (!play.sel.length) {
    play.sel.push(i);
    play.sum = board.cells[i];
    vib(5);
    beep(300 + play.sum * 26, 0.07, "triangle", 0.07);
    syncTray();
    paint();
    return;
  }
  // 직전 칸으로 되돌아가면 취소 — 잘못 담았을 때 손을 떼지 않고 물릴 수 있습니다
  if (play.sel.length >= 2 && i === play.sel[play.sel.length - 2]) {
    play.sum -= board.cells[play.sel.pop()];
    beep(240, 0.05, "sine", 0.05);
    syncTray();
    paint();
    return;
  }
  if (play.sel.includes(i)) return;
  if (!neighbors(play.sel[play.sel.length - 1]).includes(i)) return;
  // 10을 넘으면 담기지 않습니다. **벌칙은 없습니다**
  if (play.sum + board.cells[i] > board.target) return;

  play.sel.push(i);
  play.sum += board.cells[i];
  vib(5);
  beep(300 + play.sum * 26, 0.07, "triangle", 0.07);
  if (play.sum === board.target) resolve();
  else { syncTray(); paint(); }
});

function releasePointer() {
  if (!play.down) return;
  play.down = false;
  play.sel = [];
  play.sum = 0;
  play.ptr = null;
  syncTray();
  paint();
}
gridEl.addEventListener("pointerup", releasePointer);
gridEl.addEventListener("pointercancel", releasePointer);

// ══════════════════════════════════════════════════════════════
// 10 — 고른 것들이 한 덩이로 합쳐집니다
// ══════════════════════════════════════════════════════════════

function resolve() {
  const gone = [...play.sel];
  const now = performance.now();

  play.combo = now - play.lastClear < COMBO_MS ? play.combo + 1 : 1;
  play.comboBest = Math.max(play.comboBest, play.combo);
  play.lastClear = now;
  play.lastAction = now;
  clearSound();
  vib([10, 18, 12]);

  if (play.combo > 1) {
    const glow = $("#cvGlow");
    glow.style.opacity = String(Math.min(0.14 + play.combo * 0.07, 0.55));
    setTimeout(() => { glow.style.opacity = "0"; }, 300);
  }

  play.down = false;
  play.sel = [];
  play.sum = 0;
  play.ptr = null;
  syncTray();

  play.seg += 1; // 3칸이든 5칸이든 **1점** — 화면의 그림과 숫자를 맞춥니다
  syncHud();

  // ① 고른 클로버들이 가운데 한 점으로 모입니다
  // 좌표를 못 재면(화면이 바뀌는 중) 연출만 건너뛰고 판은 그대로 정리합니다
  const spots = gone.map(centerOf).filter(Boolean);
  const drawable = spots.length === gone.length;
  let cx = 0, cy = 0, cs = 0;
  spots.forEach((c) => { cx += c.x; cy += c.y; cs = c.s; });
  cx /= spots.length || 1;
  cy /= spots.length || 1;

  play.lucky = [...gone];
  paint();
  if (drawable) gone.forEach((i) => {
    const c = centerOf(i);
    const cell = gridEl.children[i];
    cell.style.zIndex = "3";
    cell.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${(cx - c.x) * 0.5}px,${(cy - c.y) * 0.5}px) scale(1.12)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx - c.x}px,${cy - c.y}px) scale(.30)`, opacity: 0 },
      ],
      { duration: MERGE_MS, easing: "cubic-bezier(.4,0,.25,1)", fill: "forwards" },
    );
  });

  // ② 한 덩이로 뭉친 네잎이 솟아 점수로 날아갑니다
  if (drawable) flyMerged(cx, cy, cs);

  // ③ 판은 기다리지 않습니다
  setTimeout(() => {
    const t2 = performance.now();
    gone.forEach((i, k) => {
      const c = centerOf(i);
      if (c) play.rings.push({ x: c.x, y: c.y, s: c.s, t: t2 + k * 30 });
      board.cells[i] = 0;
      gridEl.children[i].style.zIndex = "";
      gridEl.children[i].getAnimations().forEach((a) => a.cancel());
    });
    play.lucky = [];
    const moved = gravity();
    paint();
    fall(moved);
    // ⚠ 길 확인을 여기서 바로 돌리면 그 탐색이 프레임을 붙잡아 **낙하가 145ms 늦게
    //    시작합니다**(2026-09-08 실측). 먼저 그리고 떨어뜨린 뒤 다음 프레임으로 미룹니다.
    requestAnimationFrame(ensureWays);
  }, MERGE_MS);
}

/** 합쳐진 「10」 — 판 밖으로 나가야 해서 body 에 붙입니다 */
function flyMerged(cx, cy, cs) {
  const size = Math.max(cs * 2.2, 78);
  const node = document.createElement("div");
  node.className = "cv-merge";
  node.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;font-size:${size}px`;
  node.innerHTML = `<div class="cv-merge__b">${STEM}<img class="cv-merge__head" src="${IMG_LUCKY}" alt=""><b>10</b></div>`;
  document.body.append(node);

  const tgt = $("#cvScore").getBoundingClientRect();
  // 점수 자리를 못 재면(화면이 바뀌는 중) 날려 보낼 목적지가 없습니다 — 그리지 않습니다
  if (!tgt.width) { node.remove(); return; }
  // 손가락은 **아래**에 있고 다음 조합을 찾는 눈은 **위**에 있습니다.
  // 손을 피해 크게 띄우면 그 자리가 바로 찾는 자리라 시야를 막습니다 — 조금만 띄웁니다.
  const lift = Math.max(size * 0.55, 46);
  const dx = tgt.left + tgt.width / 2 - cx;
  const dy = tgt.top + tgt.height / 2 - cy;

  node.firstChild.animate(
    [
      { transform: "scale(.34)", opacity: 0 },
      { transform: "scale(1.16)", opacity: 1, offset: 0.16 },
      { transform: "scale(1)", opacity: 1, offset: 0.26 },
      { transform: "scale(1)", opacity: 1, offset: 0.5 }, // 멈춰 서 있는 구간 — 약 0.15초
      { transform: "scale(.60)", opacity: 1, offset: 0.86 },
      { transform: "scale(.32)", opacity: 0 },
    ],
    { duration: MERGE_VIEW, easing: "linear", fill: "forwards" },
  );

  const flight = node.animate(
    [
      { transform: "translate(-50%,-50%) translate(0px,0px)", offset: 0, easing: "cubic-bezier(.2,1.5,.4,1)" },
      { transform: `translate(-50%,-50%) translate(0px,${-lift}px)`, offset: 0.26, easing: "linear" },
      { transform: `translate(-50%,-50%) translate(0px,${-lift}px)`, offset: 0.5, easing: "cubic-bezier(.35,0,.25,1)" },
      { transform: `translate(-50%,-50%) translate(${dx * 0.6}px,${dy * 0.6 - lift * 0.4}px)`, offset: 0.76 },
      { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px)`, offset: 1 },
    ],
    { duration: MERGE_VIEW, fill: "forwards" },
  );
  flight.onfinish = () => {
    node.remove();
    const e = $("#cvScore");
    e.classList.remove("is-pop");
    void e.offsetWidth;
    e.classList.add("is-pop");
    beep(760, 0.09, "triangle", 0.07);
  };
}

/** 위가 내려앉고 빈자리는 새 값으로 채웁니다. 낙하 거리를 함께 돌려줍니다 */
function gravity() {
  const moved = {};
  for (let c = 0; c < board.cols; c++) {
    const stack = [];
    for (let r = board.rows - 1; r >= 0; r--) {
      const v = board.cells[idx(c, r)];
      if (v) stack.push({ v, r });
    }
    for (let r = board.rows - 1, k = 0; r >= 0; r--, k++) {
      const di = idx(c, r);
      if (k < stack.length) {
        board.cells[di] = stack[k].v;
        if (stack[k].r !== r) moved[di] = r - stack[k].r;
      } else {
        board.cells[di] = randomValue();
        moved[di] = r + 1;
      }
    }
  }
  return moved;
}

function fall(moved) {
  const first = gridEl.children[0]?.getBoundingClientRect();
  if (!first || !first.height) return; // 잴 수 없으면 낙하 연출을 건너뜁니다 (판은 이미 정리됐습니다)
  const h = first.height + GAP + 3;
  for (const i of Object.keys(moved)) {
    const face = faceOf(gridEl.children[i]);
    face.animate(
      [{ transform: `translateY(${-moved[i] * h}px)` }, { transform: "none" }],
      {
        duration: FALL_BASE + Math.min(moved[i], FALL_CAP) * FALL_STEP,
        easing: "cubic-bezier(.3,1.15,.6,1)",
      },
    );
  }
}

/**
 * 채워 넣는 값의 분포 — 서버가 첫 판을 만들 때 쓴 것과 **같은 가중치**입니다.
 * 균등으로 되돌리면 2칸 짝이 지배적이 되어 판이 다른 게임이 됩니다.
 */
const BAG = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 9];
const randomValue = () => BAG[(Math.random() * BAG.length) | 0];

/** 막히지 않게 최소 5개의 길은 남겨 둡니다 — **3칸짜리로** 심습니다 */
function ensureWays() {
  let changed = false;
  for (let t = 0; t < 40 && ways(5).length < 5; t++) {
    const i = (Math.random() * board.cells.length) | 0;
    if (!board.cells[i]) continue;
    const n1 = neighbors(i).filter((x) => board.cells[x]);
    if (!n1.length) continue;
    const j = n1[(Math.random() * n1.length) | 0];
    const n2 = neighbors(j).filter((x) => board.cells[x] && x !== i);
    if (!n2.length) continue;
    const k = n2[(Math.random() * n2.length) | 0];
    const a = 1 + ((Math.random() * 4) | 0);
    const b = 1 + ((Math.random() * 4) | 0);
    if (a + b >= board.target) continue;
    board.cells[i] = a;
    board.cells[j] = b;
    board.cells[k] = board.target - a - b;
    changed = true;
  }
  if (changed) paint();
}

// ══════════════════════════════════════════════════════════════
// HUD
// ══════════════════════════════════════════════════════════════

function buildTray() {
  const host = $("#cvTrayDots");
  host.replaceChildren();
  for (let i = 0; i < board.target; i++) {
    const d = document.createElement("div");
    d.className = "cv-tray__dot";
    host.append(d);
  }
}

function syncTray() {
  const dots = $("#cvTrayDots").children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = i < play.sum ? "cv-tray__dot is-on" : "cv-tray__dot";
  }
  $("#cvTray").classList.toggle("is-full", play.sum === board.target);
  $("#cvTrayNum").textContent = `${play.sum} / ${board.target}`;
}

function syncHud() {
  $("#cvScore").textContent = String(play.total + play.seg);
  const hot = performance.now() - play.lastClear < COMBO_MS && play.combo > 1;
  $("#cvCombo").textContent = hot ? `${play.combo}번째` : "—";
  $("#cvCombo").classList.toggle("hud__value--accent", hot);
}

function syncTime(left) {
  $("#cvTime").textContent = String(Math.ceil(left / 1000));
  $("#cvTime").classList.toggle("is-urgent", left < 10000);
  const bar = $("#cvBar");
  bar.style.width = `${Math.max(0, Math.min(100, (left / play.segMs) * 100))}%`;
  bar.classList.toggle("is-urgent", left < 10000);
}

/** 무동작 4초 뒤 길 하나를 알려 줍니다 */
function tickHint() {
  if (!play.running || play.hint.length) return;
  if (performance.now() - play.lastAction < HINT_MS) return;
  const p = ways(6);
  if (p.length) {
    play.hint = p[(Math.random() * p.length) | 0];
    paint();
  }
}

// ══════════════════════════════════════════════════════════════
// 런
// ══════════════════════════════════════════════════════════════

renderHeader($("#header"), { icon: "🍀", title: "행운의 클로버 찾기" });

const run = createEndlessRun({
  game: GAME,
  boost: {
    label: "15초 더 찾기",
    // 8절이 요구하는 「손해 없음」 문구 — 버튼에 그대로 박습니다
    desc: "이어해도 지금까지 찾은 네잎은 그대로 남습니다",
  },
  hooks: { onRound: startSegment, onJudged: keepJudged, onOver, pauseText },
});

let lastResult = null;
/**
 * ⚠ **ENDLESS 는 `result.detail` 이 비어 있습니다.** `spec.detailOf` 는 DB 기록용이라
 *    결과 화면까지 오지 않습니다(`CLAUDE.md` 「반복해서 물린 함정」). 결과에 쓸 값은
 *    `judgeRound` 가 `data` 로 실어 보낸 것을 여기 받아 둡니다.
 *    실제로 이걸 빼먹어 결과 화면의 「이어하기」가 0회로 나왔습니다(2026-09-08 브라우저 확인).
 */
let lastData = null;

function keepJudged(res) {
  if (res?.data) lastData = res.data;
}

$("#startBtn").addEventListener("click", startRun);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());

/**
 * 나가기 — 판이 도는 동안 상단바를 접으므로 **✕ 가 유일한 출구**입니다(REQ-11).
 *
 * 한 번 묻습니다. 판 위에서 손가락이 계속 움직이는 게임이라 스칠 수 있고,
 * 나가면 그 판은 기록되지 않고 쓴 기회도 돌아오지 않습니다.
 * 돌아가는 곳은 상단바 「‹」 와 **같은 자리**(`/games/`)로 둡니다 —
 * 출구가 둘로 갈리면 어느 쪽으로 나갔는지에 따라 다른 화면이 나옵니다.
 */
$("#cvExit").addEventListener("click", () => { $("#cvExitAsk").hidden = false; });
$("#cvExitStay").addEventListener("click", () => { $("#cvExitAsk").hidden = true; });
$("#cvExitGo").addEventListener("click", () => {
  $("#cvExitAsk").hidden = true;
  stopPlay();
  location.href = "/games/";
});
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();
requestAnimationFrame(drawFx);

async function loadReady() {
  stopPlay();
  showScreen("ready");
  document.body.classList.remove("cv-playing");
  clearRewards();
  try {
    const st = await runApi.status(GAME);
    renderReady({
      attempts: st.attempts, base: st.base_attempts,
      best: st.my_best, plays: st.my_plays, formatBest,
    });
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
  attemptReward(GAME, { perDay: AD_ATTEMPTS_PER_DAY, onGranted: loadReady });
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 기회를 모두 썼어요. 광고를 보면 한 번 더 할 수 있어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

/**
 * 한 구간 시작 — 첫 판은 60초, 이어하기는 15초.
 *
 * 이어하기(`resumed`)에서는 **판을 새로 짜지 않습니다.** 손에 들고 있던 판이 그대로
 * 이어져야 「그대로 남습니다」가 화면에서도 지켜집니다.
 */
function startSegment(round) {
  if (!round) return;
  document.body.classList.add("cv-playing");

  play.total = round.score ?? 0;
  play.seg = 0;
  play.segMs = round.play_ms ?? 60000;

  if (!round.resumed) {
    board.cols = round.cols;
    board.rows = round.rows;
    board.target = round.target;
    board.cells = [...round.board];
    play.combo = 0;
    play.comboBest = 0;
    play.lucky = [];
    buildTray();
    buildGrid();
  }

  play.sel = [];
  play.sum = 0;
  play.hint = [];
  play.rings = [];
  play.lastAction = performance.now();
  play.lastClear = 0;
  play.running = true;

  // 화면이 이미 떠 있어야 잽니다 — 엔진이 showScreen("play") 을 먼저 부릅니다.
  // 첫 프레임은 글꼴·이미지가 아직이라 한 번 더 잽니다.
  requestAnimationFrame(() => {
    fitGrid();
    requestAnimationFrame(fitGrid);
  });

  syncTray();
  syncHud();

  play.clock?.stop();
  play.clock = countdown({
    ms: play.segMs,
    onTick: (left) => { syncTime(left); tickHint(); },
    onEnd: endSegment,
  });
}

function stopPlay() {
  play.running = false;
  play.down = false;
  play.sel = [];
  play.sum = 0;
  play.ptr = null;
  play.rings = [];
  play.clock?.stop();
  play.clock = null;
  document.querySelectorAll(".cv-merge").forEach((n) => n.remove());
}

/**
 * 시간이 다했습니다. 여기가 **손이 화면에 닿아 있는 채로 화면이 바뀌는 자리**입니다 —
 * 다음 화면을 400ms 잠가 잔여 궤적이 「이어하기」를 누르지 못하게 합니다(0-H).
 */
async function endSegment() {
  if (!play.running) return;
  play.running = false;
  play.down = false;
  play.sel = [];
  play.sum = 0;
  play.ptr = null;
  syncTray();
  paint();
  armScreen("pause", LOCK_MS);
  armScreen("over", LOCK_MS);

  await run.answer({
    cleared: play.seg,
    combo_best: play.comboBest,
    played_ms: play.segMs,
  });
}

function pauseText() {
  const found = play.total + play.seg;
  return {
    sub: found > 0
      ? "이어하면 지금 판을 그대로 15초 더 찾습니다 — 찾은 네잎은 그대로 남습니다"
      : "아직 한 장도 없어요. 15초면 한두 장은 충분합니다",
    figure: `${found}장`,
  };
}

function onOver(result) {
  lastResult = result;
  stopPlay();
  document.body.classList.remove("cv-playing");

  const found = result.score ?? 0;
  renderRunOver(result, {
    figure: String(found),
    unit: "장",
    sub: found >= 15
      ? "손이 판을 읽고 있어요"
      : "작은 수부터 이어 붙이면 3~4칸 조합이 쉽게 보입니다",
    tiles: [
      { label: "찾은 네잎 클로버", value: `${comma(found)}장`, accent: true },
      { label: "최고 연쇄", value: `${lastData?.combo_best ?? play.comboBest}번째` },
      { label: "이어하기", value: `${Math.max(0, (lastData?.segments ?? 1) - 1)}회` },
    ],
    formatBest,
  });
  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "찾은 네잎 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "찾은 네잎 분포 · 오른쪽이 많음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
