/**
 * ⑦ 순서 기억 — ENDLESS
 *
 * 3×3 패드가 순서대로 반짝입니다. 같은 순서로 누르면 다음 라운드.
 * 라운드마다 길이가 1씩 늘고 점멸이 빨라집니다.
 *
 * 시퀀스는 화면에 보여줘야 하므로 응답에 포함됩니다(숫자 기억력과 같은 제약).
 * 채점은 서버가 원본과 비교하므로 결과 위조는 불가능합니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay } from "../../lib/arcade.js";

const C = ARCADE.SEQUENCE;

const lengthOf = (roundNo) => C.START_LENGTH + (roundNo - 1);

export const spec = {
  game: "SEQUENCE",
  mode: "ENDLESS",
  boostLabel: "목숨 +1",

  makeRound(roundNo) {
    const length = lengthOf(roundNo);
    const flashMs = Math.round(decay(roundNo, C.FLASH_START_MS, C.FLASH_STEP_MS, C.FLASH_MIN_MS));

    // 바로 앞과 같은 칸이 연속되면 "두 번 반짝인 건지" 헷갈리므로 피합니다.
    const sequence = [];
    for (let i = 0; i < length; i++) {
      let pad = randomInt(0, C.PADS - 1);
      if (i > 0 && pad === sequence[i - 1]) pad = (pad + 1 + randomInt(0, C.PADS - 2)) % C.PADS;
      sequence.push(pad);
    }

    return {
      pub: { round: roundNo, pads: C.PADS, length, flash_ms: flashMs, sequence },
      secret: { sequence },
      // 재생 시간 + 입력 시간
      limitMs: flashMs * length * 2 + length * C.INPUT_MS_PER_STEP,
    };
  },

  judgeRound({ answer, roundSecret, timedOut }) {
    const expected = roundSecret.sequence;
    const input = Array.isArray(answer) ? answer.map(Number) : [];

    const ok =
      !timedOut &&
      input.length === expected.length &&
      input.every((v, i) => v === expected[i]);

    // 어디서 틀렸는지 알려 주면 "다음엔 될 것 같다" 는 느낌이 생깁니다.
    const missAt = ok ? null : input.findIndex((v, i) => v !== expected[i]);

    return {
      ok,
      data: ok
        ? { length: expected.length }
        : { expected, input, miss_at: missAt < 0 ? input.length : missAt, timed_out: timedOut },
    };
  },

  applyBoost(meta) {
    meta.lives += 1;
    return { data: { lives: meta.lives } };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => -meta.cleared,
  scoreOf: (meta) => meta.cleared,
};
