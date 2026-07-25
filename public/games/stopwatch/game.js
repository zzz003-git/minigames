/**
 * ① 스탑워치 챌린지
 *
 * 측정 방식: performance.now() — 단조 증가 시계라 시스템 시각을 바꿔도 영향이 없고,
 * 네트워크 지연이 기록에 섞이지 않습니다. START 를 누른 순간 서버에 arm 요청을
 * "응답을 기다리지 않고" 보내 두고, 서버는 그 도착 시각을 기준으로 제출값을 검증합니다.
 */

import { apiGet, apiPost, ApiFail } from "../../shared/api.js";
import { watchAdForReward, renderAdBar } from "../../shared/ad.js";
import {
  $, el, clear, showScreen, toast, renderDots, renderChart, renderHeader,
  ms2, ms3, gapText, comma,
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

renderHeader($("#header"), { title: "⏱ 스탑워치 챌린지" });

$("#startBtn").addEventListener("click", onStart);
$("#stopBtn").addEventListener("click", onStop);
$("#retryBtn").addEventListener("click", () => loadChallenge());
$("#viewStatsBtn").addEventListener("click", openStats);
$("#backToResultBtn").addEventListener("click", () => {
  showScreen("result");
  renderReadyAdBar("result");
});

// 스페이스바로도 START/STOP 가능하게 (반응속도 게임이라 키보드가 유리한 사용자도 있음)
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  const screen = $(".screen.is-active")?.dataset.screen;
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

    $("#targetDisplay").textContent = `${ms2(res.target_ms)} 초`;
    $("#startBtn").disabled = false;
    $("#runningTarget").textContent = `목표: ${ms2(res.target_ms)} 초`;
    $("#stopHint").textContent = `정확히 ${ms2(res.target_ms)}초에 탭하세요!`;
    renderAttempts();
    renderReadyAdBar("ready");
  } catch (err) {
    handleStartError(err);
  }
}

function handleStartError(err) {
  if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
    $("#targetDisplay").textContent = "기회 소진";
    $("#attemptText").textContent = "오늘 도전 기회를 모두 사용했습니다.";
    renderDots($("#attemptDots"), { total: 0, used: 0 });
    renderReadyAdBar("ready");
    return;
  }
  $("#targetDisplay").textContent = "오류";
  toast(err.message ?? "도전을 시작할 수 없습니다.", "error");
}

function renderAttempts() {
  const { total, used, remaining } = state.attempts;
  renderDots($("#attemptDots"), { total, used });
  $("#attemptText").textContent = `${remaining}회 남음 (오늘 ${used}/${total}회 사용)`;
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
  renderAdBarHidden();
  tick();
}

function tick() {
  const elapsed = performance.now() - state.t0;
  const sec = elapsed / 1000;
  $("#timerMain").textContent = sec.toFixed(2);
  $("#timerMs").textContent = `.${Math.floor(elapsed % 10)}`;
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
    renderReadyAdBar("ready");
  } finally {
    $("#stopBtn").disabled = false;
  }
}

// ── 결과 ─────────────────────────────────────────────────────

function renderResult(res) {
  $("#resultTarget").textContent = `${ms2(res.target_ms)}초 (랜덤)`;
  $("#resultGap").textContent = gapText(res.gap_ms);
  $("#resultRank").textContent = `TOP ${res.rank_pct}%`;

  const tiles = [
    { value: `${comma(res.bucket_total)}명`, label: "동일 타임 도전자" },
    { value: `${ms3(res.abs_gap_ms)}s`, label: "오차", accent: true },
    { value: `${res.attempts.used}회`, label: "오늘 도전" },
  ];

  clear($("#resultTiles"));
  for (const t of tiles) {
    $("#resultTiles").append(
      el("div", { class: `tile ${t.accent ? "tile--accent" : ""}` },
        el("div", { class: "tile__value" }, t.value),
        el("div", { class: "tile__label" }, t.label)),
    );
  }

  $("#resultNote").textContent = res.suspect
    ? "이 기록은 검증 이상치로 표시되어 전체 통계에는 반영되지 않습니다."
    : `실제 기록 ${ms3(res.elapsed_ms)}초 · 남은 기회 ${res.attempts.remaining}회`;

  showScreen("result");
  renderReadyAdBar("result");
}

// ── 전체 통계 (광고 시청 후 열람) ─────────────────────────────

async function openStats() {
  const bucket = state.lastResult?.bucket;

  try {
    const stats = await apiGet("/game/stats", { game: "STOPWATCH", bucket });
    renderStats(stats);
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      const rewarded = await watchAdForReward("STOPWATCH_STATS");
      if (!rewarded) return;
      try {
        renderStats(await apiGet("/game/stats", { game: "STOPWATCH", bucket }));
      } catch (e) {
        toast(e.message, "error");
      }
      return;
    }
    toast(err.message, "error");
  }
}

function renderStats(stats) {
  const bucket = stats.bucket ?? "-";
  const total = stats.distribution?.count ?? 0;
  $("#statsTitle").textContent = `이번 목표 타임: ${bucket}초 | 도전자 ${comma(total)}명`;

  renderChart($("#statsChart"), {
    bins: stats.distribution?.bins ?? [],
    mine: state.lastResult?.abs_gap_ms ?? null,
    caption: "← 오차 분포 (Deviation Distribution) →",
  });

  const my = state.lastResult;
  $("#statsMyRecord").textContent = my ? `오차 ${gapText(my.gap_ms)}` : "기록 없음";
  $("#statsMyPct").textContent = my ? `TOP ${my.rank_pct}%` : "—";

  clear($("#statsPopular"));
  const popular = stats.popular_buckets ?? [];
  if (popular.length === 0) {
    $("#statsPopular").append(el("div", { class: "hint" }, "아직 집계된 목표 타임이 없습니다."));
  }
  for (const b of popular) {
    $("#statsPopular").append(
      el("div", { class: "tile" },
        el("div", { class: "tile__value" }, `${b.bucket}초`),
        el("div", { class: "tile__label" }, `${comma(b.n)}명 도전`)),
    );
  }

  showScreen("stats");
  renderAdBarHidden();
}

// ── 하단 광고 바 ─────────────────────────────────────────────

function renderReadyAdBar(screen) {
  if (screen === "ready") {
    renderAdBar($("#adbar"), {
      label: "🎁 도전 기회 추가 | 광고 보기 →",
      onClick: async () => {
        const res = await watchAdForReward("STOPWATCH_ATTEMPT");
        if (!res) return;
        toast(`기회 ${res.reward.amount}회가 추가되었습니다.`, "good");
        loadChallenge();
      },
    });
    return;
  }

  renderAdBar($("#adbar"), {
    label: "📊 통계 확인 | 광고 보기 →",
    onClick: openStats,
  });
}

function renderAdBarHidden() {
  clear($("#adbar"));
}
