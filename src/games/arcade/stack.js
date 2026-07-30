/**
 * ㉑ 퍼펙트 스택 — ENDLESS
 *
 * 좌우로 흐르는 블록을 탭해 쌓습니다. 아래 층과 겹친 부분만 남고 벗어난 부분은
 * 잘려 떨어지며, 남은 폭이 다음 블록의 폭이 됩니다.
 * 기획: plans/2026-07-30/PLAN-18_퍼펙트스택.md (IDEA-2026-0018)
 *
 * ── 서버가 블록 위치를 직접 재현해서 판정합니다 ───────────────────────────
 * 블록은 왕복 시간·시작 위상만 정하면 시각의 함수로 결정되는 값입니다(삼각파).
 * 그래서 클라이언트가 보낸 좌표를 판정에 쓰지 않고 **경과 시간만 받아 위치를 다시
 * 계산**합니다. 신고 좌표는 재현값과 비교하는 정합성 확인에만 씁니다.
 * ⑪ 링 스톱과 같은 구조이고, 남는 한계도 같습니다 — 경과 시간 자체는 클라이언트가
 * 신고하는 값이라 서버 시간창 안에서 유리한 시각을 고르는 조작까지는 막지 못합니다.
 *
 * ── 비밀값이 없습니다 ────────────────────────────────────────────────────
 * 이 게임에는 감출 정답이 없습니다. 블록이 어디를 지나는지는 화면에 다 보이고,
 * 그것을 제때 멈추는 것이 과제입니다. 그래서 라운드 데이터 전부가 공개이고
 * secret 은 비어 있습니다 — 서버가 재현으로 판정하므로 점수를 위조할 수는 없습니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay } from "../../lib/arcade.js";

const C = ARCADE.STACK;

/** 신고 경과 시간과 서버 관측 시간창의 허용 차이 (네트워크 왕복 + 렌더링) */
const NETWORK_TOLERANCE_MS = 700;

/** 화면에 그릴 탑의 최대 층 수. 세션 meta 가 무한히 커지지 않게 오래된 층은 버립니다. */
const TOWER_KEEP = 40;

const round3 = (v) => Number(v.toFixed(3));

/**
 * 시각 t 에서의 블록 왼쪽 끝 위치 (0 ~ 1-width).
 *
 * 삼각파입니다 — 한 왕복(sweep) 동안 왼쪽 끝에서 오른쪽 끝까지 갔다가 돌아옵니다.
 * `phase0` 은 시작 위상이라 매 층 블록이 다른 자리에서 출발합니다.
 */
export function blockX(elapsedMs, sweepMs, phase0, width) {
  const room = Math.max(0, 1 - width);
  const phase = (((elapsedMs / sweepMs + phase0) % 1) + 1) % 1;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return tri * room;
}

/** 층이 오를수록 왕복이 빨라집니다 — 단 SWEEP_MIN_MS 아래로는 내리지 않습니다 */
const sweepOf = (level) =>
  Math.round(decay(level, C.SWEEP_START_MS, C.SWEEP_STEP_MS, C.SWEEP_MIN_MS));

/** 런 시작 상태 — 바닥판 하나 위에 첫 블록을 얹습니다 */
function initExt(meta) {
  const half = C.BASE_WIDTH / 2;
  meta.ext = {
    ...(meta.ext ?? {}),
    // 지금 블록이 얹힐 면(= 직전 층). 0~1 좌표의 [왼쪽, 오른쪽]
    support: [round3(0.5 - half), round3(0.5 + half)],
    width: C.START_WIDTH, // 이번에 흐르는 블록의 폭
    tower: [[round3(0.5 - half), round3(0.5 + half)]], // 그려야 하는 층들 (바닥판 포함)
    levels: 0, // 쌓은 층 수
    combo: 0, // 중앙 정렬 연속
    combos: 0, // 콤보 성립 횟수 (결과 화면용)
    perfects: 0,
    offSum: 0, // 오차 합 — 순위 지표의 동점자 보정에 씁니다
    bestOff: null,
    score: 0,
  };
  return meta.ext;
}

/** 층당 확정 보상 — 위로 갈수록 커집니다 (기획서 7장 「상위 층 가중」) */
const pointsFor = (level) => level;

export const spec = {
  game: "STACK",
  mode: "ENDLESS",
  boostLabel: "이어하기",

  /**
   * 라운드 = 블록 한 개.
   *
   * 층이 오를수록 왕복이 빨라지고(하한 있음) 폭은 직전 겹침만큼 좁아집니다.
   * 시작 위상을 매번 새로 뽑아 같은 리듬으로 반복 탭하는 것을 막습니다.
   */
  makeRound(roundNo, meta) {
    const ext = meta.ext?.support ? meta.ext : initExt(meta);
    const level = (ext.levels ?? 0) + 1;
    const sweep = sweepOf(level);
    const phase0 = randomInt(0, 999) / 1000;

    return {
      pub: {
        level,
        width: ext.width,
        support: ext.support,
        tower: ext.tower,
        sweep_ms: sweep,
        phase0,
        min_width: C.MIN_WIDTH,
        combo: ext.combo ?? 0,
        combo_need: C.COMBO_NEED,
        score: ext.score ?? 0,
        levels: ext.levels ?? 0,
      },
      secret: { sweep, phase0, width: ext.width },
      limitMs: C.ROUND_MAX_MS,
    };
  },

  /**
   * answer = { x: 클라이언트가 그린 블록 왼쪽 끝 } · elapsed_ms = 탭까지의 경과 시간
   *
   * 판정 기준은 **서버가 다시 계산한 위치**입니다. 신고 좌표는 대조용입니다.
   */
  judgeRound({ answer, elapsedMs, timedOut, sinceIssuedMs, roundSecret, meta }) {
    const ext = meta.ext?.support ? meta.ext : initExt(meta);
    const { sweep, phase0, width } = roundSecret ?? {};

    // 20초는 조준 시간이라 넉넉합니다. 그래도 넘겼다면 놓친 것으로 보고 판을 닫습니다.
    if (timedOut || !sweep) {
      return { ok: false, data: { timed_out: true, ...view(ext) } };
    }

    // 신고 경과 시간은 "라운드를 내려보낸 뒤 요청이 도착하기까지" 안에 있어야 하고,
    // 그 차이는 네트워크 왕복 수준이어야 합니다. 벗어나면 서버 관측값으로 판정합니다.
    const claimed = Number(elapsedMs);
    const plausible =
      Number.isFinite(claimed) &&
      claimed >= 0 &&
      claimed <= sinceIssuedMs &&
      sinceIssuedMs - claimed <= NETWORK_TOLERANCE_MS;
    const elapsed = plausible ? claimed : sinceIssuedMs;

    const x = blockX(elapsed, sweep, phase0, width);
    const [sl, sr] = ext.support;

    // 겹친 구간만 남습니다. 벗어난 부분은 잘려 떨어집니다.
    const left = Math.max(x, sl);
    const right = Math.min(x + width, sr);
    const overlap = right - left;

    // 중앙 정렬 판정 — 블록 중심과 받침 중심의 차이
    const off = Math.abs((x + width / 2) - (sl + sr) / 2);
    const perfect = off <= C.PERFECT_TOL;

    // 신고 좌표가 서버 재현값과 크게 어긋나면 조작 신호로 남깁니다 (판정에는 영향 없음).
    const reported = Number(answer?.x);
    const drift = Number.isFinite(reported) ? Math.abs(reported - x) : 0;
    const suspect = !plausible || drift > C.X_TOLERANCE;

    // ── 실패: 겹침이 최소 폭 아래 ─────────────────────────────
    if (overlap < C.MIN_WIDTH) {
      return {
        ok: false,
        suspect,
        data: {
          x: round3(x),
          overlap: round3(Math.max(0, overlap)),
          off: round3(off),
          dropped: true,
          ...view(ext),
        },
      };
    }

    // ── 성공 ──────────────────────────────────────────────────
    const level = (ext.levels ?? 0) + 1;

    // 첫 FREE_LEVELS 층은 폭이 줄지 않습니다(기획서 6장). 얹은 자리를 그대로 받침으로
    // 삼아 층이 온전히 앉습니다 — 규칙을 배우기 전에 잘려 나가는 경험을 주지 않습니다.
    const free = level <= C.FREE_LEVELS;
    const span = free ? [x, x + width] : [left, right];

    ext.support = [round3(span[0]), round3(span[1])];
    ext.levels = level;
    ext.offSum = (ext.offSum ?? 0) + off;
    ext.bestOff = ext.bestOff == null ? off : Math.min(ext.bestOff, off);
    if (perfect) ext.perfects = (ext.perfects ?? 0) + 1;

    ext.tower = [...(ext.tower ?? []), ext.support].slice(-TOWER_KEEP);

    let width2 = free ? width : span[1] - span[0];

    // 중앙 정렬 3연속 → 폭 회복 (기획서 4장 4번)
    ext.combo = perfect ? (ext.combo ?? 0) + 1 : 0;
    let recovered = false;
    if (ext.combo >= C.COMBO_NEED) {
      ext.combo = 0;
      ext.combos = (ext.combos ?? 0) + 1;
      width2 = Math.min(C.START_WIDTH, width2 + C.COMBO_RECOVER);
      recovered = true;
    }

    ext.width = round3(width2);
    const points = pointsFor(level) + (recovered ? C.COMBO_NEED : 0);
    ext.score = (ext.score ?? 0) + points;

    return {
      ok: true,
      suspect,
      data: {
        x: round3(x),
        span: ext.support,
        overlap: round3(overlap),
        off: round3(off),
        perfect,
        recovered,
        points,
        cut: round3(width - overlap),
        ...view(ext),
      },
    };
  },

  /**
   * 「광고 보고 직전 상태에서 이어하기」 — 탑·층수·보상을 그대로 유지합니다(기획서 8장).
   * ext 를 건드리지 않는 것이 곧 "그대로 유지" 입니다.
   *
   * 폭은 마지막으로 성립한 폭으로 되돌립니다. 떨어뜨린 시도는 받침을 바꾸지 않으므로
   * 목숨만 되돌리면 직전 상태가 그대로 복원됩니다.
   */
  applyBoost(meta) {
    const ext = meta.ext?.support ? meta.ext : initExt(meta);
    meta.lives += 1;
    return { data: { lives: meta.lives, ...view(ext) } };
  },

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    const levels = ext.levels ?? 0;
    return {
      levels,
      score: ext.score ?? 0,
      perfects: ext.perfects ?? 0,
      combos: ext.combos ?? 0,
      best_off: ext.bestOff == null ? null : round3(ext.bestOff),
      avg_off: levels > 0 ? round3((ext.offSum ?? 0) / levels) : null,
      last_width: ext.width ?? null,
    };
  },

  bucketOf: () => "all",

  /**
   * 순위 지표 = 층수. 같은 층수면 **평균 오차가 작은 쪽**이 상위입니다.
   *
   * 두 값을 하나로 묶는 방식은 연속 정답형(streakMetric)과 같습니다 —
   * 뒤 항이 0~999 의 양수 페널티라 `unpackCount` 로 층수를 그대로 되돌릴 수 있습니다.
   */
  rankMetricOf: (meta) => {
    const ext = meta.ext ?? {};
    const levels = ext.levels ?? 0;
    const avgOff = levels > 0 ? (ext.offSum ?? 0) / levels : 1;
    return -(levels * 1000) + Math.min(999, Math.round(avgOff * 1000));
  },

  scoreOf: (meta) => meta.ext?.score ?? 0,
};

/** 판정·보상 응답마다 붙이는 "지금까지" 요약 (ENDLESS 는 result.detail 이 비어 있습니다) */
function view(ext) {
  return {
    levels: ext.levels ?? 0,
    score: ext.score ?? 0,
    width: ext.width ?? C.START_WIDTH,
    support: ext.support ?? [0, 0],
    tower: ext.tower ?? [],
    combo: ext.combo ?? 0,
    combos: ext.combos ?? 0,
    perfects: ext.perfects ?? 0,
  };
}
