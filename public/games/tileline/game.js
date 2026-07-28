/**
 * ⑳ 어디에 놓을까
 *
 * 판 상태와 타일 순서는 서버가 들고 있고, 클라이언트는 "몇 번 칸에 놓았는가" 만 보냅니다.
 * 인접 보너스와 줄 완성 판정도 전부 서버가 합니다.
 *
 * 한 칸만 채우면 완성되는 줄은 점선으로 표시합니다 — 무엇을 놓치고 있는지 보여야
 * "여기만 채우면 되는데" 가 성립합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown,
} from "../../shared/run.js";

const GAME = "TILELINE";
const AD_PER_DAY = 5;

const formatBest = (metric) => `${-metric}점`;

/** 브랜드별 색 — 같은 상품을 붙였는지 한눈에 보여야 인접 보너스가 판단이 됩니다. */
const COLOR = {
  "아메리카노": "#3d5a80",
  "샌드위치": "#5a3d68",
  "초코바": "#68503d",
  "생수": "#3d6857",
  "우유": "#59603d",
};

let timer = null;
let lastResult = null;
let round = null;
let lastPoints = 0;

renderHeader($("#header"), { icon: "🟦", title: "어디에 놓을까", badge: "12장" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "타일 1개 추가", desc: "줄이 완성되는 칸에 한 장 더 놓습니다" },
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

  setHeaderBadge(`${next.tiles_left}장`);
  $("#hudTiles").textContent = String(next.tiles_left);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  $("#tileName").textContent = next.tile ?? "—";
  $("#nextName").textContent = next.next_tile ? `다음 · ${next.next_tile}` : "마지막 타일입니다";
  $("#lineText").textContent = next.unlock_only
    ? "광고 혜택 — 줄이 완성되는 칸에만 놓을 수 있습니다"
    : `완성한 줄 ${next.lines_done.length}개 · ${lastPoints}점`;

  paint();
  startTimer(state.limitMs);
}

function paint() {
  const host = clear($("#tiles"));
  host.style.setProperty("--cols", String(round.n));
  const near = new Set(round.near_cells ?? []);

  for (let i = 0; i < round.n * round.n; i++) {
    const brand = round.board[i];
    const placeable = brand == null && (!round.unlock_only || near.has(i));

    let cls = "tile";
    if (brand) cls += " is-filled";
    else if (near.has(i)) cls += " is-hint";

    const node = el("button", {
      class: cls,
      type: "button",
      style: brand ? `background:${COLOR[brand] ?? "#3d5a80"};color:#fff` : null,
      disabled: !placeable,
      onclick: () => place(i),
    }, brand ? brand.slice(0, 2) : "");

    host.append(node);
  }
}

function place(cell) {
  stopTimer();
  run.answer(cell);
}

async function onJudged(res) {
  stopTimer();
  const d = res.data ?? {};

  if (d.invalid) { toast(d.invalid, "error"); return; }

  if (d.opened?.length) {
    toast(`${d.opened.join(" · ")} 완성! +${d.gained}점`, "good");
    await new Promise((r) => setTimeout(r, 500));
  } else if (d.adjacent > 0) {
    toast(`인접 ${d.adjacent}칸 · +${d.gained}점`, "good");
  }
  lastPoints = d.points ?? lastPoints;
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

function pauseText() {
  return {
    sub: "광고를 보면 타일 한 장을 더 받아 그 줄을 완성할 수 있습니다",
    figure: `${lastPoints}점`,
  };
}

function onOver(result) {
  stopTimer();
  lastResult = result;
  const points = result.score ?? 0;
  const lines = round?.lines_done?.length ?? 0;

  renderRunOver(result, {
    figure: String(points),
    unit: "점",
    sub: lines ? `줄 ${lines}개를 완성했어요` : "이번엔 줄을 완성하지 못했어요",
    tiles: [
      { label: "완성한 줄", value: `${lines}개` },
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
