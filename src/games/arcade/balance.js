/**
 * ㉔ 밸런스 드롭 — ENDLESS
 *
 * 물건을 떨어뜨려 저울을 수평(초록 구간)에 맞춥니다.
 * 기획: plans/2026-07-30/PLAN-20_밸런스드롭.md (IDEA-2026-0020) · docs/balance-game.md
 *
 * ── 무게를 숨기지 않습니다 ───────────────────────────────────────────────
 * 무게가 전부 보입니다. 숨기면 계산이 아니라 추측이 되고, 추측은 기대값 게임입니다
 * (기획서 0절 안티패턴 검사). 그래서 이 게임에는 감출 정답이 없고, 남는 것은 조준입니다.
 *
 * ── 판정은 순수 계산입니다 ───────────────────────────────────────────────
 * 토크 = Σ(무게 × 위치). 클라이언트가 보내는 것은 **놓은 위치 하나**뿐이고 나머지는
 * 서버가 가진 값입니다. 시각을 신고하지 않으므로 시간 조작 경로가 아예 없습니다 —
 * ⑪ 링 스톱·㉑ 퍼펙트 스택보다 검증이 단순합니다. 화면의 흔들림은 연출일 뿐입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay } from "../../lib/arcade.js";

const C = ARCADE.BALANCE;

const round2 = (v) => Number(v.toFixed(2));

/** 레벨이 오르면 초록 구간이 좁아집니다. 첫 판은 넓게 둡니다(기획서 0-4) */
const tolOf = (level) =>
  level === 1 ? C.FIRST_LEVEL_TOL : decay(level, C.TOL_START, C.TOL_STEP, C.TOL_MIN);

/** 접시에 얹힌 물건들의 토크 합 */
const torqueOf = (items) => items.reduce((s, it) => s + it.w * it.pos, 0);

/**
 * 레벨 하나를 배정합니다.
 *
 * 처음 얹혀 있는 물건은 **왼쪽(음수 위치)** 에 둡니다 — 기울어진 저울이 첫 화면에서
 * 목표를 설명하기 때문입니다(기획서 0-1). 놓을 물건의 무게는 그 기울기를 되돌릴 수
 * 있는 범위에서 뽑습니다. 되돌릴 수 없는 판을 내면 실력이 아니라 운이 됩니다.
 */
export function makeLevel(level, pickInt = randomInt) {
  const n = pickInt(C.PRELOAD_MIN, Math.min(C.PRELOAD_MAX, 1 + Math.floor(level / 2)));
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      w: pickInt(C.WEIGHT_MIN, C.WEIGHT_MAX),
      pos: round2(-(0.3 + pickInt(0, 60) / 100)), // -0.30 ~ -0.90
    });
  }

  const load = Math.abs(torqueOf(items));
  // |w × pos| 로 load 를 상쇄할 수 있어야 합니다. pos 는 최대 ARM 이므로 w >= load/ARM.
  const need = Math.ceil(load / C.ARM);
  const w = Math.min(C.WEIGHT_MAX, Math.max(C.WEIGHT_MIN, need));

  return { items, drop: { w }, tol: round2(tolOf(level)) };
}

const viewOf = (ext) => ({
  level: ext.level ?? 1,
  items: ext.items ?? [],
  torque: round2(torqueOf(ext.items ?? [])),
  tol: ext.tol ?? C.TOL_START,
  score: ext.score ?? 0,
});

export const spec = {
  game: "BALANCE",
  mode: "ENDLESS",
  boostLabel: "한 개 더 놓기",

  makeRound(roundNo, meta) {
    const ext = meta.ext ?? (meta.ext = {});
    const level = (meta.cleared ?? 0) + 1;

    // 이어하기 직후에는 **저울을 그대로 두고** 물건 하나만 더 줍니다 (기획서 4장 6번)
    const keep = ext.keep === true;
    if (!keep || !ext.items) {
      const made = makeLevel(level);
      ext.items = made.items;
      ext.drop = made.drop;
      ext.tol = made.tol;
    } else {
      ext.drop = { w: Math.max(C.WEIGHT_MIN, Math.round(Math.abs(torqueOf(ext.items)) / C.ARM)) };
    }
    ext.keep = false;
    ext.level = level;

    return {
      pub: {
        level,
        items: ext.items, // 무게가 전부 보입니다
        drop_w: ext.drop.w,
        tol: ext.tol,
        arm: C.ARM,
        torque: round2(torqueOf(ext.items)),
        score: ext.score ?? 0,
      },
      secret: { w: ext.drop.w, tol: ext.tol },
      limitMs: C.ROUND_MAX_MS,
    };
  },

  /** answer = { pos: -1 ~ +1 } — 놓은 위치. 나머지는 서버가 가진 값으로 계산합니다 */
  judgeRound({ answer, timedOut, roundSecret, meta }) {
    const ext = meta.ext ?? (meta.ext = {});
    if (timedOut) return { ok: false, data: { timed_out: true, ...viewOf(ext) } };

    const pos = Number(answer?.pos);
    if (!Number.isFinite(pos) || Math.abs(pos) > C.ARM) {
      return { ok: false, data: { invalid: "저울 밖입니다", ...viewOf(ext) } };
    }

    const placed = { w: roundSecret.w, pos: round2(pos) };
    ext.items = [...(ext.items ?? []), placed];

    const torque = torqueOf(ext.items);
    const ok = Math.abs(torque) <= roundSecret.tol;
    if (ok) ext.score = (ext.score ?? 0) + C.LEVEL_POINT;

    return {
      ok,
      data: {
        placed,
        torque: round2(torque),
        tol: roundSecret.tol,
        // 얼마나 벗어났는지 — 「2mm 부족했다」를 보여 주는 값입니다
        off: round2(Math.max(0, Math.abs(torque) - roundSecret.tol)),
        ...viewOf(ext),
      },
    };
  },

  /** 「한 개 더 놓기」 — 현재 저울 상태 그대로 물건 하나를 추가로 놓습니다 */
  applyBoost(meta) {
    const ext = meta.ext ?? (meta.ext = {});
    meta.lives += 1;
    ext.keep = true; // 다음 makeRound 가 저울을 새로 만들지 않게 표시합니다
    return { data: { lives: meta.lives, ...viewOf(ext) } };
  },

  detailOf: (meta) => ({
    levels: meta.cleared ?? 0,
    score: meta.ext?.score ?? 0,
    last_torque: round2(torqueOf(meta.ext?.items ?? [])),
  }),

  bucketOf: () => "all",
  rankMetricOf: (meta) => -meta.cleared,
  scoreOf: (meta) => meta.ext?.score ?? 0,
};
