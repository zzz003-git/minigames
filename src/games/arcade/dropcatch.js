/**
 * ⑱ 와르르 받기 — BATCH
 *
 * 떨어지는 상품을 바구니로 받고 폭탄만 피합니다. 폭탄 3개면 종료.
 *
 * 왜 낙하 일정을 미리 내려주는가:
 *   실시간 낙하 게임에서 물체마다 HTTP 왕복을 하면 왕복 지연이 그대로 조작감을 망치고,
 *   서버가 "지금 떨어졌다" 를 밀어 줄 수단(웹소켓)도 없습니다. 그래서 ⑤ 반응속도와 같은
 *   구조를 씁니다 — 서버가 일정을 확정해 세션에 저장하고 클라이언트는 그것을 재생만 하며,
 *   끝나고 결과 전체를 제출하면 서버가 원본 일정과 대조해 다시 채점합니다.
 *
 *   따라서 **점수는 클라이언트가 정할 수 없습니다.** 다만 "실제로 받았는가" 자체는
 *   클라이언트 신고값이라, 전부 받았다고 주장하는 스크립트는 원리적으로 구분되지
 *   않습니다(docs/arcade-10-games.md §6 의 반응속도·링스톱과 같은 한계).
 *   대응은 두 가지입니다.
 *     ① 받은 시각이 그 물건이 바구니 선에 닿는 물리적 창을 벗어나면 어긋난 신고로 셉니다
 *     ② 어긋난 비율이 BAD_TIMING_PCT 를 넘을 때만 이상치 — 한 번의 실수로 판 전체를
 *        순위에서 빼지 않습니다 (docs/arcade-10-games.md §9.2)
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";

const C = ARCADE.DROPCATCH;

/** 경과 시간에 따라 값을 선형으로 줄입니다 (간격·낙하 시간용) */
const shrink = (ms, start, perSec, min) => Math.max(min, start - (ms / 1000) * perSec);

/**
 * 낙하 일정을 만듭니다.
 *
 * fromMs 부터 untilMs 까지 채우며, 이미 만들어 둔 일정 뒤에 이어붙일 수 있도록
 * 시작 시각과 개수 상한을 인자로 받습니다(이어받기로 연장할 때 씁니다).
 */
function buildSchedule(fromMs, untilMs, alreadyCount) {
  const items = [];
  let t = fromMs;

  while (t < untilMs && alreadyCount + items.length < C.MAX_ITEMS) {
    const fallMs = Math.round(shrink(t, C.FALL_START_MS, C.FALL_DECAY_PER_SEC, C.FALL_MIN_MS));

    // 첫 물건은 바구니 시작 자리 바로 위로 — 첫 판을 반드시 성공시킵니다.
    const first = alreadyCount === 0 && items.length === 0;
    const lane = first ? C.FIRST_LANE : randomInt(0, C.LANES - 1);

    let kind = "good";
    if (!first) {
      // SAFE_MS 이전에는 폭탄이 나오지 않습니다.
      const bombPct =
        t < C.SAFE_MS
          ? 0
          : Math.min(
              C.BOMB_MAX_PCT,
              C.BOMB_START_PCT + ((t - C.SAFE_MS) / 1000) * C.BOMB_RISE_PER_SEC,
            );
      const roll = randomInt(1, 100);
      if (roll <= bombPct) kind = "bomb";
      else if (roll > 100 - C.BONUS_PCT) kind = "bonus";
    }

    items.push({ t: Math.round(t), lane, kind, fall_ms: fallMs });
    t += Math.round(shrink(t, C.SPAWN_START_MS, C.SPAWN_DECAY_PER_SEC, C.SPAWN_MIN_MS));
  }

  return items;
}

/**
 * 신고된 결과를 원본 일정과 대조해 채점합니다.
 *
 * answers[i] : 1 = 받음 / 0 = 놓침 (그 뒤로는 손대지 않은 물건이라 null 허용)
 * times[i]   : 그 물건이 판정된 시각 (런 시작 기준 ms)
 */
function grade(items, answers, times, allowedLives) {
  let lives = allowedLives;
  let score = 0;
  let caught = 0;
  let missed = 0;
  let bombsHit = 0;
  let bonus = 0;
  let combo = 0;
  let bestCombo = 0;
  let comboBonus = 0;
  let handled = 0;
  let badTiming = 0;
  let timed = 0;
  let lastT = -1;

  for (let i = 0; i < items.length; i++) {
    if (lives <= 0) break; // 목숨이 떨어진 뒤의 물건은 아예 세지 않습니다

    const raw = answers[i];
    if (raw == null) break; // 시간이 끝나 손대지 못한 물건 — 여기서 판이 끝났습니다

    const item = items[i];
    const got = Number(raw) === 1;
    handled += 1;

    // ── 신고 시각 검증 ──────────────────────────────────────
    // 물건이 바구니 선에 닿는 시각은 일정에서 정해집니다. 그 창을 벗어난 신고는
    // 물리적으로 불가능합니다.
    // 창을 벗어난 신고와 순서가 뒤집힌 신고를 **같은 방식으로** 셉니다.
    // 순서 뒤집힘을 따로 즉시 이상치로 잡으면 한 번의 어긋남이 판 전체를 순위에서
    // 빼게 됩니다 (docs/arcade-10-games.md §9.2).
    // times[i] 가 null 이면 "화면이 멈춰 있던 사이에 지나간 물건" 입니다 — 받을 기회가
    // 없었으므로 시각을 주장하지 않습니다. Number(null) 은 0 이라 먼저 걸러야 합니다.
    const t = times[i] == null ? NaN : Number(times[i]);
    if (Number.isFinite(t)) {
      timed += 1;
      const landAt = item.t + item.fall_ms;
      const offWindow = Math.abs(t - landAt) > C.LAND_TOLERANCE_MS;
      const reversed = t < lastT;
      if (offWindow || reversed) badTiming += 1;
      // 직전 값을 그대로 기준으로 둡니다. 최대값을 들고 가면 크게 튄 값 하나가 그 뒤의
      // 정상 신고를 전부 "순서 뒤집힘" 으로 만들어, 실수 한 번이 비율을 밀어 올립니다.
      lastT = t;
    }

    // ── 판정 ────────────────────────────────────────────────
    if (item.kind === "bomb") {
      if (got) {
        bombsHit += 1;
        lives -= 1;
        combo = 0;
      }
      // 폭탄을 피한 것은 콤보에 영향을 주지 않습니다 — 피하는 게 정상이라 보상하지 않습니다
      continue;
    }

    if (!got) {
      missed += 1;
      combo = 0;
      continue;
    }

    caught += 1;
    score += item.kind === "bonus" ? C.BONUS_POINT : C.GOOD_POINT;
    if (item.kind === "bonus") bonus += 1;

    combo += 1;
    if (combo > bestCombo) bestCombo = combo;
    if (combo % C.COMBO_STEP === 0) {
      comboBonus += C.COMBO_BONUS;
      score += C.COMBO_BONUS;
    }
  }

  // 어긋난 신고가 일정 비율을 넘을 때만 이상치입니다.
  const badPct = timed > 0 ? (badTiming / timed) * 100 : 0;
  const suspect = badPct > C.BAD_TIMING_PCT;

  return {
    score,
    caught,
    missed,
    bombsHit,
    bonus,
    bestCombo,
    comboBonus,
    handled,
    livesLeft: Math.max(0, lives),
    suspect,
    badTiming,
  };
}

export const spec = {
  game: "DROPCATCH",
  mode: "BATCH",
  boostLabel: `목숨 +1 · ${C.BOOST_MS / 1000}초 연장`,

  makeBatch(meta) {
    const items = buildSchedule(0, C.BASE_LIMIT_MS, 0);

    meta.ext.limit_ms = C.BASE_LIMIT_MS;
    meta.ext.lives = C.LIVES;

    return {
      // 낙하 일정은 화면에 그려야 하는 값이라 공개가 불가피합니다
      // (⑦ 순서 기억이 시퀀스를 공개하는 것과 같은 제약).
      // 공개해도 점수를 정할 수 없는 이유는 파일 상단 주석에 있습니다.
      pub: {
        items,
        lanes: C.LANES,
        lives: C.LIVES,
        limit_ms: C.BASE_LIMIT_MS,
        safe_ms: C.SAFE_MS,
        combo_step: C.COMBO_STEP,
        combo_bonus: C.COMBO_BONUS,
        bonus_point: C.BONUS_POINT,
      },
      secret: { items },
      limitMs: C.BASE_LIMIT_MS,
    };
  },

  /** 이어받기 — 목숨 1개를 되돌리고 그만큼 일정을 연장합니다. 점수·콤보는 유지됩니다. */
  applyBoost(meta, secret) {
    const items = secret.round?.items ?? [];
    const from = meta.ext.limit_ms ?? C.BASE_LIMIT_MS;
    const until = from + C.BOOST_MS;

    const added = buildSchedule(from, until, items.length);
    const merged = [...items, ...added];

    meta.ext.limit_ms = until;
    meta.ext.lives = (meta.ext.lives ?? 0) + 1;
    meta.limit_ms = until;

    return {
      secret: { ...secret, round: { items: merged } },
      data: {
        items: added,
        from_index: items.length,
        // 서버는 "이 런에 허용된 목숨 총량", 화면은 "지금 남은 목숨" 을 셉니다.
        // 이름을 갈라 두지 않으면 화면이 total 을 남은 목숨으로 그려 4개가 됩니다.
        lives_added: 1,
        total_lives: meta.ext.lives,
        limit_ms: until,
        added_ms: C.BOOST_MS,
      },
    };
  },

  gradeBatch({ answers, times, meta, roundSecret }) {
    const items = roundSecret?.items ?? [];
    // 이 런에 허용된 목숨 총량. 이어받기로 늘어난 만큼 채점도 늘어나야 합니다 —
    // 여기서 C.LIVES 를 그대로 쓰면 보상을 쓰고 이어받은 구간이 통째로 잘립니다.
    const allowedLives = meta.ext.lives ?? C.LIVES;
    const g = grade(items, answers, times, allowedLives);

    return {
      cleared: g.caught,
      correct: g.caught,
      score: g.score,
      suspect: g.suspect,
      ext: { score: g.score, caught: g.caught, best_combo: g.bestCombo },
      detail: {
        score: g.score,
        caught: g.caught,
        missed: g.missed,
        bombs_hit: g.bombsHit,
        bonus_caught: g.bonus,
        best_combo: g.bestCombo,
        combo_bonus: g.comboBonus,
        handled: g.handled,
        total_items: items.length,
        allowed_lives: allowedLives, // 이어받기로 늘어난 총량이 채점에 실제로 쓰였는지 보이게 둡니다
        lives_left: g.livesLeft,
        limit_ms: meta.ext.limit_ms ?? C.BASE_LIMIT_MS,
        bad_timing: g.badTiming,
      },
    };
  },

  bucketOf: () => "all",

  /** 점수가 우선, 같으면 최고 콤보가 긴 쪽이 상위 */
  rankMetricOf: (meta) =>
    -((meta.ext.score ?? 0) * 1000) + Math.max(0, 999 - Math.min(999, meta.ext.best_combo ?? 0)),

  scoreOf: (meta) => meta.ext.score ?? 0,
};
