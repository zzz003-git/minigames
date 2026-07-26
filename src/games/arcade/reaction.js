/**
 * ⑤ 반응속도 테스트 — BATCH
 *
 * 초록으로 바뀌는 순간 탭. 5시행의 평균이 기록입니다.
 *
 * 왜 대기 시간을 클라이언트에 미리 내려주는가:
 *   서버가 "지금 초록" 을 밀어 줄 수단(웹소켓)이 없고, 매 시행마다 HTTP 왕복을 하면
 *   왕복 지연이 그대로 반응 시간에 섞입니다. 그래서 스탑워치와 같은 구조를 씁니다 —
 *   측정은 클라이언트의 performance.now(), 검증은 서버의 시간창과 인간 하한.
 *   대기 시간을 아는 스크립트는 완벽한 기록을 낼 수 있고, 그건 100ms 하한과
 *   시간창 검증으로 이상치 표시까지만 대응합니다 (docs/arcade-10-games.md §6).
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { mean } from "../../lib/arcade.js";

const C = ARCADE.REACTION;

const randomWait = () => randomInt(C.WAIT_MIN_MS, C.WAIT_MAX_MS);

export const spec = {
  game: "REACTION",
  mode: "BATCH",
  boostLabel: `시행 +1 (좋은 ${C.TRIALS}개만 채택)`,

  makeBatch(meta) {
    const waits = Array.from({ length: C.TRIALS }, randomWait);
    meta.ext.trials = C.TRIALS;

    return {
      pub: {
        waits,
        adopt: C.TRIALS,
        max_trials: C.MAX_TRIALS,
        reaction_max_ms: C.REACTION_MAX_MS,
      },
      secret: { waits },
      // 대기 시간 합 + 시행당 최대 반응 시간 + 여유. 이 이상 걸리면 시간창 검증에서 걸립니다.
      limitMs: waits.reduce((a, b) => a + b, 0) + C.TRIALS * C.REACTION_MAX_MS + 15000,
    };
  },

  /** 광고 1회 = 시행 1회 추가. 총 7시행 중 좋은 5개만 채택합니다. */
  applyBoost(meta, secret) {
    const wait = randomWait();
    const waits = [...(secret.round?.waits ?? []), wait];
    meta.ext.trials = waits.length;

    return {
      secret: { ...secret, round: { waits } },
      data: { wait_ms: wait, trial_index: waits.length - 1, trials: waits.length },
    };
  },

  /**
   * answers[i] = 반응 시간(ms), 부정출발은 -1.
   * times[i]   = 그 시행에 실제로 걸린 시간(대기 + 반응) — 내부 정합성 검증용.
   */
  gradeBatch({ answers, times, roundSecret, elapsedMs }) {
    const waits = roundSecret?.waits ?? [];

    const trials = answers.slice(0, waits.length).map((raw, i) => {
      const ms = Number(raw);
      const falseStart = !Number.isFinite(ms) || ms < 0;
      const missed = !falseStart && ms > C.REACTION_MAX_MS;
      return {
        index: i,
        wait_ms: waits[i],
        reaction_ms: falseStart || missed ? null : Math.round(ms),
        false_start: falseStart,
        missed,
      };
    });

    const valid = trials.filter((t) => t.reaction_ms != null).map((t) => t.reaction_ms);
    // 좋은 기록 TRIALS 개만 채택 — 광고로 늘린 시행은 최악값을 버리는 데 쓰입니다.
    const adopted = [...valid].sort((a, b) => a - b).slice(0, C.TRIALS);
    const avg = mean(adopted);

    // 사람이 낼 수 없는 반응 시간 + 신고한 시행 시간의 합이 실제 경과보다 큰 경우
    const tooFast = valid.some((ms) => ms < C.HUMAN_FLOOR_MS);
    const claimed = times.reduce((a, b) => a + (Number.isFinite(Number(b)) ? Number(b) : 0), 0);
    const inconsistent = claimed > elapsedMs + 3000;

    return {
      cleared: adopted.length,
      correct: adopted.length,
      score: avg == null ? 0 : Math.round(avg),
      suspect: tooFast || inconsistent,
      ext: { avg_ms: avg == null ? null : Math.round(avg) },
      detail: {
        trials,
        adopted_count: adopted.length,
        total_trials: trials.length,
        false_starts: trials.filter((t) => t.false_start).length,
        avg_ms: avg == null ? null : Math.round(avg),
        best_ms: adopted.length > 0 ? adopted[0] : null,
        worst_ms: adopted.length > 0 ? adopted[adopted.length - 1] : null,
      },
    };
  },

  bucketOf: () => "all",

  /** 평균 반응 시간(ms). 유효 시행이 하나도 없으면 최하위. */
  rankMetricOf: (meta) => meta.ext.avg_ms ?? 99999,

  scoreOf: (meta) => meta.ext.avg_ms ?? 0,
};
