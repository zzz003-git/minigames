/**
 * ㉑ 퍼펙트 스택
 *
 * 블록 하나를 얹을 때마다 서버가 판정합니다(ENDLESS).
 *
 * ── 블록 위치를 서버와 같은 식으로 계산합니다 ────────────────────────────
 * 서버가 내려준 왕복 시간(sweep_ms)·시작 위상(phase0)·폭(width)만으로 위치가
 * 결정되므로, 화면은 그 삼각파를 그대로 그리기만 합니다. 탭하면 **경과 시간**을
 * 보내고 서버가 같은 식으로 다시 계산해 판정합니다 — 화면이 점수를 정하지 않습니다.
 * (⑪ 링 스톱과 같은 구조)
 *
 * 좌표는 전부 0~1 정규화입니다. 캔버스 크기가 달라도 판정이 같아야 하기 때문입니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, unpackCount,
} from "../../shared/run.js";

const GAME = "STACK";
const AD_PER_DAY = 3;

/** rank_metric = -(층수 × 1000) + 평균오차 페널티 → 층수만 되돌립니다 */
const formatBest = (metric) => `${unpackCount(metric)}층`;

/**
 * 캔버스 논리 크기 — CSS 로 늘려 씁니다.
 * 탑은 바닥에서 위로 자라므로 세로가 길면 초반에 빈 공간만 보입니다.
 * 정사각에 가깝게 두고, 탑이 높아지면 카메라를 올려 늘 맨 위가 보이게 합니다.
 */
const W = 360;
const H = 360;
/** 한 층의 높이(px). 탑이 화면을 넘으면 아래로 밀어 그립니다 */
const LAYER_H = 26;

const state = { round: null, t0: 0, raf: 0, busy: false, cut: null };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🧱", title: "퍼펙트 스택" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "이어하기", desc: "지금 탑과 층수를 그대로 이어갑니다" },
  hooks: {
    onRound: renderRound,
    onJudged: showVerdict,
    onOver: onOver,
    pauseText: pauseText,
  },
});

$("#startBtn").addEventListener("click", startRun);
$("#tower").addEventListener("click", drop);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ══════════════════════════════════════════════════════════════
// 시작 화면
// ══════════════════════════════════════════════════════════════

async function loadReady() {
  stopLoop();
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
      toast("오늘 기회를 모두 썼어요. 광고를 보면 한 판 더 할 수 있어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 탑 그리기
// ══════════════════════════════════════════════════════════════

/** 서버와 **같은 식**이어야 합니다 (src/games/arcade/stack.js 의 blockX) */
function blockX(elapsedMs, sweepMs, phase0, width) {
  const room = Math.max(0, 1 - width);
  const phase = (((elapsedMs / sweepMs + phase0) % 1) + 1) % 1;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return tri * room;
}

function renderRound(round) {
  if (!round) return;

  state.round = round;
  state.t0 = performance.now();
  state.busy = false;

  $("#hudLevel").textContent = String(round.levels ?? 0);
  $("#hudScore").textContent = comma(round.score ?? 0);
  $("#hudCombo").textContent = `${round.combo ?? 0}/${round.combo_need ?? 3}`;
  setHeaderBadge(`${round.levels ?? 0}층`);
  $("#playHint").textContent =
    (round.levels ?? 0) === 0 ? "블록이 바닥판 위에 오면 탭" : "아래 층과 겹치게 탭";

  startLoop();
}

function startLoop() {
  stopLoop();
  const g = $("#towerCanvas").getContext("2d");
  const step = () => {
    draw(g);
    state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

function stopLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

/**
 * 탑과 흐르는 블록을 그립니다.
 *
 * 탑이 캔버스보다 높아지면 **위쪽 일정 층만 보이게 밀어 올립니다** — 화면 밖으로
 * 나가면 어디에 얹는지 보이지 않아 게임이 성립하지 않습니다.
 */
function draw(g) {
  const round = state.round;
  if (!round) return;

  g.clearRect(0, 0, W, H);

  const tower = round.tower ?? [];
  // 맨 위 층이 항상 같은 높이(TOP_Y)에 오도록 카메라를 올립니다
  const TOP_Y = H - LAYER_H * 4;
  const shift = Math.max(0, (tower.length - 1) * LAYER_H - (H - LAYER_H * 5));

  tower.forEach(([l, r], i) => {
    const y = H - LAYER_H * (i + 1) + shift;
    if (y < -LAYER_H || y > H) return;
    const base = i === 0;
    g.fillStyle = base ? "rgba(233,146,127,.28)" : `hsl(14 62% ${34 + ((i * 5) % 26)}%)`;
    g.strokeStyle = "rgba(255,255,255,.14)";
    roundRect(g, l * W, y, (r - l) * W, LAYER_H - 3, 4);
    g.fill();
    g.stroke();
  });

  // 흐르는 블록
  if (!state.busy) {
    const x = blockX(performance.now() - state.t0, round.sweep_ms, round.phase0, round.width);
    const y = Math.min(TOP_Y, H - LAYER_H * (tower.length + 1) + shift);
    g.fillStyle = "#E9927F";
    g.strokeStyle = "rgba(255,255,255,.35)";
    roundRect(g, x * W, y, round.width * W, LAYER_H - 3, 4);
    g.fill();
    g.stroke();

    // 받침 중앙 안내선 — 조준점이 보이지 않으면 조준 게임이 되지 않습니다
    const [sl, sr] = round.support ?? [0, 1];
    const mid = ((sl + sr) / 2) * W;
    g.strokeStyle = "rgba(255,255,255,.18)";
    g.setLineDash([4, 6]);
    g.beginPath();
    g.moveTo(mid, y + LAYER_H);
    g.lineTo(mid, H);
    g.stroke();
    g.setLineDash([]);
  }

  // 잘려 떨어지는 조각 (판정 직후 짧게)
  if (state.cut && performance.now() - state.cut.at < 420) {
    const p = (performance.now() - state.cut.at) / 420;
    g.globalAlpha = 1 - p;
    g.fillStyle = "#E9927F";
    roundRect(g, state.cut.x * W, state.cut.y + p * 90, state.cut.w * W, LAYER_H - 3, 4);
    g.fill();
    g.globalAlpha = 1;
  }
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

// ══════════════════════════════════════════════════════════════
// 조작 — 탭 하나
// ══════════════════════════════════════════════════════════════

async function drop() {
  if (state.busy || !state.round) return;
  state.busy = true;

  const elapsed = Math.max(0, Math.round(performance.now() - state.t0));
  const x = blockX(elapsed, state.round.sweep_ms, state.round.phase0, state.round.width);

  navigator.vibrate?.(12);
  await run.answer({ x: Number(x.toFixed(3)) }, { elapsed_ms: elapsed });
  state.busy = false;
}

/** 판정 연출 — 잘린 조각과 콤보는 서버가 준 값만 씁니다 */
async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;

  if (d.timed_out) {
    toast("시간이 지나 놓쳤어요", "error", 1600);
    return;
  }

  // 잘려 떨어지는 조각 — 어긋난 만큼만
  if (d.cut > 0.004) {
    const tower = d.tower ?? [];
    state.cut = {
      x: d.x,
      w: d.cut,
      y: H - LAYER_H * (tower.length + 1),
      at: performance.now(),
    };
  }

  $("#hudLevel").textContent = String(d.levels ?? 0);
  $("#hudScore").textContent = comma(d.score ?? 0);
  $("#hudCombo").textContent = `${d.combo ?? 0}/${state.round?.combo_need ?? 3}`;

  if (d.recovered) {
    toast("중앙 정렬 3연속! 폭이 넓어졌어요", "good", 1800);
    navigator.vibrate?.([18, 40, 24]);
  } else if (d.perfect) {
    toast("딱 맞았어요", "good", 1100);
  }
}

/**
 * 화면이 바뀐 직후 잠깐 못 누르게 막습니다.
 *
 * 이 게임은 **연타**로 진행합니다. 손이 화면에 머무르지는 않지만 다음 탭이 200ms 안에
 * 오므로, 판이 끝나는 순간 그 자리에 나타난 버튼을 그 탭이 눌러 버립니다.
 * 브라우저 확인에서 실제로 첫 탭이 실패한 뒤 두 번째 탭이 「끝내고 결과 보기」를 눌러
 * 0층으로 종료됐습니다. [over] 의 「다시 도전하기」가 눌리면 **하루 기회가 한 번 날아갑니다.**
 *
 * 기획서 0절은 「단일 탭이라 잔여 동작 문제 없음」으로 봤지만, 그 판정은 손이 화면에
 * 머무는 경우(⑳ 문지르기)만 고려한 것입니다. 연타 게임에는 그대로 적용됩니다.
 */
const ARM_DELAY_MS = 420;

function armLater(...selectors) {
  for (const sel of selectors) {
    const node = $(sel);
    if (!node) continue;
    node.style.pointerEvents = "none";
    setTimeout(() => {
      node.style.pointerEvents = "";
    }, ARM_DELAY_MS);
  }
}

function pauseText(st) {
  armLater("#adbarBoost", "#pauseEndBtn");

  const d = lastData ?? {};
  $("#pauseHeadline").textContent = d.timed_out ? "놓쳤어요" : "폭이 다 줄었어요";
  return {
    sub: `${d.levels ?? st.cleared}층까지 쌓았어요 — 이어하면 이 탑에서 계속합니다`,
    figure: `${d.levels ?? 0}층`,
  };
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function onOver(result) {
  stopLoop();
  // 연타 중 판이 끝나면 그 자리에 「다시 도전하기」가 옵니다 — 잔여 탭이 기회를 씁니다
  armLater("#retryBtn", "#adbarStats");
  lastResult = result;
  showOver(result);
}

function showOver(result) {
  const d = lastData ?? {};
  const levels = d.levels ?? 0;

  renderRunOver(result, {
    figure: String(levels),
    unit: "층",
    sub:
      d.perfects > 0
        ? `중앙에 딱 맞춘 층 ${d.perfects}개`
        : "다음엔 중앙을 노려 보세요 — 3연속이면 폭이 넓어져요",
    tiles: [
      { label: "점수", value: comma(result.score ?? 0), accent: true },
      { label: "딱 맞음", value: `${d.perfects ?? 0}층` },
      { label: "폭 회복", value: `${d.combos ?? 0}회` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "층수 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "도달 층수 분포 · 왼쪽이 높음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
