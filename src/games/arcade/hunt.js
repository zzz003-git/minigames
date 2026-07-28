/**
 * ⑱ 한 발 앞서 — ENDLESS
 *
 * 기획: ../../../../reward-minigame-research/plans/2026-07-28/PLAN-10_한발앞서.md
 *
 * 격자에 숨은 상품을 찾습니다. 다만 **표적이 매 추측마다 한 칸 움직입니다.**
 *
 * 이 한 줄이 ② 숫자야구와 갈라놓는 전부입니다. 숫자야구는 고정된 답을 힌트로
 * 좁혀 가는 게임이고, 그대로 두면 격자로 옮긴 같은 게임이 됩니다. 표적이 움직이면
 *   · 소거법이 무너진다 — 이미 눌러 본 칸이 다음 턴에 정답이 될 수 있다
 *   · 좁히기가 아니라 앞지르기가 된다 — 지금이 아니라 다음에 갈 자리를 읽는다
 *
 * 이동 경로 전체는 라운드를 만들 때 서버가 확정해 secret 에 둡니다. 응답에는 절대
 * 실리지 않으며, 판정도 서버가 합니다. 반대로 **이동 규칙과 힌트는 공개**합니다 —
 * 숨기면 운 게임이 되고, 공개해야 실력 게임이 됩니다.
 *
 * 라운드 = 한 번의 추측입니다(⑰ 딱 맞게 담기와 같은 방식). 공통 엔진이 판정 후
 * 곧바로 다음 라운드를 내므로, 기회가 남아 있으면 makeRound 가 같은 사냥을 이어 냅니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";

const C = ARCADE.HUNT;

const GOODS = ["신제품 커피", "한정판 젤리", "여름 음료", "샌드위치", "베이커리 세트"];

const cfgOf = (stage) => C.ROUNDS[Math.min(stage, C.ROUNDS.length - 1)];

function neighbors(i, n) {
  const r = Math.floor(i / n), c = i % n, out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

/** 체비셰프 거리 — 대각선을 1로 세야 "바로 옆" 이 직관과 맞습니다. */
function chebyshev(a, b, n) {
  return Math.max(
    Math.abs(Math.floor(a / n) - Math.floor(b / n)),
    Math.abs((a % n) - (b % n)),
  );
}

/** 표적의 전체 이동 경로를 판을 만들 때 확정합니다. */
function makeHunt(stage) {
  const cfg = cfgOf(stage);
  const path = [randomInt(0, cfg.n * cfg.n - 1)];

  for (let t = 1; t < C.PATH_LEN; t++) {
    let cur = path[t - 1];
    let hops = 1;
    if (cfg.step > 1 && randomInt(0, 1) === 1) hops = 2;
    if (cfg.stay && randomInt(0, 4) === 0) hops = 0;
    for (let h = 0; h < hops; h++) {
      const opts = neighbors(cur, cfg.n);
      cur = opts[randomInt(0, opts.length - 1)];
    }
    path.push(cur);
  }

  return {
    stage,
    n: cfg.n,
    step: cfg.step,
    stay: cfg.stay,
    goods: GOODS[randomInt(0, GOODS.length - 1)],
    path,
    at: 0, // 표적이 지금 경로의 몇 번째에 있는가
    used: [], // [{ cell, dist }] — 이미 눌러 본 칸과 그때의 거리
    frozen: false, // 광고 보상으로 한 턴 묶였는가
  };
}

const pubOf = (hunt, meta) => ({
  round: (hunt.stage ?? 0) + 1,
  n: hunt.n,
  goods: hunt.goods,
  step: hunt.step,
  stay: hunt.stay,
  frozen: hunt.frozen,
  used: hunt.used, // 거리 힌트는 공개합니다
  tries_left: meta.tries,
  tries_max: C.TRIES,
  points: meta.points ?? 0,
});

export const spec = {
  game: "HUNT",
  mode: "ENDLESS",
  boostLabel: "표적 1턴 정지 + 기회 1회",

  makeRound(roundNo, meta, secret) {
    meta.points = meta.points ?? 0;

    // 기회가 남아 있으면 **같은 사냥**을 이어 냅니다 (표적은 이미 움직였습니다).
    const pending = secret?.round?.hunt;
    if (pending && (meta.tries ?? 0) > 0) {
      return { pub: pubOf(pending, meta), secret: { hunt: pending }, limitMs: C.LIMIT_MS };
    }

    meta.stage = meta.stage ?? 0;
    meta.tries = C.TRIES;
    const hunt = makeHunt(meta.stage);
    return { pub: pubOf(hunt, meta), secret: { hunt }, limitMs: C.LIMIT_MS };
  },

  /** answer 는 누른 칸 번호입니다. 시간이 끝나면 그 라운드의 기회 하나를 잃습니다. */
  judgeRound({ answer, roundSecret, timedOut, meta }) {
    const hunt = roundSecret?.hunt;
    if (!hunt) return { ok: false, fatal: false, data: { error: "라운드가 없습니다" } };

    const cell = Number(answer);
    const valid = !timedOut && Number.isInteger(cell) && cell >= 0 && cell < hunt.n * hunt.n;
    const here = hunt.path[hunt.at];

    if (valid && cell === here) {
      const cfg = cfgOf(hunt.stage);
      const spare = Math.max(0, (meta.tries ?? 1) - 1);
      const gained = cfg.reward + spare * C.SPARE_BONUS;
      meta.points = (meta.points ?? 0) + gained;
      meta.stage = (meta.stage ?? 0) + 1;
      meta.tries = 0; // 다음 makeRound 가 새 사냥을 시작하도록
      return { ok: true, data: { caught: true, cell, gained, spare, points: meta.points } };
    }

    const dist = valid ? chebyshev(cell, here, hunt.n) : null;
    if (valid) hunt.used.push({ cell, dist });

    // 빗나갔으면 표적이 움직입니다 — 광고로 묶어 둔 턴만 제자리입니다.
    if (hunt.frozen) hunt.frozen = false;
    else hunt.at = Math.min(hunt.at + 1, hunt.path.length - 1);

    meta.tries = Math.max(0, (meta.tries ?? C.TRIES) - 1);
    const last = meta.tries <= 0;

    return {
      ok: false,
      fatal: last, // 마지막 기회까지 빗나가야 목숨이 깎입니다
      data: {
        cell: valid ? cell : null,
        dist,
        band: dist == null ? null : dist <= C.NEAR ? "near" : dist <= C.CLOSE ? "close" : "far",
        timed_out: Boolean(timedOut),
        tries_left: meta.tries,
        // 끝난 뒤에만 표적이 지나간 길을 공개합니다 — "여기서 기다렸으면 잡았다" 가 보여야
        // 예측 게임이 됩니다. 아직 진행 중일 때 공개하면 정답을 알려 주는 것이 됩니다.
        ...(last ? { walked: hunt.path.slice(0, hunt.at + 1) } : {}),
      },
    };
  },

  /** 광고 보상 — 표적을 한 턴 묶고 기회를 하나 돌려줍니다. */
  applyBoost(meta, secret) {
    meta.lives += 1;
    meta.tries = 1;

    const hunt = secret?.round?.hunt;
    if (hunt) hunt.frozen = true;

    return {
      secret: hunt ? { ...secret, round: { hunt } } : secret,
      data: { lives: meta.lives, tries_left: meta.tries, frozen: true },
    };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => -(meta.points ?? 0),
  scoreOf: (meta) => meta.points ?? 0,
  detailOf: (meta) => ({ stage: meta.stage ?? 0, points: meta.points ?? 0 }),
};
