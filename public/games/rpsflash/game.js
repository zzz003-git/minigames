/**
 * ⑭ 이겨라 / 져라
 *
 * 스트룹과 같은 구조입니다 — 문항 묶음을 받아 로컬로 빠르게 진행하고,
 * 답안과 문항별 응답 시간을 함께 제출하면 서버가 처음부터 다시 채점합니다.
 * 틀린 순간 광고로 오답 1회를 면제받아 연속을 이어갈 수 있습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, boostReward, statsReward, unpackCount,
} from "../../shared/run.js";

const GAME = "RPSFLASH";
const AD_PER_DAY = 5;

const EMOJI = { rock: "✊", scissors: "✌", paper: "✋" };
const HAND_NAME = { rock: "바위", scissors: "가위", paper: "보" };
const ORDER_TEXT = { WIN: "이겨라", LOSE: "져라", DRAW: "비겨라" };
const ORDER_CLASS = { WIN: "order-badge--win", LOSE: "order-badge--lose", DRAW: "order-badge--draw" };

/**
 * 손 그림 (REQ-56 §3-1).
 * 페이지를 열 때 3장을 decode 까지 끝내 두고, **그림을 쓸지는 런 시작 때 한 번만** 정합니다.
 * 문항마다 src 를 바꾸지 않고 미리 만든 <img> 를 보임/숨김으로만 바꿉니다 — 첫 문항부터
 * 그림이 나와야 하고, 문항 시작 시각(qt0)이 그림을 기다리면 안 되기 때문입니다.
 * 그림을 못 쓰면 지금처럼 이모지입니다.
 *
 * 47px 시트 판정 통과(기획회신 REP-50·51 검토 · 2026-10-06). 한 장이라도 비우면 이모지로 돕니다.
 */
const HAND_ART = {
  rock: "/games/rpsflash/img/hand_rock.v1.png",
  scissors: "/games/rpsflash/img/hand_scissors.v1.png",
  paper: "/games/rpsflash/img/hand_paper.v1.png",
};
const art = { ready: false };

async function prepareHandArt() {
  const imgs = [...document.querySelectorAll(".rps-hand-art")];
  if (!imgs.length || imgs.some((img) => !HAND_ART[img.dataset.hand])) return;
  try {
    for (const img of imgs) img.src = HAND_ART[img.dataset.hand];
    await Promise.all(imgs.map((img) => img.decode()));
    art.ready = true;
  } catch {
    art.ready = false; // 하나라도 못 불러오면 이번 페이지는 이모지
  }
}
prepareHandArt();

/** 상대 손 기준: 이기는 손 / 지는 손 */
const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
const LOSES_TO = { rock: "paper", scissors: "rock", paper: "scissors" };

const answerOf = (item) =>
  item.order === "WIN" ? LOSES_TO[item.hand] : item.order === "LOSE" ? BEATS[item.hand] : item.hand;

/** rank_metric = -(연속 × 1000) + 평균응답/10 — 복원은 unpackCount 가 합니다 */
const formatBest = (metric) => `${unpackCount(metric)}연속`;

const state = {
  sessionId: null,
  items: [],
  hands: [],
  answers: [],
  times: [],
  index: 0,
  streak: 0,
  boosts: 0,
  maxBoosts: 2,
  t0: 0,
  qt0: 0,
  itemTimer: 0,
  locked: true,
  useArt: false,
};

let lastResult = null;

renderHeader($("#header"), { icon: "✌", title: "이겨라 / 져라", badge: "0" });

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
  clearTimeout(state.itemTimer);
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
      items: res.round.items,
      hands: res.round.hands,
      answers: [],
      times: [],
      index: 0,
      streak: 0,
      boosts: 0,
      maxBoosts: res.max_boosts,
      t0: performance.now(),
      useArt: art.ready, // 런 도중에는 바꾸지 않습니다
    });

    $("#handBox").classList.toggle("is-art", state.useArt);
    buildChoices();
    clearRewards();
    showScreen("play");
    renderItem();
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

// ── 문항 ─────────────────────────────────────────────────────

function buildChoices() {
  const host = clear($("#choices"));
  for (const hand of state.hands) {
    host.append(
      el(
        "button",
        { class: "choice", type: "button", "aria-label": HAND_NAME[hand], onclick: () => pick(hand) },
        el("span", { class: "choice__hand", "aria-hidden": "true" }, EMOJI[hand]),
        HAND_NAME[hand],
      ),
    );
  }
}

function renderItem() {
  const item = state.items[state.index];
  if (!item) {
    submitRun();
    return;
  }

  const order = $("#order");
  order.textContent = ORDER_TEXT[item.order];
  order.className = `order-badge ${ORDER_CLASS[item.order]}`;

  $("#hand").textContent = EMOJI[item.hand];
  $("#handBox").setAttribute("aria-label", `상대 손: ${HAND_NAME[item.hand]}`);
  if (state.useArt) {
    for (const img of document.querySelectorAll(".rps-hand-art")) img.hidden = img.dataset.hand !== item.hand;
  }
  $("#hudStreak").textContent = String(state.streak);
  $("#hudLimit").textContent = `${(item.limit_ms / 1000).toFixed(1)}s`;
  setHeaderBadge(String(state.streak));

  state.locked = false;
  state.qt0 = performance.now();
  startItemTimer(item.limit_ms);
}

function pick(hand) {
  if (state.locked) return;
  state.locked = true;
  clearTimeout(state.itemTimer);

  const item = state.items[state.index];
  state.answers[state.index] = hand;
  state.times[state.index] = Math.round(performance.now() - state.qt0);

  if (hand === answerOf(item)) {
    state.streak += 1;
    state.index += 1;
    renderItem();
    return;
  }

  onMiss("틀렸어요", `${ORDER_TEXT[item.order]} → ${HAND_NAME[answerOf(item)]}`);
}

function startItemTimer(ms) {
  clearTimeout(state.itemTimer);

  const fill = $("#itembar");
  fill.style.transition = "none";
  fill.style.transform = "scaleX(1)";
  requestAnimationFrame(() => {
    fill.style.transition = `transform ${ms}ms linear`;
    fill.style.transform = "scaleX(0)";
  });

  state.itemTimer = setTimeout(() => {
    if (state.locked) return;
    state.locked = true;
    state.answers[state.index] = null;
    state.times[state.index] = ms;
    onMiss("시간 초과", "1초 안에 골라야 합니다");
  }, ms);
}

// ── 오답 ─────────────────────────────────────────────────────

function onMiss(reason, hint) {
  $("#pauseTitle").textContent = reason;
  $("#pauseSub").textContent = `${hint} · ${state.streak}연속에서 끊겼어요`;
  $("#pauseFigure").textContent = `${state.streak}연속`;

  showScreen("pause");
  clearRewards();

  boostReward(GAME, {
    sessionId: state.sessionId,
    label: "오답 1회 면제",
    desc: "지금 연속을 유지한 채 다음 문제로 넘어갑니다",
    used: state.boosts,
    max: state.maxBoosts,
    onBoosted: (reward) => {
      state.boosts = reward.boosts;
      state.index += 1;
      clearRewards();
      showScreen("play");
      renderItem();
    },
  });
}

// ── 제출 ─────────────────────────────────────────────────────

async function submitRun() {
  clearTimeout(state.itemTimer);
  state.locked = true;

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
    unit: "연속",
    sub: `${result.score}번 연속으로 지시를 지켰어요`,
    tiles: [
      { label: "연속", value: `${result.score}회` },
      { label: "평균", value: detail?.avg_ms != null ? `${detail.avg_ms}ms` : "—" },
      { label: "면제", value: `${detail?.forgiven ?? 0}회` },
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
        caption: "연속 정답 분포 · 왼쪽이 긴 연속",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
