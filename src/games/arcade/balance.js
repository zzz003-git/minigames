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
 * 추 하나를 판 끝(`ARM`)에 놓아 상쇄할 수 있는 토크의 상한.
 * 얹힌 기울기가 이보다 크면 **어디에 놓아도 답이 없습니다.**
 */
const MAX_CANCELABLE = C.WEIGHT_MAX * C.ARM;

/** 왼쪽(음수 위치)에 물건 n 개를 뽑습니다 */
const drawItems = (n, pickInt) =>
  Array.from({ length: n }, () => ({
    w: pickInt(C.WEIGHT_MIN, C.WEIGHT_MAX),
    pos: round2(-(0.3 + pickInt(0, 60) / 100)), // -0.30 ~ -0.90
  }));

/**
 * 레벨 하나를 배정합니다.
 *
 * 처음 얹혀 있는 물건은 **왼쪽(음수 위치)** 에 둡니다 — 기울어진 저울이 첫 화면에서
 * 목표를 설명하기 때문입니다(기획서 0-1). 놓을 물건의 무게는 그 기울기를 되돌릴 수
 * 있는 범위에서 뽑습니다. 되돌릴 수 없는 판을 내면 실력이 아니라 운이 됩니다.
 *
 * ── 답이 없는 판을 내던 버그 (2026-08-04 수정) ──────────────────────────
 * 위 약속을 **코드가 지키지 않았습니다.** 필요한 무게를 `min(WEIGHT_MAX, …)` 로
 * 잘랐기 때문입니다 — 기울기가 `WEIGHT_MAX × ARM` 을 넘으면 잘린 추로는 판 끝에
 * 놓아도 상쇄가 안 됩니다. 얹힌 물건이 늘어나는 상위 레벨일수록 자주 터져
 * **레벨 12 에서 약 59%, 전체 26%** 가 답이 없었습니다(docs/balance-game.md §6).
 *
 * `test:api` 의 산발적 실패가 이것이었습니다. 테스트가 불안정한 것이 아니라
 * 게임이 답 없는 문제를 내고 있었습니다.
 *
 * 고친 방법은 **거부 샘플링**입니다 — 상쇄 가능한 조합이 나올 때까지 다시 뽑습니다.
 * 무게를 잘라 맞추지 않는 이유는, 자르면 「무게는 되돌릴 수 있는 범위에서 뽑는다」는
 * 위 약속이 다시 깨지기 때문입니다. 잘라야 할 판은 애초에 내지 않는 것이 맞습니다.
 */
export function makeLevel(level, pickInt = randomInt) {
  const n = pickInt(C.PRELOAD_MIN, Math.min(C.PRELOAD_MAX, 1 + Math.floor(level / 2)));

  let items = drawItems(n, pickInt);
  // 가장 어려운 레벨에서도 한 번에 통과할 확률이 약 절반이라 40번이면 충분합니다.
  for (let tries = 0; tries < 40 && Math.abs(torqueOf(items)) > MAX_CANCELABLE; tries++) {
    items = drawItems(n, pickInt);
  }

  // 40번으로도 못 뽑은 경우(약 1조분의 1)의 안전망. 기여가 큰 것부터 뺍니다 —
  // 하나만 남으면 최대 토크가 `WEIGHT_MAX × 0.9` 라 반드시 상한 안에 듭니다.
  while (items.length > 1 && Math.abs(torqueOf(items)) > MAX_CANCELABLE) {
    const heaviest = items.reduce(
      (max, it, i) => (Math.abs(it.w * it.pos) > Math.abs(items[max].w * items[max].pos) ? i : max),
      0,
    );
    items.splice(heaviest, 1);
  }

  return { items, drop: { w: dropWeightFor(items) }, tol: round2(tolOf(level)) };
}

/**
 * 얹힌 기울기를 되돌릴 수 있는 추의 무게.
 *
 * **올림이어야 합니다.** 반올림하면 최대 0.5 모자랄 수 있는데, 상위 레벨의 허용
 * 오차는 `TOL_MIN`(0.45)까지 좁아져 그 차이가 오차를 넘습니다 — 답이 없는 판이
 * 됩니다. 올림이면 정답 위치가 `load / w ≤ ARM` 으로 항상 판 안에 있습니다.
 */
const dropWeightFor = (items) =>
  Math.max(C.WEIGHT_MIN, Math.ceil(Math.abs(torqueOf(items)) / C.ARM));

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
      // 새로 뽑지 않고 남은 기울기만 상쇄하면 되므로 무게 계산만 같은 규칙으로 씁니다.
      ext.drop = { w: dropWeightFor(ext.items) };
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
