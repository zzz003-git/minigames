/**
 * ㉚ 쭉
 *
 * 말랑한 덩어리를 잡아당겨 끊어지기 전까지 길게 늘립니다.
 *
 * ── 조작이 탭이 아닙니다 ─────────────────────────────────────────────────
 * 아케이드 규격은 「조작은 탭 1종류」인데 이 게임은 **연속 드래그**입니다. 늘어나는
 * 감각이 기획의 전부(기획서 16장 위험 1)라 탭으로 바꾸면 게임이 남지 않습니다.
 * 벗어난 항목과 대체 경로는 docs/stretch-game.md §1.
 *
 * ── 손상 모형은 서버와 같은 식입니다 ─────────────────────────────────────
 * `damageRate` 는 src/games/arcade/stretch.js 의 같은 이름 함수와 **같은 식**이어야
 * 합니다. 상수는 서버가 라운드에 실어 보내므로(`round.model`) 값을 여기에 적지
 * 않습니다. 한쪽만 고치면 화면이 보여 준 끊어짐과 서버가 인정한 길이가 어긋납니다
 * (㉑ 퍼펙트 스택의 blockX 와 같은 성질의 이중 구현입니다).
 *
 * 다른 점이 하나 있습니다 — 화면은 **실제 손가락 속도**로 판정하고, 서버는 표본에서
 * 구한 Δ길이/Δ시각(하한)으로 판정합니다. 그래서 서버 쪽이 늘 더 관대하고, 화면이
 * 보여 준 길이가 깎이는 일이 없습니다.
 *
 * ── 그림은 베지어 2개입니다 (기획서 16장 위험 2) ─────────────────────────
 * 변형 메시는 구형 단말에서 무겁습니다. 정식 물리 엔진 대신 **양쪽 윤곽선 베지어
 * 하나씩 + 두께 함수**로 근사합니다. 가운데가 가늘어지는 것(넥킹)이 두께 함수 하나로
 * 나오고, 프레임마다 문자열 하나만 갱신하므로 저사양에서도 프레임이 유지됩니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, armScreen,
} from "../../shared/run.js";

const GAME = "STRETCH";
const AD_PER_DAY = 5;

/** rank_metric = -(길이 × 1000) */
const lenOf = (metric) => Math.max(0, -metric) / 1000;
const formatBest = (metric) => `${lenOf(metric).toFixed(2)} 화면`;

/**
 * 화면에 그리는 최대 길이(무대 짧은 변 비율). 이보다 길어지면 시야가 줄어듭니다.
 *
 * 이 게임의 일차 원리는 **커지는 것**(원리 7)이라, 값이 작으면 늘어나는 광경 자체가
 * 안 보입니다. 0.4 로 두었더니 무대의 3분의 1도 못 채웠습니다.
 */
const RENDER_SPAN = 0.62;
/** 화면이 바뀐 직후 그 화면의 버튼을 못 누르게 두는 시간 (기획서 0-H) */
const ARM_DELAY_MS = 400;

const state = {
  model: null,
  dough: null,
  prizes: [], // { at, name, icon }
  prizeHits: 0,

  drawing: false,
  locked: true,
  broke: false,

  len: 0, // 지금 길이 (무대 짧은 변 = 1)
  dmg: 0, // 누적 손상
  elapsed: 0, // 손을 댄 뒤 흐른 시간(ms) — 첫 3초 보장의 기준
  buzzAt: 0,

  tip: null, // 손가락 위치 (무대 px)
  lastPt: null,
  lastT: 0,
  segT0: 0,
  samples: [], // { t, len }
  sentLen: 0, // 서버가 확인한 길이
  raf: 0,
};

/** 날아가는 중인 조각. 손을 뗄 때 이것을 먼저 기다려야 순서가 지켜집니다 (㉘ 과 같은 이유) */
let flight = null;
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🫓", title: "쭉" });

// 무대 요소는 **아래 loadReady() 호출보다 먼저** 잡아 둡니다.
// loadReady 의 첫 줄이 stopDraw() 이고 그것이 stage 를 만지므로, 선언이 아래에 있으면
// 모듈을 여는 순간 TDZ 오류로 화면이 통째로 죽습니다(브라우저 확인에서 걸렸습니다).
const stage = $("#stage");
const svg = $("#dough");
const body = $("#doughBody");
const prizeHost = $("#doughPrize");

const run = createEndlessRun({
  game: GAME,
  boost: {
    label: "끊긴 자리에서 이어 붙이기",
    // 기획서 8장 — 「이어 붙여도 지금 길이는 그대로예요」를 버튼에 문자로 적습니다
    desc: "이어 붙여도 지금 길이는 그대로예요",
  },
  hooks: { onRound: renderRound, onJudged: showVerdict, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ══════════════════════════════════════════════════════════════
// 시작 화면
// ══════════════════════════════════════════════════════════════

async function loadReady() {
  stopDraw();
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
    $("#doughText").textContent = "재료는 매일 바뀝니다. 늘어난 길이만큼 전액 적립돼요.";

    if ((st.attempts?.remaining ?? 0) <= 0) {
      attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
    }
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 기회를 모두 썼어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 무대
// ══════════════════════════════════════════════════════════════

/** 무대 크기. rect 가 0 이면 좌표를 만들지 않습니다 (⑳ 에서 무한 루프로 걸렸습니다) */
function metrics() {
  const r = stage.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { w: r.width, h: r.height, short: Math.min(r.width, r.height), left: r.left, top: r.top };
}

function renderRound(round) {
  if (!round) return;
  stopDraw();

  state.model = round.model;
  state.dough = round.dough;
  state.prizes = round.prizes ?? [];
  state.prizeHits = round.prize_hits ?? 0;

  // 이어 붙인 판은 길이·손상·경과를 이어받습니다 (기획서 8장 「길이·기록 유지」)
  state.len = round.start_len ?? 0;
  state.dmg = round.start_dmg ?? 0;
  state.elapsed = round.start_elapsed ?? 0;
  state.sentLen = state.len;
  state.broke = false;
  state.tip = null;
  state.samples = [];

  setHeaderBadge(round.dough?.name ?? "오늘의 재료");
  stage.style.setProperty("--c", round.dough?.hex ?? "#E8C25C");
  $("#hudLen").textContent = state.len.toFixed(2);
  $("#hudPrize").textContent = String(state.prizeHits);
  $("#playHint").innerHTML =
    state.len > 0 ? "이어 붙였어요 — <b>천천히</b> 이어 가세요" : "덩어리를 <b>천천히</b> 끌어 보세요";
  clear(prizeHost);

  fitViewBox();
  draw();
  armAfter();
}

function fitViewBox() {
  const m = metrics();
  if (!m) return;
  svg.setAttribute("viewBox", `0 0 ${m.w.toFixed(1)} ${m.h.toFixed(1)}`);
}

window.addEventListener("resize", () => {
  fitViewBox();
  draw();
});

/** 화면을 바꾼 직후에는 손을 받지 않습니다 (기획서 0-H) */
function armAfter(ms = ARM_DELAY_MS) {
  state.locked = true;
  stage.classList.add("is-locked");
  setTimeout(() => {
    state.locked = false;
    stage.classList.remove("is-locked");
  }, ms);
}

// ══════════════════════════════════════════════════════════════
// 그리기 — 베지어 2개 + 두께 함수
// ══════════════════════════════════════════════════════════════

function draw() {
  const m = metrics();
  if (!m) return;

  const cx = m.w / 2;
  const cy = m.h / 2;
  const tip = state.tip ?? { x: cx, y: cy + 1 };

  let dx = tip.x - cx;
  let dy = tip.y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5) {
    dx = 0;
    dy = 1;
  } else {
    dx /= dist;
    dy /= dist;
  }

  // 화면 끝까지 늘어나면 시야가 줄어듭니다 — 길이의 상한은 없습니다 (기획서 4장 4번)
  const zoom = state.len > RENDER_SPAN ? RENDER_SPAN / state.len : 1;
  const drawLen = Math.min(state.len, RENDER_SPAN) * m.short;
  const rx = tip.x - dx * drawLen;
  const ry = tip.y - dy * drawLen;

  // 두께 — 길수록 전체가 가늘어지고, 가운데가 가장 먼저 가늘어집니다(넥킹)
  //
  // `t` 는 「얼마나 늘어난 상태인가」입니다. 0 이면 세 두께가 모두 같아져 두 호가
  // 정확히 원 하나를 이룹니다 — 쉬는 덩어리는 **동그란 덩어리**여야 합니다.
  // (t 를 두지 않았더니 시작 화면의 덩어리가 반원으로 잘려 보였습니다)
  const t = Math.min(1, state.len / 0.5);
  const base = 0.16 * m.short * zoom;
  const neck = Math.max(0.08, 1 / (1 + state.len * 1.9));
  const hRoot = base * 0.95;
  const hTip = base * (0.95 - 0.35 * t);
  const hMid = base * (0.95 + (neck - 0.95) * t);

  // 장력이 높을수록 미세하게 떱니다 (기획서 0-3 「가운데가 가늘어지면서 미세하게 떨린다」)
  const tension = state.model ? Math.min(1, state.dmg / state.model.capacity) : 0;
  const shake = state.drawing ? tension * 2.4 * Math.sin(performance.now() / 26) : 0;

  const nx = -dy;
  const ny = dx;
  const mx = (rx + tip.x) / 2 + nx * shake;
  const my = (ry + tip.y) / 2 + ny * shake;

  // 양쪽 윤곽선을 베지어 하나씩, 뿌리와 끝은 반원으로 닫습니다.
  //
  // sweep-flag 는 **0** 입니다. 1 로 두면 두 반원이 몸통 안쪽으로 돌아 양끝에 초승달
  // 조각이 삐져나옵니다(브라우저 확인에서 그렇게 보였습니다). SVG 는 y 가 아래로
  // 커지므로 각도가 시계 방향으로 늘고, 「바깥으로 볼록한」 쪽은 반시계 = 0 입니다.
  const p = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  body.setAttribute(
    "d",
    [
      `M ${p(rx + nx * hRoot, ry + ny * hRoot)}`,
      `Q ${p(mx + nx * hMid, my + ny * hMid)} ${p(tip.x + nx * hTip, tip.y + ny * hTip)}`,
      `A ${hTip.toFixed(1)} ${hTip.toFixed(1)} 0 0 0 ${p(tip.x - nx * hTip, tip.y - ny * hTip)}`,
      `Q ${p(mx - nx * hMid, my - ny * hMid)} ${p(rx - nx * hRoot, ry - ny * hRoot)}`,
      `A ${hRoot.toFixed(1)} ${hRoot.toFixed(1)} 0 0 0 ${p(rx + nx * hRoot, ry + ny * hRoot)}`,
      "Z",
    ].join(" "),
  );

  // 늘어난 만큼 색이 옅어집니다 (기획서 0-3)
  stage.style.setProperty("--fade", (1 - Math.min(0.42, state.len * 0.17)).toFixed(3));
  stage.style.setProperty("--tension", tension.toFixed(3));
}

// ══════════════════════════════════════════════════════════════
// 끌기
// ══════════════════════════════════════════════════════════════

/** 서버 src/games/arcade/stretch.js 의 damageRate 와 **같은 식**입니다 */
function damageRate(len, speed) {
  const M = state.model;
  const L = Math.max(0, len) / M.len_ref;
  const v = Math.max(0, speed) / M.speed_ref;
  return L ** M.alpha * v ** M.beta + M.fatigue * L ** M.gamma;
}

const pointAt = (e, m) => ({
  x: Math.max(0, Math.min(m.w, e.clientX - m.left)),
  y: Math.max(0, Math.min(m.h, e.clientY - m.top)),
});

stage.addEventListener("pointerdown", (e) => {
  if (state.locked || state.drawing || !state.model) return;
  const m = metrics();
  if (!m) return;

  e.preventDefault();
  const pt = pointAt(e, m);

  state.drawing = true;
  state.tip = pt;
  state.lastPt = pt;
  state.lastT = performance.now();
  state.segT0 = state.lastT;
  state.samples = [{ t: 0, len: Number(state.len.toFixed(4)) }];
  stage.classList.add("is-drawing");

  // 캡처하면 손이 무대 밖으로 나가도 그 끌기가 이어집니다 — 손을 떼지 않는 한
  // 판은 끝나지 않아야 합니다 (기획서 4장 6번).
  try {
    stage.setPointerCapture?.(e.pointerId);
  } catch { /* 캡처 없이도 끌 수 있습니다 */ }

  loop();
});

stage.addEventListener("pointermove", (e) => {
  if (!state.drawing || state.locked) return;
  // 버튼이 떨어진 뒤의 이동으로는 늘어나지 않아야 합니다 (⑳ 에서 배운 것)
  if (e.buttons === 0) {
    endStroke(false);
    return;
  }
  const m = metrics();
  if (!m) return;
  state.tip = pointAt(e, m);
});

stage.addEventListener("pointerup", () => endStroke(false));
stage.addEventListener("pointercancel", () => endStroke(false));

/**
 * 키보드·보조기기 — 방향키로 끌고 Enter/Space 로 손을 뗍니다.
 * 한 번 누를 때마다 무대의 2% 만큼 끌리므로 「천천히」가 기본값이 됩니다.
 */
stage.addEventListener("keydown", (e) => {
  if (state.locked || !state.model) return;
  const DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  if (e.key in DIR) {
    e.preventDefault();
    const m = metrics();
    if (!m) return;
    if (!state.drawing) {
      state.drawing = true;
      state.tip = { x: m.w / 2, y: m.h / 2 };
      state.lastPt = { ...state.tip };
      state.lastT = performance.now();
      state.segT0 = state.lastT;
      state.samples = [{ t: 0, len: Number(state.len.toFixed(4)) }];
      stage.classList.add("is-drawing");
      loop();
      return;
    }
    const step = m.short * 0.02;
    state.tip = {
      x: Math.max(0, Math.min(m.w, state.tip.x + DIR[e.key][0] * step)),
      y: Math.max(0, Math.min(m.h, state.tip.y + DIR[e.key][1] * step)),
    };
    return;
  }

  if (["Enter", " ", "Spacebar"].includes(e.key) && state.drawing) {
    e.preventDefault();
    endStroke(false);
  }
});

/**
 * 매 프레임: 손가락이 움직인 만큼 늘리고 손상을 쌓습니다.
 *
 * 길이의 출처는 **손가락이 지나간 거리**입니다(무대 짧은 변 = 1). 손목을 비틀어
 * 옆으로 끄는 것도 늘리는 것이라, 화면 끝에 닿아도 계속 늘릴 수 있습니다
 * (기획서의 상상한 장면 · 4장 4번).
 */
function loop() {
  if (!state.drawing) return;
  const m = metrics();
  const M = state.model;
  if (!m || !M) {
    state.raf = requestAnimationFrame(loop);
    return;
  }

  const t = performance.now();
  // 앱을 잠깐 벗어나면 rAF 가 멈춥니다. 돌아온 첫 프레임의 dt 가 몇 초짜리로 오면
  // 그 한 프레임에 손상이 몰려 **가만히 있었는데 툭 끊어집니다.** 손가락은 그동안
  // 움직이지 않았으므로 흐르지 않은 것으로 봅니다(한 프레임분만 인정).
  const dt = Math.min((t - state.lastT) / 1000, 0.1);
  state.lastT = t;

  if (dt > 0) {
    const moved = Math.hypot(state.tip.x - state.lastPt.x, state.tip.y - state.lastPt.y) / m.short;
    state.lastPt = { ...state.tip };

    const speed = moved / dt; // 실제 손가락 속도 (파일 상단 주석 — 서버는 하한을 씁니다)
    // 손가락이 아무리 빨라도 점성 물질은 그만큼 늘어나지 않습니다
    state.len += Math.min(moved, M.max_rate * dt);
    state.elapsed += dt * 1000;
    state.dmg += damageRate(state.len, speed) * dt;

    sample(t);
    revealPrizes();
    feedback();

    // 첫 GRACE_MS 동안은 끊어지지 않습니다 (기획서 0-I 초보자 보장)
    if (state.elapsed >= M.grace_ms && state.dmg >= M.capacity) {
      draw();
      endStroke(true);
      return;
    }
  }

  draw();
  $("#hudLen").textContent = state.len.toFixed(2);
  state.raf = requestAnimationFrame(loop);
}

/** 표본은 SAMPLE_MS 간격으로만 모읍니다 — 프레임마다 보내면 요청이 커집니다 */
function sample(t) {
  const M = state.model;
  const rel = t - state.segT0;
  const last = state.samples[state.samples.length - 1];
  if (last && rel - last.t < M.sample_ms) return;

  state.samples.push({ t: Math.round(rel), len: Number(state.len.toFixed(4)) });
  if (state.samples.length >= M.flush_at) sendSegment(false);
}

/** 늘리는 도중 덩어리 안에서 상품이 드러납니다 (기획서 10장) */
function revealPrizes() {
  const hit = state.prizes.filter((p) => p.at <= state.len).length;
  if (hit <= state.prizeHits) return;

  const found = state.prizes[hit - 1];
  state.prizeHits = hit;
  $("#hudPrize").textContent = String(hit);

  prizeHost.textContent = `${found.icon} ${found.name}`;
  prizeHost.classList.remove("is-show");
  void prizeHost.offsetWidth;
  prizeHost.classList.add("is-show");
}

/** 늘어난 길이에 비례해 진동이 세집니다 (기획서 0-3 · 원리 2 손맛) */
function feedback() {
  const tension = Math.min(1, state.dmg / state.model.capacity);
  if (tension < 0.25) return;
  const gap = 260 - tension * 190; // 팽팽할수록 촘촘하게
  const t = performance.now();
  if (t - state.buzzAt < gap) return;
  state.buzzAt = t;
  navigator.vibrate?.(Math.round(4 + tension * 12));
}

function stopDraw() {
  state.drawing = false;
  cancelAnimationFrame(state.raf);
  stage.classList.remove("is-drawing", "is-snap");
  navigator.vibrate?.(0);
}

/** 끊어졌거나 손을 뗐습니다 — 어느 쪽이든 그 길이가 그대로 기록입니다 (기획서 4장 6번) */
async function endStroke(broke) {
  if (!state.drawing) return;
  state.drawing = false;
  state.broke = broke;
  state.locked = true;
  cancelAnimationFrame(state.raf);
  stage.classList.remove("is-drawing");
  stage.classList.add("is-locked");
  navigator.vibrate?.(broke ? [18, 40, 8] : 0);

  if (broke) {
    stage.classList.add("is-snap");
    await new Promise((r) => setTimeout(r, 260));
  }

  // 날아가는 조각이 있으면 먼저 끝냅니다 — 순서가 뒤집히면 마지막 조각이
  // 「이미 소진된 런」에 도착해 판이 끝나지 않습니다 (㉘ 과 같은 처리)
  if (flight) await flight;
  await sendSegment(true);
}

/** 조각 전송. `final` 이 아니면 판을 끝내지 않고 누적만 합니다 */
async function sendSegment(final) {
  const samples = state.samples;
  if (!final && samples.length === 0) return;

  // 다음 조각은 마지막 표본에서 이어집니다 — 시각을 새 조각 기준으로 되돌립니다
  const tail = samples[samples.length - 1];
  state.samples = tail && !final ? [{ t: 0, len: tail.len }] : [];
  if (!final && tail) state.segT0 = performance.now();

  const send = run.answer({ samples, ongoing: !final });
  if (!final) {
    flight = send.finally(() => {
      flight = null;
    });
    await flight;
    return;
  }
  await send;
}

// ══════════════════════════════════════════════════════════════
// 판정 결과
// ══════════════════════════════════════════════════════════════

async function showVerdict(res) {
  const d = res.data ?? {};

  if (d.invalid) {
    toast(d.invalid, "error", 1400);
    state.locked = false;
    stage.classList.remove("is-locked", "is-snap");
    return;
  }

  lastData = d;
  // 서버가 인정한 길이로 맞춥니다 — 어긋났다면 여기서 줄어듭니다
  state.sentLen = d.len ?? state.sentLen;
  if (!state.drawing) {
    state.len = state.sentLen;
    $("#hudLen").textContent = state.len.toFixed(2);
  }
  state.prizeHits = d.prize_hits ?? state.prizeHits;
  $("#hudPrize").textContent = String(state.prizeHits);

  if ((d.prizes ?? []).length > 0) {
    const names = d.prizes.map((p) => `${p.icon} ${p.name}`).join(" · ");
    toast(`${names} 발견!`, "good", 1600);
  }
}

/** [pause] — 끊어졌거나 손을 뗐습니다. 잃은 것은 없습니다 */
function pauseText() {
  // 끊어지는 순간 손이 화면 한복판에 있습니다 (기획서 0-H)
  armScreen("pause", ARM_DELAY_MS);
  const d = lastData ?? {};
  $("#pauseHeadline").textContent = state.broke ? "툭." : "손을 뗐어요";
  return {
    figure: `${(d.len ?? 0).toFixed(2)} 화면`,
    sub: state.broke
      ? "여기까지의 길이는 그대로 기록됐어요"
      : "손을 먼저 떼도 그 길이가 그대로 확정됩니다",
  };
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function onOver(result) {
  stopDraw();
  lastResult = result;
  const d = lastData ?? {};
  armScreen("over", ARM_DELAY_MS);

  renderRunOver(result, {
    figure: (d.len ?? 0).toFixed(2),
    unit: " 화면",
    sub:
      result.prev_best != null && !result.is_best
        ? `조금만 덜 급하게 끌면 넘길 수 있어요`
        : "천천히 끌수록 길게 늘어납니다",
    tiles: [
      { label: "획득", value: comma(result.score ?? 0), accent: true },
      { label: "발견한 상품", value: `${d.prize_hits ?? 0}개` },
      { label: "재료", value: state.dough?.name ?? "—" },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "길이 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "늘린 길이 분포 · 왼쪽이 김",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
