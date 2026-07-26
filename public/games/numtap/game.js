/**
 * ⑧ 숫자 순서 터치 (슐테 테이블)
 *
 * 25번을 누르는 동안 서버에 왕복하면 그 지연이 전부 기록에 섞이므로,
 * 탭 기록을 모아 두었다가 한 번에 제출합니다. 서버가 순서와 시간을 다시 확인합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, $$, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, sec2,
} from "../../shared/run.js";

const GAME = "NUMTAP";
const AD_PER_DAY = 5;
const TOTAL = 25;

/** rank_metric = 최종 기록(ms) */
const formatBest = (metric) => (metric >= 999999 ? "—" : sec2(metric));

const state = {
  sessionId: null,
  expect: 1,
  misses: 0,
  taps: [], // 누른 숫자
  times: [], // 시작 시점부터의 누적 ms
  t0: 0,
  clock: 0,
  running: false,
};

let lastResult = null;

renderHeader($("#header"), { icon: "🔢", title: "숫자 순서 터치", badge: "1 / 25" });

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#giveUpBtn").addEventListener("click", () => submitRun());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ── 시작 화면 ────────────────────────────────────────────────

async function loadReady() {
  stopClock();
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
      expect: 1,
      misses: 0,
      taps: [],
      times: [],
      running: true,
      t0: performance.now(),
    });

    buildGrid(res.round.layout, res.round.size);
    renderHud();
    clearRewards();
    showScreen("play");
    startClock();
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

// ── 보드 ─────────────────────────────────────────────────────

function buildGrid(layout, size) {
  const host = clear($("#grid"));
  host.style.setProperty("--cols", String(size));

  for (const n of layout) {
    host.append(
      el(
        "button",
        { class: "tap-cell", type: "button", "data-n": n, onclick: () => tap(n) },
        String(n),
      ),
    );
  }
}

const cellOf = (n) => $$(`.tap-cell`).find((c) => Number(c.dataset.n) === n);

function tap(n) {
  if (!state.running) return;

  state.taps.push(n);
  state.times.push(Math.round(performance.now() - state.t0));

  if (n !== state.expect) {
    state.misses += 1;
    const cell = cellOf(n);
    cell.classList.add("is-miss");
    setTimeout(() => cell.classList.remove("is-miss"), 260);
    renderHud();
    return;
  }

  const cell = cellOf(n);
  cell.classList.add("is-done");
  cell.disabled = true;
  state.expect += 1;
  renderHud();

  if (state.expect > TOTAL) submitRun();
}

function renderHud() {
  const next = Math.min(state.expect, TOTAL);
  $("#hudNext").textContent = String(next);
  $("#hudMiss").textContent = String(state.misses);
  setHeaderBadge(`${state.expect - 1} / ${TOTAL}`);
}

function startClock() {
  stopClock();
  state.clock = setInterval(() => {
    $("#hudTime").textContent = `${((performance.now() - state.t0) / 1000).toFixed(1)}s`;
  }, 100);
}

function stopClock() {
  clearInterval(state.clock);
  state.clock = 0;
}

// ── 제출 ─────────────────────────────────────────────────────

async function submitRun() {
  if (!state.running) return;
  state.running = false;
  stopClock();

  try {
    const res = await runApi.submit(GAME, state.sessionId, {
      answers: state.taps,
      times: state.times,
      elapsed_ms: Math.round(performance.now() - state.t0),
    });
    onOver(res.result, res.detail);
  } catch (err) {
    toast(err.message ?? "기록을 저장할 수 없습니다.", "error");
    loadReady();
  }
}

// ── 결과 ─────────────────────────────────────────────────────

function onOver(result, detail) {
  lastResult = result;

  const done = detail?.completed;

  renderRunOver(result, {
    figure: done ? (detail.final_ms / 1000).toFixed(2) : `${detail?.reached ?? 0}`,
    unit: done ? "초" : "까지",
    sub: done
      ? `순수 기록 ${(detail.raw_ms / 1000).toFixed(2)}초 + 오탭 ${detail.misses}회`
      : "25까지 누르지 못해 기록이 남지 않았어요",
    tiles: [
      { label: "기록", value: done ? sec2(detail.final_ms) : "—" },
      { label: "오탭", value: `${detail?.misses ?? 0}회` },
      { label: "페널티", value: `+${((detail?.penalty_ms ?? 0) / 1000).toFixed(1)}초` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 완주 시간 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "완주 시간 분포 · 왼쪽이 빠름",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
