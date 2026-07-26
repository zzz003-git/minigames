/**
 * ⑪ 링 스톱 — ENDLESS
 *
 * 원 궤도를 도는 점이 밝은 구간(타겟 아크)에 들어왔을 때 탭합니다.
 * 라운드가 올라가면 빨라지고 구간이 좁아집니다.
 *
 * ── 서버가 점의 위치를 직접 재현해서 판정합니다 ───────────────────────────
 * 점의 위치는 (시작각 + 각속도 × 경과시간) 으로 결정되는 결정론적 값입니다.
 * 그래서 서버는 클라이언트가 보낸 각도를 판정에 쓰지 않고, 경과 시간만 받아
 * 각도를 다시 계산합니다. 신고 각도는 재현값과 비교하는 정합성 확인에만 씁니다.
 *
 * 남는 한계 (정직하게 기록):
 *   경과 시간 자체는 클라이언트가 신고하는 값이라, 서버 시간창 안에서
 *   유리한 시각을 골라 신고하는 조작까지는 막지 못합니다. 신고값이 서버 시간창과
 *   네트워크 지연 수준(700ms) 이상 어긋나면 서버 관측값으로 판정하고 이상치로 표시합니다.
 *   스탑워치에서 내린 것과 같은 결론입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay, growth } from "../../lib/arcade.js";

const C = ARCADE.RINGSTOP;

/** 신고 경과 시간과 서버 관측 시간창의 허용 차이 (네트워크 왕복 + 렌더링) */
const NETWORK_TOLERANCE_MS = 700;

const mod360 = (deg) => ((deg % 360) + 360) % 360;

/** 두 각도 사이의 최단 거리 (0~180) */
const angleGap = (a, b) => {
  const d = Math.abs(mod360(a) - mod360(b));
  return d > 180 ? 360 - d : d;
};

export const spec = {
  game: "RINGSTOP",
  mode: "ENDLESS",
  boostLabel: "목숨 +1",

  makeRound(roundNo) {
    const speed = Math.round(growth(roundNo, C.SPEED_START, C.SPEED_STEP, C.SPEED_MAX));
    const arc = Math.round(decay(roundNo, C.ARC_START, C.ARC_STEP, C.ARC_MIN));
    const start = randomInt(0, 359);

    // 타겟이 시작 위치 바로 앞에 놓이면 반응할 시간이 없으므로 최소 60° 떨어뜨립니다.
    const target = mod360(start + randomInt(60, 300));

    return {
      pub: {
        round: roundNo,
        speed_dps: speed,
        arc_deg: arc,
        start_deg: start,
        target_start_deg: target,
      },
      secret: { speed, arc, start, target },
      limitMs: C.ROUND_MAX_MS,
    };
  },

  judgeRound({ answer, elapsedMs, roundSecret, timedOut, sinceIssuedMs }) {
    if (timedOut) {
      return { ok: false, data: { timed_out: true } };
    }

    const { speed, arc, start, target } = roundSecret;

    // 신고한 경과 시간은 "서버가 라운드를 내려보낸 뒤 요청이 도착하기까지" 안에 있어야 하고,
    // 그 차이는 네트워크 왕복 수준이어야 합니다. 벗어나면 서버 관측값으로 판정합니다.
    const claimedMs = Number(elapsedMs);
    const plausible =
      Number.isFinite(claimedMs) &&
      claimedMs >= 0 &&
      claimedMs <= sinceIssuedMs &&
      sinceIssuedMs - claimedMs <= NETWORK_TOLERANCE_MS;

    const elapsed = plausible ? claimedMs : sinceIssuedMs;

    // 서버가 직접 계산한 점 위치 — 판정 기준은 이 값입니다.
    const actual = mod360(start + (speed * elapsed) / 1000);

    // 타겟 아크는 target 부터 시계 방향으로 arc 만큼입니다.
    const into = mod360(actual - target);
    const ok = into <= arc;

    // 신고 각도가 서버 재현값과 크게 어긋나면 조작 신호로 남깁니다 (판정에는 영향 없음).
    const reported = Number(answer?.angle_deg);
    const drift = Number.isFinite(reported) ? angleGap(reported, actual) : 0;

    return {
      ok,
      suspect: !plausible || drift > C.ANGLE_TOLERANCE_DEG,
      data: {
        actual_deg: Number(actual.toFixed(1)),
        target_start_deg: target,
        arc_deg: arc,
        // 아크 중심에서 얼마나 벗어났는지 — "거의 다 왔다" 를 보여 주는 값
        off_deg: Number(angleGap(actual, mod360(target + arc / 2)).toFixed(1)),
        drift_deg: Number(drift.toFixed(1)),
      },
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
