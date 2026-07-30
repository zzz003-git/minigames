/**
 * ㉓ 리듬 에코 — ENDLESS
 *
 * 빛나는 박자를 그대로 두드려 따라 합니다.
 * 기획: plans/2026-07-30/PLAN-19_리듬에코.md (IDEA-2026-0019)
 *
 * ── ⑦ 순서 기억과 무엇이 다른가 ──────────────────────────────────────────
 * 조작은 같은 탭이지만 **기억 대상이 위치가 아니라 간격**입니다. 그래서 판정이
 * 좌표 비교가 아니라 **간격 차이 비교**입니다 — 코드를 공유하지 않습니다.
 *
 * ── 시간 제한이 없습니다 ─────────────────────────────────────────────────
 * 제시가 끝나면 사용자가 시작할 때까지 기다립니다. 빠른 반응이 아니라 간격의 재현이
 * 과제라 연령 장벽이 생기지 않습니다(기획서 0절 반응속도 검사).
 * 판정은 **첫 탭을 기준으로 한 상대 간격**만 봅니다 — 언제 시작했는지는 채점하지 않습니다.
 *
 * ── 남는 한계 ────────────────────────────────────────────────────────────
 * 패턴을 빛으로 재생해야 하므로 간격 배열이 화면에 내려갑니다(⑦ 과 같은 성질).
 * 채점은 서버가 하므로 결과 위조는 불가능합니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay } from "../../lib/arcade.js";

const C = ARCADE.RHYTHM;

/** 레벨 = 지금까지 통과한 수 + 1. 박 수는 레벨마다 하나씩 늘어납니다 */
const beatsOf = (level) => Math.min(C.MAX_BEATS, C.START_BEATS + level - 1);

/** 관용도는 좁아지지만 하한이 있습니다 — 이 하한이 「반응속도 게임 아님」의 근거입니다 */
const tolOf = (level) => Math.round(decay(level, C.TOL_START_MS, C.TOL_STEP_MS, C.TOL_MIN_MS));

/**
 * 간격 배열을 만듭니다. 박 수가 n 이면 간격은 n-1 개입니다.
 * GAP_STEP_MS 단위로만 뽑는 것은 사람이 재현할 수 있는 해상도로 제한하기 위한 것입니다.
 */
export function makePattern(level, pickInt = randomInt) {
  const beats = beatsOf(level);
  const steps = Math.floor((C.GAP_MAX_MS - C.GAP_MIN_MS) / C.GAP_STEP_MS);
  const gaps = [];
  for (let i = 0; i < beats - 1; i++) {
    gaps.push(C.GAP_MIN_MS + pickInt(0, steps) * C.GAP_STEP_MS);
  }
  return gaps;
}

/**
 * 탭 시각 배열을 간격으로 바꿔 정답과 비교합니다.
 *
 * @returns {{ ok:boolean, worst:number, offs:number[] }}
 */
export function judgeTaps(taps, gaps, tolMs) {
  const list = (Array.isArray(taps) ? taps : []).map(Number).filter((v) => Number.isFinite(v));
  if (list.length !== gaps.length + 1) return { ok: false, worst: Infinity, offs: [] };

  const offs = [];
  for (let i = 0; i < gaps.length; i++) {
    const got = list[i + 1] - list[i];
    if (!(got > 0)) return { ok: false, worst: Infinity, offs };
    offs.push(Math.round(got - gaps[i]));
  }

  const worst = offs.reduce((m, o) => Math.max(m, Math.abs(o)), 0);
  return { ok: worst <= tolMs, worst, offs };
}

export const spec = {
  game: "RHYTHM",
  mode: "ENDLESS",
  boostLabel: "패턴 다시 보기",

  makeRound(roundNo, meta) {
    const level = (meta.cleared ?? 0) + 1;
    const gaps = makePattern(level);
    const tol = tolOf(level);

    return {
      pub: {
        level,
        beats: gaps.length + 1,
        gaps, // 빛을 재생해야 하므로 공개가 불가피합니다
        tol_ms: tol,
      },
      secret: { gaps, tol },
      // 시간 제한 없음. 다만 세션이 1시간이면 만료되므로 한 레벨을 무한히 열어 두지 않습니다
      limitMs: 5 * 60 * 1000,
    };
  },

  judgeRound({ answer, roundSecret, timedOut }) {
    if (timedOut) return { ok: false, data: { timed_out: true } };

    const { gaps, tol } = roundSecret ?? {};
    if (!gaps) return { ok: false, data: { invalid: true } };

    const { ok, worst, offs } = judgeTaps(answer?.taps, gaps, tol);

    return {
      ok,
      data: {
        ok,
        tol_ms: tol,
        worst_off: Number.isFinite(worst) ? worst : null,
        offs,
        // 어느 박이 어긋났는지 — 「반 박자 차이로 끝났다」를 보여 주는 값입니다
        worst_at: offs.length ? offs.findIndex((o) => Math.abs(o) === worst) : -1,
      },
    };
  },

  /** 같은 레벨을 다시 시도합니다 — cleared 를 건드리지 않으므로 다음 라운드가 같은 레벨입니다 */
  applyBoost(meta) {
    meta.lives += 1;
    return { data: { lives: meta.lives, level: (meta.cleared ?? 0) + 1 } };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => -meta.cleared,
  scoreOf: (meta) => (meta.cleared ?? 0) * C.LEVEL_POINT,
};
