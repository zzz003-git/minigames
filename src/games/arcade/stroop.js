/**
 * ⑩ 색깔 말하기 (스트룹) — BATCH
 *
 * 「파랑」이라고 쓰인 빨간 글자가 나오면 답은 '빨강' 입니다.
 * 하나라도 틀리거나 문항 제한 시간을 넘기면 즉시 종료. 광고 보상은 오답 1회 면제입니다.
 *
 * 전체 30초 안에서 진행되며 순위 지표는 연속 정답 수입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay, gradeStreak, shuffled, streakMetric } from "../../lib/arcade.js";

const C = ARCADE.STROOP;
const KEYS = C.COLORS.map((c) => c.key);

const perLimit = (no) => Math.round(decay(no, C.PER_START_MS, C.PER_STEP_MS, C.PER_MIN_MS));

function makeItem(no) {
  const inkIdx = randomInt(0, C.COLORS.length - 1);
  const ink = C.COLORS[inkIdx];

  // 4문항 중 1문항 정도만 글자와 색이 일치하게 둡니다. 전부 불일치면 오히려 규칙이 단순해집니다.
  const congruent = randomInt(0, 3) === 0;
  const word = congruent
    ? ink
    : C.COLORS[(inkIdx + randomInt(1, C.COLORS.length - 1)) % C.COLORS.length];

  // 보기: 정답 + 오답 3개
  const distractors = shuffled(
    KEYS.filter((k) => k !== ink.key),
    randomInt,
  ).slice(0, C.CHOICES - 1);

  return {
    word: word.name,
    ink_hex: ink.hex,
    choices: shuffled([ink.key, ...distractors], randomInt),
    limit_ms: perLimit(no),
    answer: ink.key,
  };
}

export const spec = {
  game: "STROOP",
  mode: "BATCH",
  boostLabel: "오답 1회 면제",

  makeBatch(meta) {
    const items = Array.from({ length: C.BATCH_SIZE }, (_, i) => makeItem(i + 1));
    meta.ext.forgive = 0;

    return {
      pub: {
        items: items.map(({ word, ink_hex, choices, limit_ms }) => ({ word, ink_hex, choices, limit_ms })),
        limit_ms: C.LIMIT_MS,
        palette: C.COLORS,
      },
      secret: { answers: items.map((i) => i.answer), limits: items.map((i) => i.limit_ms) },
      limitMs: C.LIMIT_MS,
    };
  },

  applyBoost(meta) {
    meta.ext.forgive = (meta.ext.forgive ?? 0) + 1;
    return { data: { forgive: meta.ext.forgive } };
  },

  gradeBatch({ answers, times, meta, roundSecret }) {
    const graded = gradeStreak({
      answers,
      times,
      expected: roundSecret?.answers ?? [],
      limits: roundSecret?.limits ?? [],
      forgive: meta.ext.forgive ?? 0,
      minAnswerMs: C.MIN_ANSWER_MS,
    });

    return {
      cleared: graded.streak,
      correct: graded.streak,
      score: graded.streak,
      suspect: graded.suspect,
      ext: { streak: graded.streak, avg_ms: graded.avgMs == null ? null : Math.round(graded.avgMs) },
      detail: {
        streak: graded.streak,
        answered: graded.answered,
        forgiven: graded.forgiven,
        wrong_at: graded.wrongAt,
        avg_ms: graded.avgMs == null ? null : Math.round(graded.avgMs),
      },
    };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => streakMetric(meta.ext.streak ?? 0, meta.ext.avg_ms),
  scoreOf: (meta) => meta.ext.streak ?? 0,
};
