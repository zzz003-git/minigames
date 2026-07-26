/**
 * ⑪ 링 스톱
 *
 * 점의 위치는 (시작각 + 각속도 × 경과시간) 이라 서버가 그대로 재현할 수 있습니다.
 * 그래서 클라이언트는 "탭한 시점의 경과 시간" 만 보내고, 각도는 참고용으로만 함께 보냅니다.
 * 판정은 서버가 자기 계산으로 합니다.
 *
 * 각도 기준: 12시 방향이 0°, 시계 방향으로 증가.
 */

import { ApiFail } from "../../shared/api.js";
import { $, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "RINGSTOP";
const AD_PER_DAY = 5;
const R = 80; // SVG 반지름 (viewBox 200×200)
const CIRC = 2 * Math.PI * R;

const formatBest = (metric) => `${-metric}연속`;

let lastResult = null;
let anim = 0;
let round = null;
let t0 = 0;
let armed = false;

renderHeader($("#header"), { icon: "🎯", title: "링 스톱", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "목숨 +1", desc: "연속 기록을 유지한 채 이어서 도전합니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#ring").addEventListener("pointerdown", stopRing);
$("#pauseEndBtn").addEventListener("click", () => {
  stopAnim();
  run.end();
});
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  stopRing();
});

loadReady();

// ── 시작 화면 ────────────────────────────────────────────────

async function loadReady() {
  stopAnim();
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

function onRound(next, state) {
  stopAnim();
  round = next;

  setHeaderBadge(`R${next.round}`);
  $("#hudStreak").textContent = String(state.cleared);
  $("#hudSpeed").textContent = `${next.speed_dps}°/s`;
  $("#ringRound").textContent = String(next.round);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  drawTarget(next.target_start_deg, next.arc_deg);

  t0 = performance.now();
  armed = true;
  tick();
}

/** 타겟 아크 — 원 둘레의 일부만 점선으로 남겨 그립니다. */
function drawTarget(startDeg, arcDeg) {
  const len = (CIRC * arcDeg) / 360;
  const target = $("#ringTarget");
  target.setAttribute("stroke-dasharray", `${len} ${CIRC - len}`);
  // SVG 원은 3시 방향에서 시작하므로 −90° 만큼 돌려 12시 기준으로 맞춥니다.
  target.setAttribute("transform", `rotate(${startDeg - 90} 100 100)`);
}

function angleNow() {
  const elapsed = performance.now() - t0;
  return { elapsed, deg: (round.start_deg + (round.speed_dps * elapsed) / 1000) % 360 };
}

function tick() {
  if (!armed) return;
  const { deg } = angleNow();
  const rad = (deg * Math.PI) / 180;

  const dot = $("#ringDot");
  dot.setAttribute("cx", (100 + R * Math.sin(rad)).toFixed(2));
  dot.setAttribute("cy", (100 - R * Math.cos(rad)).toFixed(2));

  anim = requestAnimationFrame(tick);
}

function stopAnim() {
  armed = false;
  cancelAnimationFrame(anim);
  anim = 0;
}

function stopRing() {
  if (!armed) return;
  const { elapsed, deg } = angleNow();
  stopAnim();
  run.answer({ angle_deg: Number(deg.toFixed(2)) }, { elapsed_ms: Math.round(elapsed) });
}

/** 판정 후 실제 위치를 그려 줍니다 — 얼마나 아슬아슬했는지 보여야 다시 하고 싶어집니다. */
async function onJudged(res) {
  const actual = res.data?.actual_deg;
  if (actual != null) {
    const rad = (actual * Math.PI) / 180;
    const dot = $("#ringDot");
    dot.setAttribute("cx", (100 + R * Math.sin(rad)).toFixed(2));
    dot.setAttribute("cy", (100 - R * Math.cos(rad)).toFixed(2));
  }

  if (!res.correct && res.data?.off_deg != null) {
    toast(`${res.data.off_deg}° 차이로 빗나갔어요`, "error", 1500);
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText(state) {
  return { sub: `${state.cleared}연속에서 놓쳤어요`, figure: `${state.cleared}연속` };
}

function onOver(result) {
  stopAnim();
  lastResult = result;

  renderRunOver(result, {
    figure: String(result.cleared),
    unit: "연속",
    sub: `${result.cleared}번 연속으로 멈춰 세웠어요`,
    tiles: [
      { label: "연속", value: `${result.cleared}회` },
      { label: "이어하기", value: `${result.detail?.boosts ?? 0}회` },
      { label: "소요", value: `${Math.round(result.elapsed_ms / 1000)}초` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 연속 기록 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "연속 성공 분포 · 오른쪽이 긴 연속",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
