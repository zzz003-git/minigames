/**
 * ② 숫자야구
 *
 * 정답은 서버 세션에만 있고 클라이언트로 내려오지 않습니다.
 * 따라서 S/B 판정도 매 턴 서버(POST /game/guess)에 물어봅니다.
 * 이 구조라서 개발자도구로 정답을 볼 수 있는 경로가 없습니다.
 */

import { apiGet, apiPost, ApiFail } from "../../shared/api.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../../shared/ad.js";
import {
  $, el, clear, showScreen, toast, renderPips, renderSlots, renderChart, renderStats,
  renderHeader, setHeaderBadge, mountNumpad, bindKeyboardNumpad, celebrate,
  mmss, comma, currentScreen,
} from "../../shared/ui.js";

const DIGITS = 3;
const REWARD_HOSTS = ["#adbar", "#adbar2", "#adbar3", "#adbar4"];

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

renderHeader($("#header"), { icon: "⚾", title: "숫자야구", badge: "3-DIGIT" });

$("#inputBtn").addEventListener("click", openInput);
$("#cancelInputBtn").addEventListener("click", () => {
  state.input = "";
  showScreen("main");
  renderRewards("main");
});
$("#successNewBtn").addEventListener("click", () => newGame());
$("#failNewBtn").addEventListener("click", () => newGame());
$("#giveUpBtn").addEventListener("click", giveUp);
$("#successStatsBtn").addEventListener("click", openStats);
$("#failStatsBtn").addEventListener("click", openStats);
$("#statsBackBtn").addEventListener("click", () => {
  const back = state.lastResult?.game_over ? (state.lastResult.solved ? "success" : "fail") : "main";
  showScreen(back);
  renderRewards(back);
});

numpad = mountNumpad($("#numpad"), {
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitGuess,
  okLabel: "확인",
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
      renderRewards("main");
    }
  } catch (err) {
    toast(err.message ?? "게임을 시작할 수 없습니다.", "error");
  }
}

const newGame = () => loadGame({ fresh: true });

function renderMain() {
  renderSlots($("#blindSlots"), { length: DIGITS, blind: true });

  renderHistoryInto($("#history"));
  $("#historyEmpty").classList.toggle("hidden", state.history.length > 0);

  const total = 6 + state.adViews * 3;
  const label = `${state.history.length} / ${total}`;
  $("#historyCount").textContent = state.history.length > 0 ? label : "";
  $("#inputHistoryCount").textContent = label;

  renderPips($("#attemptDots"), { total, used: total - state.attemptsLeft, base: 6 });

  clear($("#adCount")).append(
    document.createTextNode(String(state.attemptsLeft)),
    el("span", { class: "figure__sub" }, `회 남음 · 광고 ${state.adViews}/${state.maxAdViews}`),
  );
  setHeaderBadge(`${state.attemptsLeft}회`);

  $("#inputBtn").disabled = state.attemptsLeft <= 0;
}

function renderHistoryInto(host) {
  clear(host);
  for (const h of state.history) {
    const out = h.strikes === 0 && h.balls === 0;
    host.append(
      el(
        "div",
        { class: "history__row" },
        el("span", { class: "history__guess" }, [...h.guess].join(" ")),
        el(
          "span",
          { class: "history__verdict" },
          out
            ? el("span", { class: "tag" }, "OUT")
            : [
                h.strikes > 0 ? el("span", { class: "tag tag--strike" }, `${h.strikes} S`) : null,
                h.balls > 0 ? el("span", { class: "tag tag--ball" }, `${h.balls} B`) : null,
              ],
        ),
      ),
    );
  }
}

// ── 숫자 입력 ────────────────────────────────────────────────

function openInput() {
  if (state.attemptsLeft <= 0) {
    toast("남은 기회가 없습니다. 광고를 보면 충전됩니다.", "error");
    return;
  }
  state.input = "";
  renderHistoryInto($("#inputHistory"));
  renderInput();
  showScreen("input");
  renderRewards("input");
}

function renderInput() {
  renderSlots($("#inputSlots"), { length: DIGITS, value: state.input, variant: "input" });
  $("#inputLabel").textContent = `숫자 입력 (${state.history.length + 1}번째)`;
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
      renderRewards("main");
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

function renderSuccess(res) {
  $("#successSub").textContent = `정답은 ${[...res.answer].join(" ")} 였어요`;

  renderSlots($("#successSlots"), {
    length: DIGITS,
    value: res.answer,
    variant: "compact",
    marks: [true, true, true],
    expected: res.answer,
  });

  renderStats(
    $("#successTiles"),
    [
      { label: "시도", value: `${res.attempt_no}회` },
      { label: "소요", value: mmss(res.elapsed_ms) },
      { label: "순위", value: res.rank_pct ? `TOP ${res.rank_pct}%` : "—", accent: true },
    ],
    { inset: true },
  );

  showScreen("success");
  renderRewards("success");
  celebrate($("#successCard"));
}

/** 기회 소진 — 정답을 감춘 채 「광고 충전」 / 「포기하고 정답 보기」 중 선택 */
function renderExhausted() {
  renderHistoryInto($("#exhaustedHistory"));
  const canRefill = state.adViews < state.maxAdViews;
  $("#exhaustedNote").textContent = canRefill
    ? `광고는 이 게임에서 ${state.maxAdViews}회까지 사용할 수 있습니다 (현재 ${state.adViews}회)`
    : "광고 한도를 모두 사용했습니다. 정답을 확인하고 새 게임을 시작해 주세요.";

  showScreen("exhausted");
  renderRewards("exhausted");
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
  $("#failSub").textContent = `정답은 ${[...res.answer].join(" ")} 이었어요`;

  renderSlots($("#failSlots"), { length: DIGITS, value: res.answer, variant: "compact" });

  renderStats(
    $("#failTiles"),
    [
      { label: "이번 기록", value: `${res.attempt_no}회 사용` },
      { label: "광고 사용", value: `${res.ad_views ?? state.adViews}/${state.maxAdViews}회` },
    ],
    { inset: true },
  );

  showScreen("fail");
  renderRewards("fail");
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
  renderRewards("main");
  toast(`기회 ${res.reward.amount}회가 충전되었습니다.`, "good");
}

// ── 전체 통계 ────────────────────────────────────────────────

async function openStats() {
  try {
    renderStatsScreen(await apiGet("/game/stats", { game: "BASEBALL" }));
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      if (!(await watchAdForReward("BASEBALL_STATS"))) return;
      try {
        renderStatsScreen(await apiGet("/game/stats", { game: "BASEBALL" }));
      } catch (e) {
        toast(e.message, "error");
      }
      return;
    }
    toast(err.message, "error");
  }
}

function renderStatsScreen(stats) {
  renderStats($("#statsTiles"), [
    { label: "총 게임", value: comma(stats.total_games) },
    { label: "성공률", value: `${stats.success_rate}%`, accent: true },
    { label: "평균 시도", value: stats.avg_attempts != null ? `${stats.avg_attempts}회` : "—" },
  ]);

  const bins = (stats.attempt_distribution ?? []).map((r) => ({
    from: r.attempts,
    to: r.attempts,
    count: r.n,
  }));
  renderChart($("#statsChart"), {
    bins,
    mine: state.lastResult?.solved ? state.lastResult.attempt_no : null,
    caption: "왼쪽이 적은 시도",
  });

  const host = clear($("#statsPosition"));
  const dist = stats.position_distribution ?? [];

  if (dist.length === 0) {
    host.append(el("div", { class: "footnote--dim center" }, "아직 집계된 기록이 없습니다"));
  }

  dist.forEach((counts, pos) => {
    const max = Math.max(...counts, 1);
    const bar = el("div", { class: "chart chart--short" });
    counts.forEach((c, digit) => {
      bar.append(
        el("div", {
          class: "chart__bar",
          style: `height:${Math.max(3, (c / max) * 100)}%`,
          title: `숫자 ${digit}: ${c}회`,
        }),
      );
    });

    host.append(
      el(
        "div",
        { class: "mt-sm" },
        el("div", { class: "footnote--dim" }, `${pos + 1}번째 자리`),
        bar,
        el("div", { class: "chart__caption" }, "0 1 2 3 4 5 6 7 8 9"),
      ),
    );
  });

  showScreen("stats");
  REWARD_HOSTS.forEach((h) => clearRewardCard($(h)));
}

// ── 보상 카드 ────────────────────────────────────────────────

function renderRewards(screen) {
  REWARD_HOSTS.forEach((h) => clearRewardCard($(h)));

  const canRefill = state.adViews < state.maxAdViews;

  if (screen === "main" || screen === "exhausted") {
    renderRewardCard($(screen === "main" ? "#adbar" : "#adbar3"), {
      icon: "🎁",
      title: canRefill ? "광고 보고 기회 충전" : "광고 한도에 도달했습니다",
      desc: canRefill
        ? `같은 정답으로 이어서 도전합니다 · ${state.adViews}/${state.maxAdViews}회 사용`
        : "새 게임을 시작하면 기회가 초기화됩니다",
      cta: canRefill ? "+3회" : "불가",
      disabled: !canRefill,
      onClick: refillByAd,
    });
    return;
  }

  if (screen === "success" || screen === "fail") {
    renderRewardCard($(screen === "success" ? "#adbar2" : "#adbar4"), {
      icon: "📊",
      title: "광고 보고 전체 통계 열람",
      desc: "성공률 · 평균 시도 · 자리별 정답 분포",
      cta: "보기",
      onClick: openStats,
    });
  }
}
