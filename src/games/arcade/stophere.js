/**
 * ⑯ 여기서 그만 — ENDLESS
 *
 * 기획: ../../../../reward-minigame-research/plans/2026-07-28/PLAN-07_여기서그만.md
 *
 * 한 장씩 뽑아 쌓다가 스스로 멈춥니다. 꽝이 뜨면 거기서 끝나지만
 * **쌓은 것은 그대로 확정**입니다 — 잃는 경우가 구조적으로 없습니다.
 *
 * 그렇게만 두면 "계속 뽑기"의 기대값이 항상 크거나 같아져서 '그만'을 누를 이유가
 * 사라지고 판단 게임이 성립하지 않습니다. 그래서 **자발 정지 보너스**(STOP_MULT)를 둡니다.
 * 멈추면 ×1.5, 꽝이면 ×1.0. 여기서 처음으로 진짜 판단 지점이 생깁니다.
 *
 * 확률을 숨기지 않습니다. 매 라운드 꽝 확률을 pub 에 담아 화면에 그대로 씁니다.
 * 금융·카드 앱에서 확률형을 다루면서 확률을 감추면 신뢰를 잃고, 공개해도 게임은
 * 성립합니다 — 공개된 확률 아래에서 언제 멈출지가 이 게임의 판단이기 때문입니다.
 *
 * 꽝 여부는 라운드를 만드는 시점에 서버가 확정해 secret 에 둡니다. 응답에 넣지 않으므로
 * 클라이언트가 미리 알 수 없고, 채점도 전적으로 서버가 합니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";

const C = ARCADE.STOPHERE;

const GOODS = ["아메리카노", "샌드위치", "초코바", "생수", "우유", "김밥", "젤리", "빵"];

/** 라운드별 장당 가치 — 후반은 상한으로 눌러 "계속이 항상 유리"해지지 않게 합니다. */
const valueOf = (roundNo) => C.VALUES[roundNo - 1] ?? C.VALUE_MAX;

/** 처음 SAFE_ROUNDS 장은 꽝 없음. 이후 BUST_STEP 씩 올라 BUST_MAX 에서 멈춥니다. */
const bustPctOf = (roundNo) => {
  if (roundNo <= C.SAFE_ROUNDS) return 0;
  const p = C.BUST_START + (roundNo - C.SAFE_ROUNDS - 1) * C.BUST_STEP;
  return Math.min(C.BUST_MAX, Math.round(p * 100) / 100);
};

const payoutIfStop = (stack) => Math.round(stack * C.STOP_MULT);

export const spec = {
  game: "STOPHERE",
  mode: "ENDLESS",
  boostLabel: "꽝 1회 무효",

  makeRound(roundNo, meta) {
    if (roundNo > C.MAX_ROUNDS) return null;

    const stack = meta.stack ?? 0;
    const value = valueOf(roundNo);
    const bustPct = bustPctOf(roundNo);
    const bust = bustPct > 0 && randomInt(1, 10000) <= Math.round(bustPct * 10000);

    return {
      pub: {
        round: roundNo,
        value,
        bust_pct: bustPct, // 숨기지 않습니다
        goods: GOODS[randomInt(0, GOODS.length - 1)],
        stack,
        stop_payout: payoutIfStop(stack),
        stop_mult: C.STOP_MULT,
      },
      secret: { bust, value },
      limitMs: C.LIMIT_MS,
    };
  },

  /**
   * answer 는 "more" 또는 "stop" 입니다.
   *
   * 시간 초과는 "그만"으로 처리합니다. 방치했다고 쌓은 것을 빼앗으면 손실이 생기고,
   * 그 순간 이 게임의 전제("잃는 경우가 없다")가 무너집니다.
   */
  judgeRound({ answer, roundSecret, timedOut, meta }) {
    meta.stack = meta.stack ?? 0;

    if (timedOut || answer === "stop") {
      meta.stopped = !timedOut;
      meta.timed_out = Boolean(timedOut);
      meta.payout = payoutIfStop(meta.stack);
      return {
        ok: true,
        done: true, // 자발 정지는 실패가 아니라 완주입니다
        data: {
          stopped: true,
          timed_out: Boolean(timedOut),
          stack: meta.stack,
          payout: meta.payout,
          mult: C.STOP_MULT,
        },
      };
    }

    if (answer !== "more") {
      return { ok: false, fatal: false, data: { error: "answer 는 more 또는 stop 이어야 합니다" } };
    }

    if (roundSecret?.bust) {
      // 꽝 — 여기서 끝나지만 쌓은 것은 그대로 확정입니다.
      meta.payout = meta.stack;
      meta.busted = true;
      return {
        ok: false,
        fatal: true,
        data: { bust: true, stack: meta.stack, payout: meta.stack, missed_mult: C.STOP_MULT },
      };
    }

    meta.stack += roundSecret?.value ?? 0;
    meta.payout = meta.stack; // 지금 꽝이 나도 받는 금액
    return { ok: true, data: { gained: roundSecret?.value ?? 0, stack: meta.stack } };
  },

  /**
   * 광고 보상 — 이번 꽝을 무효로 하고 이어 갑니다. 쌓은 것은 그대로입니다.
   * 엔진이 목숨을 되찾은 런에 다음 라운드를 바로 발급하므로 여기서는 목숨만 돌려놓습니다.
   */
  applyBoost(meta) {
    meta.lives += 1;
    meta.busted = false;
    return { data: { lives: meta.lives, stack: meta.stack ?? 0 } };
  },

  bucketOf: () => "all",

  // 순위 지표는 "작을수록 좋은" 값으로 정규화합니다.
  rankMetricOf: (meta) => -(meta.payout ?? meta.stack ?? 0),
  scoreOf: (meta) => meta.payout ?? meta.stack ?? 0,

  detailOf: (meta) => ({
    stack: meta.stack ?? 0,
    payout: meta.payout ?? 0,
    stopped: Boolean(meta.stopped),
    busted: Boolean(meta.busted),
    timed_out: Boolean(meta.timed_out),
  }),
};
