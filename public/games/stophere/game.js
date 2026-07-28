/**
 * ⑯ 여기서 그만
 *
 * 클라이언트는 "한 장 더" 인지 "그만" 인지만 보냅니다. 뽑을 장의 꽝 여부는 서버가
 * 라운드를 만들 때 이미 정해 두었고 응답에 실리지 않으므로, 화면을 뜯어봐도 알 수 없습니다.
 *
 * 꽝 확률은 반대로 **일부러 드러냅니다**. 감추면 운 게임이 되고, 공개하면
 * "이 확률에서 멈출까 더 갈까" 라는 판단 게임이 됩니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown,
} from "../../shared/run.js";

const GAME = "STOPHERE";
const AD_PER_DAY = 5;

/** rank_metric = -지급액 */
const formatBest = (metric) => `${-metric}P`;

let timer = null;
let lastResult = null;
let lastRound = null;
// 결과 응답에는 detail 이 실리지 않습니다(서버가 DB 에만 남김).
// 그래서 런 도중에 받은 값을 직접 들고 있다가 결과 화면에서 씁니다.
let lastStack = 0;

renderHeader($("#header"), { icon: "🛑", title: "여기서 그만", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "꽝 1회 무효", desc: "쌓은 것을 그대로 두고 이어서 뽑습니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#moreBtn").addEventListener("click", () => decide("more"));
$("#stopBtn").addEventListener("click", () => decide("stop"));
$("#pauseEndBtn").addEventListener("click", () => {
  stopTimer();
  run.end();
});
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ── 시작 화면 ────────────────────────────────────────────────

async function loadReady() {
  stopTimer();
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
    await run.begin();
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

// ── 라운드 ───────────────────────────────────────────────────

function onRound(round, state) {
  stopTimer();
  lastRound = round;

  setHeaderBadge(`R${round.round}`);
  $("#hudRound").textContent = String(round.round);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  lastStack = round.stack;
  $("#stackValue").textContent = `${round.stack}P`;
  $("#stopValue").textContent = `${round.stop_payout}P`;
  $("#stopBtnValue").textContent = `${round.stop_payout}P`;

  $("#cardValue").textContent = `+${round.value}P`;
  $("#cardGoods").textContent = round.goods;

  const pct = Math.round((round.bust_pct ?? 0) * 100);
  $("#bustText").textContent = pct === 0
    ? "이 장이 꽝일 확률 0% — 처음 세 장은 꽝이 없습니다"
    : `이 장이 꽝일 확률 ${pct}%`;

  // 아직 아무것도 쌓지 않았으면 멈출 것이 없습니다.
  $("#stopBtn").disabled = round.stack <= 0;
  $("#moreBtn").disabled = false;

  startTimer(state.limitMs);
}

function decide(choice) {
  $("#moreBtn").disabled = true;
  $("#stopBtn").disabled = true;
  stopTimer();
  run.answer(choice);
}

/** 꽝이 났을 때 "그냥 멈췄으면 얼마였는지" 를 보여 줍니다 — 그게 아까움의 크기입니다. */
async function onJudged(res) {
  stopTimer();
  if (typeof res.data?.stack === "number") lastStack = res.data.stack;
  if (res.correct || !res.data?.bust) return;

  const stack = res.data.stack ?? 0;
  const mult = res.data.missed_mult ?? 1.5;
  toast(`꽝! 쌓은 ${stack}P는 그대로 확정 — 멈췄다면 ${Math.round(stack * mult)}P였어요`, "error");
  await new Promise((r) => setTimeout(r, 600));
}

// ── 라운드 제한 시간 ─────────────────────────────────────────
//
// 시간이 끝나면 서버가 '그만' 으로 처리합니다. 방치했다고 쌓은 것을 빼앗으면
// 손실이 생기고, 그 순간 이 게임의 전제("잃는 경우가 없다")가 무너집니다.

function startTimer(limitMs) {
  if (!limitMs) return;
  const fill = $("#timebar");

  timer = countdown({
    ms: limitMs,
    onTick: (left) => {
      $("#hudTime").textContent = `${(left / 1000).toFixed(1)}s`;
      fill.style.transform = `scaleX(${left / limitMs})`;
    },
    onEnd: () => run.answer("stop", { timeout: true }),
  });
}

function stopTimer() {
  timer?.stop();
  timer = null;
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText(state) {
  const stack = lastRound?.stack ?? 0;
  return {
    sub: `쌓은 ${stack}P는 이미 확정입니다. 광고를 보면 이 꽝을 무효로 하고 이어 갑니다`,
    figure: `${stack}P`,
  };
}

function onOver(result) {
  stopTimer();
  lastResult = result;

  const stopped = Boolean(result.completed);   // 자발 정지 = 완주
  const payout = result.score ?? 0;
  const stack = lastStack;

  renderRunOver(result, {
    figure: `${payout}P`,
    unit: "",
    sub: stopped
      ? `쌓은 ${stack}P × 정지 보너스 1.5배`
      : `꽝이 나왔지만 쌓은 ${stack}P는 전액 확정 지급되었습니다`,
    tiles: [
      { label: "쌓은 것", value: `${stack}P` },
      { label: "뽑은 장", value: `${result.cleared}장` },
      { label: "이어하기", value: result.boosted ? "사용" : "없음" },
    ],
    formatBest,
  });

  const note = $("#overNote");
  if (note) {
    note.textContent = stopped
      ? "스스로 멈춘 판에는 광고를 제안하지 않습니다."
      : `여기서 멈췄다면 ${Math.round(stack * 1.5)}P였습니다.`;
  }

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 지급액 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "지급액 분포 · 오른쪽이 높은 지급액",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
