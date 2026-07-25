/**
 * ② 숫자야구
 *
 * 정답은 서버 세션에만 있고 클라이언트로 내려오지 않습니다.
 * 따라서 S/B 판정도 매 턴 서버(POST /game/guess)에 물어봅니다.
 * 이 구조라서 개발자도구로 정답을 볼 수 있는 경로가 없습니다.
 */

import { apiGet, apiPost, ApiFail } from "../../shared/api.js";
import { watchAdForReward, renderAdBar } from "../../shared/ad.js";
import {
  $, el, clear, showScreen, toast, renderDots, renderSlots, renderChart, renderHeader,
  mountNumpad, bindKeyboardNumpad, mmss, comma, currentScreen,
} from "../../shared/ui.js";

const DIGITS = 3;

const state = {
  sessionId: null,
  attemptsLeft: 0,
  adViews: 0,
  maxAdViews: 3,
  history: [],
  input: "",
  lastResult: null,
};

let numpad = null;

// ── 초기화 ───────────────────────────────────────────────────

renderHeader($("#header"), { title: "⚾ 숫자야구", badge: "3-DIGIT" });

$("#inputBtn").addEventListener("click", openInput);
$("#cancelInputBtn").addEventListener("click", () => {
  state.input = "";
  showScreen("main");
  renderAdBarFor("main");
});
$("#successNewBtn").addEventListener("click", () => newGame());
$("#failNewBtn").addEventListener("click", () => newGame());
$("#exhaustedRefillBtn").addEventListener("click", refillByAd);
$("#giveUpBtn").addEventListener("click", giveUp);
$("#successStatsBtn").addEventListener("click", openStats);
$("#failStatsBtn").addEventListener("click", openStats);
$("#statsBackBtn").addEventListener("click", () => {
  const back = state.lastResult?.game_over ? (state.lastResult.solved ? "success" : "fail") : "main";
  showScreen(back);
  renderAdBarFor(back);
});

numpad = mountNumpad($("#numpad"), {
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitGuess,
  okLabel: "OK",
});

bindKeyboardNumpad({
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitGuess,
  isActive: () => currentScreen() === "input",
});

loadGame();

// ── 게임 로드 / 새 게임 ───────────────────────────────────────

async function loadGame({ fresh = false } = {}) {
  try {
    const res = await apiPost("/game/session/start", { game_type: "BASEBALL", fresh });
    state.sessionId = res.session_id;
    state.attemptsLeft = res.attempts_left;
    state.adViews = res.ad_views ?? 0;
    state.maxAdViews = res.max_ad_views ?? 3;
    state.history = res.history ?? [];
    state.input = "";
    state.lastResult = null;

    renderMain();
    if (res.exhausted) {
      renderExhausted();
    } else {
      showScreen("main");
      renderAdBarFor("main");
    }
  } catch (err) {
    toast(err.message ?? "게임을 시작할 수 없습니다.", "error");
  }
}

const newGame = () => loadGame({ fresh: true });

function renderMain() {
  renderSlots($("#blindSlots"), { length: DIGITS, value: "" });
  // 정답 자리는 물음표로 표시합니다 (기획서 화면①)
  for (const slot of $("#blindSlots").children) slot.textContent = "?";

  renderHistoryInto($("#history"));
  $("#historyEmpty").classList.toggle("hidden", state.history.length > 0);

  const total = 6 + state.adViews * 3;
  renderDots($("#attemptDots"), { total, used: total - state.attemptsLeft });
  $("#adCount").textContent = `${state.attemptsLeft}회 · 광고 ${state.adViews}/${state.maxAdViews}`;
  $("#inputBtn").disabled = state.attemptsLeft <= 0;
}

function renderHistoryInto(host) {
  clear(host);
  for (const h of state.history) {
    host.append(
      el("div", { class: "history__row" },
        el("div", { class: "history__cell" }, [...h.guess].join(" ")),
        el("div", { class: `history__badge ${h.strikes > 0 ? "history__badge--s" : "history__badge--o"}` }, `${h.strikes}S`),
        el("div", { class: `history__badge ${h.balls > 0 ? "history__badge--b" : "history__badge--o"}` }, `${h.balls}B`)),
    );
  }
}

// ── 숫자 입력 ────────────────────────────────────────────────

function openInput() {
  if (state.attemptsLeft <= 0) {
    toast("남은 기회가 없습니다. 광고를 시청하면 충전됩니다.", "error");
    return;
  }
  state.input = "";
  renderInput();
  showScreen("input");
  renderAdBarFor("input");
}

function renderInput() {
  renderSlots($("#inputSlots"), { length: DIGITS, value: state.input });
  $("#inputLabel").textContent = `${DIGITS}자리 숫자를 입력하세요 (${state.history.length + 1}번째)`;
  numpad.setOkEnabled(state.input.length === DIGITS);
}

function pushDigit(d) {
  if (currentScreen() !== "input") return;
  if (state.input.length >= DIGITS) return;
  if (state.input.includes(d)) {
    toast("같은 숫자를 중복해서 쓸 수 없습니다.", "error", 1500);
    return;
  }
  state.input += d;
  renderInput();
}

function popDigit() {
  if (currentScreen() !== "input") return;
  state.input = state.input.slice(0, -1);
  renderInput();
}

async function submitGuess() {
  if (state.input.length !== DIGITS) return;
  const guess = state.input;
  numpad.setOkEnabled(false);

  try {
    const res = await apiPost("/game/guess", { session_id: state.sessionId, guess });
    state.history = res.history ?? state.history;
    state.attemptsLeft = res.attempts_left;
    state.input = "";

    if (!res.game_over) {
      renderMain();
      toast(res.out ? `${guess} → OUT` : `${guess} → ${res.strikes}S ${res.balls}B`);

      // 기회를 다 썼지만 광고로 충전할 수 있는 상태 — 정답은 아직 공개하지 않습니다.
      if (res.exhausted) {
        renderExhausted();
        return;
      }
      showScreen("main");
      renderAdBarFor("main");
      return;
    }

    state.lastResult = res;
    renderMain();
    res.solved ? renderSuccess(res) : renderFail(res);
  } catch (err) {
    toast(err.message ?? "판정을 받을 수 없습니다.", "error");
    renderInput();
  }
}

// ── 결과 화면 ────────────────────────────────────────────────

function tilesInto(host, items) {
  clear(host);
  for (const t of items) {
    host.append(
      el("div", { class: `tile ${t.accent ? "tile--accent" : ""}` },
        el("div", { class: "tile__value" }, t.value),
        el("div", { class: "tile__label" }, t.label)),
    );
  }
}

function renderSuccess(res) {
  $("#successAnswer").textContent = [...res.answer].join(" · ");
  tilesInto($("#successTiles"), [
    { value: `${res.attempt_no}회`, label: "시도" },
    { value: mmss(res.elapsed_ms), label: "소요" },
    { value: res.rank_pct ? `TOP ${res.rank_pct}%` : "—", label: "순위", accent: true },
  ]);
  showScreen("success");
  renderAdBarFor("success");
}

/** 기회 소진 — 정답을 감춘 채 「광고 충전」 / 「포기하고 정답 보기」 중 선택 */
function renderExhausted() {
  renderHistoryInto($("#exhaustedHistory"));
  const canRefill = state.adViews < state.maxAdViews;
  $("#exhaustedRefillBtn").disabled = !canRefill;
  $("#exhaustedNote").textContent = canRefill
    ? `이 게임에서 광고는 ${state.maxAdViews}회까지 사용할 수 있습니다. (현재 ${state.adViews}회)`
    : "광고 한도를 모두 사용했습니다. 정답을 확인하고 새 게임을 시작해 주세요.";

  showScreen("exhausted");
  renderAdBarFor("exhausted");
}

async function giveUp() {
  try {
    const res = await apiPost("/game/giveup", { session_id: state.sessionId });
    state.lastResult = res;
    state.history = res.history ?? state.history;
    renderFail(res);
  } catch (err) {
    toast(err.message ?? "정답을 확인할 수 없습니다.", "error");
  }
}

function renderFail(res) {
  $("#failAnswer").textContent = [...res.answer].join(" • ");
  tilesInto($("#failTiles"), [
    { value: `${res.attempt_no}회`, label: "총 시도" },
    { value: "공개", label: "정답" },
    { value: `${res.ad_views ?? state.adViews}/${state.maxAdViews}`, label: "광고 사용" },
  ]);
  $("#failNote").textContent = "새 게임을 시작하면 새로운 정답이 생성됩니다.";

  showScreen("fail");
  renderAdBarFor("fail");
}

// ── 광고: 기회 충전 ──────────────────────────────────────────

async function refillByAd() {
  const res = await watchAdForReward("BASEBALL_ATTEMPT", { sessionId: state.sessionId });
  if (!res) return;

  state.attemptsLeft = res.reward.attempts_left;
  state.adViews = res.reward.ad_views;
  state.lastResult = null;

  renderMain();
  showScreen("main");
  renderAdBarFor("main");
  toast(`기회 ${res.reward.amount}회가 충전되었습니다.`, "good");
}

// ── 전체 통계 ────────────────────────────────────────────────

async function openStats() {
  try {
    renderStats(await apiGet("/game/stats", { game: "BASEBALL" }));
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      if (!(await watchAdForReward("BASEBALL_STATS"))) return;
      try {
        renderStats(await apiGet("/game/stats", { game: "BASEBALL" }));
      } catch (e) {
        toast(e.message, "error");
      }
      return;
    }
    toast(err.message, "error");
  }
}

function renderStats(stats) {
  tilesInto($("#statsTiles"), [
    { value: comma(stats.total_games), label: "총 게임" },
    { value: `${stats.success_rate}%`, label: "성공률", accent: true },
    { value: stats.avg_attempts != null ? `${stats.avg_attempts}회` : "—", label: "평균 시도" },
  ]);

  const bins = (stats.attempt_distribution ?? []).map((r) => ({
    from: r.attempts,
    to: r.attempts,
    count: r.n,
  }));
  renderChart($("#statsChart"), {
    bins,
    mine: state.lastResult?.solved ? state.lastResult.attempt_no : null,
    caption: "← 적은 시도 · 많은 시도 →",
  });

  clear($("#statsPosition"));
  const dist = stats.position_distribution ?? [];
  dist.forEach((counts, pos) => {
    const max = Math.max(...counts, 1);
    const row = el("div", { style: "margin-bottom:10px" });
    row.append(el("div", { class: "label", style: "margin-bottom:4px" }, `${pos + 1}번째 자리`));
    const bar = el("div", { class: "chart", style: "height:64px" });
    counts.forEach((c, digit) => {
      bar.append(
        el("div", {
          class: "chart__bar",
          style: `height:${Math.max(3, (c / max) * 100)}%`,
          title: `숫자 ${digit}: ${c}회`,
        }),
      );
    });
    row.append(bar);
    row.append(el("div", { class: "chart__caption" }, "0 1 2 3 4 5 6 7 8 9"));
    $("#statsPosition").append(row);
  });

  showScreen("stats");
  clear($("#adbar"));
}

// ── 하단 광고 바 ─────────────────────────────────────────────

function renderAdBarFor(screen) {
  if (screen === "input") {
    clear($("#adbar"));
    return;
  }

  if (screen === "success" || screen === "fail") {
    renderAdBar($("#adbar"), { label: "📊 통계 열람 | 광고 보기 →", onClick: openStats });
    return;
  }

  // main / exhausted — 기회 충전 유도
  const canRefill = state.adViews < state.maxAdViews;
  const bar = renderAdBar($("#adbar"), {
    label: canRefill ? "⚡ 기회 충전 | 광고 보기 →" : "광고 한도 도달 — 새 게임을 시작해 주세요",
    onClick: canRefill ? refillByAd : () => {},
  });
  bar.disabled = !canRefill;
}
