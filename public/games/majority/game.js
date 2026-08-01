/**
 * ⑮ 다들 뭐 골랐을까
 *
 * 서버가 문항과 "어제까지의 집계" 를 세션에 넣어 두고, 클라이언트는 몇 번째 보기를
 * 눌렀는지만 보냅니다. 비율은 **판정이 끝난 뒤에만** 응답에 들어옵니다 —
 * 미리 내려보내면 그게 곧 정답이라 게임이 성립하지 않습니다.
 *
 * 보기의 좌우 위치는 서버가 매번 섞습니다. 그래서 이 화면은 "왼쪽/오른쪽" 이 아니라
 * 항상 보기 내용으로 결과를 말합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, $$, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown,
} from "../../shared/run.js";

const GAME = "MAJORITY";
const AD_PER_DAY = 5;
const TOTAL = 3;

/** 결과를 보여 주고 다음 문항으로 넘어가기까지 (비율 막대가 끝까지 차오를 시간) */
const REVEAL_MS = 1700;

/** rank_metric = -점수 */
const formatBest = (metric) => `${Math.round(-metric)}점`;

let timer = null;
let lastResult = null;
let currentQ = null;
let log = [];

renderHeader($("#header"), { icon: "🗳", title: "다들 뭐 골랐을까", badge: `1/${TOTAL}` });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "되돌리기 1회", desc: "지금까지 맞힌 문항은 그대로 두고 빗나간 문항만 새 문항으로 바꿉니다" },
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
  log = [];
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

// ── 문항 ─────────────────────────────────────────────────────

function onRound(round, state) {
  stopTimer();
  if (!round) return;
  currentQ = round;

  const no = round.no ?? state.cleared + 1;
  setHeaderBadge(`${no}/${TOTAL}`);
  $("#hudStep").textContent = `${no} / ${TOTAL}`;
  $("#voteTopic").textContent = "오늘의 질문";
  $("#voteQ").textContent = round.prompt;
  $("#voteNote").textContent = "더 많은 사람이 고른 쪽을 고르세요";
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });
  renderStepDots(state.cleared);

  const host = clear($("#voteList"));
  round.options.forEach((label, index) => {
    host.append(
      el(
        "button",
        { class: "vote-opt", type: "button", onclick: () => run.answer(index) },
        el("span", { class: "vote-opt__fill" }),
        el(
          "span",
          { class: "vote-opt__row" },
          el("span", { class: "vote-opt__label" }, label),
          el("span", { class: "vote-opt__pct" }, ""),
        ),
      ),
    );
  });

  startTimer(state.limitMs);
}

function renderStepDots(cleared) {
  const host = clear($("#stepDots"));
  for (let i = 0; i < TOTAL; i++) {
    host.append(
      el("span", { class: `trial-dot ${i < cleared ? "is-done" : ""}` }, i < cleared ? "✓" : `${i + 1}`),
    );
  }
}

/**
 * 판정 결과 공개.
 *
 * 고른 자리에서 그대로 비율이 차오르게 합니다. 다수 쪽에는 초록 테두리가 붙고,
 * 소수를 골랐으면 내가 누른 쪽이 산호색이 됩니다. 색만으로 알리지 않도록
 * 비율 숫자와 "내 선택" 표시를 함께 넣습니다.
 */
async function onJudged(res) {
  stopTimer();

  const d = res.data ?? {};
  const opts = $$(".vote-opt");
  for (const b of opts) b.disabled = true;

  const counting = d.basis === "none";

  if (counting) {
    $("#voteNote").textContent = "아직 집계 중인 문항이라 통과했어요 (점수 없음)";
  } else if (d.timed_out) {
    $("#voteNote").textContent = "시간이 지나 선택하지 못했어요";
  } else {
    const sample = Number(d.sample ?? 0).toLocaleString("ko-KR");
    const basis = d.basis === "day" ? "어제까지" : "지금까지";
    $("#voteNote").textContent = res.correct
      ? `적중! ${basis} ${sample}명 중 다수를 맞혔어요 · +${d.points}점`
      : `아깝다! ${basis} ${sample}명은 반대쪽을 더 골랐어요`;
  }

  // 비율 공개 — 집계가 없는 문항은 보여 줄 숫자도 없습니다.
  if (!counting && d.pct != null) {
    opts.forEach((b, i) => {
      const isMajor = i === d.major_index;
      const pct = isMajor ? d.pct : Math.round((100 - d.pct) * 10) / 10;

      b.classList.add("is-revealed");
      if (isMajor) b.classList.add("is-major");
      if (i === d.picked_index) b.classList.add("is-mine");

      b.querySelector(".vote-opt__pct").textContent = `${pct}%`;
      // 다음 프레임에 폭을 줘야 transition 이 걸립니다
      requestAnimationFrame(() => {
        b.querySelector(".vote-opt__fill").style.width = `${pct}%`;
      });

      if (i === d.picked_index) {
        b.querySelector(".vote-opt__row").after(el("span", { class: "vote-opt__mine" }, "내 선택"));
      }
    });
  }

  log.push({
    prompt: currentQ?.prompt ?? "",
    hit: Boolean(res.correct),
    counting,
    pct: d.pct ?? null,
    points: d.points ?? 0,
  });

  await new Promise((r) => setTimeout(r, counting ? 1100 : REVEAL_MS));
}

// ── 문항 제한 시간 ───────────────────────────────────────────

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
  return { sub: `${state.cleared + 1}번째 문항에서 빗나갔어요`, figure: `${state.cleared}/${TOTAL}` };
}

function onOver(result) {
  stopTimer();
  lastResult = result;

  const cleared = result.cleared ?? 0;
  const done = cleared >= TOTAL;
  // 전부 「집계 중」 문항이었던 판에는 완주 보너스가 붙지 않습니다 (서버 규칙과 같은 조건)
  const bonus = done && log.some((r) => !r.counting);

  renderRunOver(result, {
    figure: String(result.score ?? 0),
    unit: "점",
    sub: done
      ? `${TOTAL}문항 연속 적중!${bonus ? " 완주 보너스까지 받았어요" : ""}`
      : `${cleared}문항을 맞혔어요`,
    tiles: [
      { label: "적중", value: `${cleared} / ${TOTAL}` },
      // 결과 응답에는 보상 사용 여부(boosted)만 들어옵니다 — 횟수는 리그 구분에만 쓰입니다.
      { label: "되돌리기", value: result.boosted ? "사용" : "안 씀" },
      { label: "완주 보너스", value: bonus ? "+50" : "—" },
    ],
    formatBest,
  });

  renderLog();
  renderOverRewards();
}

function renderLog() {
  const host = clear($("#overLog"));

  for (const [i, r] of log.entries()) {
    const text = r.counting
      ? `${r.prompt} · 집계 중`
      : `${r.prompt} · 다수 ${r.pct}%`;

    host.append(
      el(
        "div",
        { class: "vote-log__row" },
        el("span", { class: `vote-log__mark ${r.hit ? "is-hit" : "is-miss"}` }, r.hit ? "✓" : "✕"),
        el("span", { class: "vote-log__text", title: r.prompt }, `${i + 1}. ${text}`),
        el("span", { class: "vote-log__pts" }, r.points > 0 ? `+${r.points}` : "—"),
      ),
    );
  }

  if (log.length === 0) {
    host.append(el("div", { class: "empty-note" }, "기록이 없습니다"));
  }
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
        caption: "점수 분포 · 왼쪽이 고득점",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
