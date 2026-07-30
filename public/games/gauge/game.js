/**
 * ㉗ 오늘의 전국 게이지
 *
 * 기여 토큰을 밀어 넣어 모든 사용자가 함께 채우는 하루 목표를 올립니다.
 * 기획서가 「게임이 아니라 시즌 레이어」로 쓴 문서라, 여기서는 그 게이지를 눈으로 보고
 * 직접 기여하는 참여 화면으로 먼저 구현합니다 — docs/gauge-game.md.
 *
 * 화면에 보이는 총량은 **내 기여가 반영된 뒤의 값**입니다(서버가 지역 합으로 계산).
 * 전역 반영은 판이 끝난 뒤 한 번에 일어나므로, 다른 사람의 기여는 다음 참여에서 보입니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, boostReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "GAUGE";
const AD_PER_DAY = 1;

const formatBest = (metric) => `${comma(Math.max(0, -metric))}점`;

const state = { round: null, busy: false, boosted: false };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🇰🇷", title: "오늘의 전국 게이지" });

const run = createEndlessRun({
  game: GAME,
  fresh: false, // 하루 한 번 참여 — 새로고침으로 잃으면 안 됩니다
  boost: { label: "기여 2배", desc: "남은 토큰의 반영량이 두 배가 됩니다" },
  hooks: { onRound: renderRound, onJudged: showVerdict, onOver: onOver, pauseText: () => ({ sub: "", figure: "" }) },
});

$("#startBtn").addEventListener("click", startRun);
$("#pushBtn").addEventListener("click", push);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

async function loadReady() {
  showScreen("ready");
  clearRewards();
  try {
    const st = await runApi.status(GAME);
    renderReady({ attempts: st.attempts, base: st.base_attempts, best: st.my_best, plays: st.my_plays, formatBest });
    $("#playsValue").textContent = st.my_plays > 0 ? `${comma(st.my_plays)}일` : "첫 참여";

    if ((st.attempts?.remaining ?? 0) <= 0) {
      try {
        await run.begin();
        toast("이어서 참여", "good", 1300);
        return;
      } catch {
        /* 진행 중인 참여가 없습니다 */
      }
    }
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
  attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    state.boosted = false;
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 참여를 마쳤어요. 광고를 보면 한 번 더 기여할 수 있어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "참여할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 게이지
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;
  state.round = round;
  state.busy = false;

  $("#hud1").textContent = `${round.pct}%`;
  $("#hud2").textContent = comma(round.my_tokens ?? 0);
  $("#hud3").textContent = String(round.tokens_left ?? 0);
  setHeaderBadge(`${round.pct}%`);

  drawGauge(round);
  $("#pushBtn").disabled = (round.tokens_left ?? 0) <= 0;
  $("#playHint").textContent =
    round.multiplier > 1 ? "기여 2배 적용 중 — 남은 토큰을 밀어 넣으세요" : "토큰을 밀어 넣으세요";

  renderBoostCard(round);
}

function drawGauge(v) {
  $("#gaugePct").textContent = `${v.pct}%`;
  $("#gaugeFill").style.setProperty("--pct", `${v.pct}%`);
  $("#gaugeNum").textContent = `${comma(v.total)} / ${comma(v.target)}`;

  const marks = clear($("#gaugeMarks"));
  for (const s of v.stages ?? []) {
    marks.append(
      el("span", { class: `natgauge__mark ${v.pct >= s ? "is-open" : ""}`, style: `--at:${s}%` },
        el("b", {}, `${s}%`)),
    );
  }

  const tokens = clear($("#gaugeTokens"));
  const total = v.tokens ?? 0;
  const left = v.tokens_left ?? 0;
  for (let i = 0; i < total; i++) {
    tokens.append(el("span", { class: `token ${i < total - left ? "is-used" : ""}` }, "◆"));
  }
}

async function push() {
  if (state.busy || !state.round || (state.round.tokens_left ?? 0) <= 0) return;
  state.busy = true;
  $("#pushBtn").disabled = true;
  navigator.vibrate?.(14);
  await run.answer(0);
  state.busy = false;
}

async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;

  $("#hud1").textContent = `${d.pct}%`;
  $("#hud2").textContent = comma(d.my_tokens ?? 0);
  $("#hud3").textContent = String(d.tokens_left ?? 0);
  drawGauge(d);

  const fill = $("#gaugeFill");
  fill.classList.add("is-bump");
  setTimeout(() => fill.classList.remove("is-bump"), 500);

  if (d.just_opened) {
    toast(`${d.pct}% 단계 해금! 모두가 보상을 받아요`, "good", 2200);
    navigator.vibrate?.([20, 50, 30]);
  } else {
    toast(`+${d.added} 기여`, "good", 900);
  }
}

/** 「기여 2배」는 남은 토큰이 있을 때만 뜻이 있습니다 */
function renderBoostCard(round) {
  const host = $("#adbarBoost");
  if (!host) return;
  clear(host);
  if (state.boosted || (round.tokens_left ?? 0) <= 0 || (round.multiplier ?? 1) > 1) return;

  boostReward(GAME, {
    sessionId: run.state.sessionId,
    label: "기여 2배",
    desc: "남은 토큰의 반영량이 두 배가 됩니다",
    used: 0,
    max: run.state.maxBoosts ?? 1,
    onBoosted: (reward) => {
      state.boosted = true;
      const d = reward?.data ?? {};
      state.round = { ...state.round, ...d };
      drawGauge(state.round);
      $("#playHint").textContent = "기여 2배 적용 중 — 남은 토큰을 밀어 넣으세요";
      clear(host);
    },
  });
}

// ── 결과 ─────────────────────────────────────────────────────

function onOver(result) {
  lastResult = result;
  const d = lastData ?? {};

  renderRunOver(result, {
    figure: `${d.pct ?? 0}%`,
    sub:
      (d.opened ?? 0) > 0
        ? `오늘 ${d.opened}단계가 열렸어요 — 모두가 보상을 받습니다`
        : "아직 첫 단계 전이에요 — 다른 사람들의 기여가 더해집니다",
    tiles: [
      { label: "내 기여", value: comma(d.added_total ?? 0), accent: true },
      { label: "전국", value: `${comma(d.total ?? 0)} / ${comma(state.round?.target ?? 0)}` },
      { label: "획득", value: comma(result.score ?? 0) },
    ],
    formatBest,
  });

  const stages = state.round?.stages ?? [];
  const next = stages.find((s) => (d.pct ?? 0) < s);
  $("#stageText").textContent = next
    ? `다음 단계는 ${next}% — ${comma(Math.max(0, Math.ceil(((next - (d.pct ?? 0)) / 100) * (state.round?.target ?? 0))))} 만큼 남았어요. 내일 목표는 자정에 새로 열립니다.`
    : "오늘 목표를 모두 달성했어요! 내일 새 목표가 열립니다.";

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  clear($("#adbarBoost"));
  statsReward(GAME, { desc: "기여량 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "기여량 분포 · 왼쪽이 많음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
