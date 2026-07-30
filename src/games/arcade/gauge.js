/**
 * ㉗ 오늘의 전국 게이지 — ENDLESS
 *
 * 기여 토큰을 밀어 넣어 **모든 사용자가 함께 채우는 하루 목표**를 올립니다.
 * 기획: plans/2026-07-30/PLAN-17_오늘의전국게이지.md (IDEA-2026-0017) · docs/gauge-game.md
 *
 * ── 이 기획은 원래 게임이 아닙니다 ───────────────────────────────────────
 * 기획서는 「배포 전 게임에 얹히는 시즌 레이어」로 쓰였습니다. 여기서는 그 게이지를
 * 눈으로 보고 직접 기여하는 **참여 화면**으로 먼저 구현합니다 — 전역 카운터·해금·정산이
 * 실제로 도는지 확인하는 것이 레이어로 확장하기 전의 순서입니다(docs/gauge-game.md §3).
 *
 * ── 전역 카운터 ──────────────────────────────────────────────────────────
 * `UPDATE ... SET total = total + ?` 한 문장으로 올립니다. SQLite(D1)는 쓰기를
 * 직렬화하므로 이 증가는 **원자적**입니다 — 읽고 더해 쓰는 방식이 아니라 한 문장이라
 * 경합에서 값이 유실되지 않습니다. 대규모에서 걸리는 것은 정확성이 아니라 쓰기
 * 처리량이고, 그 지점에서 캐시 계층이나 Durable Objects 로 옮겨야 합니다.
 *
 * ⑮ 다들 뭐 골랐을까에 이어 **사용자 간 공용 상태를 쓰는 두 번째 게임**입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { dayKey, now } from "../../lib/time.js";

const C = ARCADE.GAUGE;

/** 오늘 게이지를 읽습니다 (없으면 0) */
async function readGauge(env, day) {
  const row = await env.DB.prepare(`SELECT total FROM gauge_daily WHERE day = ?`).bind(day).first();
  return row?.total ?? 0;
}

/**
 * 오늘 게이지를 올립니다. **한 문장 증가**라 동시 호출에서도 값이 유실되지 않습니다.
 * 새 날의 첫 기여는 INSERT 로 만들어지고, 그 뒤부터는 DO UPDATE 로 더해집니다.
 */
async function bumpGauge(env, day, amount) {
  await env.DB.prepare(
    `INSERT INTO gauge_daily (day, total, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET total = total + excluded.total, updated_at = excluded.updated_at`,
  )
    .bind(day, amount, now())
    .run();
}

async function readMine(env, userId, day) {
  const row = await env.DB.prepare(
    `SELECT tokens FROM gauge_contrib WHERE user_id = ? AND day = ?`,
  )
    .bind(userId, day)
    .first();
  return row?.tokens ?? 0;
}

async function saveMine(env, userId, day, tokens) {
  await env.DB.prepare(
    `INSERT INTO gauge_contrib (user_id, day, tokens, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET
       tokens = gauge_contrib.tokens + excluded.tokens, updated_at = excluded.updated_at`,
  )
    .bind(userId, day, tokens, now())
    .run();
}

/** 목표 대비 몇 %인지, 그리고 지금까지 열린 단계 수 */
export function stagesOf(total) {
  const pct = Math.min(100, Math.round((total / C.DAILY_TARGET) * 100));
  const opened = C.STAGES.filter((s) => pct >= s).length;
  const nextAt = C.STAGES.find((s) => pct < s) ?? null;
  return { pct, opened, nextAt };
}

const viewOf = (ext) => {
  const total = ext.total ?? 0;
  const { pct, opened, nextAt } = stagesOf(total);
  return {
    total,
    target: C.DAILY_TARGET,
    pct,
    stages: C.STAGES,
    opened,
    next_at: nextAt,
    my_tokens: ext.myTokens ?? 0,
    // 판정 응답의 `added` 는 **그 토큰 하나**의 증가분이고, 이것은 **판 전체**의 기여입니다.
    // 한 이름으로 두 뜻을 쓰면 화면이 조용히 틀린 값을 보여 줍니다(테스트가 여기에 걸렸습니다).
    added_total: ext.added ?? 0,
    tokens_left: Math.max(0, (ext.tokens ?? 0) - (ext.pushed ?? 0)),
    tokens: ext.tokens ?? C.TOKENS,
    score: ext.score ?? 0,
    multiplier: ext.multiplier ?? 1,
  };
};

export const spec = {
  game: "GAUGE",
  mode: "ENDLESS",
  endsOnDone: true, // 목숨이 없습니다 — 토큰을 다 밀어 넣으면 끝납니다
  boostLabel: "기여 2배",

  /** 런 시작 — 오늘 게이지와 내 기여량을 한 번 읽습니다 */
  async initSecret(meta, { env, userId }) {
    const day = dayKey();
    const [total, mine] = await Promise.all([readGauge(env, day), readMine(env, userId, day)]);

    meta.ext = {
      ...(meta.ext ?? {}),
      day,
      total,
      startTotal: total,
      myTokens: mine,
      tokens: C.TOKENS,
      pushed: 0,
      multiplier: 1,
      added: 0,
      score: 0,
      openedAtStart: stagesOf(total).opened,
    };
    return { day };
  },

  makeRound(roundNo, meta) {
    const ext = meta.ext ?? {};
    if ((ext.pushed ?? 0) >= (ext.tokens ?? C.TOKENS)) return null;
    return {
      pub: { ...viewOf(ext), token_value: C.TOKEN_VALUE },
      secret: null,
      limitMs: null,
    };
  },

  /**
   * 라운드 = 토큰 하나 밀어 넣기.
   *
   * 게이지 반영은 **판이 끝난 뒤 한 번에** 합니다(onRunEnd). 토큰마다 전역 행을 쓰면
   * 한 판에 쓰기가 토큰 수만큼 늘어나는데, 화면에 필요한 것은 "내 기여가 반영된 뒤의
   * 값" 이고 그건 지역 합으로 정확히 계산할 수 있습니다.
   */
  judgeRound({ meta }) {
    const ext = meta.ext ?? (meta.ext = {});
    ext.pushed = (ext.pushed ?? 0) + 1;

    const add = C.TOKEN_VALUE * (ext.multiplier ?? 1);
    ext.added = (ext.added ?? 0) + add;
    ext.total = (ext.total ?? 0) + add;
    ext.myTokens = (ext.myTokens ?? 0) + add;
    ext.score = (ext.score ?? 0) + C.TOKEN_POINT * (ext.multiplier ?? 1);

    const done = ext.pushed >= (ext.tokens ?? C.TOKENS);

    // 내 기여로 단계가 열렸으면 그 자리에서 알려 줍니다 (기획서 8장 종료 화면)
    const opened = stagesOf(ext.total).opened;
    const justOpened = opened > (ext.openedSeen ?? ext.openedAtStart ?? 0);
    if (justOpened) {
      ext.openedSeen = opened;
      ext.score += C.STAGE_POINT;
    }

    return {
      ok: true,
      fatal: false,
      done,
      data: { added: add, just_opened: justOpened, ...viewOf(ext) },
    };
  },

  /** 「광고 보고 기여 2배」 — 남은 토큰의 반영량이 두 배가 됩니다 */
  applyBoost(meta) {
    const ext = meta.ext ?? (meta.ext = {});
    ext.multiplier = 2;
    return { data: { ...viewOf(ext) } };
  },

  /** 결과가 저장된 뒤 전역 게이지와 내 기여량을 한 번에 씁니다 */
  async onRunEnd(env, meta, ctx) {
    const ext = meta.ext ?? {};
    if (!ext.day || !(ext.added > 0)) return;
    await bumpGauge(env, ext.day, ext.added);
    await saveMine(env, ctx.userId, ext.day, ext.added);
  },

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    return {
      added_total: ext.added ?? 0,
      my_tokens: ext.myTokens ?? 0,
      total: ext.total ?? 0,
      pct: stagesOf(ext.total ?? 0).pct,
      opened: stagesOf(ext.total ?? 0).opened,
      multiplier: ext.multiplier ?? 1,
      score: ext.score ?? 0,
    };
  },

  bucketOf: () => "all",
  /** 순위는 내 누적 기여량입니다 — 이 게임에 잘하고 못하고는 없습니다 */
  rankMetricOf: (meta) => -(meta.ext?.myTokens ?? 0),
  scoreOf: (meta) => meta.ext?.score ?? 0,
};
