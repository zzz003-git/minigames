/**
 * ⑧ 숫자 순서 터치 (슐테 테이블) — BATCH
 *
 * 5×5 격자의 1~25를 순서대로 누릅니다. 완주 시간이 기록입니다.
 *
 * 배치는 화면에 그대로 보이는 정보라 숨길 이유가 없습니다. 대신 서버가
 * "정말 순서대로 눌렀는지" 와 "그 시간이 물리적으로 가능한지" 를 다시 확인합니다.
 * 런 중 광고 보상이 없는 유일한 게임입니다 — 순수 기록 경신 게임이라
 * 보상이 끼면 기록의 의미가 사라집니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";

const C = ARCADE.NUMTAP;
const TOTAL = C.SIZE * C.SIZE;

export const spec = {
  game: "NUMTAP",
  mode: "BATCH",

  makeBatch() {
    const layout = shuffled(
      Array.from({ length: TOTAL }, (_, i) => i + 1),
      randomInt,
    );

    return {
      pub: { size: C.SIZE, total: TOTAL, layout },
      secret: { layout },
      limitMs: C.MAX_MS,
    };
  },

  /**
   * answers[i] = i번째로 누른 칸의 숫자 (오탭 포함)
   * times[i]   = 시작 시점부터의 누적 경과 ms
   */
  gradeBatch({ answers, times, elapsedMs }) {
    let expect = 1;
    let misses = 0;
    let finishMs = null;
    let minGap = Infinity;
    let fastGaps = 0;
    let gaps = 0;
    let prevMs = 0;

    for (let i = 0; i < answers.length; i++) {
      const n = Number(answers[i]);
      const t = Number(times[i]);

      if (Number.isFinite(t)) {
        const gap = t - prevMs;
        minGap = Math.min(minGap, gap);
        gaps += 1;
        if (gap < C.MIN_TAP_GAP_MS) fastGaps += 1;
        prevMs = t;
      }

      if (n === expect) {
        if (expect === TOTAL) finishMs = Number.isFinite(t) ? t : elapsedMs;
        expect += 1;
      } else {
        misses += 1;
      }
    }

    const completed = finishMs != null;
    const finalMs = completed ? Math.round(finishMs + misses * C.MISS_PENALTY_MS) : null;

    // 25번을 사람 손으로 누르려면 최소한의 간격이 필요합니다. 그보다 촘촘하면 자동 입력.
    // 다만 한두 번 유난히 빨랐던 것(인접한 칸을 연달아 누른 경우)까지 잡으면 오탐이 되므로,
    // 촘촘한 간격이 여러 번이고 비율로도 두드러질 때만 이상치로 봅니다.
    const automated = fastGaps > 3 && gaps > 0 && fastGaps / gaps >= 0.2;
    const suspect = completed && (automated || finishMs > elapsedMs + 2000);

    return {
      cleared: expect - 1,
      correct: expect - 1,
      score: finalMs ?? 0,
      suspect,
      ext: { final_ms: finalMs, completed },
      detail: {
        completed,
        reached: expect - 1,
        total: TOTAL,
        raw_ms: completed ? Math.round(finishMs) : null,
        misses,
        penalty_ms: misses * C.MISS_PENALTY_MS,
        final_ms: finalMs,
        min_gap_ms: Number.isFinite(minGap) ? Math.round(minGap) : null,
      },
    };
  },

  bucketOf: () => `${C.SIZE}x${C.SIZE}`,

  /** 완주 시간(ms). 중도 포기는 최하위로 둡니다. */
  rankMetricOf: (meta) => meta.ext.final_ms ?? 999999,
  scoreOf: (meta) => meta.ext.final_ms ?? 0,
};
