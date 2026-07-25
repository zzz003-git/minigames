/**
 * ① 스탑워치 챌린지
 *
 * 측정 방식: performance.now() — 단조 증가 시계라 시스템 시각을 바꿔도 영향이 없고,
 * 네트워크 지연이 기록에 섞이지 않습니다. START 를 누른 순간 서버에 arm 요청을
 * "응답을 기다리지 않고" 보내 두고, 서버는 그 도착 시각을 기준으로 제출값을 검증합니다.
 */

import { apiGet, apiPost, ApiFail } from "../../shared/api.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../../shared/ad.js";
import {
  $, el, clear, showScreen, toast, renderPips, renderChart, renderStats, renderHeader,
  celebrate, ms2, ms3, gapText, comma, currentScreen,
} from "../../shared/ui.js";

const state = {
  sessionId: null,
  targetMs: null,
  attempts: { total: 0, used: 0, remaining: 0 },
  t0: 0,
  raf: 0,
  lastResult: null,
};

// ── 초기화 ───────────────────────────────────────────────────

renderHeader($("#header"), { icon: "⏱", title: "스탑워치 챌린지" });

$("#startBtn").addEventListener("click", onStart);
$("#stopBtn").addEventListener("click", onStop);
$("#retryBtn").addEventListener("click", () => loadChallenge());
$("#viewStatsBtn").addEventListener("click", openStats);
$("#backToResultBtn").addEventListener("click", () => {
  showScreen("result");
  renderRewards("result");
});

// 스페이스바로도 START/STOP 가능하게 (반응속도 게임이라 키보드가 유리한 사용자도 있음)
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  const screen = currentScreen();
  if (screen === "ready" && !$("#startBtn").disabled) onStart();
  else if (screen === "running") onStop();
});

loadChallenge();

// ── 도전 준비 ────────────────────────────────────────────────

async function loadChallenge() {
  showScreen("ready");
  $("#startBtn").disabled = true;
  $("#targetDisplay").textContent = "···";

  try {
    const res = await apiPost("/game/session/start", { game_type: "STOPWATCH" });
    state.sessionId = res.session_id;
    state.targetMs = res.target_ms;
    state.attempts = res.attempts;

    setFigure($("#targetDisplay"), ms2(res.target_ms), "초");
    $("#startBtn").disabled = false;
    $("#runningTarget").textContent = `목표 ${ms2(res.target_ms)}초`;
    renderAttempts();
    renderRewards("ready");
  } catch (err) {
    handleStartError(err);
  }
}

function handleStartError(err) {
  if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
    $("#targetDisplay").textContent = "—";
    setFigure($("#attemptText"), "0", "회");
    renderPips($("#attemptDots"), { total: 0, used: 0 });
    renderRewards("ready");
    return;
  }
  $("#targetDisplay").textContent = "—";
  toast(err.message ?? "도전을 시작할 수 없습니다.", "error");
}

/** 큰 숫자 + 작은 단위 표기 */
function setFigure(host, value, unit) {
  clear(host);
  host.append(document.createTextNode(value));
  if (unit) host.append(el("span", { class: "figure__unit" }, unit));
}

function renderAttempts() {
  const { total, used, remaining } = state.attempts;
  renderPips($("#attemptDots"), { total, used, base: 5 });
  clear($("#attemptText"));
  $("#attemptText").append(
    document.createTextNode(String(remaining)),
    el("span", { class: "figure__sub" }, ` / ${total}회`),
  );
}

// ── 게임 진행 ────────────────────────────────────────────────

function onStart() {
  if (!state.sessionId) return;

  // 1) 먼저 시계를 잡습니다. 네트워크 작업이 측정에 끼어들지 않도록.
  state.t0 = performance.now();

  // 2) 서버에 "지금 시작했다" 를 알립니다. 응답은 기다리지 않습니다.
  apiPost("/game/session/arm", { game_type: "STOPWATCH", session_id: state.sessionId }).catch(() => {
    // arm 이 실패해도 게임은 진행됩니다. 서버는 세션 생성 시각 기준으로 느슨하게 검증합니다.
  });

  showScreen("running");
  tick();
}

function tick() {
  const elapsed = performance.now() - state.t0;
  $("#timerMain").textContent = (elapsed / 1000).toFixed(2);
  state.raf = requestAnimationFrame(tick);
}

async function onStop() {
  if (!state.raf) return;
  const elapsedMs = Math.round(performance.now() - state.t0);
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  $("#stopBtn").disabled = true;

  try {
    const res = await apiPost("/game/session/stop", {
      session_id: state.sessionId,
      elapsed_ms: elapsedMs,
    });
    state.lastResult = res;
    state.attempts = res.attempts;
    renderResult(res);
  } catch (err) {
    toast(err.message ?? "기록을 저장할 수 없습니다.", "error");
    showScreen("ready");
    renderRewards("ready");
  } finally {
    $("#stopBtn").disabled = false;
  }
}

// ── 결과 ─────────────────────────────────────────────────────

/** 오차 크기에 따른 평가 문구 */
function verdictOf(absGapMs) {
  if (absGapMs <= 30) return { badge: "🎯", headline: "완벽해요!", great: true };
  if (absGapMs <= 100) return { badge: "🎉", headline: "훌륭해요!", great: true };
  if (absGapMs <= 300) return { badge: "👍", headline: "좋아요!", great: false };
  if (absGapMs <= 800) return { badge: "🙂", headline: "아쉬워요", great: false };
  return { badge: "🌙", headline: "다시 도전해볼까요?", great: false };
}

function renderResult(res) {
  const v = verdictOf(res.abs_gap_ms);

  const badge = $("#resultBadge");
  badge.textContent = v.badge;
  badge.className = v.great ? "badge-round" : "badge-round badge-round--quiet";

  $("#resultHeadline").textContent = v.headline;
  $("#resultSub").textContent = `목표 ${ms2(res.target_ms)}초 · 오차 ${ms3(res.abs_gap_ms)}초`;
  setFigure($("#resultElapsed"), ms3(res.elapsed_ms), null);

  clear($("#resultChips")).append(
    el("span", { class: "chip" }, `동일 타임 ${comma(res.bucket_total)}명`),
    el("span", { class: "chip chip--accent" }, `TOP ${res.rank_pct}%`),
  );

  $("#resultNote").textContent = res.suspect
    ? "검증 이상치로 표시되어 전체 통계에는 반영되지 않습니다"
    : `오차 ${gapText(res.gap_ms)} · 남은 기회 ${res.attempts.remaining}회`;

  showScreen("result");
  renderRewards("result");

  if (v.great) celebrate($("#resultCard"));
}

// ── 전체 통계 (광고 시청 후 열람) ─────────────────────────────

async function openStats() {
  const bucket = state.lastResult?.bucket;

  try {
    renderStatsScreen(await apiGet("/game/stats", { game: "STOPWATCH", bucket }));
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      const rewarded = await watchAdForReward("STOPWATCH_STATS");
      if (!rewarded) return;
      try {
        renderStatsScreen(await apiGet("/game/stats", { game: "STOPWATCH", bucket }));
      } catch (e) {
        toast(e.message, "error");
      }
      return;
    }
    toast(err.message, "error");
  }
}

function renderStatsScreen(stats) {
  const bucket = stats.bucket ?? "-";
  const total = stats.distribution?.count ?? 0;
  $("#statsTitle").textContent = `목표 ${bucket}초 · 도전자 ${comma(total)}명`;

  renderChart($("#statsChart"), {
    bins: stats.distribution?.bins ?? [],
    mine: state.lastResult?.abs_gap_ms ?? null,
    caption: "오차 분포 · 왼쪽이 정확",
  });

  const my = state.lastResult;
  $("#statsMyRecord").textContent = my ? `오차 ${gapText(my.gap_ms)}` : "기록 없음";
  $("#statsMyPct").textContent = my ? `TOP ${my.rank_pct}%` : "—";

  const host = clear($("#statsPopular"));
  const popular = stats.popular_buckets ?? [];

  if (popular.length === 0) {
    host.className = "mt-sm";
    host.append(el("div", { class: "footnote--dim center" }, "아직 집계된 목표 타임이 없습니다"));
  } else {
    renderStats(host, popular.map((b) => ({ label: `${comma(b.n)}명`, value: `${b.bucket}초` })));
  }

  showScreen("stats");
  clearRewardCard($("#adbar2"));
}

// ── 보상 카드 ────────────────────────────────────────────────

function renderRewards(screen) {
  clearRewardCard($("#adbar"));
  clearRewardCard($("#adbar2"));

  if (screen === "ready") {
    renderRewardCard($("#adbar"), {
      icon: "🎁",
      title: "광고 보고 도전 기회 추가",
      desc: "하루 3회까지",
      cta: "받기",
      onClick: async () => {
        const res = await watchAdForReward("STOPWATCH_ATTEMPT");
        if (!res) return;
        toast(`기회 ${res.reward.amount}회가 추가되었습니다.`, "good");
        loadChallenge();
      },
    });
    return;
  }

  if (screen === "result") {
    renderRewardCard($("#adbar2"), {
      icon: "📊",
      title: "광고 보고 전체 통계 열람",
      desc: "같은 목표 타임 도전자들의 오차 분포",
      cta: "보기",
      onClick: openStats,
    });
  }
}
