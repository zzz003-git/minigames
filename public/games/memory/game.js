/**
 * ④ 숫자 기억력 챌린지
 *
 * 채점은 서버가 원본과 비교해서 하므로 입력 결과를 위조할 수 없습니다.
 * 다만 암기용 숫자는 화면에 반드시 보여줘야 하므로, 개발자도구로 값을 읽는 행위는
 * 원리적으로 막을 수 없습니다 (완전 차단하려면 서버에서 이미지로 렌더링해야 함).
 */

import { apiGet, apiPost, ApiFail } from "../../shared/api.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../../shared/ad.js";
import {
  $, el, clear, showScreen, toast, renderSlots, renderStats, renderHeader, setHeaderBadge,
  mountNumpad, bindKeyboardNumpad, celebrate, mmss, comma, currentScreen,
} from "../../shared/ui.js";

const state = {
  levels: [],
  bestLevel: 0,
  tickets: { remaining: 0, granted: 0, used: 0 },
  selected: 1,
  session: null,
  input: "",
  hintsLeft: 0,
  countdown: 0,
  lastResult: null,
};

let numpad = null;

// ── 초기화 ───────────────────────────────────────────────────

renderHeader($("#header"), {
  icon: "🧠",
  title: "숫자 기억력",
  sub: "본 숫자를 그대로 입력하기",
  badge: "LV—",
});

$("#challengeBtn").addEventListener("click", () => startLevel(state.selected));
$("#viewRankBtn").addEventListener("click", openRank);
$("#resultRankBtn").addEventListener("click", openRank);
$("#hintBtn").addEventListener("click", useHint);
$("#backToSelectBtn").addEventListener("click", () => loadLevels());
$("#nextLevelBtn").addEventListener("click", () => {
  const next = state.lastResult?.next_level;
  if (next) startLevel(next);
});
$("#rankBackBtn").addEventListener("click", () => {
  const back = state.lastResult ? "result" : "select";
  showScreen(back);
  renderRewards(back);
});

numpad = mountNumpad($("#numpad"), {
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitInput,
  okLabel: "확인",
});

bindKeyboardNumpad({
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitInput,
  isActive: () => currentScreen() === "input",
});

loadLevels();

// ── 레벨 선택 ────────────────────────────────────────────────

async function loadLevels() {
  try {
    const res = await apiGet("/game/levels", { game: "MEMORY" });
    state.levels = res.levels;
    state.bestLevel = res.best_level;
    state.tickets = res.tickets;
    state.selected = Math.min(Math.max(1, res.best_level || 1), res.levels.length);
    renderLevels();
    showScreen("select");
    renderRewards("select");
  } catch (err) {
    toast(err.message ?? "레벨 정보를 불러올 수 없습니다.", "error");
  }
}

function renderLevels() {
  const host = clear($("#levelGrid"));

  for (const lv of state.levels) {
    const locked = lv.level > Math.max(1, state.bestLevel);
    host.append(
      el(
        "button",
        {
          class: `level-card ${locked ? "is-locked" : ""}`,
          type: "button",
          "aria-pressed": lv.level === state.selected,
          "aria-label": `레벨 ${lv.level}, ${lv.digits}자리${locked ? ", 도전권 필요" : ""}`,
          onclick: () => {
            state.selected = lv.level;
            renderLevels();
          },
        },
        el("span", { class: "level-card__lv" }, `LV${lv.level}`),
        el("span", { class: "level-card__digits" }, `${lv.digits}자리`),
        locked ? el("span", { class: "level-card__lock", "aria-hidden": "true" }, "🔒 도전권") : null,
      ),
    );
  }

  $("#bestLevel").textContent = state.bestLevel > 0 ? `LV${state.bestLevel}` : "—";
  $("#bestSub").textContent =
    state.bestLevel > 0
      ? `${(state.levels.find((l) => l.level === state.bestLevel)?.digits ?? "?")}자리까지 성공했습니다`
      : "아직 클리어한 레벨이 없습니다";
  setHeaderBadge(state.bestLevel > 0 ? `LV${state.bestLevel}` : "LV—");

  $("#ticketBadge").textContent = `도전권 ${state.tickets.remaining}장`;

  const spec = state.levels.find((l) => l.level === state.selected);
  const locked = state.selected > Math.max(1, state.bestLevel);
  $("#ticketText").textContent = locked
    ? `LV${state.selected}는 도전권이 필요합니다 · 보유 ${state.tickets.remaining}장`
    : `LV${state.selected} · ${spec?.digits ?? "?"}자리 · ${(spec?.expose_ms ?? 0) / 1000}초 노출${spec?.hints ? " · 힌트 1회" : ""}`;

  $("#challengeBtn").textContent = `▶ LV${state.selected} 도전하기`;
}

// ── 도전 시작 → 암기 ─────────────────────────────────────────

async function startLevel(level) {
  try {
    const res = await apiPost("/game/session/start", { game_type: "MEMORY", level });
    state.session = res;
    state.selected = level;
    state.input = "";
    state.hintsLeft = res.hints;
    runMemorize(res);
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      toast(err.message, "error");
      const rewarded = await watchAdForReward("MEMORY_LEVEL");
      if (!rewarded) return;
      toast("레벨 도전권이 지급되었습니다.", "good");
      startLevel(level);
      return;
    }
    toast(err.message ?? "도전을 시작할 수 없습니다.", "error");
  }
}

function runMemorize(session) {
  $("#memorizeLabel").textContent = `LV${session.level} · 기억하세요`;
  $("#memorizeDigits").textContent = [...session.digits].join(" ");
  $("#memorizeHint").textContent = `${session.digit_count}자리 숫자입니다`;

  showScreen("memorize");
  clearAllRewards();

  let left = Math.ceil(session.expose_ms / 1000);
  $("#memorizeCount").textContent = left;

  const iv = setInterval(() => {
    left -= 1;
    $("#memorizeCount").textContent = Math.max(0, left);
    if (left > 0) return;
    clearInterval(iv);
    openInput();
  }, 1000);
}

// ── 블라인드 입력 ────────────────────────────────────────────

function openInput() {
  state.input = "";
  $("#inputLabel").textContent = `기억한 ${state.session.digit_count}자리를 입력하세요`;
  $("#hintBtn").classList.toggle("hidden", state.hintsLeft <= 0);
  $("#hintBtn").disabled = state.hintsLeft <= 0;
  $("#hintBtn").textContent = `💡 힌트 사용 (${state.hintsLeft}회)`;
  renderInput();
  showScreen("input");
  renderRewards("input");

  // 입력 제한 시간
  clearTimeout(state.countdown);
  state.countdown = setTimeout(() => {
    if (currentScreen() === "input") {
      toast("입력 시간이 초과되었습니다.", "error");
      submitInput(true);
    }
  }, state.session.input_time_limit_ms);
}

function renderInput() {
  renderSlots($("#inputSlots"), {
    length: state.session.digit_count,
    value: state.input,
    small: state.session.digit_count > 7,
  });
  numpad.setOkEnabled(state.input.length > 0);
}

function pushDigit(d) {
  if (currentScreen() !== "input") return;
  if (state.input.length >= state.session.digit_count) return;
  state.input += d;
  renderInput();
}

function popDigit() {
  if (currentScreen() !== "input") return;
  state.input = state.input.slice(0, -1);
  renderInput();
}

async function useHint() {
  if (state.hintsLeft <= 0) return;
  try {
    const res = await apiPost("/game/hint", {
      session_id: state.session.session_id,
      filled: state.input,
    });
    state.hintsLeft = res.hints_left;
    // 힌트로 받은 자리를 채워 줍니다.
    if (res.index === state.input.length) {
      state.input += res.digit;
    }
    renderInput();
    $("#hintBtn").textContent = `💡 힌트 사용 (${state.hintsLeft}회)`;
    $("#hintBtn").disabled = state.hintsLeft <= 0;
    toast(`${res.index + 1}번째 자리는 ${res.digit} 입니다.`, "good");
  } catch (err) {
    toast(err.message ?? "힌트를 사용할 수 없습니다.", "error");
  }
}

async function submitInput(auto = false) {
  if (currentScreen() !== "input") return;
  if (!auto && state.input.length === 0) return;
  clearTimeout(state.countdown);
  numpad.setOkEnabled(false);

  try {
    const res = await apiPost("/game/submit", {
      game_type: "MEMORY",
      session_id: state.session.session_id,
      input: state.input,
    });
    state.lastResult = res;
    state.bestLevel = res.best_level;
    state.tickets = res.tickets;
    renderResult(res);
  } catch (err) {
    toast(err.message ?? "결과를 제출할 수 없습니다.", "error");
    loadLevels();
  }
}

// ── 결과 ─────────────────────────────────────────────────────

function renderResult(res) {
  const mark = clear($("#resultMark"));
  if (res.cleared) mark.append(el("div", { class: "check-mark", "aria-hidden": "true" }, "✓"));

  $("#resultHeadline").textContent = res.cleared ? `LV${res.level} 클리어` : `LV${res.level} 실패`;
  $("#resultSub").textContent = `${res.correct_count} / ${res.digit_count} 자리 정답`;

  // 자리별 채점 — 색 외에 ✓/✕ 아이콘도 함께 표시합니다.
  renderSlots($("#resultSlots"), {
    length: res.digit_count,
    value: res.per_digit.map((d) => d.got ?? "_").join(""),
    marks: res.per_digit.map((d) => d.correct),
    expected: res.answer,
    small: res.digit_count > 7,
  });

  renderStats($("#resultTiles"), [
    { value: `TOP ${res.rank_pct}%`, label: `LV${res.level} 상위`, accent: true },
    { value: mmss(res.elapsed_ms), label: "소요" },
    { value: `LV${res.best_level}`, label: "최고 레벨" },
  ]);

  setHeaderBadge(`LV${res.best_level}`);

  const nextAvailable = Boolean(res.next_level) && res.cleared;
  $("#nextLevelBtn").classList.toggle("hidden", !nextAvailable);
  if (nextAvailable) $("#nextLevelBtn").textContent = `▶ LV${res.next_level} 도전하기`;

  $("#resultNote").textContent = res.cleared
    ? `도전권 ${res.tickets.remaining}장 보유${nextAvailable ? " · 없으면 광고로 받을 수 있습니다" : ""}`
    : `정답은 ${[...res.answer].join(" ")} 였습니다 · 같은 레벨을 다시 도전할 수 있습니다`;

  showScreen("result");
  renderRewards("result");

  if (res.cleared) celebrate($("#resultCard"));
}

// ── 랭킹 (전면 광고 후 열람) ──────────────────────────────────

async function openRank() {
  const bucket = state.lastResult ? `LV${state.lastResult.level}` : `LV${state.selected}`;
  const load = async () => {
    renderRank(await apiGet("/game/rank", { game: "MEMORY", bucket }));
    renderLevelStats(await apiGet("/game/stats", { game: "MEMORY", bucket }));
  };

  try {
    await load();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      if (!(await watchAdForReward("MEMORY_RANK"))) return;
      try {
        await load();
      } catch (e) {
        toast(e.message, "error");
      }
      return;
    }
    toast(err.message, "error");
  }
}

function renderRank(data) {
  $("#rankTitle").textContent = `${data.bucket ?? ""} 랭킹`;

  const host = clear($("#rankList"));
  if ((data.list ?? []).length === 0) {
    host.append(el("div", { class: "footnote" }, "아직 기록이 없습니다"));
  }
  for (const row of data.list ?? []) {
    const mine = data.my_rank === row.rank;
    const d = row.detail ?? {};
    host.append(
      el(
        "div",
        { class: `rank-row ${mine ? "is-me" : ""}` },
        el("span", { class: "rank-row__no" }, mine ? "ME" : `#${row.rank}`),
        el("span", { class: "rank-row__name" }, `${row.label}${d.cleared ? " · 클리어" : ""}`),
        el("span", { class: "rank-row__value" }, `${d.correct_count ?? row.score}/${d.digit_count ?? "?"}`),
      ),
    );
  }

  showScreen("rank");
  clearAllRewards();
}

function renderLevelStats(stats) {
  const host = clear($("#levelStats"));
  const rows = stats.by_level ?? [];

  if (rows.length === 0) {
    host.append(el("div", { class: "footnote" }, "아직 집계된 기록이 없습니다"));
  }

  for (const lv of rows) {
    host.append(
      el(
        "div",
        { class: "rank-row" },
        el("span", { class: "rank-row__no" }, `LV${lv.level}`),
        el("span", { class: "rank-row__name" }, `${comma(lv.count)}회 도전`),
        el("span", { class: "rank-row__value" }, `${lv.clear_rate}%`),
      ),
    );
  }
}

// ── 보상 카드 ────────────────────────────────────────────────

const clearAllRewards = () => {
  clearRewardCard($("#adbar"));
  clearRewardCard($("#adbar2"));
};

function renderRewards(screen) {
  clearAllRewards();
  if (screen !== "select" && screen !== "result") return;

  const host = screen === "select" ? $("#adbar") : $("#adbar2");
  renderRewardCard(host, {
    icon: "🎟",
    title: "레벨 도전권 받기",
    desc: `광고를 보면 도전권 1장이 지급됩니다 (하루 3회) · 보유 ${state.tickets.remaining}장`,
    onClick: async () => {
      const res = await watchAdForReward("MEMORY_LEVEL");
      if (!res) return;
      state.tickets = res.reward.attempts;
      toast("레벨 도전권이 지급되었습니다.", "good");
      if (screen === "select") renderLevels();
      renderRewards(screen);
    },
  });
}
