/**
 * ㉙ 소등
 *
 * 캄캄한 화면의 불빛을 하나씩 꾹 눌러 끄고, 완전한 어둠까지 걸린 시간을 겨룹니다.
 *
 * ── 조작이 누름 지속입니다 ───────────────────────────────────────────────
 * 아케이드 규격은 「조작은 탭 1종류」인데 이 게임은 **누르고 있기**입니다. 손맛(진동이
 * 잦아들다 툭 멎는 감각)이 기획의 존재 이유라 탭으로 바꾸면 게임이 남지 않습니다.
 * 벗어난 항목과 대체 경로는 docs/lightout-game.md §1.
 *
 * ── 화면 전체가 밝아지는 연출을 어디에도 넣지 않습니다 ───────────────────
 * 취침 맥락이 이 기획의 전제입니다(기획서 3장 · 화면 밝기 최저 · 누운 채). 결과 화면,
 * 광고 진입, 보상 팝업 어디에서도 화면이 번쩍이면 그 전제가 무너집니다. `celebrate`
 * 를 쓰지 않고 축하도 잔광으로만 합니다.
 *
 * ── 시간의 출처는 언제나 단조 증가 시계입니다 ────────────────────────────
 * rAF 는 그리기용이고, 누른 시간은 performance.now() 차이로 직접 잽니다. rAF 틱에
 * 의존하면 절전·백그라운드에서 프레임이 멈춰 누른 시간이 0 이 됩니다 (㉕ 에서 걸렸습니다).
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, statsReward, createEndlessRun, armScreen,
} from "../../shared/run.js";

const GAME = "LIGHTOUT";

/** rank_metric = 방을 끄는 데 걸린 ms (작을수록 상위) */
const secText = (ms) => `${(ms / 1000).toFixed(1)}초`;
const formatBest = (metric) => (metric == null || metric >= 600000 ? "—" : secText(metric));

/** 마지막 불빛이 꺼진 뒤 완전한 검정으로 두는 시간 (기획서 4장 6번) */
const BLACKOUT_MS = 600;
/** 화면이 바뀐 직후 그 화면의 버튼을 못 누르게 두는 시간 (기획서 8장 0-H) */
const ARM_DELAY_MS = 400;

const state = {
  lights: [], // { spec, node, glow }
  left: 0,
  holding: null, // 지금 누르고 있는 불빛
  holdT0: 0,
  raf: 0,
  roomT0: 0, // 첫 접촉 시각 — 여기서부터 기록이 흐릅니다
  holds: [], // [{ i, ms }]
  locked: true, // 판정 중·화면 전환 중에는 손을 받지 않습니다
  busy: false,
};

let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🌙", title: "소등" });

const run = createEndlessRun({
  game: GAME,
  boost: {
    label: "이 방, 한 번 더",
    // 기획서 8장 ⓐ — 「손해 없음」을 버튼에 문자로 적습니다.
    // 서버가 **더 빠를 때만** 오늘 기록을 갱신하므로 쓸 수 있는 문구입니다.
    desc: "다시 해도 지금 기록은 그대로, 더 빠를 때만 바뀌어요",
  },
  hooks: { onRound: renderRoom, onJudged: showVerdict, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ══════════════════════════════════════════════════════════════
// 시작 화면
// ══════════════════════════════════════════════════════════════

async function loadReady() {
  stopHold();
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
    $("#playsValue").textContent = st.my_plays > 0 ? `${comma(st.my_plays)}방` : "첫 방";
    const btn = $("#startBtn");
    btn.textContent = btn.disabled ? "오늘 방을 다 껐어요" : "▶ 방 들어가기";

    // 기회가 0이면 새 런이 생길 수 없으므로 이어받기를 시도해도 안전합니다.
    // 하루 3방뿐이라 새로고침 한 번으로 방을 잃으면 안 됩니다 (⑲⑳㉕ 과 같은 처리).
    if ((st.attempts?.remaining ?? 0) <= 0) {
      try {
        await run.begin();
        toast("이어서 끄기", "good", 1300);
      } catch {
        /* 진행 중인 방이 없습니다 */
      }
    }
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
  // 방을 더 주는 광고는 없습니다 (기획서 7장)
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 방은 다 껐어요. 내일 밤 12시에 새 방이 열립니다.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "방에 들어갈 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 방
// ══════════════════════════════════════════════════════════════

const room = $("#room");

function renderRoom(round) {
  if (!round) return;
  stopHold();

  state.lights = [];
  state.holds = [];
  state.left = (round.lights ?? []).length;
  state.roomT0 = 0;
  state.busy = false;

  setHeaderBadge(`${round.room_no}번째 방`);
  $("#hudLeft").textContent = String(state.left);
  $("#hudYesterday").textContent = round.yesterday_ms == null ? "—" : secText(round.yesterday_ms);
  $("#playHint").textContent = "불빛 하나를 꾹 눌러 보세요";

  clear(room);
  room.style.setProperty("--dark", "0");

  for (const l of round.lights ?? []) {
    // 오래 눌러야 하는 불빛일수록 큽니다 — 「크기에 따라 0.4~0.8초」(기획서 4장 2번)를
    // 눈으로 알 수 있게 합니다. 글로 설명하지 않아도 손이 먼저 압니다.
    const size = 0.5 + (l.hold_ms - 400) / 400; // 0.5 ~ 1.5
    const node = el("button", {
      class: "lamp",
      type: "button",
      style: `--x:${(l.x * 100).toFixed(2)}%; --y:${(l.y * 100).toFixed(2)}%; --s:${size.toFixed(2)}`,
      "aria-label": `불빛 ${l.i + 1} — 누르고 있으면 꺼집니다`,
    }, el("span", { class: "lamp__glow", "aria-hidden": "true" }));

    attachHold(node, l);
    room.append(node);
    state.lights.push({ spec: l, node });
  }

  armAfter();
}

/** 화면을 바꾼 직후에는 손을 받지 않습니다 (기획서 8장 0-H) */
function armAfter(ms = ARM_DELAY_MS) {
  state.locked = true;
  room.classList.add("is-locked");
  setTimeout(() => {
    state.locked = false;
    room.classList.remove("is-locked");
  }, ms);
}

/**
 * 누르고 있는 동안 빛이 사그라들고, 떼면 **그 불빛만** 원래 밝기로 돌아옵니다.
 * 이미 꺼진 것은 다시 켜지지 않습니다 (기획서 4장 4번).
 */
function attachHold(node, spec) {
  const begin = (e) => {
    if (state.locked || state.busy || state.holding) return;
    e.preventDefault();

    // 기록은 **첫 접촉**부터 흐릅니다 — 방에 들어와 화면을 보는 동안은 세지 않습니다
    if (!state.roomT0) state.roomT0 = performance.now();

    state.holding = { node, spec };
    state.holdT0 = performance.now();
    node.classList.add("is-fading");
    node.style.setProperty("--hold", `${spec.hold_ms}ms`);
    buzz(spec.hold_ms);

    const step = () => {
      if (!state.holding) return;
      const held = performance.now() - state.holdT0;
      if (held >= spec.hold_ms) {
        extinguish();
        return;
      }
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  };

  const cancel = () => {
    if (!state.holding || state.holding.node !== node) return;
    // 다 눌렀는데 rAF 가 늦어 아직 안 꺼진 경우 — 시계가 기준입니다(파일 상단 주석)
    if (performance.now() - state.holdT0 >= spec.hold_ms) {
      extinguish();
      return;
    }
    stopHold();
    node.classList.remove("is-fading");
    navigator.vibrate?.(0);
  };

  node.addEventListener("pointerdown", begin);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("pointercancel", cancel);
  // 키보드·보조기기 — Enter/Space 를 누르고 있는 동안 같은 값이 흐릅니다 (㉕ 과 같은 방식)
  node.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.key === "Enter" || e.key === " ") begin(e);
  });
  node.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") cancel();
  });
}

function stopHold() {
  state.holding = null;
  cancelAnimationFrame(state.raf);
}

/**
 * 진동 감쇠 — 강→약→정지 (기획서 10장).
 * 진동을 끈 기기에서는 아무 일도 일어나지 않고, 잔광의 수축이 그 자리를 대신합니다.
 */
function buzz(holdMs) {
  const steps = 5;
  const pattern = [];
  for (let i = 0; i < steps; i++) {
    const on = Math.max(4, Math.round((holdMs / steps) * 0.5 * (1 - i / steps)));
    pattern.push(on, Math.max(4, Math.round(holdMs / steps) - on));
  }
  navigator.vibrate?.(pattern);
}

/** 다 눌렀습니다 — 툭 */
function extinguish() {
  const held = state.holding;
  if (!held) return;
  const ms = Math.round(performance.now() - state.holdT0);
  stopHold();
  navigator.vibrate?.(0);

  held.node.classList.remove("is-fading");
  held.node.classList.add("is-out");
  held.node.disabled = true;
  state.holds.push({ i: held.spec.i, ms });
  state.left -= 1;
  $("#hudLeft").textContent = String(state.left);

  // 어두워질수록 남은 불빛의 잔광이 넓어집니다 — 어둠 속에서 못 찾는 일이 없게
  // (기획서 4장 5번). 화면이 밝아지는 것이 아니라 남은 것이 도드라지는 것입니다.
  const done = 1 - state.left / Math.max(1, state.lights.length);
  room.style.setProperty("--dark", done.toFixed(3));

  if (state.left > 0) {
    $("#playHint").textContent = state.left <= 3 ? "거의 다 꺼졌어요" : "다음 불빛";
    return;
  }

  finishRoom();
}

/** 마지막 하나가 꺼졌습니다 — 완전한 검정 0.6초 뒤에 제출합니다 (기획서 4장 6번) */
async function finishRoom() {
  state.busy = true;
  state.locked = true;
  room.classList.add("is-blackout");
  $("#playHint").textContent = "";

  const totalMs = Math.round(performance.now() - state.roomT0);
  await new Promise((r) => setTimeout(r, BLACKOUT_MS));

  await run.answer({ holds: state.holds, total_ms: totalMs }, { elapsed_ms: totalMs });
}

// ══════════════════════════════════════════════════════════════
// 판정 결과
// ══════════════════════════════════════════════════════════════

async function showVerdict(res) {
  const d = res.data ?? {};

  if (d.invalid) {
    // 방이 아직 살아 있습니다 — 다시 끄면 됩니다
    toast(d.invalid, "error", 1600);
    room.classList.remove("is-blackout");
    state.busy = false;
    armAfter();
    return;
  }

  lastData = d;
  room.classList.remove("is-blackout");
}

/** [pause] — 어제보다 느렸을 때만 옵니다 (빨랐으면 서버가 곧장 결과로 보냅니다) */
function pauseText() {
  // 마지막 불빛이 꺼지는 순간 손가락은 화면 어딘가에 닿아 있습니다 (기획서 8장 0-H)
  armScreen("pause", ARM_DELAY_MS);
  const d = lastData ?? {};
  return {
    figure: d.room_ms == null ? "—" : secText(d.room_ms),
    sub:
      d.yesterday_ms == null
        ? "오늘의 기록이 내일의 기준이 됩니다"
        : `어제는 ${secText(d.yesterday_ms)}였어요`,
  };
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function onOver(result) {
  stopHold();
  const d = lastData ?? {};
  armScreen("over", ARM_DELAY_MS);

  renderRunOver(result, {
    figure: d.room_ms == null ? "—" : (d.room_ms / 1000).toFixed(1),
    unit: d.room_ms == null ? "" : "초",
    sub:
      d.yesterday_ms == null
        ? "오늘의 기록이 내일의 기준이 됩니다"
        : d.faster
          ? `어제 ${secText(d.yesterday_ms)}보다 빨랐어요`
          : `어제는 ${secText(d.yesterday_ms)}였어요`,
    tiles: [
      { label: "획득", value: comma(result.score ?? 0), accent: true },
      { label: "끈 불빛", value: `${d.light_count ?? 0}개` },
      { label: "어제", value: d.yesterday_ms == null ? "—" : secText(d.yesterday_ms) },
    ],
    formatBest,
  });

  // 「즉시 재도전」이 아니라 **내일**로 향하는 것이 이 게임의 정직한 형태입니다
  // (기획서 12장 킬 테스트 ③ · 취침 맥락).
  const note = $("#overNote");
  if (note && !result.suspect) {
    note.textContent =
      (result.attempts?.remaining ?? 0) > 0
        ? `오늘 남은 방 ${result.attempts.remaining}개`
        : "오늘의 방을 다 껐어요. 화면은 이미 까맣습니다.";
  }

  lastResult = result;
  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "소등 시간 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "소등 시간 분포 · 왼쪽이 빠름",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
