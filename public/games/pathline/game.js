/**
 * ⑰ 한 줄로 이어요
 *
 * 정답 경로는 서버 secret 입니다. 클라이언트는 지나간 칸을 순서대로 모아 한 번에 보내고,
 * "붙어 있는가 · 다시 밟지 않았는가 · 번호 순서대로인가" 는 전부 서버가 다시 확인합니다.
 * 완성했다는 클라이언트의 주장은 믿지 않습니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun, countdown,
} from "../../shared/run.js";

const GAME = "PATHLINE";
const AD_PER_DAY = 5;

const formatBest = (metric) => `${-metric}점`;

let timer = null;
let lastResult = null;
let round = null;
let trail = [];      // 지금까지 지나온 칸
let next = 2;        // 다음에 밟아야 할 번호
let lastPoints = 0;

renderHeader($("#header"), { icon: "🧵", title: "한 줄로 이어요", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "정답 경로 3칸 공개", desc: "지금 점수는 그대로 두고 같은 판을 힌트와 함께 다시 풉니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#resetBtn").addEventListener("click", resetTrail);
$("#pauseEndBtn").addEventListener("click", () => { stopTimer(); run.end(); });
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
      attempts: st.attempts, base: st.base_attempts,
      best: st.my_best, plays: st.my_plays, formatBest,
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

const cellOfNum = (n) =>
  Number(Object.keys(round.marks).find((k) => round.marks[k] === n));

function onRound(nextRound, state) {
  stopTimer();
  round = nextRound;
  lastPoints = nextRound.points ?? lastPoints;

  setHeaderBadge(`R${nextRound.round}`);
  $("#hudRound").textContent = String(nextRound.round);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });

  resetTrail();
  startTimer(state.limitMs);
}

function resetTrail() {
  if (!round) return;
  trail = [cellOfNum(1)];
  next = 2;
  paint();
}

function paint() {
  $("#nextNum").textContent = next > round.nums ? "완성!" : `${next}번`;
  $("#lenText").textContent =
    `지금 ${trail.length}칸 · 최단 ${round.min_len}칸으로 풀면 보너스`;

  const host = clear($("#tiles"));
  host.style.setProperty("--cols", String(round.w));
  const hinted = new Set(round.hint ?? []);

  for (let i = 0; i < round.w * round.h; i++) {
    const num = round.marks[i];
    const at = trail.indexOf(i);
    let cls = "tile";
    let label = "";

    if (num) {
      cls += at >= 0 ? " is-answer" : " is-num";
      label = String(num);
    } else if (at >= 0) {
      cls += " is-path";
      label = "·";
    } else if (hinted.has(i)) {
      cls += " is-hint";
    }

    host.append(
      el("button", { class: cls, type: "button", onclick: () => step(i) }, label),
    );
  }
}

function isAdjacent(a, b) {
  const ra = Math.floor(a / round.w), ca = a % round.w;
  const rb = Math.floor(b / round.w), cb = b % round.w;
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}

function step(cell) {
  if (next > round.nums) return;
  const cur = trail[trail.length - 1];

  // 바로 앞 칸을 누르면 한 칸 되돌아갑니다.
  if (trail.length >= 2 && cell === trail[trail.length - 2]) {
    const popped = trail.pop();
    if (round.marks[popped] === next - 1) next -= 1;
    paint();
    return;
  }

  if (trail.includes(cell)) { toast("이미 지나간 칸입니다.", "error"); return; }
  if (!isAdjacent(cur, cell)) { toast("붙어 있는 칸으로만 이어갈 수 있습니다.", "error"); return; }

  const num = round.marks[cell];
  if (num && num !== next) { toast(`${next}번을 먼저 지나야 합니다.`, "error"); return; }

  trail.push(cell);
  if (num) next += 1;
  paint();

  if (next > round.nums) {
    stopTimer();
    run.answer([...trail]);
  }
}

// ── 라운드 제한 시간 ─────────────────────────────────────────

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

async function onJudged(res) {
  stopTimer();
  const d = res.data ?? {};

  if (res.correct) {
    lastPoints = d.points ?? lastPoints;
    toast(
      d.shortest
        ? `완성! +${d.gained}점 · 최단 ${d.min_len}칸`
        : `완성! +${d.gained}점 · 내 경로 ${d.len}칸 / 최단 ${d.min_len}칸`,
      "good",
    );
    return;
  }

  // 서버가 무효로 본 경로 — 클라이언트 검사를 통과했더라도 서버 판정이 최종입니다.
  if (d.invalid) { toast(d.invalid, "error"); resetTrail(); return; }
  if (d.timed_out) await new Promise((r) => setTimeout(r, 400));
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText() {
  return {
    sub: "광고를 보면 정답 경로 앞 3칸을 열고 같은 판을 다시 풉니다",
    figure: `${lastPoints}점`,
  };
}

function onOver(result) {
  stopTimer();
  lastResult = result;
  const points = result.score ?? 0;

  renderRunOver(result, {
    figure: String(points),
    unit: "점",
    sub: `${result.cleared}판을 완성했어요`,
    tiles: [
      { label: "완성", value: `${result.cleared}판` },
      { label: "점수", value: `${points}점` },
      { label: "이어하기", value: result.boosted ? "사용" : "없음" },
    ],
    formatBest,
  });

  renderOverRewards();
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
        caption: "점수 분포 · 오른쪽이 높은 점수",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
