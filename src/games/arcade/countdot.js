/**
 * ⑫ 순간 개수 세기 — ENDLESS
 *
 * 점이 0.4초쯤 나타났다 사라집니다. 몇 개였는지 숫자패드로 입력합니다.
 * 라운드가 올라가면 점이 많아지고 노출 시간이 짧아집니다. 목숨 3개.
 *
 * 점의 좌표는 화면에 그려야 하므로 응답에 포함됩니다. 채점(개수 비교)은 서버가 합니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay, growth } from "../../lib/arcade.js";

const C = ARCADE.COUNTDOT;

/**
 * 점 좌표를 겹치지 않게 배치합니다.
 * 겹쳐 보이면 "몇 개인지" 가 아니라 "몇 개로 보이는지" 를 묻는 게임이 되어 버립니다.
 */
function scatter(count) {
  const dots = [];
  const minDist = Math.max(9, 30 - count); // 점이 많아질수록 간격 기준을 완화

  for (let i = 0; i < count; i++) {
    let placed = null;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const x = randomInt(7, 93);
      const y = randomInt(9, 91);
      const clash = dots.some((d) => Math.hypot(d.x - x, d.y - y) < minDist);
      if (!clash) placed = { x, y };
    }
    dots.push(placed ?? { x: randomInt(7, 93), y: randomInt(9, 91) });
  }

  return dots;
}

export const spec = {
  game: "COUNTDOT",
  mode: "ENDLESS",
  boostLabel: "목숨 +1",

  makeRound(roundNo) {
    const maxDots = Math.round(
      growth(roundNo, C.MAX_DOTS_START, C.MAX_DOTS_STEP, C.MAX_DOTS_CAP),
    );
    const count = randomInt(C.MIN_DOTS, maxDots);
    const exposeMs = Math.round(
      decay(roundNo, C.EXPOSE_START_MS, C.EXPOSE_STEP_MS, C.EXPOSE_MIN_MS),
    );

    return {
      pub: { round: roundNo, dots: scatter(count), expose_ms: exposeMs, max_dots: maxDots },
      secret: { count },
      limitMs: exposeMs + C.INPUT_LIMIT_MS,
    };
  },

  judgeRound({ answer, roundSecret, timedOut }) {
    const guess = Number(answer);
    const ok = !timedOut && Number.isInteger(guess) && guess === roundSecret.count;

    return {
      ok,
      data: { guess: Number.isFinite(guess) ? guess : null, count: roundSecret.count, timed_out: timedOut },
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
