/**
 * ⑦ 순서 기억
 *
 * 서버가 시퀀스를 만들고 채점합니다. 시퀀스 자체는 화면에 재생해야 하므로 응답에 들어오지만
 * (숫자 기억력과 같은 제약), 입력 결과를 위조하는 것은 불가능합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, $$, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, roundText,
} from "../../shared/run.js";

const GAME = "SEQUENCE";
const AD_PER_DAY = 5;

const formatBest = (metric) => roundText(-metric);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastResult = null;
let input = [];
let accepting = false;

renderHeader($("#header"), { icon: "🔔", title: "순서 기억", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "목숨 +1", desc: "같은 길이의 새 문제로 이어서 도전합니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

buildPads();

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ── 패드 ─────────────────────────────────────────────────────

function buildPads() {
  const host = clear($("#pads"));
  for (let i = 0; i < 9; i++) {
    host.append(
      el("button", {
        class: "pad",
        type: "button",
        disabled: true,
        "aria-label": `${i + 1}번 패드`,
        onclick: () => tap(i),
      }),
    );
  }
}

const pads = () => $$(".pad");

function setPadsEnabled(on) {
  for (const p of pads()) p.disabled = !on;
}

async function flash(index, ms) {
  const pad = pads()[index];
  pad.classList.add("is-lit");
  await sleep(ms);
  pad.classList.remove("is-lit");
  await sleep(Math.max(90, ms * 0.35));
}

// ── 시작 화면 ────────────────────────────────────────────────

async function loadReady() {
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

async function onRound(round, state) {
  input = [];
  accepting = false;

  setHeaderBadge(`R${round.round}`);
  $("#hudRound").textContent = String(round.round);
  $("#hudLength").textContent = String(round.length);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  for (const p of pads()) p.classList.remove("is-tapped", "is-miss");
  setPadsEnabled(false);

  $("#playHint").textContent = "잘 보세요…";
  await sleep(600);

  for (const pad of round.sequence) await flash(pad, round.flash_ms);

  $("#playHint").textContent = `${round.length}칸을 순서대로 누르세요`;
  accepting = true;
  setPadsEnabled(true);
}

function tap(index) {
  if (!accepting) return;

  const pad = pads()[index];
  pad.classList.add("is-tapped");
  setTimeout(() => pad.classList.remove("is-tapped"), 160);

  input.push(index);

  const expected = Number($("#hudLength").textContent);
  $("#playHint").textContent = `${input.length} / ${expected}`;

  if (input.length < expected) return;

  accepting = false;
  setPadsEnabled(false);
  run.answer(input);
}

/** 틀린 자리를 짚어 줍니다 — 어디서 끊겼는지 알면 다시 하고 싶어집니다. */
async function onJudged(res) {
  if (res.correct) {
    $("#playHint").textContent = "좋아요!";
    await sleep(400);
    return;
  }

  const missAt = res.data?.miss_at;
  const shouldBe = res.data?.expected?.[missAt];
  if (shouldBe != null) {
    pads()[shouldBe].classList.add("is-miss");
    $("#playHint").textContent = `${missAt + 1}번째가 달랐어요`;
  }
  await sleep(900);
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText(state) {
  return { sub: `${state.cleared + 3}칸에서 막혔어요`, figure: `${state.cleared}R` };
}

function onOver(result) {
  lastResult = result;
  accepting = false;
  setPadsEnabled(false);

  renderRunOver(result, {
    figure: String(result.cleared),
    unit: "라운드",
    sub: `최장 ${result.cleared + 2}칸까지 외웠어요`,
    tiles: [
      { label: "클리어", value: `${result.cleared}R` },
      { label: "최장", value: `${result.cleared + 2}칸` },
      { label: "이어하기", value: `${result.detail?.boosts ?? 0}회` },
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
