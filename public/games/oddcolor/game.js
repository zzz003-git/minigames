/**
 * ⑥ 색 다른 타일 찾기
 *
 * 서버가 라운드마다 색 배열과 정답 위치를 만들고, 정답 위치는 세션에만 둡니다.
 * 클라이언트는 "몇 번째 칸을 눌렀는가" 만 보내고 판정은 전부 서버가 합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, $$, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown, roundText,
} from "../../shared/run.js";

const GAME = "ODDCOLOR";
const AD_PER_DAY = 5;

/** rank_metric = -클리어 라운드 수 */
const formatBest = (metric) => roundText(-metric);

let timer = null;
let lastResult = null;

renderHeader($("#header"), { icon: "🎨", title: "색 다른 타일 찾기", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "목숨 +1", desc: "같은 라운드부터 이어서 도전합니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
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

  setHeaderBadge(`R${round.round}`);
  $("#hudRound").textContent = String(round.round);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  const host = clear($("#tiles"));
  host.style.setProperty("--cols", String(round.grid));

  round.colors.forEach((color, index) => {
    host.append(
      el("button", {
        class: "tile",
        type: "button",
        style: `background:${color}`,
        "aria-label": `${index + 1}번 칸`,
        onclick: () => pick(index),
      }),
    );
  });

  startTimer(state.limitMs);
}

const pick = (index) => run.answer(index);

/** 틀렸을 때 정답 위치를 잠깐 보여 줍니다 — "저기였구나" 가 재도전 동기가 됩니다. */
async function onJudged(res) {
  stopTimer();
  if (res.correct) return;

  const tiles = $$(".tile");
  const answer = res.data?.answer_index;
  if (answer != null && tiles[answer]) tiles[answer].classList.add("is-answer");
  if (res.data?.picked != null && tiles[res.data.picked]) {
    tiles[res.data.picked].classList.add("is-wrong");
  }
  for (const t of tiles) t.disabled = true;

  await new Promise((r) => setTimeout(r, 750));
}

// ── 라운드 제한 시간 ─────────────────────────────────────────

function startTimer(limitMs) {
  if (!limitMs) return;
  const fill = $("#timebar");

  timer = countdown({
    ms: limitMs,
    onTick: (left) => {
      $("#hudTime").textContent = `${(left / 1000).toFixed(1)}s`;
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

function pauseText(state) {
  return { sub: `라운드 ${state.cleared + 1}에서 멈췄어요`, figure: `${state.cleared}R` };
}

function onOver(result) {
  stopTimer();
  lastResult = result;

  renderRunOver(result, {
    figure: String(result.cleared),
    unit: "라운드",
    sub: `${result.cleared}라운드까지 통과했어요`,
    tiles: [
      { label: "클리어", value: `${result.cleared}R` },
      { label: "이어하기", value: `${result.detail?.boosts ?? 0}회` },
      { label: "소요", value: `${Math.round(result.elapsed_ms / 1000)}초` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 라운드 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "도달 라운드 분포 · 오른쪽이 높은 라운드",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
