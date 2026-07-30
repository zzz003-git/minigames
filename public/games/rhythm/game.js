/**
 * ㉓ 리듬 에코
 *
 * 원이 빛나는 간격을 기억해 같은 박자로 두드립니다.
 *
 * ── 시간 제한이 없습니다 ─────────────────────────────────────────────────
 * 제시가 끝나면 테두리가 밝아지고, 사용자가 첫 번째로 두드릴 때까지 기다립니다.
 * 판정은 **첫 탭을 기준으로 한 상대 간격**이라 언제 시작하든 불리하지 않습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "RHYTHM";
const AD_PER_DAY = 3;

const formatBest = (metric) => `LV ${Math.max(0, -metric)}`;

const state = { round: null, phase: "idle", taps: [], t0: 0, busy: false, timers: [] };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🥁", title: "리듬 에코" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "패턴 다시 보기", desc: "같은 레벨을 다시 시도합니다" },
  hooks: { onRound: renderRound, onJudged: showVerdict, onOver: onOver, pauseText: pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#echoPad").addEventListener("click", tap);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

async function loadReady() {
  clearTimers();
  showScreen("ready");
  clearRewards();
  try {
    const st = await runApi.status(GAME);
    renderReady({ attempts: st.attempts, base: st.base_attempts, best: st.my_best, plays: st.my_plays, formatBest });
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
  attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 기회를 모두 썼어요. 광고를 보면 한 번 더 할 수 있어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

/**
 * 예약된 빛을 모두 취소합니다.
 *
 * `const` 화살표로 두면 안 됩니다 — 이 파일은 모듈 마지막에 `loadReady()` 를 부르는데
 * 그 안에서 이것을 쓰므로, 선언 전 접근(TDZ)으로 모듈 초기화가 통째로 죽습니다.
 * 그러면 시작 버튼이 계속 disabled 로 남아 게임이 열리지 않습니다(브라우저에서 걸렸습니다).
 * 함수 선언은 호이스팅되므로 순서에 상관없이 안전합니다.
 */
function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}

// ══════════════════════════════════════════════════════════════
// 제시 → 재현
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;
  state.round = round;
  state.busy = false;

  $("#hud1").textContent = String(round.level);
  $("#hud2").textContent = `${round.beats}박`;
  $("#hud3").textContent = `±${round.tol_ms}ms`;
  setHeaderBadge(`LV ${round.level}`);

  drawBeats(round.beats, 0);
  playPattern(round);
}

/** 박 수를 점으로 보여 줍니다 — 몇 번 두드려야 하는지가 보여야 합니다 */
function drawBeats(total, done) {
  const host = clear($("#echoBeats"));
  for (let i = 0; i < total; i++) {
    host.append(el("span", { class: `beat ${i < done ? "is-on" : ""}` }));
  }
}

/** 빛으로 패턴을 재생합니다. 재생이 끝나면 테두리가 밝아지고 입력을 기다립니다 */
function playPattern(round) {
  clearTimers();
  state.phase = "show";
  state.taps = [];
  $("#playHint").textContent = "빛을 보세요";
  $("#echoPad").classList.remove("is-armed");

  const pad = $("#echoPad");
  let at = 300;
  const flash = () => {
    pad.classList.add("is-lit");
    state.timers.push(setTimeout(() => pad.classList.remove("is-lit"), 160));
  };

  // 첫 박 + 간격마다 한 번씩
  state.timers.push(setTimeout(flash, at));
  round.gaps.forEach((g) => {
    at += g;
    state.timers.push(setTimeout(flash, at));
  });

  state.timers.push(
    setTimeout(() => {
      state.phase = "input";
      pad.classList.add("is-armed");
      $("#playHint").textContent = "이제 같은 박자로 두드리세요 (시간 제한 없음)";
    }, at + 400),
  );
}

async function tap() {
  if (state.phase !== "input" || state.busy) return;

  const now = performance.now();
  if (state.taps.length === 0) state.t0 = now;
  state.taps.push(Math.round(now - state.t0));

  const pad = $("#echoPad");
  pad.classList.add("is-hit");
  setTimeout(() => pad.classList.remove("is-hit"), 140);
  navigator.vibrate?.(10);
  drawBeats(state.round.beats, state.taps.length);

  if (state.taps.length < state.round.beats) return;

  state.busy = true;
  state.phase = "judge";
  await run.answer({ taps: state.taps });
  state.busy = false;
}

async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;

  const pad = $("#echoPad");
  pad.classList.remove("is-armed");
  pad.classList.add(d.ok ? "is-good" : "is-bad");
  setTimeout(() => pad.classList.remove("is-good", "is-bad"), 600);

  if (d.ok) toast("박자 맞았어요", "good", 1100);
  else if (d.worst_off != null) {
    const dir = d.worst_off > 0 ? "느렸어요" : "빨랐어요";
    toast(`${Math.abs(d.worst_off)}ms ${dir} (허용 ±${d.tol_ms}ms)`, "error", 1900);
  }
}

function pauseText(st) {
  const d = lastData ?? {};
  const off = d.worst_off == null ? null : Math.abs(d.worst_off);
  return {
    sub: off == null ? `LV ${st.cleared} 까지 왔어요` : `${off}ms 차이로 끝났어요 (허용 ±${d.tol_ms}ms)`,
    figure: `LV ${st.cleared}`,
  };
}

function onOver(result) {
  clearTimers();
  lastResult = result;
  const level = result.cleared ?? 0;

  renderRunOver(result, {
    figure: `LV ${level}`,
    sub: level >= 5 ? "간격을 정확히 기억하고 있어요" : "박 수가 늘어도 간격만 맞추면 됩니다",
    tiles: [
      { label: "점수", value: comma(result.score ?? 0), accent: true },
      { label: "도달 박 수", value: `${(lastData?.offs?.length ?? 0) + 1}박` },
      { label: "마지막 오차", value: lastData?.worst_off == null ? "—" : `${Math.abs(lastData.worst_off)}ms` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "도달 레벨 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "도달 레벨 분포 · 왼쪽이 높음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
