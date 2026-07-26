/**
 * ⑫ 순간 개수 세기
 *
 * 서버가 점 좌표와 개수를 만들고, 노출은 클라이언트가 합니다.
 * 좌표는 화면에 그려야 하므로 응답에 들어오지만 채점(개수 비교)은 서버가 합니다.
 */

import { ApiFail } from "../../shared/api.js";
import {
  $, el, clear, showScreen, toast, renderHeader, setHeaderBadge,
  mountNumpad, bindKeyboardNumpad, currentScreen,
} from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, roundText,
} from "../../shared/run.js";

const GAME = "COUNTDOT";
const AD_PER_DAY = 5;
const MAX_INPUT = 2; // 점은 최대 24개 → 두 자리

const formatBest = (metric) => roundText(-metric);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastResult = null;
let input = "";
let accepting = false;
let numpad = null;

renderHeader($("#header"), { icon: "👁", title: "순간 개수 세기", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "목숨 +1", desc: "지금까지의 라운드를 유지한 채 이어서 도전합니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

numpad = mountNumpad($("#numpad"), {
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitCount,
  okLabel: "확인",
});

bindKeyboardNumpad({
  onDigit: pushDigit,
  onBack: popDigit,
  onOk: submitCount,
  isActive: () => currentScreen() === "play" && accepting,
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

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
  input = "";
  accepting = false;
  renderInput();

  setHeaderBadge(`R${round.round}`);
  $("#hudRound").textContent = String(round.round);
  $("#hudExpose").textContent = `${round.expose_ms}ms`;
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  const field = clear($("#field"));
  field.append(el("div", { class: "dot-field__msg", id: "fieldMsg" }, "준비…"));
  await sleep(700);

  // 노출
  clear(field);
  for (const d of round.dots) {
    field.append(
      el("span", { class: "dot-field__dot", style: `left:${d.x}%; top:${d.y}%` }),
    );
  }
  await sleep(round.expose_ms);

  clear(field).append(el("div", { class: "dot-field__msg" }, "몇 개였나요?"));
  accepting = true;
  $("#inputLabel").textContent = "본 개수를 입력하세요";
}

function pushDigit(d) {
  if (!accepting || input.length >= MAX_INPUT) return;
  if (input === "" && d === "0") return; // 0개짜리 문제는 없습니다
  input += d;
  renderInput();
}

function popDigit() {
  if (!accepting) return;
  input = input.slice(0, -1);
  renderInput();
}

function renderInput() {
  $("#inputValue").textContent = input === "" ? "—" : input;
  numpad?.setOkEnabled(input.length > 0);
}

function submitCount() {
  if (!accepting || input === "") return;
  accepting = false;
  numpad.setOkEnabled(false);
  run.answer(Number(input));
}

/** 틀렸으면 실제 개수를 알려 줍니다. */
async function onJudged(res) {
  if (res.correct) {
    $("#inputLabel").textContent = "정답!";
    await sleep(350);
    return;
  }

  $("#inputLabel").textContent = `정답은 ${res.data?.count}개였어요`;
  await sleep(900);
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText(state) {
  return { sub: `라운드 ${state.cleared + 1}에서 목숨을 다 썼어요`, figure: `${state.cleared}R` };
}

function onOver(result) {
  lastResult = result;
  accepting = false;

  renderRunOver(result, {
    figure: String(result.cleared),
    unit: "라운드",
    sub: `${result.cleared}라운드까지 맞혔어요`,
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
