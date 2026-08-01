/**
 * ⑥ 색 다른 타일 찾기 — ENDLESS
 *
 * 격자에서 하나만 색이 다릅니다. 라운드가 올라가면 격자가 커지고 색 차이가 줄어듭니다.
 *
 * 정답 위치(index)는 응답에 넣지 않고 서버 세션에만 둡니다. 다만 색 배열 자체는
 * 화면에 그려야 하므로, 개발자도구로 배열을 훑어 다른 값을 찾는 것은 막을 수 없습니다.
 * 채점은 전적으로 서버가 하므로 결과 위조는 불가능합니다.
 */

import { ARCADE, adSetOf } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay } from "../../lib/arcade.js";

const C = ARCADE.ODDCOLOR;

/** 3라운드마다 한 단계씩 커지는 격자 (2×2 → 6×6) */
const gridOf = (roundNo) =>
  Math.min(C.GRID_MAX, C.GRID_MIN + Math.floor((roundNo - 1) / C.ROUNDS_PER_GRID));

export const spec = {
  game: "ODDCOLOR",
  mode: "ENDLESS",
  boostLabel: "목숨 +1",

  makeRound(roundNo) {
    const grid = gridOf(roundNo);
    const count = grid * grid;

    // 명도 차이가 라운드마다 좁아집니다. 위아래 어느 쪽으로 벌릴지도 매번 바꿉니다.
    const delta = decay(roundNo, C.DELTA_START, C.DELTA_STEP, C.DELTA_MIN);
    const dir = randomInt(0, 1) === 0 ? -1 : 1;
    const index = randomInt(0, count - 1);

    const set = adSetOf("ODDCOLOR");
    // 광고 세트가 걸려 있으면 판별 대상이 색 자체가 아니라 상품이 됩니다. 한 칸만
    // 밝기를 틀어 두는데, 그 폭은 위의 delta 를 그대로 쓰므로 난이도 곡선이 같습니다.
    const pub =
      set.kind === "glyph"
        ? {
            round: roundNo,
            grid,
            glyph: set.glyphs[randomInt(0, set.glyphs.length - 1)],
            tints: Array.from({ length: count }, (_, i) =>
              i === index ? `brightness(${(1 + (delta / 100) * dir).toFixed(3)})` : "none",
            ),
          }
        : (() => {
            const hue = randomInt(0, 359);
            const sat = randomInt(48, 72);
            const light = randomInt(44, 60);
            const base = `hsl(${hue} ${sat}% ${light}%)`;
            const odd = `hsl(${hue} ${sat}% ${(light + delta * dir).toFixed(1)}%)`;
            return {
              round: roundNo,
              grid,
              colors: Array.from({ length: count }, (_, i) => (i === index ? odd : base)),
            };
          })();

    return {
      pub,
      secret: { index },
      limitMs: Math.round(decay(roundNo, C.LIMIT_START_MS, C.LIMIT_STEP_MS, C.LIMIT_MIN_MS)),
    };
  },

  judgeRound({ answer, roundSecret, timedOut }) {
    const picked = Number(answer);
    const ok = !timedOut && Number.isInteger(picked) && picked === roundSecret.index;

    return {
      ok,
      // 틀렸을 때만 정답을 알려 줍니다 (다음 라운드가 없으므로 노출해도 안전).
      data: ok ? { picked } : { picked, answer_index: roundSecret.index, timed_out: timedOut },
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
