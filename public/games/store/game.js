/**
 * ⑲ 내 가게 채우기
 *
 * 상품 하나를 놓을 때마다 서버가 판정합니다(ENDLESS). 판이 끝나도 가게는 남습니다.
 *
 * 조작은 **빈 칸 탭** 하나뿐입니다. 기획서는 드래그로 적었지만 아케이드 규격이
 * 「탭 1종류」이고, 이 게임의 핵심은 제스처가 아니라 정리욕과 딸깍의 손맛이라
 * 탭으로도 그대로 성립합니다 (docs/store-game.md §5).
 *
 * 실패가 없는 게임이라 목숨·이어하기 화면이 없습니다. 잘못 누른 칸은 흔들리기만 하고
 * 판은 그대로 이어집니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, attemptReward, statsReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "STORE";
const AD_PER_DAY = 1;

/** rank_metric = -(누적 진열 칸 수) */
const formatBest = (metric) => `${Math.max(0, -metric)}칸`;

const state = { corner: null, busy: false };
let lastResult = null;
let lastDetail = null;

renderHeader($("#header"), { icon: "🏪", title: "내 가게 채우기", badge: "1" });

const run = createEndlessRun({
  game: GAME,
  // 하루 한 판이라 새로고침으로 진행분이 날아가면 그날 다시 못 합니다.
  // 진행 중인 런이 있으면 그대로 이어받습니다(기회를 쓰지 않음).
  fresh: false,
  // 이어하기가 없는 게임이라 boost 는 쓰이지 않지만, 컨트롤러가 요구하는 모양은 맞춥니다.
  boost: { label: "—", desc: "—" },
  hooks: {
    onRound: renderRound,
    onJudged: showVerdict,
    onOver: onOver,
    pauseText: () => ({ sub: "", figure: "" }),
  },
});

$("#startBtn").addEventListener("click", startRun);
$("#retryBtn").addEventListener("click", () => loadReady());
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
    // 기본 문구가 "시작하기" 라서 이 게임의 말로 바꿔 둡니다.
    const btn = $("#startBtn");
    if (!btn.disabled) btn.textContent = "▶ 상자 열기";
    else btn.textContent = "오늘 상자를 다 썼어요";

    // 하루 한 판이라 새로고침 한 번에 그날을 잃으면 안 됩니다.
    // 기회가 0이면 **새 런이 생길 수 없으므로** 이어받기를 시도해도 안전합니다 —
    // 진행 중인 런이 있으면 그대로 돌아오고, 없으면 NO_ATTEMPTS 로 떨어질 뿐입니다.
    if ((st.attempts?.remaining ?? 0) <= 0) {
      try {
        await run.begin();
        toast("이어서 채우기", "good", 1400);
        return;
      } catch {
        /* 진행 중인 런이 없습니다 — 시작 화면 그대로 둡니다 */
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
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 상자를 다 썼어요. 광고를 보면 보너스 상자가 하나 더 와요.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "상자를 열 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ── 플레이 ───────────────────────────────────────────────────

function renderRound(round) {
  if (!round) return;

  state.corner = round.item.corner;
  state.busy = false;

  $("#hudScore").textContent = String(round.score ?? 0);
  $("#hudStage").textContent = String(round.stage);
  $("#hudLeft").textContent = String(round.total - round.no + 1);
  setHeaderBadge(`${round.stage}단계`);

  $("#handIcon").textContent = round.item.icon;
  $("#handName").textContent = round.item.name;

  const corner = round.shelves.find((s) => s.key === round.item.corner);
  $("#handWhere").textContent = `${corner?.icon ?? ""} ${corner?.name ?? ""} 코너의 빈 칸에 넣어 주세요`;

  renderShelves(round.shelves, round.item.corner);
}

/** 선반 3개. 지금 상품이 들어갈 수 있는 코너의 빈 칸만 누를 수 있습니다. */
function renderShelves(shelves, activeCorner) {
  const host = clear($("#shelves"));

  for (const sh of shelves) {
    const isTarget = sh.key === activeCorner;

    const slots = el("div", { class: "shelf__slots" });
    sh.slots.forEach((slot, i) => {
      const filled = slot != null;
      const open = isTarget && !filled;

      const node = el(
        open ? "button" : "div",
        {
          class: `slot ${filled ? "is-filled" : ""} ${open ? "is-open" : ""}`,
          ...(open ? { type: "button", "aria-label": `${sh.name} ${i + 1}번 칸에 넣기` } : {}),
          ...(filled ? { title: slot.name } : {}),
        },
        filled ? slot.icon : "",
      );

      if (open) node.addEventListener("click", () => submit(i));
      slots.append(node);
    });

    host.append(
      el(
        "div",
        { class: `shelf ${isTarget ? "is-target" : ""}` },
        el(
          "div",
          { class: "shelf__head" },
          el("span", { class: "shelf__icon", "aria-hidden": "true" }, sh.icon),
          el("span", { class: "shelf__name" }, sh.name),
          el("span", { class: "shelf__fill" }, `${sh.slots.filter(Boolean).length}/${sh.slots.length}`),
        ),
        slots,
      ),
    );
  }
}

async function submit(answer) {
  if (state.busy) return;
  state.busy = true;
  await run.answer(answer);
  state.busy = false;
}

/** 판정 연출 — 점수·완성·도감은 서버가 준 값만 씁니다 */
async function showVerdict(res) {
  const d = res.data ?? {};

  // ENDLESS 는 result.detail 이 비어 있어(엔진 구조상) 결과 화면이 쓸 값을 여기서 챙깁니다.
  if (!d.invalid) lastDetail = d;

  if (d.invalid) {
    // 실패가 없는 게임이라 알려만 주고 판은 그대로 둡니다.
    $("#handCard").classList.add("is-nope");
    setTimeout(() => $("#handCard").classList.remove("is-nope"), 320);
    toast(d.invalid, "error", 1200);
    return;
  }

  if (d.timed_out) {
    toast("시간이 지나 다음 상품으로 넘어갔어요", "error", 1600);
    return;
  }

  $("#hudScore").textContent = String(d.score ?? 0);
  $("#hudStage").textContent = String(d.stage ?? 1);

  if (d.completed) toast(`선반 완성! +${10}`, "good", 1600);
  else if (d.new_dex) toast("도감에 새로 등록됐어요", "good", 1400);
}

// ── 결과 ─────────────────────────────────────────────────────

function onOver(result) {
  lastResult = result;
  showOver(result);
}

function showOver(result) {
  const d = lastDetail ?? {};

  renderRunOver(result, {
    figure: String(d.placed_today ?? 0),
    unit: "개",
    sub:
      d.shelves_today > 0
        ? `선반 ${d.shelves_today}줄을 완성했어요`
        : "오늘도 가게가 조금 자랐어요",
    tiles: [
      { label: "가게 단계", value: `${d.stage ?? 1}단계`, accent: true },
      { label: "완성 선반", value: `${d.done_shelves ?? 0}줄` },
      { label: "도감", value: `${d.dex_count ?? 0}종` },
    ],
    formatBest,
  });

  // 기획서 8장의 종료 화면 — 재방문 동기는 광고가 아니라 미완의 선반입니다.
  const near = d.near;
  $("#tomorrowText").textContent = near
    ? `${near.icon} ${near.name} 코너, ${near.left}칸 남았어요 — 내일 상자로 완성!`
    : "선반을 모두 완성했어요. 내일 새 상자가 도착합니다.";

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "가게 크기 전체 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "가게 크기 분포 · 왼쪽이 큼",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
