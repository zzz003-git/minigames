/**
 * 🔮 오늘의 타로 — 서버
 * ==========================================================================
 *
 * 기획: TAROT-SPEC-01 · 레퍼런스 구현 `tarot/prototype/TAROT-PROTO-01_오늘의타로.html`
 *
 * ── 아케이드가 아니다 ────────────────────────────────────────────────────
 * 순위도 실패도 없다. 그래서 `sessions`/`results` 를 쓰지 않고 아케이드 런 엔진도
 * 타지 않는다. 「한 판」이 없고 **하루에 몇 장 뽑았는가**만 있다.
 *
 * ── 추첨은 서버가 한다 ───────────────────────────────────────────────────
 * 프로토는 클라이언트 시드로 뽑았지만 실서비스에서는 **서버 균등 추첨**이다
 * (기획서 T-01). 화면이 카드를 정할 수 있으면 도감 마일스톤(+20P/+50P)을 원하는
 * 카드로 채울 수 있고, 그건 원가에 직접 닿는다.
 *
 * 반대로 **해석 문장의 회전은 화면이 한다.** 같은 카드라도 날짜·포커스에 따라 문장이
 * 바뀌는데, 그건 보상과 무관하므로 서버가 알 필요가 없다(기획서 T-07).
 */

import { TAROT, SUITE } from "../lib/config.js";
import { ApiError, requireOneOf } from "../lib/http.js";
import { randomInt } from "../lib/crypto.js";
import { dayKey, now } from "../lib/time.js";
import { grantPoints, grantMany, completeDaily, dailyState, distribution, touchUser, pointState } from "../lib/suite.js";

const parseDraws = (raw) => {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

async function loadDay(env, userId, day) {
  const row = await env.DB.prepare(
    `SELECT draws, ad_more_used, ad_stats_seen FROM tarot_daily WHERE user_id = ? AND day = ?`,
  )
    .bind(userId, day)
    .first();

  return {
    draws: parseDraws(row?.draws),
    adMoreUsed: row?.ad_more_used ?? 0,
    adStatsSeen: Boolean(row?.ad_stats_seen),
  };
}

async function loadMeta(env, userId) {
  const row = await env.DB.prepare(`SELECT welcome_used FROM tarot_meta WHERE user_id = ?`)
    .bind(userId)
    .first();
  return { welcomeUsed: Boolean(row?.welcome_used) };
}

async function collection(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT card_id FROM tarot_coll WHERE user_id = ? ORDER BY card_id`,
  )
    .bind(userId)
    .all();
  return (rows?.results ?? []).map((r) => r.card_id);
}

/**
 * 오늘 몇 장까지 뽑을 수 있는가.
 *
 *   무료 1장 + 광고로 연 만큼 + 웰컴 보너스(계정 1회)
 *
 * 광고를 본 것 자체가 권리이므로 **광고를 보고 안 뽑은 채 날이 바뀌면 사라진다** —
 * 그 편이 「오늘의 카드」라는 전제와 맞는다.
 */
const allowedDraws = (st, meta) =>
  TAROT.FREE_DRAWS + st.adMoreUsed + (TAROT.WELCOME_DRAW && !meta.welcomeUsed ? 1 : 0);

// ══════════════════════════════════════════════════════════════
// GET /api/tarot/today
// ══════════════════════════════════════════════════════════════

export async function today({ env, userId }) {
  const day = dayKey();
  await touchUser(env, userId, day);

  const [st, meta, coll, suite, points] = await Promise.all([
    loadDay(env, userId, day),
    loadMeta(env, userId),
    collection(env, userId),
    dailyState(env, userId, day),
    pointState(env, userId, day),
  ]);

  return {
    day,
    draws: st.draws,
    used_focuses: st.draws.map((d) => d.f),
    allowed: allowedDraws(st, meta),
    remaining: Math.max(0, allowedDraws(st, meta) - st.draws.length),
    ad_more_used: st.adMoreUsed,
    ad_more_max: TAROT.AD_MORE_PER_DAY,
    ad_stats_seen: st.adStatsSeen,
    welcome_available: TAROT.WELCOME_DRAW && !meta.welcomeUsed,
    collection: coll,
    milestones: { half: TAROT.MILESTONE_HALF, full: TAROT.MILESTONE_FULL },
    shuffles: st.draws.length === 0 ? TAROT.SHUFFLES_FIRST : TAROT.SHUFFLES_EXTRA,
    suite,
    points,
  };
}

// ══════════════════════════════════════════════════════════════
// POST /api/tarot/draw
// ══════════════════════════════════════════════════════════════

/**
 * 한 장 뽑는다. body: { focus }
 *
 * 검증 두 가지가 이 API 의 전부다.
 *   ① 오늘 뽑을 수 있는 장수가 남았는가 (무료 1 + 광고분)
 *   ② 그 포커스를 오늘 이미 썼는가 — 같은 포커스를 다시 뽑아 마음에 드는 결과를
 *      고르는 것을 막는다(기획서 T-02 「결과 쇼핑 방지」)
 */
export async function draw({ env, userId, body }) {
  const day = dayKey();
  const focus = requireOneOf(body?.focus, "focus", TAROT.FOCUSES);

  await touchUser(env, userId, day);

  const [st, meta] = await Promise.all([loadDay(env, userId, day), loadMeta(env, userId)]);
  const allowed = allowedDraws(st, meta);

  if (st.draws.length >= allowed) {
    throw new ApiError(
      "NO_DRAWS",
      "오늘 뽑을 수 있는 카드를 모두 뽑았어요. 내일 새 카드가 기다립니다.",
      403,
    );
  }
  if (st.draws.some((d) => d.f === focus)) {
    throw new ApiError("FOCUS_USED", "오늘 이미 뽑은 고민이에요. 다른 고민을 골라 보세요.", 400);
  }

  // 균등 추첨. 22장 전부 같은 확률이고 이미 뽑은 카드도 다시 나온다 —
  // 「오늘의 카드」는 그날의 뽑기이지 수집 게임이 아니다.
  const cardId = randomInt(0, TAROT.CARDS - 1);
  const nextDraws = [...st.draws, { c: cardId, f: focus }];
  const isFirstDraw = st.draws.length === 0;

  // 웰컴 보너스를 이번에 쓴 것인지 — 무료분을 넘겨 뽑았고 광고분도 아닐 때
  const usedWelcome =
    TAROT.WELCOME_DRAW && !meta.welcomeUsed && st.draws.length >= TAROT.FREE_DRAWS + st.adMoreUsed;

  await env.DB.prepare(
    `INSERT INTO tarot_daily (user_id, day, draws) VALUES (?, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET draws = excluded.draws`,
  )
    .bind(userId, day, JSON.stringify(nextDraws))
    .run();

  if (usedWelcome) {
    await env.DB.prepare(
      `INSERT INTO tarot_meta (user_id, welcome_used, updated_at) VALUES (?, 1, ?)
       ON CONFLICT (user_id) DO UPDATE SET welcome_used = 1, updated_at = excluded.updated_at`,
    )
      .bind(userId, now())
      .run();
  }

  // 도감. 처음 뽑은 카드만 남긴다 — 중복은 "이미 있는 카드" 일 뿐 잃는 것이 없다.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO tarot_coll (user_id, card_id, first_day) VALUES (?, ?, ?)`,
  )
    .bind(userId, cardId, day)
    .run();
  const isNew = (ins?.meta?.changes ?? 0) > 0;

  const coll = await collection(env, userId);

  // ── 적립 ────────────────────────────────────────────────────
  // 코어 완료는 **하루 1회**다. 「한 장 더」로 두 번째를 뽑아도 적립은 늘지 않는다
  // (기획서 T-03 문구 「한 장 더 뽑아도 오늘의 카드와 적립은 그대로예요」).
  const grants = [];
  if (isFirstDraw) {
    grants.push({
      key: `TAROT_DRAW:${day}`,
      reason: "TAROT_DRAW",
      amount: SUITE.POINTS.CORE_DONE,
      day,
    });
  }
  if (isNew) {
    grants.push({
      key: `TAROT_NEW:${cardId}`, // 카드별 평생 1회 — 날짜를 넣지 않는다
      reason: "TAROT_NEW",
      amount: SUITE.POINTS.COLLECT_NEW,
      day,
    });
  }
  if (coll.length >= TAROT.MILESTONE_HALF) {
    grants.push({
      key: "MILESTONE_TAROT_HALF",
      reason: "MILESTONE_TAROT_HALF",
      amount: SUITE.POINTS.MILESTONE_HALF,
      day,
    });
  }
  if (coll.length >= TAROT.MILESTONE_FULL) {
    grants.push({
      key: "MILESTONE_TAROT_FULL",
      reason: "MILESTONE_TAROT_FULL",
      amount: SUITE.POINTS.MILESTONE_FULL,
      day,
    });
  }
  const gained = await grantMany(env, userId, grants);

  // 허브 갱신·분포·트리플 판정은 **첫 뽑기에서만**. 두 번째 카드로 오늘의 축이
  // 바뀌면 「오늘의 나 한 장」이 뽑을 때마다 달라진다.
  let suiteResult = null;
  if (isFirstDraw) {
    suiteResult = await completeDaily(env, userId, "tarot", cardId, day);
  }

  const after = await loadDay(env, userId, day);
  const afterMeta = await loadMeta(env, userId);

  return {
    card_id: cardId,
    focus,
    is_new: isNew,
    collection_count: coll.length,
    gained,
    core_done: isFirstDraw,
    remaining: Math.max(0, allowedDraws(after, afterMeta) - after.draws.length),
    triple: suiteResult?.triple ?? false,
    triple_gained: suiteResult?.tripleGained ?? 0,
    suite: await dailyState(env, userId, day),
    points: await pointState(env, userId, day),
  };
}

// ══════════════════════════════════════════════════════════════
// GET /api/tarot/stats
// ══════════════════════════════════════════════════════════════

/**
 * 전국 분포. **광고를 봐야 열린다**(T-04) — 시청 여부는 `tarot_daily.ad_stats_seen`.
 * 표본이 임계 미만이면 「집계 중」으로 응답한다(SUITE 1.5).
 */
export async function stats({ env, userId }) {
  const day = dayKey();
  const st = await loadDay(env, userId, day);

  if (!st.adStatsSeen) {
    throw new ApiError("AD_REQUIRED", "광고를 시청하면 오늘의 전국 분포를 볼 수 있습니다.", 403);
  }

  const dist = await distribution(env, "tarot", day);
  const mine = st.draws[0]?.c ?? null;
  return { ...dist, my_card: mine };
}

// ══════════════════════════════════════════════════════════════
// 광고 보상 (src/routes/ad.js 에서 호출)
// ══════════════════════════════════════════════════════════════

/** 「한 장 더」 — 오늘 뽑을 수 있는 장수를 1 늘린다 */
export async function grantExtraDraw(env, userId, day = dayKey()) {
  await env.DB.prepare(
    `INSERT INTO tarot_daily (user_id, day, ad_more_used) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ad_more_used = ad_more_used + 1`,
  )
    .bind(userId, day)
    .run();

  const st = await loadDay(env, userId, day);
  const meta = await loadMeta(env, userId);
  return {
    kind: "TAROT_DRAW",
    ad_more_used: st.adMoreUsed,
    ad_more_max: TAROT.AD_MORE_PER_DAY,
    remaining: Math.max(0, allowedDraws(st, meta) - st.draws.length),
    shuffles: TAROT.SHUFFLES_EXTRA,
  };
}

/** 전국 분포 열람 해제 — 당일 상시 */
export async function unlockStats(env, userId, day = dayKey()) {
  await env.DB.prepare(
    `INSERT INTO tarot_daily (user_id, day, ad_stats_seen) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ad_stats_seen = 1`,
  )
    .bind(userId, day)
    .run();
  return { kind: "UNLOCK", scope: "tarot_stats" };
}

/** 광고 라우트가 상한을 검사할 때 쓰는 현재 사용량 */
export async function adUsage(env, userId, trigger, day = dayKey()) {
  const st = await loadDay(env, userId, day);
  if (trigger === "TAROT_ATTEMPT") return st.adMoreUsed;
  if (trigger === "TAROT_STATS") return st.adStatsSeen ? 1 : 0;
  return 0;
}
