/**
 * ⑨ 60초 암산
 *
 * 서버가 문제 묶음을 한 번에 발급하고 정답은 세션에만 둡니다.
 * 60초짜리 게임에서 문항마다 왕복하면 지연이 그대로 점수를 깎으므로,
 * 클라이언트가 로컬로 빠르게 진행하고 끝에 답안 전체를 제출하면 서버가 다시 채점합니다.
 *
 * 광고 보상(+15초)은 시간이 끝난 순간 제안합니다.
 * 결과를 확정한 뒤에는 세션이 닫혀 이어붙일 수 없기 때문입니다.
 */

import { ApiFail } from "../../shared/api.js";
import {
  $, clear, showScreen, toast, renderHeader, setHeaderBadge,
  mountNumpad, bindKeyboardNumpad, currentScreen,
} from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, boostReward, statsReward, countdown, unpackCount,
} from "../../shared/run.js";

const GAME = "MATHRUSH";
const AD_PER_DAY = 5;
const MAX_DIGITS = 5;

/** rank_metric = -(정답 × 1000) + 평균응답/10 — 복원은 unpackCount 가 합니다 */
const formatBest = (metric) => `${unpackCount(metric)}문제`;

const state = {
  sessionId: null,
  questions: [],
  answers: [],
  times: [],
  index: 0,
  score: 0,
  wrong: 0,
  input: "",
  limitMs: 60000,
  penaltyMs: 3000,
  boosts: 0,
  maxBoosts: 2,
  t0: 0,
  qt0: 0,
  timer: null,
};

let lastResult = null;
let numpad = null;

renderHeader($("#header"), { icon: "➗", title: "60초 암산", badge: "0" });

numpad = mountNumpad($("#numpad"), {
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: commitAnswer,
  okLabel: "확인",
});

bindKeyboardNumpad({
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: commitAnswer,
  isActive: () => currentScreen() === "play",
});

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
  state.timer?.stop();
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
      questions: res.round.questions,
      answers: [],
      times: [],
      index: 0,
      score: 0,
      wrong: 0,
      input: "",
      limitMs: res.round.limit_ms,
      penaltyMs: res.round.wrong_penalty_ms,
      boosts: 0,
      maxBoosts: res.max_boosts,
      t0: performance.now(),
    });

    clearRewards();
    showScreen("play");
    renderQuestion();
    startTimer(state.limitMs);
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

// ── 문제 ─────────────────────────────────────────────────────

function renderQuestion() {
  const q = state.questions[state.index];
  if (!q) {
    timeUp();
    return;
  }

  $("#question").textContent = `${q.a} ${q.op} ${q.b}`;
  state.input = "";
  state.qt0 = performance.now();
  renderAnswerBox();
  setHeaderBadge(String(state.score));
  $("#hudScore").textContent = String(state.score);
}

function renderAnswerBox(kind = "") {
  const box = $("#answerBox");
  box.className = `answer-box ${state.input === "" ? "is-empty" : ""} ${kind}`;
  box.textContent = state.input === "" ? "?" : state.input;
  numpad?.setOkEnabled(state.input.length > 0);
}

function pushDigit(d) {
  if (state.input.length >= MAX_DIGITS) return;
  if (state.input === "" && d === "0") return;
  state.input += d;
  renderAnswerBox();
}

function popDigit() {
  state.input = state.input.slice(0, -1);
  renderAnswerBox();
}

/**
 * 답을 확정합니다. 정오 판정은 화면 연출과 시간 페널티에만 쓰고,
 * 점수는 제출 후 서버가 다시 채점한 값을 씁니다.
 */
function commitAnswer() {
  if (state.input === "") return;

  const q = state.questions[state.index];
  const value = Number(state.input);
  const expected = q.op === "+" ? q.a + q.b : q.op === "-" ? q.a - q.b : q.a * q.b;
  const hit = value === expected;

  state.answers[state.index] = value;
  state.times[state.index] = Math.round(performance.now() - state.qt0);

  if (hit) {
    state.score += 1;
  } else {
    state.wrong += 1;
    state.timer?.add(-state.penaltyMs);
    renderAnswerBox("is-wrong");
    toast(`틀렸어요 · −${state.penaltyMs / 1000}초`, "error", 1200);
  }

  state.index += 1;
  setTimeout(renderQuestion, hit ? 0 : 220);
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
    onEnd: timeUp,
  });
}

/** 시간이 끝났습니다 — 여기서 연장할지 확정할지 고릅니다. */
function timeUp() {
  state.timer?.stop();

  $("#pauseSub").textContent = `${state.score}문제를 맞혔어요`;
  $("#pauseFigure").textContent = `${state.score}문제`;

  showScreen("pause");
  clearRewards();

  boostReward(GAME, {
    sessionId: state.sessionId,
    label: "+15초",
    desc: "연장한 판은 75초 · 90초 리그로 따로 집계됩니다",
    used: state.boosts,
    max: state.maxBoosts,
    onBoosted: (reward) => {
      state.boosts = reward.boosts;
      state.limitMs = reward.data.limit_ms;
      clearRewards();
      showScreen("play");
      renderQuestion();
      startTimer(reward.data.added_ms);
    },
  });
}

async function submitRun() {
  state.timer?.stop();

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
    unit: "문제",
    sub: `${detail?.attempted ?? 0}문제 중 ${result.score}개 정답 · 정확도 ${detail?.accuracy ?? 0}%`,
    tiles: [
      { label: "정답", value: `${result.score}개` },
      { label: "오답", value: `${detail?.wrong ?? 0}개` },
      { label: "평균", value: detail?.avg_ms != null ? `${(detail.avg_ms / 1000).toFixed(1)}초` : "—" },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: `${lastResult?.bucket ?? "60s"} 리그 전체 분포와 TOP 20`, onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "정답 수 분포 · 왼쪽이 많음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
