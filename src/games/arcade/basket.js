/**
 * ⑯ 딱 맞게 담기 — ENDLESS
 *
 * 기획: ../../../../reward-minigame-research/plans/2026-07-28/PLAN-09_딱맞게담기.md
 *
 * 목표 금액에 딱 맞게 상품을 담습니다. **시간 제한이 없고 시도 횟수(3회)가 제한**입니다.
 * ⑨ 60초 암산과 계산 소재가 겹치므로 압박의 원천을 시간에서 시도로 옮겼습니다 —
 * 빠른 연산이 아니라 조합 탐색을 묻는 게임이 됩니다.
 *
 * ── 라운드 = 한 번의 시도 ────────────────────────────────────────────────
 * 공통 엔진은 판정이 끝나면 곧바로 다음 라운드를 발급합니다. 그래서 "같은 문제에
 * 세 번 도전" 을 그대로 표현할 수 없습니다. 대신 **한 라운드를 한 번의 시도로 두고**,
 * 아직 시도가 남았으면 makeRound 가 직전 문제를 그대로 다시 발급합니다.
 *   · 맞힘        → ok:true            (cleared +1, 다음 문제)
 *   · 틀림(여유O)  → ok:false fatal:false (목숨 유지, 같은 문제 재발급)
 *   · 틀림(마지막) → ok:false fatal:true  (목숨 차감 → 종료 또는 광고 이어하기)
 *
 * ── 해가 없는 판을 만들지 않는다 ─────────────────────────────────────────
 * 목표 금액은 가격표를 먼저 만든 뒤 그중 몇 개를 골라 그 합으로 정합니다.
 * 임의의 숫자를 목표로 던지면 풀 수 없는 판이 나오고, 그 순간 실력이 아니라 운이 됩니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";

const C = ARCADE.BASKET;

const GOODS = [
  "아메리카노", "샌드위치", "초코바", "생수", "우유", "김밥",
  "젤리", "빵", "요거트", "컵라면", "바나나", "사이다",
];

const cfgOf = (stage) => C.ROUNDS[Math.min(stage, C.ROUNDS.length - 1)];

const sumOf = (prices, idx) => idx.reduce((acc, i) => acc + (prices[i] ?? 0), 0);

/** 가격표를 먼저 만들고, 그중 일부의 합을 목표로 삼습니다 — 해가 항상 존재합니다. */
function makePuzzle(stage) {
  const cfg = cfgOf(stage);
  const lift = Math.min(stage, C.LIFT_MAX_ROUND) * C.PRICE_LIFT;

  const names = shuffled(GOODS, randomInt).slice(0, cfg.items);
  const prices = names.map(() => {
    const steps = (C.PRICE_MAX - C.PRICE_MIN) / C.PRICE_STEP;
    return C.PRICE_MIN + randomInt(0, steps) * C.PRICE_STEP + lift;
  });

  const order = shuffled(names.map((_, i) => i), randomInt);
  const k = randomInt(cfg.pick[0], cfg.pick[1]);
  const answer = order.slice(0, k);

  return { names, prices, answer, target: sumOf(prices, answer), tol: cfg.tol, stage };
}

const pubOf = (puzzle, meta) => ({
  round: (puzzle.stage ?? 0) + 1,
  items: puzzle.names.map((name, i) => ({ name, price: puzzle.prices[i] })),
  target: puzzle.target,
  tolerance: puzzle.tol,
  tries_left: meta.tries,
  tries_max: C.TRIES,
  points: meta.points ?? 0,
});

export const spec = {
  game: "BASKET",
  mode: "ENDLESS",
  boostLabel: "상품 1개 교체 + 시도 1회",

  makeRound(roundNo, meta, secret) {
    meta.points = meta.points ?? 0;

    // 아직 시도가 남아 있으면 **같은 문제**를 그대로 다시 냅니다.
    const pending = secret?.round?.puzzle;
    if (pending && (meta.tries ?? 0) > 0) {
      return { pub: pubOf(pending, meta), secret: { puzzle: pending }, limitMs: null };
    }

    meta.stage = meta.stage ?? 0;
    meta.tries = C.TRIES;
    const puzzle = makePuzzle(meta.stage);
    // limitMs: null — 이 게임에는 제한 시간이 없습니다(관통 원리 6).
    return { pub: pubOf(puzzle, meta), secret: { puzzle }, limitMs: null };
  },

  /** answer 는 담은 상품의 인덱스 배열입니다. */
  judgeRound({ answer, roundSecret, meta }) {
    const puzzle = roundSecret?.puzzle;
    if (!puzzle) return { ok: false, fatal: false, data: { error: "라운드가 없습니다" } };

    const picked = Array.isArray(answer) ? [...new Set(answer.map(Number))] : [];
    const valid = picked.every((i) => Number.isInteger(i) && i >= 0 && i < puzzle.prices.length);
    if (!valid) {
      return { ok: false, fatal: false, data: { error: "담은 상품 번호가 올바르지 않습니다" } };
    }

    const sum = sumOf(puzzle.prices, picked);
    const gap = Math.abs(puzzle.target - sum);
    const firstTry = (meta.tries ?? C.TRIES) === C.TRIES;

    if (gap <= puzzle.tol) {
      const cfg = cfgOf(puzzle.stage);
      const bonus = (gap === 0 ? C.PERFECT_BONUS : 0) + (firstTry ? C.FIRST_TRY_BONUS : 0);
      meta.points = (meta.points ?? 0) + cfg.reward + bonus;
      meta.stage = (meta.stage ?? 0) + 1;
      meta.tries = 0; // 다음 makeRound 가 새 문제를 내도록
      return {
        ok: true,
        data: { sum, gap, perfect: gap === 0, first_try: firstTry, gained: cfg.reward + bonus, points: meta.points },
      };
    }

    meta.tries = Math.max(0, (meta.tries ?? C.TRIES) - 1);
    const last = meta.tries <= 0;
    return {
      ok: false,
      fatal: last, // 마지막 시도까지 빗나가야 목숨이 깎입니다
      data: { sum, gap, tries_left: meta.tries, ...(last ? { target: puzzle.target } : {}) },
    };
  },

  /**
   * 광고 보상 — 시도 1회를 되돌리고 상품 하나를 새 가격으로 바꿉니다.
   *
   * 기획서는 "남은 차이 근처로 교체" 라고 적었지만, 보상 엔드포인트는 이용자가 무엇을
   * 담아 두었는지 받지 않습니다(세션만 받습니다). 그래서 서버가 알 수 있는 범위에서
   * 같은 효과를 냅니다 — **정답 조합에 없는 상품 하나를 정답 상품과 같은 가격으로** 바꿔
   * 목표에 닿는 길을 하나 더 만듭니다. 정답을 대신 눌러 주지는 않습니다.
   */
  applyBoost(meta, secret) {
    meta.lives += 1;
    meta.tries = 1;

    const puzzle = secret?.round?.puzzle;
    if (!puzzle) return { data: { lives: meta.lives, tries_left: meta.tries } };

    const spare = puzzle.names
      .map((_, i) => i)
      .filter((i) => !puzzle.answer.includes(i));

    let swapped = null;
    if (spare.length) {
      const at = spare[randomInt(0, spare.length - 1)];
      puzzle.prices[at] = puzzle.prices[puzzle.answer[0]];
      swapped = { index: at, name: puzzle.names[at], price: puzzle.prices[at] };
    }

    return {
      secret: { ...secret, round: { puzzle } },
      data: { lives: meta.lives, tries_left: meta.tries, swapped },
    };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => -(meta.points ?? 0),
  scoreOf: (meta) => meta.points ?? 0,
  detailOf: (meta) => ({ stage: meta.stage ?? 0, points: meta.points ?? 0 }),
};
