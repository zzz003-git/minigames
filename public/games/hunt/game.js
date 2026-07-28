/**
 * ⑱ 한 발 앞서
 *
 * 표적의 이동 경로는 서버가 라운드를 만들 때 확정하고 응답에 싣지 않습니다.
 * 클라이언트는 "몇 번 칸을 눌렀는가" 만 보내고, 거리 힌트만 돌려받습니다.
 *
 * 이미 눌러 본 칸은 '오답' 이 아니라 **흐린 흔적**으로 남깁니다 —
 * 표적이 돌아올 수 있어 소거의 근거가 되지 못한다는 것을 화면으로 말합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, $$, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown,
} from "../../shared/run.js";

const GAME = "HUNT";
const AD_PER_DAY = 5;

const formatBest = (metric) => `${-metric}점`;

const BAND_TEXT = {
  near: "바로 옆이었어요 — 다음 턴엔 어디로 갈까요",
  close: "가까웠어요",
  far: "멀었어요",
};
const BAND_MARK = { near: "옆", close: "근접", far: "멂" };

let timer = null;
let lastResult = null;
let round = null;
let lastPoints = 0;

renderHeader($("#header"), { icon: "🎯", title: "한 발 앞서", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "표적 1턴 정지 + 기회 1회", desc: "다음 한 번은 표적이 움직이지 않습니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#pauseEndBtn").addEventListener("click", () => { stopTimer(); run.end(); });
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
      attempts: st.attempts, base: st.base_attempts,
      best: st.my_best, plays: st.my_plays, formatBest,
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

function onRound(next, state) {
  stopTimer();
  round = next;
  lastPoints = next.points ?? lastPoints;

  setHeaderBadge(`R${next.round}`);
  $("#hudRound").textContent = String(next.round);
  $("#hudTries").textContent = `${next.tries_left}회`;
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  $("#goodsName").textContent = next.goods;
  $("#moveText").textContent = next.frozen
    ? "표적이 묶여 있습니다 — 다음 한 번은 움직이지 않습니다"
    : `표적은 누를 때마다 최대 ${next.step}칸 움직입니다${next.stay ? " (제자리 가능)" : ""}`;

  paintGrid();
  startTimer(state.limitMs);
}

function paintGrid(reveal) {
  const host = clear($("#tiles"));
  host.style.setProperty("--cols", String(round.n));

  const last = round.used.length ? round.used[round.used.length - 1] : null;
  const walked = reveal ?? null;

  for (let i = 0; i < round.n * round.n; i++) {
    const hit = round.used.filter((u) => u.cell === i).pop();
    const step = walked ? walked.indexOf(i) : -1;

    let cls = "tile";
    let label = "";

    if (step >= 0) {
      // 끝난 뒤 표적이 지나간 길 — 여기서 기다렸으면 잡았습니다
      cls += step === walked.length - 1 ? " is-answer" : " is-path";
      label = String(step + 1);
    } else if (hit && last && hit.cell === last.cell) {
      cls += " is-wrong";
      label = BAND_MARK[last.dist <= 1 ? "near" : last.dist <= 2 ? "close" : "far"];
    } else if (hit) {
      cls += " is-used";
      label = "·";
    }

    host.append(
      el("button", {
        class: cls,
        type: "button",
        disabled: Boolean(walked),
        "aria-label": `${i + 1}번 칸`,
        onclick: () => pick(i),
      }, label),
    );
  }
}

function pick(cell) {
  stopTimer();
  for (const t of $$(".tile")) t.disabled = true;
  run.answer(cell);
}

async function onJudged(res) {
  stopTimer();
  const d = res.data ?? {};

  if (res.correct) {
    toast(`잡았습니다! +${d.gained}점${d.spare ? ` (기회 ${d.spare}회 남김)` : ""}`, "good");
    lastPoints = d.points ?? lastPoints;
    return;
  }

  if (d.band) toast(BAND_TEXT[d.band], d.band === "near" ? "good" : "error");
  else if (d.timed_out) toast("시간이 끝나 기회를 하나 잃었습니다", "error");

  // 마지막 기회까지 놓쳤으면 표적이 지나간 길을 보여 줍니다.
  if (d.walked) {
    round.used = round.used ?? [];
    paintGrid(d.walked);
    await new Promise((r) => setTimeout(r, 1400));
  } else {
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── 라운드 제한 시간 ─────────────────────────────────────────

function startTimer(limitMs) {
  if (!limitMs) return;
  const fill = $("#timebar");
  timer = countdown({
    ms: limitMs,
    onTick: (left) => {
      $("#hudTime") && ($("#hudTime").textContent = `${(left / 1000).toFixed(1)}s`);
      fill.style.transform = `scaleX(${left / limitMs})`;
    },
    onEnd: () => run.answer(null, { timeout: true }),
  });
}

function stopTimer() {
  timer?.stop();
  timer = null;
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText() {
  return {
    sub: "광고를 보면 표적을 한 턴 묶고 한 번 더 노릴 수 있습니다",
    figure: `${lastPoints}점`,
  };
}

function onOver(result) {
  stopTimer();
  lastResult = result;
  const points = result.score ?? 0;

  renderRunOver(result, {
    figure: String(points),
    unit: "점",
    sub: `${result.cleared}라운드에서 표적을 잡았어요`,
    tiles: [
      { label: "잡은 횟수", value: `${result.cleared}회` },
      { label: "점수", value: `${points}점` },
      { label: "이어하기", value: result.boosted ? "사용" : "없음" },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 점수 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "점수 분포 · 오른쪽이 높은 점수",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
