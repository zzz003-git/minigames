/**
 * ⑬ 카드 짝 맞추기
 *
 * 배치는 서버 세션에만 있습니다. 카드를 뒤집을 때마다 서버에 물어보고, 서버가 그 자리의
 * 그림 하나만 알려 줍니다. 개발자도구로 배치 전체를 미리 볼 수 있는 경로가 없습니다.
 *
 * 그래서 여기서는 createEndlessRun 을 쓰지 않고 직접 씁니다 —
 * "라운드" 가 곧 "카드 한 장 뒤집기" 라 화면 흐름이 다른 4종과 다릅니다.
 */

import { ApiFail } from "../../shared/api.js";
import {
  $, $$, el, clear, showScreen, toast, renderHeader, setHeaderBadge, mmss,
} from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, boostReward, statsReward,
} from "../../shared/run.js";

const GAME = "CARDPAIR";
const AD_PER_DAY = 5;
const CARDS = 16;
const PAIRS = 8;

/** rank_metric = 뒤집기 × 100000 + 초 */
const formatBest = (metric) => `${Math.floor(metric / 100000)}회`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  sessionId: null,
  flips: 0,
  pairs: 0,
  boosts: 0,
  maxBoosts: 2,
  busy: false,
  pending: null, // 첫 장을 뒤집어 둔 카드 index
  t0: 0,
  clock: 0,
};

let lastResult = null;

renderHeader($("#header"), { icon: "🃏", title: "카드 짝 맞추기", badge: "0 FLIPS" });

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
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
      flips: 0,
      pairs: 0,
      boosts: 0,
      maxBoosts: res.max_boosts,
      busy: false,
      pending: null,
      t0: performance.now(),
    });

    buildBoard();
    renderHud();
    clearRewards();
    showScreen("play");
    startClock();
    renderBoost();
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

function buildBoard() {
  const host = clear($("#cards"));
  for (let i = 0; i < CARDS; i++) {
    host.append(
      el(
        "button",
        { class: "mcard", type: "button", "aria-label": `${i + 1}번 카드`, onclick: () => flip(i) },
        el("span", { class: "mcard__back", "aria-hidden": "true" }, "?"),
      ),
    );
  }
}

const cardAt = (i) => $$(".mcard")[i];

function showFace(index, symbol) {
  const card = cardAt(index);
  card.classList.add("is-face");
  card.classList.remove("is-hinted");
  clear(card).append(document.createTextNode(symbol));
}

function showBack(index) {
  const card = cardAt(index);
  card.classList.remove("is-face", "is-miss");
  clear(card).append(el("span", { class: "mcard__back", "aria-hidden": "true" }, "?"));
}

function renderHud() {
  $("#hudFlips").textContent = String(state.flips);
  $("#hudPairs").textContent = `${state.pairs} / ${PAIRS}`;
  setHeaderBadge(`${state.flips} FLIPS`);
}

// ── 뒤집기 ───────────────────────────────────────────────────

async function flip(index) {
  if (state.busy || !state.sessionId) return;
  const card = cardAt(index);
  if (card.classList.contains("is-matched") || card.classList.contains("is-face")) return;

  state.busy = true;

  try {
    const res = await runApi.round(GAME, state.sessionId, index);
    const d = res.data ?? {};

    if (d.phase === "ignored") return;

    state.flips = d.flips ?? state.flips;
    state.pairs = res.cleared ?? state.pairs;
    showFace(index, d.symbol);
    renderHud();

    if (d.phase === "match") {
      for (const i of d.matched) {
        cardAt(i).classList.add("is-matched");
        cardAt(i).disabled = true;
      }
      renderBoost();
    }

    if (d.phase === "miss") {
      for (const i of d.pair) cardAt(i).classList.add("is-miss");
      await sleep(700);
      for (const i of d.pair) showBack(i);
    }

    if (res.game_over) onOver(res.result);
  } catch (err) {
    toast(err.message ?? "카드를 뒤집을 수 없습니다.", "error");
  } finally {
    state.busy = false;
  }
}

// ── 시계 ─────────────────────────────────────────────────────

function startClock() {
  stopClock();
  state.clock = setInterval(() => {
    $("#hudTime").textContent = mmss(performance.now() - state.t0);
  }, 500);
}

function stopClock() {
  clearInterval(state.clock);
  state.clock = 0;
}

// ── 광고 보상: 한 쌍 위치 공개 ────────────────────────────────

function renderBoost() {
  boostReward(GAME, {
    sessionId: state.sessionId,
    label: "한 쌍 위치 공개",
    desc: "아직 못 맞춘 카드 중 한 쌍의 자리를 알려 줍니다",
    used: state.boosts,
    max: state.maxBoosts,
    onBoosted: async (reward) => {
      state.boosts = reward.boosts;
      renderBoost();

      const hint = reward.data;
      if (!hint) {
        toast("공개할 카드가 남아 있지 않습니다.", "error");
        return;
      }

      for (const i of hint.pair) {
        cardAt(i).classList.add("is-hinted");
        clear(cardAt(i)).append(document.createTextNode(hint.symbol));
      }
      await sleep(2600);
      for (const i of hint.pair) {
        if (!cardAt(i).classList.contains("is-matched")) showBack(i);
        cardAt(i).classList.remove("is-hinted");
      }
    },
  });
}

// ── 결과 ─────────────────────────────────────────────────────

function onOver(result) {
  stopClock();
  lastResult = result;

  renderRunOver(result, {
    figure: String(result.score),
    unit: "회 뒤집기",
    sub: `여덟 쌍을 ${mmss(result.elapsed_ms)} 만에 맞췄어요`,
    tiles: [
      { label: "뒤집기", value: `${result.score}회` },
      { label: "소요", value: mmss(result.elapsed_ms) },
      { label: "힌트", value: `${result.detail?.boosts ?? 0}회` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "전체 뒤집기 횟수 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "뒤집기 횟수 분포 · 왼쪽이 적음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
