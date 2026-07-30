/**
 * ㉒ 3초 탐정
 *
 * 장면을 3초 보여 주고, 가린 뒤 다시 열어 바뀐 하나를 찾게 합니다.
 * 실패가 없어 목숨·이어하기 화면이 없습니다 — 못 찾은 사건은 미해결로 남습니다.
 *
 * 「그 장면 한 번 더 보기」 광고는 **답을 내기 전** 찾는 중에 쓸 수 있게 두었습니다.
 * 기획서 4장 6번은 「못 찾은 직후」로 적었지만, 판정이 끝난 사건은 이미 정답이
 * 밝아진 뒤라 다시 볼 것이 없습니다. 아직 찾고 있을 때 다시 보여 주는 것이
 * 같은 값을 주면서 실제로 도움이 됩니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../../shared/ad.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "DETECTIVE";
const AD_PER_DAY = 3;

const formatBest = (metric) => `${Math.max(0, -metric)}건`;

const state = { round: null, phase: "idle", busy: false, replays: 0, maxReplays: 3 };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🔍", title: "3초 탐정" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "장면 다시 보기", desc: "그 장면을 한 번 더 보여드려요" },
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
  showScreen("ready");
  clearRewards();
  try {
    const st = await runApi.status(GAME);
    renderReady({ attempts: st.attempts, base: st.base_attempts, best: st.my_best, plays: st.my_plays, formatBest });
    const btn = $("#startBtn");
    if (!btn.disabled) btn.textContent = "▶ 사건 열기";
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }
  attemptReward(GAME, { perDay: AD_PER_DAY, onGranted: loadReady });
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    state.replays = 0;
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
// 장면 — 3초 노출 → 가림 → 다시 열기
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;
  state.round = round;
  state.busy = false;
  state.maxReplays = run.state.maxBoosts ?? 3;

  $("#hud1").textContent = `${round.no}/${round.total}`;
  $("#hud2").textContent = String(round.solved_today ?? 0);
  $("#hud3").textContent = comma(round.score ?? 0);
  setHeaderBadge(round.redo ? "재도전 사건" : `사건 ${round.no}`);

  playScene(round);
}

/** 노출 → 가림 → 변경 후 장면. 이 순서가 이 게임의 규칙 설명 전부입니다 */
function playScene(round) {
  state.phase = "expose";
  drawScene(round.icons, false);
  $("#sceneMask").classList.remove("is-on");
  $("#playHint").textContent = round.redo ? "어제 못 찾은 사건이에요 — 잘 보세요" : "3초간 보세요";

  let left = Math.ceil(round.expose_ms / 1000);
  $("#sceneCount").textContent = String(left);
  $("#sceneCount").hidden = false;
  const tick = setInterval(() => {
    left -= 1;
    $("#sceneCount").textContent = String(Math.max(0, left));
    if (left <= 0) clearInterval(tick);
  }, 1000);

  setTimeout(() => {
    clearInterval(tick);
    $("#sceneCount").hidden = true;
    $("#sceneMask").classList.add("is-on");
    state.phase = "mask";

    setTimeout(() => {
      $("#sceneMask").classList.remove("is-on");
      drawScene(round.after, true);
      state.phase = "find";
      $("#playHint").textContent = "무엇이 바뀌었나요? (시간 제한 없음)";
      renderReplayCard();
    }, round.mask_ms);
  }, round.expose_ms);
}

/** 아이콘 격자. 찾는 단계에서만 누를 수 있습니다 */
function drawScene(icons, clickable) {
  const host = clear($("#sceneGrid"));
  const round = state.round;
  host.style.setProperty("--cols", String(round?.cols ?? 4));

  icons.forEach((it, i) => {
    const node = el(
      clickable && !it.gone ? "button" : "div",
      {
        class: `sicon ${it.gone ? "is-gone" : ""}`,
        style: `--at-col:${it.col + 1}; --at-row:${it.row + 1}; --tint:${it.color}`,
        ...(clickable && !it.gone ? { type: "button", "aria-label": `${i + 1}번 ${it.sym}` } : {}),
      },
      it.gone ? "" : it.sym,
    );
    if (clickable) node.addEventListener("click", () => pick(i));
    host.append(node);
  });

  // 사라진 자리는 눌러야 정답이 될 수 있으므로 빈 칸도 버튼으로 둡니다
  if (clickable) {
    icons.forEach((it, i) => {
      if (!it.gone) return;
      const hole = el("button", {
        class: "sicon sicon--hole",
        type: "button",
        style: `--at-col:${it.col + 1}; --at-row:${it.row + 1}`,
        "aria-label": `${i + 1}번 빈 자리`,
      });
      hole.addEventListener("click", () => pick(i));
      host.append(hole);
    });
  }
}

async function pick(i) {
  if (state.busy || state.phase !== "find") return;
  state.busy = true;
  clearRewardCard($("#adbarPlay"));
  await run.answer(i);
  state.busy = false;
}

/** 찾는 중에만 나오는 「장면 다시 보기」 */
function renderReplayCard() {
  const host = $("#adbarPlay");
  if (!host) return;
  clearRewardCard(host);
  if (state.replays >= state.maxReplays) return;

  renderRewardCard(host, {
    icon: "👀",
    title: "광고 보고 장면 다시 보기",
    desc: `이 판에서 ${state.replays}/${state.maxReplays}회 사용 · 찾은 것은 그대로예요`,
    cta: "다시 보기",
    onClick: async () => {
      const res = await watchAdForReward(`${GAME}_BOOST`, { sessionId: run.state.sessionId });
      if (!res) return;
      state.replays += 1;
      clearRewardCard(host);
      playScene(state.round);
    },
  });
}

async function showVerdict(res) {
  const d = res.data ?? {};
  lastData = d;
  state.phase = "locked";
  clearRewardCard($("#adbarPlay"));

  $("#hud2").textContent = String(d.solved_today ?? 0);
  $("#hud3").textContent = comma(d.score ?? 0);

  const grid = $("#sceneGrid");
  const nodes = [...grid.children];
  const answer = nodes.find((n) => n.getAttribute("aria-label")?.startsWith(`${(d.answer_index ?? 0) + 1}번`));

  if (d.hit) {
    answer?.classList.add("is-found");
    toast(d.redo ? "어제 못 찾은 사건 해결! 보너스" : "찾았어요!", "good", 1500);
    navigator.vibrate?.(20);
  } else {
    grid.classList.add("is-nope");
    setTimeout(() => grid.classList.remove("is-nope"), 320);
    answer?.classList.add("is-answer");
    toast("여기였어요 — 미해결로 남습니다", "error", 1800);
  }

  // 판정 직후 입력 잠금 — 다음 장면이 오자마자 잔여 탭이 오답으로 먹히지 않게 (기획서 0절)
  await new Promise((r) => setTimeout(r, state.round?.lock_ms ?? 500));
}

function onOver(result) {
  lastResult = result;
  const d = lastData ?? {};

  renderRunOver(result, {
    figure: String(d.solved_today ?? 0),
    unit: "건",
    sub:
      (d.unsolved_today ?? 0) > 0
        ? `미해결 ${d.unsolved_today}건은 내일 다시 옵니다`
        : "오늘 사건을 모두 해결했어요",
    tiles: [
      { label: "점수", value: comma(result.score ?? 0), accent: true },
      { label: "미해결", value: `${d.unsolved_today ?? 0}건` },
      { label: "누적 해결", value: `${comma(d.solved_total ?? 0)}건` },
    ],
    formatBest,
  });

  $("#caseFileText").textContent =
    (d.unsolved_today ?? 0) > 0
      ? `미해결 ${d.unsolved_today}건 — 내일 그 장면이 그대로 다시 옵니다. 그때 해결하면 재해결 보너스가 붙어요.`
      : `해결 ${d.solved_today ?? 0}건 · 재해결 ${d.redone_today ?? 0}건. 내일 새 사건 ${state.round?.total ?? 5}건이 옵니다.`;

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  clearRewardCard($("#adbarPlay"));
  statsReward(GAME, { desc: "해결 건수 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "해결한 사건 수 분포 · 왼쪽이 많음",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
