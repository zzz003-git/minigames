/**
 * 아케이드 런 공통 클라이언트 모듈
 * ==========================================================================
 *
 * 신규 미니게임 10종이 공유하는 부분만 모았습니다.
 * 게임별 파일(public/games/<게임>/game.js)에는 "그 게임만의 플레이 화면" 만 남습니다.
 *
 * ── 화면 골격 약속 ────────────────────────────────────────────────────────
 * 10종의 index.html 은 아래 id 를 같은 의미로 씁니다. 이 약속 덕분에 시작 화면 ·
 * 결과 화면 · 통계 화면을 여기서 통째로 그릴 수 있습니다.
 *
 *   [ready] #bestValue #playsValue #attemptText #attemptDots #startBtn #adbar
 *   [over]  #overCard #overBadge #overHeadline #overSub #overFigure
 *           #overChips #overTiles #overNote #adbarBoost #adbarStats
 *   [stats] #statsTitle #statsChart #statsTiles #statsRank #statsLeagues
 * ==========================================================================
 */

import { apiGet, apiPost, ApiFail } from "./api.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "./ad.js";
import {
  $, el, clear, showScreen, toast, renderPips, renderStats, renderChart, celebrate, comma,
} from "./ui.js";

// ══════════════════════════════════════════════════════════════
// API 래퍼
// ══════════════════════════════════════════════════════════════

export const runApi = {
  /** 새 런 시작. fresh=false 면 진행 중이던 런을 이어 씁니다(새로고침 복구). */
  start: (game, body = {}) => apiPost("/game/session/start", { game_type: game, ...body }),

  /** ENDLESS — 라운드 1회 판정 */
  round: (game, sessionId, answer, extra = {}) =>
    apiPost("/game/round", { game_type: game, session_id: sessionId, answer, ...extra }),

  /** BATCH — 답안 일괄 제출 */
  submit: (game, sessionId, payload) =>
    apiPost("/game/submit", { game_type: game, session_id: sessionId, ...payload }),

  /** 중도 종료 */
  finish: (game, sessionId) => apiPost("/game/finish", { game_type: game, session_id: sessionId }),

  /** 시작 화면용 — 남은 기회 · 내 최고 기록 */
  status: (game, bucket) => apiGet("/user/attempts", { game, bucket }),
};

// ══════════════════════════════════════════════════════════════
// 시작 화면
// ══════════════════════════════════════════════════════════════

/**
 * 남은 기회 표시 + 내 최고 기록.
 * @param {{ attempts:object, base:number, best:number|null, plays:number,
 *           formatBest:(metric:number)=>string }} opts
 */
export function renderReady({ attempts, base, best, plays, formatBest }) {
  const { total, used, remaining } = attempts;

  renderPips($("#attemptDots"), { total, used, base });

  const text = $("#attemptText");
  if (text) {
    clear(text).append(
      document.createTextNode(String(remaining)),
      el("span", { class: "figure__sub" }, ` / ${total}회`),
    );
  }

  const bestEl = $("#bestValue");
  if (bestEl) bestEl.textContent = best == null ? "—" : formatBest(best);

  const playsEl = $("#playsValue");
  if (playsEl) playsEl.textContent = plays > 0 ? `${comma(plays)}판` : "첫 도전";

  const startBtn = $("#startBtn");
  if (startBtn) {
    startBtn.disabled = remaining <= 0;
    startBtn.textContent = remaining > 0 ? "▶ 시작하기" : "오늘 기회를 모두 썼어요";
  }
}

// ══════════════════════════════════════════════════════════════
// 플레이 화면 HUD
// ══════════════════════════════════════════════════════════════

/** 목숨 하트. 색만으로 정보를 전달하지 않도록 스크린리더 텍스트를 함께 넣습니다. */
export function renderLives(host, { lives, max }) {
  if (!host) return;
  clear(host);
  host.className = "lives";

  const shown = Math.max(lives, max);
  for (let i = 0; i < shown; i++) {
    host.append(
      el("span", { class: `life ${i < lives ? "is-on" : ""}`, "aria-hidden": "true" }, "♥"),
    );
  }
  host.append(el("span", { class: "sr-only" }, `남은 목숨 ${lives}개`));
}

/**
 * 카운트다운.
 *
 * 남은 시간은 항상 performance.now() 차이로 계산합니다(단조 증가 시계).
 * 화면 갱신은 requestAnimationFrame 으로 하지만, **종료는 rAF 에 맡기지 않습니다.**
 *
 * 이유: 탭이 백그라운드로 가면 rAF 가 아예 멈춥니다. 그러면 제한 시간이 지나도
 * onEnd 가 불리지 않아 게임이 계속 진행되고, 실제 플레이 시간이 제한 시간을 넘겨
 * 서버 검증에서 이상치로 걸러집니다 — 사용자는 앱을 잠깐 벗어났을 뿐인데
 * 기록이 순위에 안 올라가는 상황이 됩니다.
 * 그래서 종료 시각은 setTimeout 으로 따로 걸어 둡니다(백그라운드에서도 발화하며,
 * 브라우저가 지연시켜도 1초 안쪽입니다). 복귀 즉시에도 한 번 더 확인합니다.
 *
 * @returns {{ stop:()=>void, add:(ms:number)=>void, left:()=>number }}
 */
export function countdown({ ms, onTick, onEnd }) {
  const t0 = performance.now();
  let total = ms;
  let raf = 0;
  let timer = 0;
  let done = false;

  const left = () => total - (performance.now() - t0);

  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    onTick?.(0);
    onEnd?.();
  };

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(finish, Math.max(0, left()));
  };

  const step = () => {
    if (done) return;
    const remain = left();
    if (remain <= 0) {
      finish();
      return;
    }
    onTick?.(remain);
    raf = requestAnimationFrame(step);
  };

  // 백그라운드에 있는 동안 제한 시간이 지났다면 돌아온 즉시 끝냅니다.
  function onVisible() {
    if (document.visibilityState !== "visible" || done) return;
    if (left() <= 0) finish();
    else {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(step);
    }
  }

  document.addEventListener("visibilitychange", onVisible);
  arm();
  raf = requestAnimationFrame(step);

  return {
    stop: () => {
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    },
    /** 광고 보상으로 시간을 늘리거나(양수) 오답 페널티로 깎을 때(음수) */
    add: (delta) => {
      total += delta;
      arm();
    },
    left: () => (done ? 0 : Math.max(0, left())),
  };
}

// ══════════════════════════════════════════════════════════════
// 결과 화면
// ══════════════════════════════════════════════════════════════

/** 신기록 여부와 순위에 따른 표정 */
function verdictOf(res) {
  if (res.is_best && res.plays > 1) return { badge: "🏆", headline: "신기록!", great: true };
  if (res.rank_pct != null && res.rank_pct <= 10) return { badge: "🔥", headline: "상위권이에요!", great: true };
  if (res.rank_pct != null && res.rank_pct <= 40) return { badge: "👍", headline: "좋아요!", great: false };
  return { badge: "🎮", headline: "한 번 더 해볼까요?", great: false };
}

/**
 * 결과 카드를 그립니다. 10종이 같은 마크업을 쓰므로 여기서 한 번에 처리합니다.
 *
 * @param {object} res  서버 result 객체
 * @param {{ figure:string, unit?:string, sub:string,
 *           tiles?:Array<{label:string,value:string,accent?:boolean}>,
 *           formatBest:(metric:number)=>string }} view
 */
export function renderRunOver(res, view) {
  const v = verdictOf(res);

  const badge = $("#overBadge");
  if (badge) {
    badge.textContent = v.badge;
    badge.className = v.great ? "badge-round" : "badge-round badge-round--quiet";
  }

  $("#overHeadline").textContent = v.headline;
  $("#overSub").textContent = view.sub;

  const figure = clear($("#overFigure"));
  figure.append(document.createTextNode(view.figure));
  if (view.unit) figure.append(el("span", { class: "figure__unit" }, view.unit));

  const chips = clear($("#overChips"));
  if (res.rank_pct != null && res.bucket_total > 0) {
    chips.append(
      el("span", { class: "chip" }, `참가자 ${comma(res.bucket_total)}명`),
      el("span", { class: "chip chip--accent" }, `TOP ${res.rank_pct}%`),
    );
  }
  if (res.boosted) chips.append(el("span", { class: "chip" }, "광고 보상 리그"));

  if (view.tiles) renderStats($("#overTiles"), view.tiles, { inset: true });

  const note = $("#overNote");
  if (note) {
    if (res.suspect) {
      note.textContent = "검증 이상치로 표시되어 전체 순위에는 반영되지 않습니다";
    } else if (res.prev_best != null && !res.is_best) {
      note.textContent = `내 최고 기록 ${view.formatBest(res.prev_best)} · 남은 기회 ${res.attempts.remaining}회`;
    } else {
      note.textContent = `남은 기회 ${res.attempts.remaining}회`;
    }
  }

  showScreen("over");
  if (v.great) celebrate($("#overCard"));
}

// ══════════════════════════════════════════════════════════════
// 전체 순위 (전면 광고 시청 후 열람)
// ══════════════════════════════════════════════════════════════

/**
 * 통계를 불러옵니다. 잠겨 있으면 광고를 한 번 보여 주고 다시 시도합니다.
 * 이 흐름이 게임마다 똑같이 반복되므로 여기로 뺐습니다.
 */
export async function openStats(game, { bucket, render }) {
  const fetchOnce = () => apiGet("/game/stats", { game, bucket });

  try {
    render(await fetchOnce());
    return true;
  } catch (err) {
    if (!(err instanceof ApiFail) || err.code !== "AD_REQUIRED") {
      toast(err.message, "error");
      return false;
    }
  }

  if (!(await watchAdForReward(`${game}_STATS`))) return false;

  try {
    render(await fetchOnce());
    return true;
  } catch (err) {
    toast(err.message, "error");
    return false;
  }
}

/**
 * 통계 화면 공통 렌더.
 * @param {object} stats  서버 응답
 * @param {{ mine:number|null, caption:string, formatBest:(m:number)=>string,
 *           tiles?:Array }} view
 */
export function renderStatsScreen(stats, view) {
  const dist = stats.distribution;
  const total = dist?.count ?? 0;

  $("#statsTitle").textContent = `${stats.label ?? "전체 통계"} · 기록 ${comma(total)}건`;

  renderChart($("#statsChart"), {
    bins: dist?.bins ?? [],
    mine: view.mine,
    caption: view.caption,
  });

  renderStats(
    $("#statsTiles"),
    view.tiles ?? [
      { label: "내 최고", value: stats.my_best == null ? "—" : view.formatBest(stats.my_best), accent: true },
      { label: "내 플레이", value: `${comma(stats.my_plays ?? 0)}판` },
      { label: "전체 기록", value: `${comma(total)}건` },
    ],
  );

  const leagues = clear($("#statsLeagues"));
  for (const l of stats.leagues ?? []) {
    leagues.append(
      el(
        "div",
        { class: "rank-row" },
        el("span", { class: "rank-row__no" }, l.boosted ? "AD" : "—"),
        el("span", { class: "rank-row__name" }, l.boosted ? `${l.bucket} (광고 보상)` : l.bucket),
        el("span", { class: "rank-row__value" }, `${comma(l.count)}건`),
      ),
    );
  }
  if ((stats.leagues ?? []).length === 0) {
    leagues.append(el("div", { class: "empty-note" }, "아직 집계된 기록이 없습니다"));
  }

  showScreen("stats");
}

/** TOP 20 순위 목록 (선택 — 순위 화면을 따로 두는 게임용) */
export async function loadRankList(game, bucket, formatMetric) {
  const host = $("#statsRank");
  if (!host) return;
  clear(host);

  try {
    const res = await apiGet("/game/rank", { game, bucket });
    if ((res.list ?? []).length === 0) {
      host.append(el("div", { class: "empty-note" }, "아직 순위가 없습니다. 첫 기록의 주인공이 되어 보세요"));
      return;
    }
    for (const r of res.list) {
      host.append(
        el(
          "div",
          { class: `rank-row ${res.my_rank === r.rank ? "is-me" : ""}` },
          el("span", { class: "rank-row__no" }, `${r.rank}`),
          el("span", { class: "rank-row__name" }, r.label),
          el("span", { class: "rank-row__value" }, formatMetric(r.rank_metric)),
        ),
      );
    }
  } catch {
    host.append(el("div", { class: "empty-note" }, "순위를 불러오지 못했습니다"));
  }
}

// ══════════════════════════════════════════════════════════════
// 보상 카드
// ══════════════════════════════════════════════════════════════

// 보상 카드가 놓이는 자리. 게임마다 있는 것만 씁니다
// (예: 반응속도는 이어하기를 결과 화면이 아니라 플레이 화면 안에서 제안합니다).
const HOSTS = ["#adbar", "#adbarBoost", "#adbarStats"];

/** 화면을 옮길 때 이전 화면의 보상 카드를 지웁니다. */
export function clearRewards() {
  for (const sel of HOSTS) {
    const host = $(sel);
    if (host) clearRewardCard(host);
  }
}

/** 시작 화면 — 도전 기회 충전 */
export function attemptReward(game, { perDay, onGranted }) {
  const host = $("#adbar");
  if (!host) return;

  renderRewardCard(host, {
    icon: "🎁",
    title: "광고 보고 도전 기회 +1",
    desc: `하루 ${perDay}회까지`,
    cta: "받기",
    onClick: async () => {
      const res = await watchAdForReward(`${game}_ATTEMPT`);
      if (!res) return;
      toast("도전 기회가 1회 추가되었습니다.", "good");
      onGranted?.(res);
    },
  });
}

/**
 * 결과 화면 — 이어하기.
 *
 * 「다시 도전」 버튼보다 아래에 둡니다. 무료 재도전 경로를 가리면
 * 단기 광고 수익은 늘지만 리텐션이 떨어집니다 (docs/arcade-10-games.md §3.4).
 */
export function boostReward(game, { sessionId, label, desc, used, max, onBoosted }) {
  const host = $("#adbarBoost");
  if (!host) return;

  const exhausted = used >= max;

  renderRewardCard(host, {
    icon: "▶",
    title: exhausted ? "이어하기를 모두 사용했습니다" : `광고 보고 이어하기 · ${label}`,
    desc: exhausted ? "새로 시작하면 처음부터 도전합니다" : `${desc} · 이 판에서 ${used}/${max}회 사용`,
    cta: exhausted ? "불가" : "이어하기",
    disabled: exhausted,
    onClick: async () => {
      const res = await watchAdForReward(`${game}_BOOST`, {
        sessionId,
        copy: { title: label, reward: desc },
      });
      if (!res) return;
      toast(`${label} 적용되었습니다.`, "good");
      onBoosted?.(res.reward);
    },
  });
}

/** 결과 화면 — 전체 순위 열람 */
export function statsReward(game, { desc, onOpen }) {
  const host = $("#adbarStats");
  if (!host) return;

  renderRewardCard(host, {
    icon: "🏅",
    title: "광고 보고 전체 순위 보기",
    desc,
    cta: "보기",
    onClick: onOpen,
  });
}

// ══════════════════════════════════════════════════════════════
// ENDLESS 런 컨트롤러
// ══════════════════════════════════════════════════════════════

/**
 * 라운드 방식 게임 4종(색 찾기 · 순서 기억 · 링 스톱 · 개수 세기)의 진행 루프.
 *
 * 서버 응답은 세 갈래뿐입니다.
 *   game_over  결과 확정 → 결과 화면
 *   exhausted  목숨은 떨어졌지만 이어하기가 남음 → 선택 화면 (세션은 아직 열려 있음)
 *   그 외      다음 라운드 진행
 *
 * 이 분기가 게임마다 똑같이 반복되므로 여기서 처리하고, 게임 파일에는
 * "라운드를 어떻게 그리는가" 와 "판정 결과를 어떻게 연출하는가" 만 남깁니다.
 *
 * @param {{ game:string,
 *           boost:{ label:string, desc:string },
 *           hooks:{ onRound:(round,state)=>void,
 *                   onJudged?:(res,state)=>void|Promise<void>,
 *                   onOver:(result,state)=>void,
 *                   pauseText:(state)=>{ sub:string, figure:string } } }} opts
 */
export function createEndlessRun({ game, boost, hooks }) {
  const state = {
    sessionId: null,
    roundNo: 1,
    lives: 0,
    maxLives: 0,
    cleared: 0,
    boosts: 0,
    maxBoosts: 0,
    limitMs: null,
    busy: false,
    paused: false,
  };

  /** 새 런 시작 */
  async function begin() {
    const res = await runApi.start(game, { fresh: true });
    Object.assign(state, {
      sessionId: res.session_id,
      roundNo: res.round_no,
      lives: res.lives,
      maxLives: res.max_lives,
      cleared: 0,
      boosts: 0,
      maxBoosts: res.max_boosts,
      limitMs: res.limit_ms,
      paused: false,
    });
    clearRewards();
    showScreen("play");
    hooks.onRound(res.round, state);
    return state;
  }

  /** 라운드 답 제출. timeout=true 면 시간 초과로 보냅니다. */
  async function answer(value, extra = {}) {
    // paused = 목숨을 다 써서 "이어하기 아니면 종료" 를 기다리는 상태.
    // 이때 답을 더 보내면 서버가 RUN_EXHAUSTED 로 거부합니다(보상이 무효화되지 않도록).
    if (state.busy || state.paused || !state.sessionId) return null;
    state.busy = true;

    try {
      const res = await runApi.round(game, state.sessionId, value, extra);
      state.cleared = res.cleared ?? state.cleared;
      state.lives = res.lives ?? state.lives;

      // 시간 초과는 서버가 판정합니다. 앱을 잠깐 벗어났다 돌아오면 화면의 카운트다운은
      // 멈춰 있었어도 서버 시계는 흘러가 있으므로, 왜 틀린 것으로 처리됐는지 알려 줍니다.
      if (res.data?.timed_out) toast("시간이 초과됐어요", "error", 1600);

      await hooks.onJudged?.(res, state);

      if (res.game_over) {
        hooks.onOver(res.result, state);
        return res;
      }

      if (res.exhausted) {
        state.boosts = res.boosts ?? state.boosts;
        showPause();
        return res;
      }

      state.roundNo = res.round_no;
      state.limitMs = res.limit_ms;
      hooks.onRound(res.round, state);
      return res;
    } catch (err) {
      // 답이 엇갈려 이미 소진된 런에 도착한 경우 — 오류가 아니라 선택 화면으로 보냅니다.
      if (err instanceof ApiFail && err.code === "RUN_EXHAUSTED") {
        showPause();
        return null;
      }
      toast(err.message ?? "판정을 받을 수 없습니다.", "error");
      return null;
    } finally {
      state.busy = false;
    }
  }

  /** 목숨 소진 — 이어할지 끝낼지 고르는 화면 */
  function showPause() {
    state.paused = true;
    const text = hooks.pauseText(state);
    const sub = $("#pauseSub");
    const fig = $("#pauseFigure");
    if (sub) sub.textContent = text.sub;
    if (fig) fig.textContent = text.figure;

    showScreen("pause");
    clearRewards();

    boostReward(game, {
      sessionId: state.sessionId,
      label: boost.label,
      desc: boost.desc,
      used: state.boosts,
      max: state.maxBoosts,
      onBoosted: (reward) => {
        state.boosts = reward.boosts;
        state.lives = reward.lives;
        state.roundNo = reward.round_no;
        state.limitMs = reward.limit_ms;
        state.paused = false;
        clearRewards();
        showScreen("play");
        hooks.onRound(reward.round, state);
      },
    });
  }

  /** 이어하지 않고 여기서 결과를 확정합니다. */
  async function end() {
    if (!state.sessionId) return;
    try {
      const res = await runApi.finish(game, state.sessionId);
      hooks.onOver(res.result, state);
    } catch (err) {
      toast(err.message ?? "결과를 저장할 수 없습니다.", "error");
    }
  }

  return { state, begin, answer, end };
}

// ══════════════════════════════════════════════════════════════
// 서식
// ══════════════════════════════════════════════════════════════

/**
 * 연속/정답 수를 순위 지표에서 되돌립니다.
 *
 * 서버는 동점자를 가르려고 두 값을 하나로 묶어 저장합니다 (lib/arcade.js 의 streakMetric).
 *   rank_metric = -(개수 × 1000) + 평균응답ms/10        ← 뒤 항은 0~999 의 양수 페널티
 *
 * 그래서 `-rank_metric / 1000` 은 항상 개수보다 조금 **작습니다** (13연속 → 12.805).
 * floor 로 내리면 1이 깎여 "13연속을 냈는데 최고 기록이 12연속" 으로 표시됩니다.
 * 페널티 항이 1000 미만인 것이 보장되므로 ceil 이 정확한 복원입니다.
 */
export const unpackCount = (metric) => Math.max(0, Math.ceil(-metric / 1000));

/** 1234 → '1.23초' */
export const sec2 = (ms) => `${(ms / 1000).toFixed(2)}초`;

/** 밀리초를 그대로 보여줄 때: 287 → '287ms' */
export const msText = (ms) => `${Math.round(ms)}ms`;

/** 라운드 수 표기 */
export const roundText = (n) => `${n}R`;
