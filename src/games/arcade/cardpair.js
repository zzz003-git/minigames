/**
 * ⑬ 카드 짝 맞추기 — ENDLESS (라운드 = 카드 한 장 뒤집기)
 *
 * 4×4, 8쌍. 적게 뒤집을수록 상위입니다.
 *
 * ── 카드 배치는 서버 세션에만 있습니다 ────────────────────────────────────
 * 클라이언트는 뒷면만 받고, 카드를 뒤집을 때마다 서버에 물어봅니다.
 * 서버는 그 자리의 그림 하나만 알려 주므로 배치 전체를 미리 볼 수 있는 경로가 없습니다.
 * (숫자야구와 같은 구조 — 신규 10종 중 어뷰징을 완전히 차단할 수 있는 두 게임 중 하나)
 *
 * 광고 보상은 "아직 못 맞춘 한 쌍의 위치 공개" 입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";

const C = ARCADE.CARDPAIR;
const CARDS = C.PAIRS * 2;

export const spec = {
  game: "CARDPAIR",
  mode: "ENDLESS",
  boostLabel: "한 쌍 위치 공개",

  /** 런 내내 유지되는 비밀값 — 카드 배치 */
  initSecret(meta) {
    const symbols = shuffled(C.SYMBOLS, randomInt).slice(0, C.PAIRS);
    const layout = shuffled([...symbols, ...symbols], randomInt);

    meta.ext = { flips: 0, pending: null, matched: [], pairs: C.PAIRS, cards: CARDS };
    return { layout };
  },

  // makeRound 없음: 라운드마다 새로 만들 데이터가 없습니다(배치는 런 시작 때 한 번).

  judgeRound({ answer, meta, runSecret }) {
    const layout = runSecret?.layout ?? [];
    const index = Number(answer);
    const ext = meta.ext;

    if (!Number.isInteger(index) || index < 0 || index >= CARDS) {
      return { ok: false, fatal: false, data: { error: "BAD_INDEX" } };
    }
    if (ext.matched.includes(index) || ext.pending === index) {
      // 이미 맞춘 카드나 방금 뒤집은 카드를 또 누른 경우 — 뒤집기 횟수를 세지 않습니다.
      return { ok: false, fatal: false, data: { index, phase: "ignored" } };
    }

    ext.flips += 1;
    const symbol = layout[index];

    // 첫 장
    if (ext.pending == null) {
      ext.pending = index;
      return { ok: false, fatal: false, data: { index, symbol, phase: "first", flips: ext.flips } };
    }

    // 둘째 장
    const first = ext.pending;
    ext.pending = null;

    if (layout[first] === symbol) {
      ext.matched.push(first, index);
      const done = ext.matched.length >= CARDS;
      return {
        ok: true,
        fatal: false,
        done,
        data: { index, symbol, phase: "match", matched: [first, index], flips: ext.flips },
      };
    }

    return {
      ok: false,
      fatal: false,
      data: { index, symbol, phase: "miss", pair: [first, index], flips: ext.flips },
    };
  },

  /** 아직 못 맞춘 카드 중 한 쌍의 위치를 공개합니다. */
  applyBoost(meta, secret) {
    const layout = secret.ext?.layout ?? [];
    const ext = meta.ext;

    const open = layout
      .map((symbol, index) => ({ symbol, index }))
      .filter((c) => !ext.matched.includes(c.index));

    if (open.length < 2) return { data: null };

    const pick = open[randomInt(0, open.length - 1)];
    const twin = open.find((c) => c.symbol === pick.symbol && c.index !== pick.index);
    if (!twin) return { data: null };

    return { data: { pair: [pick.index, twin.index], symbol: pick.symbol } };
  },

  bucketOf: () => "4x4",

  /** 뒤집기 횟수가 우선, 같으면 빠른 쪽이 상위 */
  rankMetricOf: (meta, { elapsedMs }) =>
    (meta.ext.flips ?? 999) * 100000 + Math.min(99999, Math.round(elapsedMs / 1000)),

  scoreOf: (meta) => meta.ext.flips ?? 0,
};
