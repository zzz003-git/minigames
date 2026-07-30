/**
 * ㉔ 밸런스 드롭
 *
 * 물건을 좌우로 밀어 자리를 정하고 떨어뜨려 저울을 초록 구간에 맞춥니다.
 *
 * ── 조작이 탭 하나가 아닙니다 ────────────────────────────────────────────
 * 위치를 정하는 조작이 필요해 규격(탭 1종류)을 벗어납니다 — docs/balance-game.md.
 * 위치 입력을 **`<input type="range">`** 로 둔 것은 접근성 때문입니다. 드래그로도
 * 움직이고, 키보드 화살표로도 같은 값을 만들 수 있으며 스크린리더가 값을 읽습니다.
 *
 * 화면의 흔들림은 연출이고 판정은 서버의 토크 계산입니다. 시각을 신고하지 않으므로
 * 시간 조작 경로가 없습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "BALANCE";
const AD_PER_DAY = 3;
/** 저울이 기우는 최대 각도 — 토크를 각도로 옮길 때만 씁니다(연출) */
const MAX_TILT_DEG = 14;

const formatBest = (metric) => `LV ${Math.max(0, -metric)}`;

const state = { round: null, busy: false };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "⚖", title: "밸런스 드롭" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "한 개 더 놓기", desc: "지금 저울 상태 그대로 하나를 더 놓습니다" },
  hooks: { onRound: renderRound, onJudged: showVerdict, onOver: onOver, pauseText: pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#dropBtn").addEventListener("click", drop);
$("#posRange").addEventListener("input", moveHand);
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
// 저울
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;
  state.round = round;
  state.busy = false;

  $("#hud1").textContent = String(round.level);
  $("#hud2").textContent = round.torque.toFixed(1);
  $("#hud3").textContent = comma(round.score ?? 0);
  setHeaderBadge(`LV ${round.level}`);

  $("#dropWeight").textContent = String(round.drop_w);
  $("#posRange").value = "60";
  $("#dropBtn").disabled = false;
  $("#playHint").textContent = "밀어서 자리를 정하고 떨어뜨리세요";

  drawItems(round.items);
  drawZone(round.tol, round.torque);
  moveHand();
}

/** 접시에 얹힌 물건 — 무게가 전부 보입니다(숨기면 기대값 게임이 됩니다) */
function drawItems(items) {
  const host = clear($("#scaleItems"));
  for (const it of items) {
    host.append(
      el(
        "span",
        { class: "scale__item", style: `--at:${(it.pos * 50 + 50).toFixed(1)}%` },
        el("b", {}, String(it.w)),
      ),
    );
  }
}

/** 초록 목표 구간과 바늘. 오차를 숫자로 쓰지 않는 것이 기획서 0절의 요구입니다 */
function drawZone(tol, torque) {
  const zone = $("#scaleZone");
  // 토크 ±6 을 게이지 폭 전체로 봅니다
  const pct = (v) => Math.max(0, Math.min(100, (v / 6) * 50 + 50));
  zone.style.setProperty("--zone-a", `${pct(-tol)}%`);
  zone.style.setProperty("--zone-b", `${pct(tol)}%`);
  $("#scaleNeedle").style.setProperty("--at", `${pct(torque)}%`);
  $("#scaleBeam").style.setProperty(
    "--tilt",
    `${Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, (torque / 6) * MAX_TILT_DEG)).toFixed(2)}deg`,
  );
}

function moveHand() {
  const v = Number($("#posRange").value) / 100;
  $("#scaleHand").style.setProperty("--at", `${(v * 50 + 50).toFixed(1)}%`);
}

async function drop() {
  if (state.busy || !state.round) return;
  state.busy = true;
  $("#dropBtn").disabled = true;

  const pos = Number($("#posRange").value) / 100;
  navigator.vibrate?.(14);
  await run.answer({ pos: Number(pos.toFixed(2)) });
  state.busy = false;
}

async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;

  if (d.invalid) {
    toast(d.invalid, "error", 1400);
    $("#dropBtn").disabled = false;
    return;
  }

  drawItems(d.items ?? []);
  drawZone(d.tol ?? 1, d.torque ?? 0);
  $("#hud2").textContent = (d.torque ?? 0).toFixed(1);
  $("#hud3").textContent = comma(d.score ?? 0);

  const beam = $("#scaleBeam");
  beam.classList.add("is-swing");
  setTimeout(() => beam.classList.remove("is-swing"), 700);

  if (res.correct) toast("수평! 초록 구간에 들어왔어요", "good", 1300);
  else if (d.off != null) toast(`${d.off.toFixed(1)} 만큼 벗어났어요`, "error", 1700);

  // 저울이 멈출 때까지 기다립니다 — 그 시간 동안 광고 버튼을 띄우지 않습니다(기획서 0절)
  await new Promise((r) => setTimeout(r, 650));
}

function pauseText(st) {
  const d = lastData ?? {};
  return {
    sub: d.off != null ? `${d.off.toFixed(1)} 만큼 벗어났어요 — 한 개 더 놓으면 맞출 수 있어요` : `LV ${st.cleared} 까지 왔어요`,
    figure: `LV ${st.cleared}`,
  };
}

function onOver(result) {
  lastResult = result;
  renderRunOver(result, {
    figure: `LV ${result.cleared ?? 0}`,
    sub: (result.cleared ?? 0) >= 5 ? "지레를 제대로 쓰고 있어요" : "접시 중심에서 멀수록 힘이 세집니다",
    tiles: [
      { label: "점수", value: comma(result.score ?? 0), accent: true },
      { label: "마지막 기울기", value: (lastData?.torque ?? 0).toFixed(1) },
      { label: "목표 구간", value: `±${(lastData?.tol ?? 0).toFixed(2)}` },
    ],
    formatBest,
  });
  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "도달 레벨 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "도달 레벨 분포 · 왼쪽이 높음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
