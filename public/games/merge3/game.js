/**
 * ㉖ 세 칸 쌓기
 *
 * 세 기둥 중 하나를 눌러 맨 위에 쌓고, 바로 아래와 같으면 붙어 커집니다.
 * 조작은 **기둥 탭 하나**이고, 규격을 벗어나는 것은 한 판 길이(1~3분)입니다 —
 * docs/merge3-game.md.
 *
 * 연쇄가 이 게임의 재미 전부라 소리를 반음씩 올립니다(기획서 4장 4번).
 * 오디오는 사용자 조작 직후에만 울리므로 브라우저 자동재생 정책에 걸리지 않습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "MERGE3";
const AD_PER_DAY = 3;

const formatBest = (metric) => `${Math.max(0, Math.ceil(-metric / 1000))}단계`;

const state = { round: null, busy: false, audio: null };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🪙", title: "세 칸 쌓기" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "맨 위 하나 치우기", desc: "지금 점수와 최고 등급은 그대로 두고 가장 높은 기둥의 맨 위만 걷어냅니다" },
  hooks: { onRound: renderRound, onJudged: showVerdict, onOver: onOver, pauseText: pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#pauseEndBtn").addEventListener("click", () => run.end());
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
      toast("오늘 기회를 모두 썼어요. 광고를 보면 한 번 더 할 수 있어요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 기둥
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;
  state.round = round;
  state.busy = false;

  $("#hud1").textContent = round.best_name;
  $("#hud2").textContent = String(round.merges ?? 0);
  $("#hud3").textContent = comma(round.score ?? 0);
  setHeaderBadge(round.best_name);

  $("#mergeNext").textContent = round.next.icon;
  $("#mergeNext").setAttribute("aria-label", `다음: ${round.next.name}`);
  $("#playHint").textContent = `${round.next.name} — 같은 것 위에 놓으면 커집니다 (상한 ${round.height})`;

  drawCols(round);
}

function drawCols(round) {
  const host = clear($("#mergeCols"));
  round.cols.forEach((col, i) => {
    const stack = el("span", { class: "pillar__stack" });
    // 아래에서 위로 쌓이므로 역순으로 그립니다
    [...col].reverse().forEach((t) => {
      stack.append(el("span", { class: "tile", title: t.name }, t.icon));
    });

    const full = col.length >= round.height;
    const node = el(
      "button",
      {
        class: `pillar ${full ? "is-full" : ""}`,
        type: "button",
        "aria-label": `${i + 1}번 기둥 (${col.length}/${round.height}) — ${col.length ? col[col.length - 1].name + " 위에 놓기" : "비어 있음"}`,
      },
      stack,
      el("span", { class: "pillar__cap" }, `${col.length}/${round.height}`),
    );
    node.addEventListener("click", () => place(i));
    host.append(node);
  });
}

async function place(i) {
  if (state.busy || !state.round) return;
  state.busy = true;
  await run.answer(i);
  state.busy = false;
}

/** 연쇄마다 반음 올라가는 소리 — 이 게임의 보상 신호입니다 */
function chime(step) {
  try {
    state.audio ??= new (window.AudioContext ?? window.webkitAudioContext)();
    const ctx = state.audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440 * Math.pow(2, step / 12);
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.stop(ctx.currentTime + 0.24);
  } catch {
    /* 소리는 없어도 게임은 성립합니다 */
  }
}

async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;

  if (d.invalid) {
    toast(d.invalid, "error", 1200);
    return;
  }

  $("#hud1").textContent = d.best_name;
  $("#hud2").textContent = String(d.merges ?? 0);
  $("#hud3").textContent = comma(d.score ?? 0);
  drawCols({ ...state.round, ...d });

  if (d.chain > 0) {
    for (let s = 0; s < d.chain; s++) setTimeout(() => chime(s * 2), s * 130);
    navigator.vibrate?.(12 + d.chain * 6);
    if (d.chain >= 2) toast(`${d.chain}연쇄! +${d.points}`, "good", 1500);
    else if (d.top) toast(`${d.top.name}!`, "good", 1000);
  }
}

function pauseText(st) {
  const d = lastData ?? {};
  return {
    sub: `${d.best_name ?? "동전"} 까지 키웠어요 — 맨 위를 하나 치우면 계속할 수 있어요`,
    figure: d.best_name ?? "-",
  };
}

function onOver(result) {
  lastResult = result;
  const d = lastData ?? {};

  renderRunOver(result, {
    figure: d.best_name ?? "동전",
    sub: (d.merges ?? 0) >= 10 ? "연쇄를 잘 쓰고 있어요" : "같은 것을 아래에 모아 두면 연쇄가 터집니다",
    tiles: [
      { label: "점수", value: comma(result.score ?? 0), accent: true },
      { label: "합체", value: `${d.merges ?? 0}회` },
      { label: "최고 연쇄", value: `${result.detail?.chain_best ?? d.chain ?? 0}단` },
    ],
    formatBest,
  });

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "최고 등급 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "도달 등급 분포 · 왼쪽이 높음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
