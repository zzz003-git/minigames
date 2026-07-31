/**
 * ㉘ 톡톡
 *
 * 손을 떼지 않고 뽁뽁이를 훑어서 연달아 터뜨립니다.
 *
 * ── 조작이 탭이 아닙니다 ─────────────────────────────────────────────────
 * 아케이드 규격은 「조작은 탭 1종류」인데 이 게임은 **연속 드래그**입니다. 기획의
 * 핵심이 원리 2 손맛(톡 터지는 촉감)이고 종료 조건이 「손을 뗌」이라, 탭으로 바꾸면
 * 게임이 통째로 남지 않습니다. 벗어난 항목과 대체 경로는 docs/toktok-game.md §5.
 *
 * ── 판정은 조각 단위로 ───────────────────────────────────────────────────
 * 터짐마다 서버에 물으면 판이 성립하지 않습니다(왕복 약 470ms). 화면은 훑는 동안
 * **지나간 칸과 시각을 모으기만** 하고, FLUSH_AT 개마다 한 조각씩 보냅니다.
 * 서버가 같은 규칙으로 다시 세므로 개수를 화면이 정하지 않습니다.
 *
 * 조각으로 나누는 이유는 **마우스에 손목 제약이 없기 때문**입니다. 버튼을 누른 채
 * 계속 돌리면 훑기가 몇 분이고 이어지는데, 한 번에 보내려던 초안은 상한에서 잘려
 * 화면 2000개가 400개로 기록됐습니다. 조각은 판을 끝내지 않습니다(`ongoing: true`) —
 * 끝내는 것은 여전히 손을 떼는 것뿐입니다. 자세한 것은 docs/toktok-game.md §2.
 *
 * ── 히트가 새지 않게 (기획서 16장 위험 2) ────────────────────────────────
 * 손가락이 빠르면 프레임 사이의 칸을 건너뜁니다. 그래서 점 단위가 아니라 **직전
 * 좌표와 현재 좌표를 잇는 선분**으로 판정합니다 — 칸 좌표로 옮겨 한 칸씩 걸어가며
 * 지나간 자리를 빠짐없이 터뜨립니다. 서버도 이웃 칸끼리만 이어졌는지 검사하므로,
 * 이 보간을 빠뜨리면 기록이 그 자리에서 잘립니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, boostReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "TOKTOK";
const AD_PER_DAY = 5;

/** rank_metric = -(터뜨린 개수) — 동점자 보정항이 없습니다 (spec 주석 참조) */
const formatBest = (metric) => `${Math.max(0, -metric)}개`;

/** 터진 자리에 새 뽁뽁이가 밀려 올라오기까지 */
const REFILL_MS = 200;
/** 한 번의 이동으로 걸어갈 수 있는 칸 수 상한 — 격자가 유한하므로 닿지 않는 안전장치입니다 */
const MAX_WALK = 16;
/** 손을 떼지 않아도 이만큼 모이면 한 조각을 보냅니다 (config.ARCADE.TOKTOK.FLUSH_AT 과 같은 값) */
const FLUSH_AT = 150;
/** 화면이 바뀐 직후 그 화면의 버튼을 못 누르게 두는 시간 (기획서 0-H) */
const ARM_DELAY_MS = 400;

const state = {
  cols: 0,
  rows: 0,
  cells: [], // { node, cap, prize }
  prizes: new Map(), // 스트로크 안 몇 번째 터짐이 상품인가
  drawing: false,
  locked: true, // 판정 중·화면 전환 중에는 손을 받지 않습니다
  last: null, // 마지막으로 터뜨린 칸
  lastT: 0, // 마지막으로 터뜨린 시각 (조각 시작 이후 ms)
  path: [],
  times: [],
  segT0: 0, // 지금 조각이 시작된 시각
  // 화면에 띄우는 개수 = 서버가 확인한 것 + 날아가는 중 + 아직 안 보낸 것.
  // 셋으로 나눠 두어야 조각을 보내는 순간에도 숫자가 뒤로 가지 않습니다.
  confirmed: 0,
  inflight: 0,
  pending: 0, // 지금 조각의 터짐 수 (상품 순번의 기준 — 조각마다 다시 셉니다)
  pitch: 0, // 음정 — 훑기 시작부터 계속 오릅니다
  popped: false, // 이번 훑기에서 하나라도 터뜨렸는가
  prizeHits: 0,
};

/** 날아가는 중인 조각. 손을 뗄 때 이것을 먼저 기다려야 순서가 지켜집니다 */
let flight = null;

let lastResult = null;
let lastData = null;
let muted = false;
/** 시작 화면에서 읽어 둔 내 최고 기록(개수). [pause] 문구가 이 값을 씁니다 */
let myBest = null;

renderHeader($("#header"), { icon: "🫧", title: "톡톡" });

const run = createEndlessRun({
  game: GAME,
  boost: {
    label: "이어서 터뜨리기",
    // 기획서 0-F — 「이어해도 지금 기록은 그대로예요」를 버튼에 적습니다
    desc: "이어해도 지금 기록은 그대로예요",
  },
  hooks: {
    onRound: renderRound,
    onJudged: showVerdict,
    onOver: onOver,
    pauseText: pauseText,
  },
});

$("#startBtn").addEventListener("click", startRun);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());
$("#muteBtn").addEventListener("click", toggleMute);
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ══════════════════════════════════════════════════════════════
// 시작 화면
// ══════════════════════════════════════════════════════════════

async function loadReady() {
  showScreen("ready");
  clearRewards();

  try {
    const st = await runApi.status(GAME);
    renderReady({
      attempts: st.attempts,
      base: st.base_attempts,
      best: st.my_best,
      plays: st.my_plays,
      formatBest,
    });
    myBest = st.my_best == null ? null : Math.max(0, -st.my_best);
    $("#playsValue").textContent = st.my_plays > 0 ? `${comma(st.my_plays)}판` : "첫 도전";
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }

  $("#packText").textContent = "뽁뽁이 무늬와 색은 매일 바뀝니다 — 오늘의 포장.";
  attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 기회를 모두 썼어요. 광고를 보면 한 판 더 할 수 있어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 소리 — 이 게임의 절반 (기획서 16장 위험 1)
// ══════════════════════════════════════════════════════════════

let ac = null;

/**
 * 오디오는 **사용자 제스처 안에서** 열어야 합니다. 손을 대는 순간이 그 자리입니다.
 * 브라우저가 막거나 지원하지 않으면 조용히 진동만 남깁니다.
 */
function openAudio() {
  try {
    ac ??= new (window.AudioContext ?? window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
  } catch {
    ac = null;
  }
}

/**
 * 톡 — 짧게 붙었다 떨어지는 소리.
 *
 * 끊기지 않는 동안 **반음씩 오릅니다**(원리 4 콤보·흐름). 두 옥타브를 넘으면
 * 사람이 못 듣는 높이로 가므로 위쪽 한 옥타브 안에서 계속 올라갑니다.
 */
function tok(n, prize = false) {
  if (muted || !ac) return;
  const semi = n <= 24 ? n : 12 + ((n - 24) % 12);
  const t = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = prize ? "square" : "triangle";
  osc.frequency.value = 294 * Math.pow(2, semi / 12);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(prize ? 0.3 : 0.18, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + (prize ? 0.22 : 0.1));

  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + (prize ? 0.24 : 0.12));
}

function toggleMute() {
  muted = !muted;
  const btn = $("#muteBtn");
  btn.textContent = muted ? "🔇 소리" : "🔊 소리";
  btn.setAttribute("aria-pressed", String(muted));
}

// ══════════════════════════════════════════════════════════════
// 뽁뽁이 판
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;

  lastData = round; // 결과·[pause] 화면이 쓰는 값

  // 소진된 런을 이어받은 경우 — 손을 뗀 자리의 [pause] 화면으로 보냅니다
  if (round.strokes > 0 && run.state.lives <= 0) {
    showResumedPause(round);
    return;
  }

  // 훑는 도중에 도착한 다음 조각의 판입니다 — 화면을 다시 그리면 손이 붙어 있는데
  // 판이 갈아엎어집니다. 상품 순번만 새것으로 바꾸고 그대로 둡니다.
  if (state.drawing) {
    state.prizes = new Map((round.prizes ?? []).map((p) => [p.at, p]));
    return;
  }

  state.cols = round.cols;
  state.rows = round.rows;
  state.prizeHits = round.prize_hits ?? 0;
  state.prizes = new Map((round.prizes ?? []).map((p) => [p.at, p]));
  resetStroke();
  state.confirmed = round.pops ?? 0;

  const pack = round.pack ?? {};
  setHeaderBadge(pack.name ?? "오늘의 포장");
  $("#hudPops").textContent = String(state.confirmed);
  $("#hudPrize").textContent = String(state.prizeHits);
  $("#playHint").innerHTML =
    state.confirmed > 0
      ? "이어서 <b>죽</b> 끌어 보세요 — 지금 기록은 그대로예요"
      : "손가락을 대고 <b>죽</b> 끌어 보세요";

  buildBoard(pack.hex ?? "#7FD8C0");
  state.locked = false;
}

function resetStroke() {
  state.drawing = false;
  state.last = null;
  state.lastT = 0;
  state.path = [];
  state.times = [];
  state.segT0 = 0;
  state.inflight = 0;
  state.pending = 0;
  state.pitch = 0;
  state.popped = false;
}

/** 화면에 띄우는 연속 개수 */
function showCount() {
  const n = $("#hudPops");
  n.textContent = String(state.confirmed + state.inflight + state.pending);
  n.classList.remove("is-bump");
  void n.offsetWidth; // 애니메이션 재시작
  n.classList.add("is-bump");
}

function buildBoard(hex) {
  const board = clear($("#board"));
  board.style.setProperty("--cols", String(state.cols));
  board.style.setProperty("--rows", String(state.rows));
  board.style.setProperty("--pack", hex);
  board.classList.remove("is-locked", "is-drawing");

  state.cells = [];
  for (let i = 0; i < state.cols * state.rows; i++) {
    const cap = el("span", { class: "bub__cap" });
    const ring = el("span", { class: "bub__ring", "aria-hidden": "true" });
    const prize = el("span", { class: "bub__prize", "aria-hidden": "true" });
    const node = el("div", { class: "bub" }, cap, ring, prize);
    state.cells.push({ node, cap, prize });
    board.append(node);
  }
}

/** 화면 좌표 → 칸 번호. 판 밖이거나 크기를 잴 수 없으면 null (⑳ 에서 배운 것) */
function cellAt(e) {
  const board = $("#board");
  const r = board.getBoundingClientRect();
  if (!board.isConnected || r.width <= 0 || r.height <= 0) return null;

  const c = Math.floor(((e.clientX - r.left) / r.width) * state.cols);
  const row = Math.floor(((e.clientY - r.top) / r.height) * state.rows);
  if (c < 0 || row < 0 || c >= state.cols || row >= state.rows) return null;
  return row * state.cols + c;
}

/**
 * 지난 칸에서 이번 칸까지 **한 칸씩** 걸어가며 전부 터뜨립니다.
 * 매 걸음이 이웃 칸이라 서버의 경로 검사를 그대로 통과합니다.
 *
 * 시각도 함께 나눕니다. 한 번의 pointermove 로 두세 칸이 터질 때 시각을 전부 같게
 * 두면 간격이 0ms 이 되어 **정상적인 빠른 훑기가 이상치로 찍힙니다**(브라우저 확인에서
 * 실제로 걸렸습니다). 손가락은 그 사이를 실제로 지나갔으므로 나눠 적는 것이 맞습니다.
 */
function walkTo(cell, tNow) {
  if (state.last == null) {
    pop(cell, tNow);
    return;
  }
  const c0 = state.last % state.cols;
  const r0 = Math.floor(state.last / state.cols);
  const c1 = cell % state.cols;
  const r1 = Math.floor(cell / state.cols);

  const n = Math.min(MAX_WALK, Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0)));
  const t0 = state.lastT;
  for (let i = 1; i <= n; i++) {
    const c = Math.round(c0 + ((c1 - c0) * i) / n);
    const r = Math.round(r0 + ((r1 - r0) * i) / n);
    pop(r * state.cols + c, t0 + ((tNow - t0) * i) / n);
  }
}

function pop(cell, tNow = performance.now() - state.segT0) {
  if (cell === state.last) return;

  state.path.push(cell);
  state.times.push(Math.round(Math.max(0, tNow)));
  state.lastT = tNow;
  state.last = cell;
  state.pending += 1;
  state.pitch += 1;
  state.popped = true;

  // 상품 순번은 **조각 안에서** 셉니다 — 서버도 조각마다 자기 스케줄로 다시 셉니다
  const prize = state.prizes.get(state.pending) ?? null;
  burst(cell, prize);
  tok(state.pitch, Boolean(prize));
  navigator.vibrate?.(prize ? [12, 30, 24] : 8);

  if (prize) {
    state.prizeHits += 1;
    $("#hudPrize").textContent = String(state.prizeHits);
  }

  showCount();

  // 손을 떼지 않아도 조각을 보냅니다 — 마우스는 손목 제약이 없어 훑기가 몇 분이고
  // 이어지는데, 한 번에 보내려 하면 상한에서 잘려 화면과 기록이 어긋납니다.
  if (state.pending >= FLUSH_AT && !flight) sendSegment(false);
}

/**
 * 지금까지 모은 경로를 한 조각으로 보냅니다.
 *
 * `final=false` 면 판을 끝내지 않고 누적만 합니다(서버의 `ongoing`).
 * 보내는 즉시 버퍼를 비우고 시각 기준을 새로 잡으므로, 날아가는 동안에도 손은
 * 멈추지 않고 다음 조각을 채웁니다.
 */
function sendSegment(final) {
  const cells = state.path;
  const times = state.times;
  state.path = [];
  state.times = [];
  state.segT0 = performance.now();
  state.lastT = 0;
  state.inflight += state.pending;
  state.pending = 0;

  const p = run
    .answer({ cells, times, ongoing: !final }, { elapsed_ms: times[times.length - 1] ?? 0 })
    .finally(() => {
      if (flight === p) flight = null;
    });
  flight = p;
  return p;
}

/** 터짐 연출 + 아래에서 새 뽁뽁이가 올라오는 되돌림 */
function burst(cell, prize) {
  const c = state.cells[cell];
  if (!c) return;

  if (prize) {
    c.prize.textContent = prize.icon ?? "";
    c.node.classList.remove("is-prize");
    void c.node.offsetWidth;
    c.node.classList.add("is-prize");
  }

  c.node.classList.remove("is-rise");
  c.node.classList.add("is-pop");

  clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    c.node.classList.remove("is-pop");
    c.node.classList.add("is-rise");
    c.timer = setTimeout(() => c.node.classList.remove("is-rise"), 260);
  }, REFILL_MS);
}

// ══════════════════════════════════════════════════════════════
// 훑기
// ══════════════════════════════════════════════════════════════

const board = $("#board");

board.addEventListener("pointerdown", (e) => {
  if (state.locked || state.drawing) return;
  const cell = cellAt(e);
  if (cell == null) return;

  e.preventDefault();
  openAudio();

  state.drawing = true;
  state.segT0 = performance.now();
  board.classList.add("is-drawing");
  // 캡처하면 손이 판 밖으로 나가도 그 훑기가 이어집니다 — 손을 떼지 않는 한
  // 판은 끝나지 않아야 합니다.
  try {
    board.setPointerCapture?.(e.pointerId);
  } catch { /* 캡처 없이도 훑을 수 있습니다 */ }

  pop(cell); // 손이 닿는 즉시 하나가 터집니다 (기획서 0-3)
});

board.addEventListener("pointermove", (e) => {
  if (!state.drawing || state.locked) return;

  // 버튼이 떨어진 뒤의 이동으로는 터지지 않아야 합니다 (⑳ 에서 배운 것)
  if (e.buttons === 0) {
    endStroke();
    return;
  }

  const cell = cellAt(e);
  if (cell == null) {
    // 판 밖으로 나갔습니다. 손은 아직 붙어 있으므로 훑기는 살아 있고,
    // 돌아왔을 때 경로가 이어지지 않는 자리만 이음매로 남깁니다.
    if (state.last != null) {
      const t = performance.now() - state.segT0;
      state.path.push(-1);
      state.times.push(Math.round(t));
      state.lastT = t;
      state.last = null;
    }
    return;
  }

  walkTo(cell, performance.now() - state.segT0);
});

board.addEventListener("pointerup", endStroke);
board.addEventListener("pointercancel", endStroke);

/**
 * 키보드·보조기기 — 방향키로 훑고 Enter/Space 로 손을 뗍니다.
 * 마우스가 없는 사용자도 같은 게임을 할 수 있어야 합니다.
 */
board.addEventListener("keydown", (e) => {
  if (state.locked) return;

  const DIR = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -state.cols, ArrowDown: state.cols };
  if (e.key in DIR) {
    e.preventDefault();
    if (!state.drawing || state.last == null) {
      openAudio();
      state.drawing = true;
      if (!state.segT0) state.segT0 = performance.now();
      pop(Math.floor((state.rows * state.cols) / 2));
      return;
    }
    const c = state.last % state.cols;
    const next = state.last + DIR[e.key];
    // 좌우 이동이 줄을 넘어가지 않게 합니다 (칸 번호만 보면 넘어갑니다)
    if (e.key === "ArrowLeft" && c === 0) return;
    if (e.key === "ArrowRight" && c === state.cols - 1) return;
    if (next < 0 || next >= state.cols * state.rows) return;
    pop(next);
    return;
  }

  if (["Enter", " ", "Spacebar"].includes(e.key) && state.drawing) {
    e.preventDefault();
    endStroke();
  }
});

/** 손을 뗀 순간 — 판이 끝납니다 */
async function endStroke() {
  if (!state.drawing) return;
  state.drawing = false;
  state.locked = true;
  board.classList.remove("is-drawing");
  board.classList.add("is-locked");

  if (!state.popped) {
    // 살짝 닿았다 뗀 것으로 판을 끝내지 않습니다
    state.locked = false;
    board.classList.remove("is-locked");
    resetStroke();
    return;
  }

  // 날아가는 조각이 있으면 먼저 끝냅니다 — 순서가 뒤집히면 마지막 조각이
  // 「이미 소진된 런」에 도착해 판이 끝나지 않습니다.
  if (flight) await flight;
  await sendSegment(true);
}

// ══════════════════════════════════════════════════════════════
// 판정 결과
// ══════════════════════════════════════════════════════════════

async function showVerdict(res) {
  const d = res.data ?? {};

  if (d.invalid) {
    toast(d.invalid, "error", 1400);
    state.locked = false;
    board.classList.remove("is-locked");
    resetStroke();
    showCount();
    return;
  }

  // ENDLESS 는 result.detail 이 비어 있어(엔진 구조상) 결과 화면이 쓸 값을 여기서 챙깁니다
  lastData = d;

  // 서버가 센 값으로 맞춥니다 — 경로가 어긋나 잘렸다면 여기서 줄어듭니다.
  // 아직 안 보낸 조각(pending)은 그대로 두고 더합니다 — 손은 계속 움직이고 있습니다.
  state.confirmed = d.pops ?? state.confirmed;
  state.inflight = 0;
  state.prizeHits = d.prize_hits ?? state.prizeHits;
  showCount();
  $("#hudPrize").textContent = String(state.prizeHits);

  if ((d.prizes ?? []).length > 0) {
    const names = d.prizes.map((p) => `${p.icon} ${p.name}`).join(" · ");
    toast(`${names} — 뜯어서 나왔어요`, "good", 2000);
  }
}

// ══════════════════════════════════════════════════════════════
// 손을 뗀 뒤 — 그 자리에서 이어하기
// ══════════════════════════════════════════════════════════════

/**
 * 판이 끝나는 조건이 「손을 뗌」이라, 화면이 바뀐 직후에 **다시 손을 대려는 동작**이
 * 그 자리에 온 광고 버튼을 누릅니다. 기획서 8장의 「광고는 선택형」이 그 자리에서
 * 깨지므로, 화면을 바꾼 직후 잠깐 이 화면 전체가 손을 받지 않게 둡니다 (기획서 0-H).
 * ⑳ 에서 실서비스로 겪은 것과 같은 자리입니다.
 */
function armPauseLater() {
  const screen = document.querySelector('[data-screen="pause"]');
  if (!screen) return;
  screen.style.pointerEvents = "none";
  setTimeout(() => {
    screen.style.pointerEvents = "";
  }, ARM_DELAY_MS);
}

function pauseText() {
  armPauseLater();

  const pops = lastData?.pops ?? 0;

  $("#pauseHeadline").textContent = "손을 뗐어요";

  return {
    // 기획서 8장의 종료 문구 — 「열넷 — 최고는 열여덟이었어요」
    sub:
      myBest != null && pops < myBest
        ? `최고는 ${myBest}개였어요 — 이어해도 지금 기록은 그대로예요`
        : "이어해도 지금 기록은 그대로예요",
    figure: `${pops}개`,
  };
}

/** 소진된 런을 새로고침으로 이어받았을 때의 [pause] 화면 (⑳ 과 같은 처리) */
function showResumedPause(round) {
  lastData = round;
  const t = pauseText();
  $("#pauseSub").textContent = t.sub;
  $("#pauseFigure").textContent = t.figure;

  showScreen("pause");
  clearRewards();

  boostReward(GAME, {
    sessionId: run.state.sessionId,
    label: "이어서 터뜨리기",
    desc: "이어해도 지금 기록은 그대로예요",
    used: round.boosts_used ?? 0,
    max: run.state.maxBoosts,
    onBoosted: (reward) => {
      run.state.paused = false;
      run.state.lives = reward.lives;
      clearRewards();
      showScreen("play");
      renderRound(reward.round);
    },
  });
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function onOver(result) {
  lastResult = result;
  state.locked = true;

  const d = lastData ?? {};
  const best = result.prev_best == null ? null : Math.max(0, -result.prev_best);

  renderRunOver(result, {
    figure: String(result.score ?? 0),
    unit: "개",
    sub:
      result.is_best || best == null
        ? "손 떼지 않고 여기까지 왔어요"
        : `최고는 ${best}개였어요`,
    tiles: [
      { label: "한 번에 최다", value: `${d.best_stroke ?? 0}개`, accent: true },
      { label: "훑은 횟수", value: `${d.strokes ?? 0}번` },
      { label: "상품", value: `${d.prize_hits ?? 0}개` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "최장 연속 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "최장 연속 분포 · 왼쪽이 많이 터뜨림",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
