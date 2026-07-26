/**
 * ⑩ 색깔 말하기 (스트룹)
 *
 * 서버가 문항 묶음과 정답을 만들고, 제출된 답안을 처음부터 다시 채점합니다.
 * 클라이언트도 정오를 판단하지만("틀리면 즉시 종료"를 화면에 반영해야 하므로)
 * 점수는 서버가 다시 매긴 값만 씁니다.
 *
 * 광고 보상(오답 1회 면제)은 틀린 순간에 제안합니다.
 * 답안을 제출해 버리면 세션이 닫혀 연속을 이어붙일 수 없습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, boostReward, statsReward, countdown, unpackCount,
} from "../../shared/run.js";

const GAME = "STROOP";
const AD_PER_DAY = 5;

/** rank_metric = -(연속 × 1000) + 평균응답/10 — 복원은 unpackCount 가 합니다 */
const formatBest = (metric) => `${unpackCount(metric)}연속`;

const state = {
  sessionId: null,
  items: [],
  palette: [],
  answers: [],
  times: [],
  index: 0,
  streak: 0,
  boosts: 0,
  maxBoosts: 2,
  limitMs: 30000,
  remainMs: 30000,
  t0: 0,
  qt0: 0,
  timer: null,
  itemTimer: 0,
  locked: true,
};

let lastResult = null;

renderHeader($("#header"), { icon: "🌈", title: "색깔 말하기", badge: "0" });

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#pauseEndBtn").addEventListener("click", submitRun);
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ── 시작 화면 ────────────────────────────────────────────────

async function loadReady() {
  stopTimers();
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
    Object.assign(state, {
      sessionId: res.session_id,
      items: res.round.items,
      palette: res.round.palette,
      answers: [],
      times: [],
      index: 0,
      streak: 0,
      boosts: 0,
      maxBoosts: res.max_boosts,
      limitMs: res.round.limit_ms,
      t0: performance.now(),
    });

    clearRewards();
    showScreen("play");
    startTotalTimer();
    renderItem();
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

// ── 문항 ─────────────────────────────────────────────────────

const nameOf = (key) => state.palette.find((c) => c.key === key)?.name ?? key;
const hexOf = (key) => state.palette.find((c) => c.key === key)?.hex ?? "#fff";

/** 정답 = 글자에 칠해진 색. pub 에는 hex 만 오므로 팔레트에서 키를 되찾습니다. */
const answerOf = (item) => state.palette.find((c) => c.hex === item.ink_hex)?.key;

function renderItem() {
  const item = state.items[state.index];
  if (!item) {
    submitRun();
    return;
  }

  const word = $("#word");
  word.textContent = item.word;
  word.style.color = item.ink_hex;

  const host = clear($("#choices"));
  for (const key of item.choices) {
    host.append(
      el(
        "button",
        { class: "choice", type: "button", onclick: () => pick(key) },
        el("span", { class: "choice__swatch", style: `background:${hexOf(key)}`, "aria-hidden": "true" }),
        nameOf(key),
      ),
    );
  }

  $("#hudStreak").textContent = String(state.streak);
  setHeaderBadge(String(state.streak));

  state.locked = false;
  state.qt0 = performance.now();
  startItemTimer(item.limit_ms);
}

function pick(key) {
  if (state.locked) return;
  state.locked = true;
  clearTimeout(state.itemTimer);

  const item = state.items[state.index];
  state.answers[state.index] = key;
  state.times[state.index] = Math.round(performance.now() - state.qt0);

  if (key === answerOf(item)) {
    state.streak += 1;
    state.index += 1;
    renderItem();
    return;
  }

  onMiss("틀렸어요");
}

function startItemTimer(ms) {
  clearTimeout(state.itemTimer);

  const fill = $("#itembar");
  fill.style.transition = "none";
  fill.style.transform = "scaleX(1)";
  // 다음 프레임에 트랜지션을 걸어야 되감기가 눈에 보이지 않습니다.
  requestAnimationFrame(() => {
    fill.style.transition = `transform ${ms}ms linear`;
    fill.style.transform = "scaleX(0)";
  });

  state.itemTimer = setTimeout(() => {
    if (state.locked) return;
    state.locked = true;
    state.answers[state.index] = null;
    state.times[state.index] = ms;
    onMiss("시간 초과");
  }, ms);
}

// ── 오답 — 이어할지 확정할지 ─────────────────────────────────

function onMiss(reason) {
  // 이어하기를 고르면 남은 시간을 그대로 이어받아야 하므로 멈추기 전에 붙잡아 둡니다.
  state.remainMs = state.timer?.left() ?? state.limitMs;
  state.timer?.stop();

  $("#pauseTitle").textContent = reason;
  $("#pauseSub").textContent = `${state.streak}연속에서 끊겼어요`;
  $("#pauseFigure").textContent = `${state.streak}연속`;

  showScreen("pause");
  clearRewards();

  boostReward(GAME, {
    sessionId: state.sessionId,
    label: "오답 1회 면제",
    desc: "지금 연속을 유지한 채 다음 문제로 넘어갑니다",
    used: state.boosts,
    max: state.maxBoosts,
    onBoosted: (reward) => {
      state.boosts = reward.boosts;
      state.index += 1;
      clearRewards();
      showScreen("play");
      startTotalTimer(state.remainMs);
      renderItem();
    },
  });
}

// ── 타이머 ───────────────────────────────────────────────────

function startTotalTimer(ms) {
  state.timer?.stop();
  const total = ms ?? state.limitMs;
  const fill = $("#timebar");

  state.timer = countdown({
    ms: total,
    onTick: (left) => {
      const time = $("#hudTime");
      time.textContent = (left / 1000).toFixed(1);
      time.classList.toggle("is-urgent", left < 5000);
      fill.style.transform = `scaleX(${Math.max(0, left / state.limitMs)})`;
    },
    onEnd: () => {
      state.locked = true;
      clearTimeout(state.itemTimer);
      submitRun();
    },
  });
}

function stopTimers() {
  state.timer?.stop();
  clearTimeout(state.itemTimer);
}

// ── 제출 ─────────────────────────────────────────────────────

async function submitRun() {
  stopTimers();
  state.locked = true;

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
    unit: "연속",
    sub: `${result.score}문제를 연속으로 맞혔어요`,
    tiles: [
      { label: "연속", value: `${result.score}개` },
      { label: "평균", value: detail?.avg_ms != null ? `${detail.avg_ms}ms` : "—" },
      { label: "면제", value: `${detail?.forgiven ?? 0}회` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 연속 기록 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "연속 정답 분포 · 왼쪽이 긴 연속",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
