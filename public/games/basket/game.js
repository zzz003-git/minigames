/**
 * ⑯ 딱 맞게 담기
 *
 * 서버가 가격표와 목표 금액을 만들고(목표는 실제 조합의 합이라 해가 항상 있습니다),
 * 클라이언트는 "몇 번 상품을 담았는가" 만 보냅니다. 채점은 전부 서버가 합니다.
 *
 * 시간 제한이 없으므로 타이머가 없습니다 — 압박은 남은 시도 횟수가 만듭니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderLives, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "BASKET";
const AD_PER_DAY = 5;

/** rank_metric = -점수 */
const formatBest = (metric) => `${-metric}점`;

const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;

let lastResult = null;
let round = null;
let picked = new Set();
let lastPoints = 0;

renderHeader($("#header"), { icon: "🧺", title: "딱 맞게 담기", badge: "R1" });

const run = createEndlessRun({
  game: GAME,
  boost: { label: "상품 1개 교체 + 시도 1회", desc: "지금 점수는 그대로 두고 같은 문제를 한 번 더 풉니다" },
  hooks: { onRound, onJudged, onOver, pauseText },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
$("#submitBtn").addEventListener("click", submit);
$("#clearBtn").addEventListener("click", () => { picked.clear(); paint(); });
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

function onRound(next, state) {
  // 같은 문제를 다시 받은 것인지(시도만 줄어든 것) 새 문제인지 구분합니다.
  const sameProblem = round && round.target === next.target && round.round === next.round;
  round = next;
  if (!sameProblem) picked.clear();
  lastPoints = next.points ?? lastPoints;

  setHeaderBadge(`R${next.round}`);
  $("#hudRound").textContent = String(next.round);
  renderLives($("#hudLives"), { lives: state.lives, max: state.maxLives });
  paint();
}

function paint() {
  $("#hudTries").textContent = `${round.tries_left}회`;
  $("#targetValue").textContent = won(round.target);

  const sum = [...picked].reduce((acc, i) => acc + round.items[i].price, 0);
  const gap = round.target - sum;
  $("#sumText").textContent = gap === 0
    ? `담은 합계 ${won(sum)} · 정확히 맞았습니다`
    : `담은 합계 ${won(sum)} · ${won(Math.abs(gap))} ${gap > 0 ? "모자랍니다" : "넘었습니다"}`;
  $("#tolText").textContent = round.tolerance === 0
    ? "오차 0원 — 정확히 맞아야 합니다"
    : `허용 오차 ±${won(round.tolerance)}`;

  const host = clear($("#items"));
  round.items.forEach((item, i) => {
    host.append(
      el("button", {
        // 선택 상태는 기존 디자인 시스템의 .choice.is-hit 을 그대로 씁니다
        // (base.css 에 없는 클래스를 새로 만들면 스타일이 조용히 빠집니다)
        class: `choice${picked.has(i) ? " is-hit" : ""}`,
        type: "button",
        onclick: () => {
          if (picked.has(i)) picked.delete(i); else picked.add(i);
          paint();
        },
      }, [
        el("span", { class: "choice__title" }, item.name),
        el("span", { class: "choice__sub" }, won(item.price)),
      ]),
    );
  });

  $("#submitBtn").textContent = `담기 완료 (남은 시도 ${round.tries_left}회)`;
}

function submit() {
  $("#submitBtn").disabled = true;
  run.answer([...picked]);
}

async function onJudged(res) {
  $("#submitBtn").disabled = false;
  const d = res.data ?? {};

  if (res.correct) {
    const parts = [`+${d.gained}점`];
    if (d.perfect) parts.push("오차 0원");
    if (d.first_try) parts.push("첫 시도");
    lastPoints = d.points ?? lastPoints;
    toast(`통과! ${parts.join(" · ")}`, "good");
    picked.clear();
    return;
  }

  if (d.error) { toast(d.error, "error"); return; }
  if (typeof d.gap === "number" && d.tries_left > 0) {
    toast(`${won(d.gap)} 차이 — 남은 시도 ${d.tries_left}회`, "error");
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── 결과 ─────────────────────────────────────────────────────

function pauseText() {
  return {
    sub: "광고를 보면 상품 하나를 바꾸고 한 번 더 담을 수 있습니다",
    figure: `${lastPoints}점`,
  };
}

function onOver(result) {
  lastResult = result;
  const points = result.score ?? 0;

  renderRunOver(result, {
    figure: String(points),
    unit: "점",
    sub: `${result.cleared}라운드를 통과했어요`,
    tiles: [
      { label: "통과", value: `${result.cleared}R` },
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
