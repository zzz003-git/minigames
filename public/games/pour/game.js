/**
 * ㉕ 오늘의 한 잔
 *
 * 병을 누르고 있으면 색이 쏟아지고 떼면 그 층이 확정됩니다.
 *
 * ── 조작이 누름 지속입니다 ───────────────────────────────────────────────
 * 규격(탭 1종류)을 벗어납니다 — docs/pour-game.md. 손맛이 이 기획의 존재 이유라
 * 탭으로 바꾸면 게임이 남지 않습니다(기획서 5장).
 * 키보드·보조기기는 **Enter 를 누르고 있는 동안** 같은 값이 오르게 두었습니다.
 *
 * 부은 양은 화면이 계산해 보내고, 서버는 **누른 시간과 양이 비례하는지** 검사합니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, statsReward, boostReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "POUR";

const GRADE_NAME = { perfect: "딱 맞음", near: "근접", loose: "여유", over: "넘침" };
/** rank_metric = 목표선과의 차이 × 1000 (작을수록 상위) */
const formatBest = (metric) => (metric >= 1000 ? "넘침" : metric <= 30 ? "딱 맞음" : metric <= 80 ? "근접" : "여유");

const state = { round: null, pouring: false, raf: 0, t0: 0, amount: 0, busy: false };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🥤", title: "오늘의 한 잔" });

const run = createEndlessRun({
  game: GAME,
  fresh: false, // 하루 한 잔 — 새로고침으로 그날을 잃으면 안 됩니다
  boost: { label: "그 층만 다시 붓기", desc: "다시 부어도 지금 층은 그대로예요" },
  hooks: { onRound: renderRound, onJudged: showVerdict, onOver: onOver, pauseText: () => ({ sub: "", figure: "" }) },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

async function loadReady() {
  stopPour();
  showScreen("ready");
  clearRewards();

  try {
    const st = await runApi.status(GAME);
    renderReady({ attempts: st.attempts, base: st.base_attempts, best: st.my_best, plays: st.my_plays, formatBest });
    $("#playsValue").textContent = st.my_plays > 0 ? `${comma(st.my_plays)}잔` : "첫 잔";
    const btn = $("#startBtn");
    btn.textContent = btn.disabled ? "내일 잔을 기다려 주세요" : "▶ 잔 받기";

    // 기회가 0이면 새 런이 생길 수 없으므로 이어받기를 시도해도 안전합니다
    if ((st.attempts?.remaining ?? 0) <= 0) {
      try {
        await run.begin();
        toast("이어서 붓기", "good", 1300);
        return;
      } catch {
        /* 진행 중인 런이 없습니다 */
      }
    }
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
  // 잔을 더 주는 광고는 없습니다 (기획서 8장)
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 잔은 다 썼어요. 내일 밤 12시에 새 잔이 도착합니다.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "잔을 받을 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 잔 · 붓기
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;
  state.round = round;
  state.busy = false;
  state.amount = 0;

  $("#hud1").textContent = `${round.poured}/${round.total_layers}`;
  $("#hud2").textContent = `${Math.round(round.target * 100)}%`;
  $("#hud3").textContent = comma(round.score ?? 0);
  setHeaderBadge(`${round.no}번째 층`);
  $("#playHint").textContent = `${round.bottle.name} 병을 꾹 누르세요 (떼면 확정)`;

  $("#cupTarget").style.setProperty("--at", `${(round.target * 100).toFixed(1)}%`);
  drawLayers(round.layers, 0);
  drawBottles(round);
}

/** 층을 아래에서부터 쌓아 그립니다. 마지막에 지금 붓고 있는 양을 얹습니다 */
function drawLayers(layers, extra) {
  const host = clear($("#cupLiquid"));
  let acc = 0;
  for (const l of layers ?? []) {
    host.append(el("span", { class: "cup__layer", style: `--h:${(l.amount * 100).toFixed(2)}%; --c:${l.hex}` }));
    acc += l.amount;
  }
  if (extra > 0) {
    const hex = state.round?.bottle?.hex ?? "#fff";
    host.append(el("span", { class: "cup__layer is-pouring", style: `--h:${(extra * 100).toFixed(2)}%; --c:${hex}` }));
    acc += extra;
  }
  const level = Math.min(1, acc);
  $("#cup").classList.toggle("is-over", level > (state.round?.target ?? 1) + 0.001);
  $("#cup").style.setProperty("--level", `${(level * 100).toFixed(1)}%`);
}

/** 병 세 개. 지금 부을 병만 누를 수 있습니다 */
function drawBottles(round) {
  const host = clear($("#bottles"));
  (round.bottles ?? []).forEach((b, i) => {
    const active = i === round.no - 1;
    const node = el(
      active ? "button" : "div",
      {
        class: `bottle ${active ? "is-active" : ""} ${i < round.no - 1 ? "is-used" : ""}`,
        style: `--c:${b.hex}`,
        ...(active ? { type: "button", "aria-label": `${b.name} 붓기 — 누르고 있으면 쏟아집니다` } : {}),
      },
      el("span", { class: "bottle__name" }, b.name),
    );
    if (active) attachPour(node);
    host.append(node);
  });
}

/** 누르고 있는 동안 양이 오릅니다. 떼면 그 값으로 확정합니다 */
function attachPour(node) {
  const begin = (e) => {
    if (state.busy || state.pouring) return;
    e.preventDefault();
    state.pouring = true;
    state.t0 = performance.now();
    state.amount = 0;
    node.classList.add("is-pouring");
    const step = () => {
      if (!state.pouring) return;
      const held = Math.min(state.round.max_hold_ms, performance.now() - state.t0);
      state.amount = Math.min(1, (held / 1000) * state.round.rate);
      drawLayers(state.round.layers, state.amount);
      if (held >= state.round.max_hold_ms) {
        end();
        return;
      }
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  };

  const end = () => {
    if (!state.pouring) return;
    state.pouring = false;
    cancelAnimationFrame(state.raf);
    node.classList.remove("is-pouring");

    // 양은 **시계에서 직접** 계산합니다. rAF 틱에 의존하면 탭이 백그라운드로 가거나
    // 절전 상태일 때 프레임이 멈춰 부은 양이 0 이 됩니다(브라우저 확인에서 걸렸습니다).
    // rAF 는 그리기용이고, 값의 출처는 언제나 단조 증가 시계여야 합니다.
    const held = Math.min(state.round.max_hold_ms, performance.now() - state.t0);
    state.amount = Math.min(1, (held / 1000) * state.round.rate);

    commit();
  };

  node.addEventListener("pointerdown", begin);
  node.addEventListener("pointerup", end);
  node.addEventListener("pointerleave", end);
  node.addEventListener("pointercancel", end);
  // 키보드·보조기기 — Enter/Space 를 누르고 있는 동안 같은 값이 오릅니다
  node.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.key === "Enter" || e.key === " ") begin(e);
  });
  node.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") end();
  });
}

function stopPour() {
  state.pouring = false;
  cancelAnimationFrame(state.raf);
}

async function commit() {
  if (state.busy) return;
  const amount = state.amount;
  if (amount <= 0.005) return; // 살짝 스친 것은 붓지 않은 것으로 봅니다

  state.busy = true;
  const held = Math.round((amount / state.round.rate) * 1000);
  navigator.vibrate?.(16);
  await run.answer({ amount: Number(amount.toFixed(3)) }, { elapsed_ms: held });
  state.busy = false;
}

async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;
  state.amount = 0;

  $("#hud1").textContent = `${d.poured}/${d.total_layers}`;
  $("#hud3").textContent = comma(d.score ?? 0);
  drawLayers(d.layers, 0);

  if (d.grade === "perfect") toast("딱 맞았어요!", "good", 1600);
  else if (d.grade === "over") toast("아, 살짝 넘쳤어요", "error", 1600);
  else if (d.new_mix) toast("새 색 조합 발견!", "good", 1600);
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function onOver(result) {
  stopPour();
  lastResult = result;
  const d = lastData ?? {};
  const grade = d.grade ?? "loose";

  renderRunOver(result, {
    figure: GRADE_NAME[grade] ?? "완성",
    sub:
      grade === "over"
        ? "넘쳤지만 층은 그대로 남았어요 — 층당 포인트는 전액 받았습니다"
        : grade === "perfect"
          ? "목표선에 딱 맞췄어요"
          : "목표선까지 조금 남았어요",
    tiles: [
      { label: "획득", value: comma(result.score ?? 0), accent: true },
      { label: "목표선 차이", value: d.gap == null ? "—" : `${Math.round(d.gap * 100)}%` },
      { label: "새 조합", value: d.new_mix ? "발견!" : "없음" },
    ],
    formatBest,
  });

  const mix = (d.layers ?? []).map((l) => l.key).join(" · ");
  $("#albumText").textContent = d.new_mix
    ? `처음 만든 조합이에요 — ${mix}. 앨범에 남았습니다. 내일은 새 목표선이 옵니다.`
    : `${mix} — 앨범에 있는 조합이에요. 내일은 새 목표선과 새 병이 옵니다.`;

  renderOverRewards();

  // 넘친 판에서만 구원 광고를 제안합니다 (기획서 8장)
  if (grade === "over" && (result.boosted ? 1 : 0) < 1) {
    boostReward(GAME, {
      sessionId: run.state.sessionId,
      label: "그 층만 다시 붓기",
      desc: "다시 부어도 지금 층은 그대로예요",
      used: 0,
      max: run.state.maxBoosts ?? 1,
      onBoosted: () => {
        toast("마지막 층을 걷어냈어요 — 다시 부어 보세요", "good", 1600);
        loadReady();
      },
    });
  }
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "목표선 차이 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "목표선과의 차이 분포 · 왼쪽이 정확함",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
