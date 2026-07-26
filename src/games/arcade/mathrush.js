/**
 * ⑨ 60초 암산 — BATCH
 *
 * 제한 시간 안에 최대한 많이 맞힙니다. 오답이면 남은 시간이 3초 깎입니다.
 * 광고 보상은 시간 +15초이며, 연장한 런은 60s / 75s / 90s 로 리그를 나눠 집계합니다.
 * (연장한 사람과 안 한 사람을 같은 순위표에 두면 순위가 광고 시청량 순위가 됩니다)
 *
 * 문제는 서버가 만들고 정답도 서버가 보관합니다. 다만 암산 문제는 문제만 있으면
 * 누구나(스크립트도) 답을 계산할 수 있으므로, 자동화는 응답 시간 하한으로만 걸러집니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { hasImpossibleTiming, mean } from "../../lib/arcade.js";

const C = ARCADE.MATHRUSH;

/**
 * 문항 번호가 올라갈수록 어려워집니다.
 *   1~10번  두 자리 덧뺄셈
 *   11~25번 한 자리 곱셈
 *   26번~   세 자리 덧뺄셈 / 두 자리 × 한 자리
 */
function makeQuestion(no) {
  if (no <= 10) {
    const a = randomInt(11, 79);
    const b = randomInt(11, 79);
    return randomInt(0, 1) === 0
      ? { a: a + b, op: "-", b, answer: a }
      : { a, op: "+", b, answer: a + b };
  }

  if (no <= 25) {
    const a = randomInt(3, 9);
    const b = randomInt(3, 9);
    return { a, op: "×", b, answer: a * b };
  }

  if (randomInt(0, 1) === 0) {
    const a = randomInt(120, 899);
    const b = randomInt(30, 199);
    return randomInt(0, 1) === 0
      ? { a: a + b, op: "-", b, answer: a }
      : { a, op: "+", b, answer: a + b };
  }

  const a = randomInt(12, 39);
  const b = randomInt(3, 9);
  return { a, op: "×", b, answer: a * b };
}

export const spec = {
  game: "MATHRUSH",
  mode: "BATCH",
  boostLabel: `+${C.BOOST_MS / 1000}초`,
  // bucket(60s/75s/90s)이 이미 보상 사용량을 담고 있으므로 '+' 접미사를 쓰지 않습니다.
  boostBucketSuffix: false,

  makeBatch(meta) {
    const questions = Array.from({ length: C.BATCH_SIZE }, (_, i) => makeQuestion(i + 1));
    meta.ext.limit_ms = C.BASE_LIMIT_MS;

    return {
      pub: {
        questions: questions.map(({ a, op, b }) => ({ a, op, b })),
        limit_ms: C.BASE_LIMIT_MS,
        wrong_penalty_ms: C.WRONG_PENALTY_MS,
        max_limit_ms: C.BASE_LIMIT_MS + C.BOOST_MS * ARCADE.MATHRUSH.boostsPerRun,
      },
      secret: { answers: questions.map((q) => q.answer) },
      limitMs: C.BASE_LIMIT_MS,
    };
  },

  applyBoost(meta) {
    meta.ext.limit_ms = (meta.ext.limit_ms ?? C.BASE_LIMIT_MS) + C.BOOST_MS;
    meta.limit_ms = meta.ext.limit_ms;
    return { data: { limit_ms: meta.ext.limit_ms, added_ms: C.BOOST_MS } };
  },

  /**
   * answers[i] = 입력한 수 (건너뛰었으면 null)
   * times[i]   = 그 문항에 쓴 시간 ms
   */
  gradeBatch({ answers, times, meta, roundSecret, elapsedMs }) {
    const expected = roundSecret?.answers ?? [];
    const limitMs = meta.ext.limit_ms ?? C.BASE_LIMIT_MS;

    let correct = 0;
    let wrong = 0;
    const spent = [];

    for (let i = 0; i < answers.length && i < expected.length; i++) {
      const raw = answers[i];
      if (raw == null) continue; // 시간이 끝나 손대지 못한 문항

      const t = Number(times[i]);
      if (Number.isFinite(t)) spent.push(Math.max(0, t));

      if (Number(raw) === expected[i]) correct += 1;
      else wrong += 1;
    }

    // 오답 페널티만큼 실제 플레이 시간은 제한 시간보다 짧아야 합니다.
    const allowedMs = limitMs - wrong * C.WRONG_PENALTY_MS + 3000;
    const overtime = elapsedMs > allowedMs;

    const avgMs = mean(spent);
    const suspect = overtime || hasImpossibleTiming(spent, C.MIN_ANSWER_MS);

    return {
      cleared: correct,
      correct,
      score: correct,
      suspect,
      ext: { correct, avg_ms: avgMs == null ? null : Math.round(avgMs) },
      detail: {
        correct,
        wrong,
        attempted: correct + wrong,
        limit_ms: limitMs,
        avg_ms: avgMs == null ? null : Math.round(avgMs),
        accuracy: correct + wrong > 0 ? Number(((correct / (correct + wrong)) * 100).toFixed(1)) : 0,
      },
    };
  },

  /** 60s / 75s / 90s — 연장 여부가 곧 리그입니다. */
  bucketOf: (meta) => `${Math.round((meta.ext.limit_ms ?? C.BASE_LIMIT_MS) / 1000)}s`,

  /** 정답 수가 우선, 같으면 평균 응답 시간이 짧은 쪽이 상위 */
  rankMetricOf: (meta) =>
    -((meta.ext.correct ?? 0) * 1000) + Math.min(999, Math.round((meta.ext.avg_ms ?? 9990) / 10)),

  scoreOf: (meta) => meta.ext.correct ?? 0,
};
