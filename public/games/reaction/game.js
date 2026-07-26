/**
 * ⑤ 반응속도 테스트
 *
 * 측정은 performance.now() 로 합니다 — 단조 증가 시계라 시스템 시각을 바꿔도 영향이 없고,
 * 네트워크 왕복이 기록에 섞이지 않습니다 (스탑워치와 같은 이유).
 *
 * 광고 보상은 결과 화면이 아니라 플레이 화면 끝에서 제안합니다.
 * 시행이 끝나면 세션이 닫히므로, 그 전에 "한 판 더" 를 물어봐야 이어붙일 수 있습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, boostReward, statsReward, msText,
} from "../../shared/run.js";

const GAME = "REACTION";
const AD_PER_DAY = 5;

/** rank_metric = 평균 반응 시간(ms) */
const formatBest = (metric) => (metric >= 99999 ? "—" : msText(metric));

const state = {
  sessionId: null,
  waits: [],
  results: [], // 시행별 반응 시간 (부정출발은 -1)
  spent: [], // 시행별 소요 시간 (대기 + 반응) — 서버 정합성 검증용
  index: 0,
  adopt: 5,
  boosts: 0,
  maxBoosts: 2,
  reactionMaxMs: 3000,
  phase: "idle", // idle | waiting | go | done
  t0: 0,
  trialStart: 0,
  timer: 0,
  runStart: 0,
};

renderHeader($("#header"), { icon: "⚡", title: "반응속도 테스트", badge: "5 TRIALS" });

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#confirmBtn").addEventListener("click", submitRun);
$("#flash").addEventListener("pointerdown", onTap);
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

// 스페이스바로도 반응할 수 있게 (마우스보다 키보드가 빠른 사용자가 있습니다)
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  if (state.phase === "waiting" || state.phase === "go") onTap();
});

loadReady();

// ── 시작 화면 ────────────────────────────────────────────────

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
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }

  attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
}

// ── 런 진행 ──────────────────────────────────────────────────

async function startRun() {
  $("#startBtn").disabled = true;

  try {
    const res = await runApi.start(GAME, { fresh: true });
    state.sessionId = res.session_id;
    state.waits = res.round.waits;
    state.adopt = res.round.adopt;
    state.reactionMaxMs = res.round.reaction_max_ms;
    state.maxBoosts = res.max_boosts;
    state.boosts = 0;
    state.results = [];
    state.spent = [];
    state.index = 0;
    state.runStart = performance.now();

    $("#wrapCard").classList.add("hidden");
    clearRewards();
    showScreen("play");
    renderTrials();
    armTrial();
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

/** 다음 시행 준비 — 무작위 대기 후 초록으로 바뀝니다. */
function armTrial() {
  const flash = $("#flash");
  state.phase = "waiting";
  state.trialStart = performance.now();

  flash.className = "flash is-waiting";
  flash.textContent = "초록으로 바뀔 때까지 기다리세요";
  setHeaderBadge(`${state.index + 1} / ${state.waits.length}`);
  $("#hudTrial").textContent = `${state.index + 1} / ${state.waits.length}`;

  state.timer = setTimeout(() => {
    state.phase = "go";
    state.t0 = performance.now();
    flash.className = "flash is-go";
    flash.textContent = "지금!";
  }, state.waits[state.index]);
}

function onTap() {
  if (state.phase === "waiting") {
    // 부정출발 — 이 시행은 기록에 넣지 않습니다.
    clearTimeout(state.timer);
    recordTrial(-1);
    const flash = $("#flash");
    flash.className = "flash is-early";
    flash.textContent = "너무 빨라요! 이번 판은 무효";
    setTimeout(nextTrial, 900);
    return;
  }

  if (state.phase !== "go") return;

  const ms = Math.round(performance.now() - state.t0);
  recordTrial(Math.min(ms, state.reactionMaxMs));

  const flash = $("#flash");
  flash.className = "flash";
  flash.textContent = `${ms}ms`;
  $("#hudLast").textContent = `${ms}ms`;
  setTimeout(nextTrial, 700);
}

function recordTrial(ms) {
  state.phase = "idle";
  state.results.push(ms);
  state.spent.push(Math.round(performance.now() - state.trialStart));
  renderTrials();
}

function nextTrial() {
  state.index += 1;
  if (state.index < state.waits.length) {
    armTrial();
    return;
  }
  wrapUp();
}

function renderTrials() {
  const host = clear($("#trialDots"));
  for (let i = 0; i < state.waits.length; i++) {
    const v = state.results[i];
    const cls = v == null ? "" : v < 0 ? "is-bad" : "is-done";
    host.append(
      el("span", { class: `trial-dot ${cls}` }, v == null ? `${i + 1}` : v < 0 ? "FS" : `${v}`),
    );
  }
}

/** 채택될 시행(좋은 N개)의 평균 */
function currentAverage() {
  const valid = state.results.filter((v) => v >= 0).sort((a, b) => a - b).slice(0, state.adopt);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/**
 * 모든 시행이 끝난 뒤 — 확정할지, 광고를 보고 한 판 더 할지 고릅니다.
 * 시행을 늘려도 채택은 좋은 5개뿐이라 "최악의 한 판을 지우는" 보상이 됩니다.
 */
function wrapUp() {
  state.phase = "done";
  const flash = $("#flash");
  flash.className = "flash";
  flash.textContent = "5번 모두 끝났습니다";

  const avg = currentAverage();
  $("#wrapAvg").textContent = avg == null ? "유효 기록 없음" : `${avg}ms`;
  $("#wrapCard").classList.remove("hidden");

  boostReward(GAME, {
    sessionId: state.sessionId,
    label: "시행 +1회",
    desc: `좋은 ${state.adopt}개만 채택하므로 가장 나쁜 기록을 버릴 수 있습니다`,
    used: state.boosts,
    max: state.maxBoosts,
    onBoosted: (reward) => {
      state.boosts = reward.boosts;
      state.waits.push(reward.data.wait_ms);
      $("#wrapCard").classList.add("hidden");
      clearRewards();
      state.index = state.waits.length - 1;
      renderTrials();
      armTrial();
    },
  });
}

async function submitRun() {
  $("#confirmBtn").disabled = true;

  try {
    const res = await runApi.submit(GAME, state.sessionId, {
      answers: state.results,
      times: state.spent,
      elapsed_ms: Math.round(performance.now() - state.runStart),
    });
    showOver(res.result, res.detail);
  } catch (err) {
    toast(err.message ?? "기록을 저장할 수 없습니다.", "error");
  } finally {
    $("#confirmBtn").disabled = false;
    $("#wrapCard").classList.add("hidden");
  }
}

// ── 결과 ─────────────────────────────────────────────────────

let lastResult = null;

function showOver(result, detail) {
  lastResult = result;
  const avg = detail?.avg_ms;

  renderRunOver(result, {
    figure: avg == null ? "—" : String(avg),
    unit: avg == null ? null : "ms",
    sub:
      avg == null
        ? "유효한 시행이 없었어요"
        : `${detail.adopted_count}회 채택 · 최고 ${detail.best_ms}ms`,
    tiles: [
      { label: "최고", value: detail?.best_ms != null ? `${detail.best_ms}ms` : "—" },
      { label: "부정출발", value: `${detail?.false_starts ?? 0}회` },
      { label: "시행", value: `${detail?.total_trials ?? 0}회` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 평균 반응속도 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "반응속도 분포 · 왼쪽이 빠름",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
