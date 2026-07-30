/**
 * ㉖ 세 칸 쌓기 — ENDLESS
 *
 * 세 기둥 중 하나를 눌러 쌓고, 바로 아래와 같으면 붙어 한 등급 올라갑니다(엔진 G 첫 원형).
 * 기획: plans/2026-07-30/PLAN-16_세칸쌓기.md (IDEA-2026-0016) · docs/merge3-game.md
 *
 * ── 첫 3수는 반드시 합쳐집니다 ───────────────────────────────────────────
 * 규칙을 글로 설명하지 않고 **첫 합체 한 번으로** 알려주는 것이 이 기획의 핵입니다
 * (기획서 4장 5번). 그래서 첫 FREE_MERGES 수 동안은 어디에 놓아도 아래와 같은 것이
 * 나오도록 서버가 배정합니다 — 판단은 4수째부터 사용자가 스스로 시작합니다.
 *
 * ── 2048 계열과 다른 점 ──────────────────────────────────────────────────
 * 격자를 방향으로 미는 것이 아니라 **세 기둥 중 어디에 쌓을지** 고릅니다.
 * 판정은 바로 아래 한 칸과만 하고, 실패는 기둥 높이 초과입니다(기획서 11장).
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";

const C = ARCADE.MERGE3;

const tierOf = (t) => C.TIERS[Math.min(t, C.TIERS.length - 1)];

/** 완성 등급이 오를수록 기둥 상한을 조입니다 (기획서 4장 7번) */
const heightOf = (best) =>
  Math.max(C.HEIGHT_MIN, C.HEIGHT_START - Math.floor(best / C.HEIGHT_TIGHTEN_AT));

/**
 * 첫 화면의 기둥.
 *
 * **기둥마다 하나씩 깔아 둡니다.** 「첫 3수는 어디에 놓아도 반드시 합쳐진다」(기획서 4장
 * 5번)를 지키려면 아래에 붙일 것이 있어야 하고, 빈 기둥에 놓으면 합쳐질 상대가 없습니다.
 * 기획서 0-1 이 첫 화면을 「전부 비었거나 **하나씩만**」으로 적어 둔 것이 이 자리입니다.
 */
function initExt(meta) {
  meta.ext = {
    ...(meta.ext ?? {}),
    cols: Array.from({ length: C.COLUMNS }, () => [0]), // 각 기둥의 등급 배열 (아래→위)
    next: 0, // 다음에 놓을 등급
    merges: 0,
    best: 0, // 도달한 최고 등급
    chainBest: 0,
    score: 0,
    placed: 0,
  };
  return meta.ext;
}

/**
 * 다음에 놓을 물건의 등급을 뽑습니다.
 *
 * 첫 FREE_MERGES 수 동안은 **어느 기둥에 놓아도 합쳐지도록** 모든 기둥의 맨 위와 같은
 * 등급을 고릅니다. 기둥이 비어 있으면(첫 수) 아무 등급이나 됩니다 — 다음 수에서 맞춰
 * 주면 되기 때문입니다.
 */
export function pickNext(ext, pickInt = randomInt) {
  const tops = (ext.cols ?? []).map((c) => (c.length ? c[c.length - 1] : null));
  const filled = tops.filter((t) => t != null);

  if ((ext.placed ?? 0) < C.FREE_MERGES && filled.length > 0) {
    // 맨 위 등급이 모두 같으면 그 값을, 다르면 가장 낮은 값을 줍니다
    // (가장 낮은 쪽에 놓으면 합체가 일어나고, 그것이 첫 성공 경험입니다)
    return Math.min(...filled);
  }
  return pickInt(0, C.SPAWN_TOP_TIER);
}

const viewOf = (ext) => ({
  cols: (ext.cols ?? []).map((c) => c.map((t) => ({ tier: t, ...tierOf(t) }))),
  next: { tier: ext.next ?? 0, ...tierOf(ext.next ?? 0) },
  height: heightOf(ext.best ?? 0),
  best: ext.best ?? 0,
  best_name: tierOf(ext.best ?? 0).name,
  merges: ext.merges ?? 0,
  score: ext.score ?? 0,
});

export const spec = {
  game: "MERGE3",
  mode: "ENDLESS",
  boostLabel: "맨 위 하나 치우기",

  makeRound(roundNo, meta) {
    const ext = meta.ext?.cols ? meta.ext : initExt(meta);
    ext.next = pickNext(ext);

    return {
      pub: viewOf(ext),
      secret: { next: ext.next },
      limitMs: null, // 시간 제한 없음 (기획서 4장 1번)
    };
  },

  /** answer = 기둥 번호 (0 ~ COLUMNS-1) */
  judgeRound({ answer, roundSecret, meta }) {
    const ext = meta.ext?.cols ? meta.ext : initExt(meta);
    const col = Number(answer);

    if (!Number.isInteger(col) || col < 0 || col >= C.COLUMNS) {
      return { ok: false, fatal: false, data: { invalid: "그 기둥은 없어요", ...viewOf(ext) } };
    }

    const stack = ext.cols[col];
    const limit = heightOf(ext.best ?? 0);

    // 상한을 넘으면 종료 — 이 게임의 유일한 실패입니다
    if (stack.length >= limit) {
      return { ok: false, fatal: true, data: { overflow: true, col, ...viewOf(ext) } };
    }

    stack.push(roundSecret?.next ?? ext.next ?? 0);
    ext.placed = (ext.placed ?? 0) + 1;

    // 바로 아래와 같으면 붙습니다. 결과가 또 아래와 같으면 연쇄로 이어집니다.
    let chain = 0;
    while (stack.length >= 2 && stack[stack.length - 1] === stack[stack.length - 2]) {
      stack.pop();
      stack[stack.length - 1] += 1;
      chain += 1;
      ext.merges = (ext.merges ?? 0) + 1;
      ext.best = Math.max(ext.best ?? 0, stack[stack.length - 1]);
    }

    ext.chainBest = Math.max(ext.chainBest ?? 0, chain);
    const points = chain > 0 ? C.MERGE_POINT * chain + C.CHAIN_BONUS * (chain - 1) : 0;
    ext.score = (ext.score ?? 0) + points;

    // 상한을 넘긴 기둥이 생겼는지 (합체로 줄어들 수 있어 배치 뒤에 다시 봅니다)
    const overflow = ext.cols.some((c) => c.length > limit);

    return {
      ok: chain > 0,
      // 합체하지 못한 것은 실패가 아닙니다 — 기둥이 넘칠 때만 판이 끝납니다
      fatal: overflow,
      data: {
        col,
        chain,
        points,
        merged: chain > 0,
        top: stack.length ? { tier: stack[stack.length - 1], ...tierOf(stack[stack.length - 1]) } : null,
        overflow,
        ...viewOf(ext),
      },
    };
  },

  /** 「맨 위 하나 치우기」 — 가장 높은 기둥의 맨 위를 걷어내고 판을 다시 엽니다 */
  applyBoost(meta) {
    const ext = meta.ext?.cols ? meta.ext : initExt(meta);
    let target = 0;
    ext.cols.forEach((c, i) => {
      if (c.length > ext.cols[target].length) target = i;
    });
    ext.cols[target].pop();
    meta.lives += 1;
    return { data: { removed_col: target, lives: meta.lives, ...viewOf(ext) } };
  },

  detailOf: (meta) => ({
    merges: meta.ext?.merges ?? 0,
    best_tier: meta.ext?.best ?? 0,
    best_name: tierOf(meta.ext?.best ?? 0).name,
    chain_best: meta.ext?.chainBest ?? 0,
    placed: meta.ext?.placed ?? 0,
    score: meta.ext?.score ?? 0,
  }),

  bucketOf: () => "all",

  /**
   * 순위 지표는 **도달한 최고 등급**이고, 같으면 합체 수가 많은 쪽이 상위입니다.
   * 점수로 세우면 오래 버틴 것과 높이 올린 것이 섞입니다 — 이 게임이 파는 것은 등급입니다.
   */
  rankMetricOf: (meta) =>
    -((meta.ext?.best ?? 0) * 1000) + Math.max(0, 999 - Math.min(999, meta.ext?.merges ?? 0)),

  scoreOf: (meta) => meta.ext?.score ?? 0,
};
