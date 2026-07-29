/**
 * ⑱ 와르르 받기
 *
 * 서버가 낙하 일정(언제·어느 칸·무엇이 떨어지는가)을 한 번에 발급하고, 화면은 그 일정을
 * 재생만 합니다. 판정 결과는 끝에 한 번 제출하고 서버가 원본 일정과 대조해 다시 채점합니다.
 * 실시간 낙하 게임에서 물체마다 왕복하면 왕복 지연이 그대로 조작감을 망치기 때문입니다.
 *
 * 조작은 **포인터 추종** 하나뿐입니다. 누른 채 움직이면 따라오고, 그냥 탭해도 그 자리로
 * 옮겨 갑니다 — 드래그를 못 쓰는 환경에서도 탭만으로 플레이할 수 있습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, boostReward, statsReward, countdown, renderLives, unpackCount,
} from "../../shared/run.js";

const GAME = "DROPCATCH";
const AD_PER_DAY = 5;

/** 바구니가 물건을 받는 폭 — 무대 너비 대비 비율 */
const CATCH_HALF = 0.1;

/**
 * 바구니 선의 높이(무대 상단 기준 %).
 * base.css 의 .fallfield__line(bottom:14%) · .basket(bottom:8%) 과 맞춰야 합니다.
 * 100 으로 두면 물건이 바구니를 지나쳐 무대 바닥까지 내려간 뒤에 판정됩니다.
 */
const LINE_PCT = 87;

/**
 * 물건이 바구니 선을 지난 뒤 이만큼 늦게 판정되면 "화면이 멈춰 있었다" 로 봅니다.
 *
 * 낙하와 판정은 rAF 로 도는데, 앱을 잠깐 벗어나면 rAF 가 멈춥니다. 돌아온 순간
 * 밀려 있던 물건이 한꺼번에 판정되면서 신고 시각이 실제 착지 시각보다 한참 뒤가 되고,
 * 서버의 착지 시각 검증에 걸려 **판 전체가 이상치**가 됩니다 — 사용자는 앱을 잠깐
 * 벗어났을 뿐인데 기록이 순위에서 빠지는 상황입니다 (docs/arcade-10-games.md §9.2).
 * 그래서 그 구간의 물건은 놓친 것으로 처리하고 **시각을 아예 신고하지 않습니다**(null).
 */
const STALL_MS = 250;

/** rank_metric = -(점수 × 1000) + 콤보 페널티 — 복원은 unpackCount 가 합니다 */
const formatBest = (metric) => `${unpackCount(metric)}점`;

const ICON = { good: "🥤", bonus: "🎁", bomb: "💣" };
const POOL = ["🥤", "🍫", "🍞", "🧃", "🍪", "🥛"];

const state = {
  sessionId: null,
  items: [],
  answers: [],
  times: [],
  lanes: 5,
  lives: 3,
  maxLives: 3,
  score: 0,
  combo: 0,
  comboStep: 5,
  comboBonus: 2,
  bonusPoint: 3,
  limitMs: 45000,
  boosts: 0,
  maxBoosts: 2,
  next: 0, // 아직 무대에 올리지 않은 첫 물건의 index
  live: [], // 화면에서 떨어지고 있는 물건들
  basketX: 0.5,
  t0: 0,
  raf: 0,
  timer: null,
  playing: false,
};

let lastResult = null;

renderHeader($("#header"), { icon: "🛒", title: "와르르 받기", badge: "0" });

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#pauseEndBtn").addEventListener("click", submitRun);
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

bindPointer();
loadReady();

// ── 시작 화면 ────────────────────────────────────────────────

async function loadReady() {
  stopLoop();
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
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }

  attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
}

async function startRun() {
  $("#startBtn").disabled = true;

  try {
    const res = await runApi.start(GAME, { fresh: true });
    const r = res.round;

    Object.assign(state, {
      sessionId: res.session_id,
      items: r.items,
      answers: [],
      times: [],
      lanes: r.lanes,
      lives: r.lives,
      maxLives: r.lives,
      score: 0,
      combo: 0,
      comboStep: r.combo_step,
      comboBonus: r.combo_bonus,
      bonusPoint: r.bonus_point,
      limitMs: r.limit_ms,
      boosts: 0,
      maxBoosts: res.max_boosts,
      next: 0,
      live: [],
      basketX: 0.5,
      t0: performance.now(),
      playing: true,
    });

    clearRewards();
    showScreen("play");
    $("#items").replaceChildren();
    renderHud();
    moveBasket(0.5);
    startTimer(state.limitMs);
    startLoop();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 도전 기회를 모두 썼습니다. 광고를 보면 기회가 추가됩니다.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ── 조작 (포인터 추종 — 탭·드래그 모두 동작) ──────────────────

function bindPointer() {
  const field = $("#field");
  const track = (ev) => {
    if (!state.playing) return;
    const box = field.getBoundingClientRect();
    if (box.width <= 0) return;
    moveBasket((ev.clientX - box.left) / box.width);
    ev.preventDefault();
  };

  field.addEventListener("pointerdown", (ev) => {
    field.setPointerCapture?.(ev.pointerId);
    track(ev);
  });
  field.addEventListener("pointermove", (ev) => {
    // 버튼을 누르고 있을 때만 따라옵니다(마우스에서 의도치 않은 추종을 막습니다).
    if (ev.buttons === 0 && ev.pointerType === "mouse") return;
    track(ev);
  });
}

function moveBasket(x) {
  state.basketX = Math.min(1, Math.max(0, x));
  $("#basket").style.left = `${state.basketX * 100}%`;
}

// ── 낙하 루프 ────────────────────────────────────────────────

/**
 * 화면 갱신은 rAF 로 하되, **판의 종료는 rAF 에 맡기지 않습니다.**
 * 제한 시간 종료는 run.js 의 countdown(setTimeout 기반)이 담당합니다.
 * (docs/arcade-10-games.md §9.2)
 */
function startLoop() {
  cancelAnimationFrame(state.raf);

  const step = () => {
    if (!state.playing) return;
    const now = performance.now() - state.t0;

    spawnDue(now);
    advance(now);

    state.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);
}

function stopLoop() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  state.timer?.stop();
}

/** 일정상 등장할 때가 된 물건을 무대에 올립니다. */
function spawnDue(now) {
  while (state.next < state.items.length && state.items[state.next].t <= now) {
    const index = state.next++;
    const item = state.items[index];

    const node = document.createElement("div");
    node.className = `falling falling--${item.kind}`;
    node.textContent =
      item.kind === "good" ? POOL[index % POOL.length] : ICON[item.kind];
    node.style.left = `${((item.lane + 0.5) / state.lanes) * 100}%`;

    $("#items").append(node);
    state.live.push({ index, item, node, x: (item.lane + 0.5) / state.lanes });
  }
}

/** 떨어지는 물건들을 내리고, 바구니 선에 닿은 것을 판정합니다. */
function advance(now) {
  for (let i = state.live.length - 1; i >= 0; i--) {
    const f = state.live[i];
    const p = (now - f.item.t) / f.item.fall_ms; // 0 = 위, 1 = 바구니 선

    if (p < 1) {
      f.node.style.top = `${Math.max(0, p) * LINE_PCT}%`;
      continue;
    }

    // 바구니 선 도달 — 여기서 한 번만 판정합니다.
    state.live.splice(i, 1);

    // 화면이 멈춰 있던 사이에 지나간 물건은 받을 기회가 없었으므로 놓친 것으로 둡니다.
    const stalled = now - (f.item.t + f.item.fall_ms) > STALL_MS;
    const got = !stalled && Math.abs(state.basketX - f.x) <= CATCH_HALF;
    resolve(f, got, stalled ? null : now);
  }
}

/** 한 물건의 결과를 확정합니다. 점수는 화면 연출용이고 최종 점수는 서버가 다시 계산합니다. */
function resolve(f, got, at) {
  state.answers[f.index] = got ? 1 : 0;
  // at 이 null 이면 시각을 신고하지 않습니다 (위 STALL_MS 주석 참조).
  state.times[f.index] = at == null ? null : Math.round(at);

  f.node.classList.add(got ? "is-caught" : "is-missed");
  setTimeout(() => f.node.remove(), 240);

  const kind = f.item.kind;

  if (kind === "bomb") {
    if (!got) return; // 피한 것은 아무 일도 일어나지 않습니다
    state.lives -= 1;
    state.combo = 0;
    showCombo(null);
    toast("폭탄!", "error", 900);
    renderHud();
    if (state.lives <= 0) runOut("폭탄 3개를 받았어요");
    return;
  }

  if (!got) {
    state.combo = 0;
    showCombo(null);
    return;
  }

  state.score += kind === "bonus" ? state.bonusPoint : 1;
  state.combo += 1;
  if (state.combo % state.comboStep === 0) {
    state.score += state.comboBonus;
    toast(`${state.combo}연속! +${state.comboBonus}`, "good", 900);
  }
  showCombo(state.combo);
  renderHud();
}

function renderHud() {
  $("#hudScore").textContent = String(state.score);
  setHeaderBadge(String(state.score));
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });
}

function showCombo(n) {
  const tag = $("#comboTag");
  if (!n || n < 2) {
    tag.hidden = true;
    return;
  }
  tag.hidden = false;
  tag.textContent = `${n} COMBO`;
}

// ── 타이머 ───────────────────────────────────────────────────

function startTimer(ms) {
  state.timer?.stop();
  const fill = $("#timebar");

  state.timer = countdown({
    ms,
    onTick: (left) => {
      const time = $("#hudTime");
      time.textContent = (left / 1000).toFixed(1);
      time.classList.toggle("is-urgent", left < 5000);
      fill.style.transform = `scaleX(${Math.max(0, left / state.limitMs)})`;
    },
    onEnd: () => runOut("시간이 끝났어요"),
  });
}

/** 목숨이 떨어졌거나 시간이 끝났습니다 — 이어받을지 확정할지 고릅니다. */
function runOut(reason) {
  if (!state.playing) return;
  stopLoop();

  // 아직 떨어지고 있던 물건은 판정하지 않고 치웁니다(손대지 못한 물건).
  for (const f of state.live) f.node.remove();
  state.live = [];

  $("#pauseTitle").textContent = state.lives <= 0 ? "아쉬워요!" : "시간 종료!";
  $("#pauseSub").textContent = reason;
  $("#pauseFigure").textContent = `${state.score}점`;

  showScreen("pause");
  clearRewards();

  boostReward(GAME, {
    sessionId: state.sessionId,
    label: "목숨 +1",
    desc: "점수와 콤보는 그대로 이어집니다",
    used: state.boosts,
    max: state.maxBoosts,
    onBoosted: (reward) => {
      const d = reward.data;
      state.boosts = reward.boosts;
      // 서버가 주는 total_lives 는 이 런에 허용된 총량입니다. 화면은 남은 목숨을
      // 그리므로 늘어난 만큼만 더합니다(총량을 그대로 넣으면 하트가 4개가 됩니다).
      state.lives += d.lives_added;
      state.maxLives = d.total_lives;
      state.limitMs = d.limit_ms;
      // 연장분 일정을 뒤에 이어붙입니다. 서버가 준 index 자리에 그대로 놓아야
      // 제출한 answers 의 위치가 서버 일정과 어긋나지 않습니다.
      for (let i = 0; i < d.items.length; i++) state.items[d.from_index + i] = d.items[i];
      state.next = d.from_index;
      state.playing = true;

      clearRewards();
      showScreen("play");
      renderHud();
      startTimer(d.added_ms);
      startLoop();
    },
  });
}

async function submitRun() {
  stopLoop();

  try {
    const res = await runApi.submit(GAME, state.sessionId, {
      answers: state.answers,
      times: state.times,
      elapsed_ms: Math.round(performance.now() - state.t0),
    });
    onOver(res.result, res.detail);
  } catch (err) {
    toast(err.message ?? "기록을 저장할 수 없습니다.", "error");
  }
}

// ── 결과 ─────────────────────────────────────────────────────

function onOver(result, detail) {
  lastResult = result;

  renderRunOver(result, {
    figure: String(result.score),
    unit: "점",
    sub: `${detail?.caught ?? 0}개를 받았어요 · 최고 ${detail?.best_combo ?? 0}연속`,
    tiles: [
      { label: "받음", value: `${detail?.caught ?? 0}개` },
      { label: "놓침", value: `${detail?.missed ?? 0}개` },
      { label: "폭탄", value: `${detail?.bombs_hit ?? 0}개` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 점수 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "점수 분포 · 왼쪽이 높음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
