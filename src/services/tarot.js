/**
 * 🔮 오늘의 타로 — 서버
 * ==========================================================================
 *
 * 기획: TAROT-SPEC-02(78장 · 별가루) · 1.0 레퍼런스 구현 `tarot/prototype/TAROT-PROTO-01_오늘의타로.html`
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
import { isTestMode } from "../lib/testmode.js";
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
  const row = await env.DB.prepare(`SELECT welcome_used, gold_intro_seen FROM tarot_meta WHERE user_id = ?`)
    .bind(userId)
    .first();
  return { welcomeUsed: Boolean(row?.welcome_used), goldIntroSeen: Boolean(row?.gold_intro_seen) };
}

async function collection(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT card_id FROM tarot_coll WHERE user_id = ? ORDER BY card_id`,
  )
    .bind(userId)
    .all();
  return (rows?.results ?? []).map((r) => r.card_id);
}

async function loadDust(env, userId) {
  const row = await env.DB.prepare(`SELECT dust FROM tarot_meta WHERE user_id = ?`)
    .bind(userId)
    .first();
  return row?.dust ?? 0;
}

/**
 * 중복 1장 → 별가루 +1, 4개면 그 자리에서 미보유 카드 1장으로 바꾼다 (T-08).
 *
 * ── 왜 한 batch 인가 ─────────────────────────────────────────────────────
 * 「별가루를 읽고 → 4 이상이면 → 빼고 → 카드를 준다」를 왕복으로 나누면, 「한 장 더」를
 * 연타해 두 요청이 같이 들어왔을 때 둘 다 3을 읽고 둘 다 교환한다. D1 의 batch 는 한
 * 트랜잭션으로 돌고 다른 쓰기가 끼어들지 못하므로, 판단과 지급을 **전부 SQL 안에** 둔다.
 *
 * 차감과 지급을 잇는 끈은 `ex_pending` 이다. ②가 4를 빼면서 1로 세우고, ③④는 그것이
 * 1일 때만 움직이고, ⑤가 0으로 되돌린다 — batch 밖에서는 언제나 0이다.
 *
 * 교환 카드는 미보유 카드 중 균등 무작위다. 난수는 SQLite `random()` 이 아니라 서버
 * 추첨과 같은 `randomInt` 로 뽑아 미보유 목록의 순번으로 쓴다(`% 미보유 수`). 2^31 을
 * 78 이하로 나눈 나머지의 치우침은 장당 1억분의 4 미만이라 무시한다.
 *
 * @returns {{ dustGained:number, exchangedCardId:number|null, gained:number }}
 */
async function exchangeDust(env, userId, day, { grant = true } = {}) {
  const t = now();
  const unowned = `
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${TAROT.CARDS - 1})
    SELECT i FROM n WHERE i NOT IN (SELECT card_id FROM tarot_coll WHERE user_id = ?1)`;

  const res = await env.DB.batch([
    // ① 별가루 +1
    env.DB.prepare(
      `INSERT INTO tarot_meta (user_id, dust, dust_total, updated_at) VALUES (?1, 1, 1, ?2)
       ON CONFLICT (user_id) DO UPDATE SET dust = dust + 1, dust_total = dust_total + 1,
                                           updated_at = excluded.updated_at`,
    ).bind(userId, t),
    // ② 4 이상이고 아직 못 만난 카드가 있으면 차감 — 78장 완성 뒤에는 쌓이기만 한다
    env.DB.prepare(
      `UPDATE tarot_meta SET dust = dust - ?2, exchanged = exchanged + 1, ex_pending = 1
        WHERE user_id = ?1 AND dust >= ?2
          AND (SELECT COUNT(*) FROM tarot_coll WHERE user_id = ?1) < ?3`,
    ).bind(userId, TAROT.DUST_PER_EXCHANGE, TAROT.CARDS),
    // ③ 차감했으면 미보유 1장 지급
    env.DB.prepare(
      `INSERT INTO tarot_coll (user_id, card_id, first_day, via)
       SELECT ?1, i, ?2, 'dust' FROM (${unowned})
        WHERE EXISTS (SELECT 1 FROM tarot_meta WHERE user_id = ?1 AND ex_pending = 1)
        ORDER BY i LIMIT 1 OFFSET (?3 % MAX(1, (SELECT COUNT(*) FROM (${unowned}))))
       RETURNING card_id`,
    ).bind(userId, day, randomInt(0, 2 ** 31 - 1)),
    // ④ 그 카드의 신규 적립 — 뽑기로 얻은 카드와 **같은 키**다(카드별 평생 1회).
    //    올해·이달의 카드에서 온 교환은 적립하지 않는다(SPEC-04 §5 ③) — 금액 0 이면 넣지 않는다
    env.DB.prepare(
      `INSERT OR IGNORE INTO suite_points (user_id, key, reason, amount, day, created_at)
       SELECT ?1, 'TAROT_NEW:' || card_id, 'TAROT_NEW', ?2, ?3, ?4
         FROM tarot_coll
        WHERE user_id = ?1 AND via = 'dust' AND ?2 > 0
          AND EXISTS (SELECT 1 FROM tarot_meta WHERE user_id = ?1 AND ex_pending = 1)`,
    ).bind(userId, grant ? SUITE.POINTS.COLLECT_NEW : 0, day, t),
    // ⑤ 끈을 푼다
    env.DB.prepare(`UPDATE tarot_meta SET ex_pending = 0 WHERE user_id = ?1 AND ex_pending = 1`).bind(
      userId,
    ),
  ]);

  const exchangedCardId = res[2]?.results?.[0]?.card_id ?? null;
  const granted = res[3]?.meta?.changes ?? 0;
  return {
    dustGained: 1,
    exchangedCardId,
    gained: granted * SUITE.POINTS.COLLECT_NEW,
  };
}

/**
 * 뽑힌 한 장을 도감에 반영한다 — 새 카드 · 별가루 교환 · 금빛 (1·2단계 규칙 그대로).
 * 일일 뽑기와 올해·이달의 카드가 같이 쓴다. `grant=false` 면 교환 카드의 신규 적립을 넣지
 * 않는다(올해·이달의 카드는 적립 없음 · SPEC-04 §5 ③).
 */
async function collectCard(env, userId, cardId, day, { via = "draw", grant = true } = {}) {
  // 새 카드인지는 PK 충돌로 정해진다. 동시 요청이어도 한쪽만 changes 1 을 받는다.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO tarot_coll (user_id, card_id, first_day, via) VALUES (?, ?, ?, ?)`,
  )
    .bind(userId, cardId, day, via)
    .run();
  const isNew = (ins?.meta?.changes ?? 0) > 0;

  // 중복이면 — 78장을 다 모으기 전엔 별가루(T-08), 다 모은 뒤엔 금빛 바퀴(SPEC-03 §1).
  // 완성은 줄어들지 않으므로 여기서 한 번 세면 된다.
  let ex = { dustGained: 0, exchangedCardId: null, gained: 0 };
  let goldNew = false;
  let goldExchangedCardId = null;
  if (!isNew) {
    const owned = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tarot_coll WHERE user_id = ?`)
      .bind(userId)
      .first();
    if ((owned?.n ?? 0) < TAROT.CARDS) {
      ex = await exchangeDust(env, userId, day, { grant });
    } else {
      goldNew = await goldByDraw(env, userId, cardId, day);
      if (!goldNew) {
        const g = await exchangeGold(env, userId, day);
        ex = { ...ex, dustGained: g.dustGained };
        goldExchangedCardId = g.goldExchangedCardId;
      }
    }
  }
  return { isNew, ex, goldNew, goldExchangedCardId };
}

// ══════════════════════════════════════════════════════════════
// 금빛 도감 (SPEC-03 §1) — 78장 완성 뒤의 두 번째 바퀴
// ══════════════════════════════════════════════════════════════

async function goldCards(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT card_id FROM tarot_coll WHERE user_id = ? AND gold = 1 ORDER BY card_id`,
  )
    .bind(userId)
    .all();
  return (rows?.results ?? []).map((r) => r.card_id);
}

/**
 * 은색 카드를 뽑았으면 그 카드가 금빛이 된다. 이미 금빛이면 false.
 * `gold = 0` 조건이 곧 판정이라, 같은 카드가 동시에 두 번 들어와도 한쪽만 바뀐다.
 */
async function goldByDraw(env, userId, cardId, day) {
  const r = await env.DB.prepare(
    `UPDATE tarot_coll SET gold = 1, gold_day = ?3, gold_via = 'draw'
      WHERE user_id = ?1 AND card_id = ?2 AND gold = 0`,
  )
    .bind(userId, cardId, day)
    .run();
  return (r?.meta?.changes ?? 0) > 0;
}

/**
 * 금빛 카드 중복 → 별가루 +1, 4개면 은색 1장이 무작위로 금빛 (SPEC-03 §1).
 *
 * 1회차 `exchangeDust` 와 같은 구조다 — 판단과 지급을 한 batch 안에 두고, 차감과 지급을
 * `ex_pending` 끈으로 잇는다. 다른 것은 ③이 「미보유 카드 지급」이 아니라 「은색 → 금빛」
 * 이라는 것과, 카드별 적립이 없다는 것(SPEC-03 §4 가안)뿐이다.
 *
 * @returns {{ dustGained:number, goldExchangedCardId:number|null }}
 */
async function exchangeGold(env, userId, day) {
  const t = now();
  const silver = `SELECT card_id FROM tarot_coll WHERE user_id = ?1 AND gold = 0`;

  const res = await env.DB.batch([
    // ① 별가루 +1
    env.DB.prepare(
      `INSERT INTO tarot_meta (user_id, dust, dust_total, updated_at) VALUES (?1, 1, 1, ?2)
       ON CONFLICT (user_id) DO UPDATE SET dust = dust + 1, dust_total = dust_total + 1,
                                           updated_at = excluded.updated_at`,
    ).bind(userId, t),
    // ② 4 이상이고 은색 카드가 남았으면 차감 — 78장 금빛 뒤에는 쌓이기만 한다
    env.DB.prepare(
      `UPDATE tarot_meta SET dust = dust - ?2, exchanged = exchanged + 1, ex_pending = 1
        WHERE user_id = ?1 AND dust >= ?2 AND EXISTS (${silver})`,
    ).bind(userId, TAROT.DUST_PER_EXCHANGE),
    // ③ 차감했으면 은색 1장을 금빛으로
    env.DB.prepare(
      `UPDATE tarot_coll SET gold = 1, gold_day = ?2, gold_via = 'dust'
        WHERE user_id = ?1
          AND EXISTS (SELECT 1 FROM tarot_meta WHERE user_id = ?1 AND ex_pending = 1)
          AND card_id = (${silver} ORDER BY card_id LIMIT 1
                         OFFSET (?3 % MAX(1, (SELECT COUNT(*) FROM (${silver})))))
       RETURNING card_id`,
    ).bind(userId, day, randomInt(0, 2 ** 31 - 1)),
    // ④ 끈을 푼다
    env.DB.prepare(`UPDATE tarot_meta SET ex_pending = 0 WHERE user_id = ?1 AND ex_pending = 1`).bind(
      userId,
    ),
  ]);

  return { dustGained: 1, goldExchangedCardId: res[2]?.results?.[0]?.card_id ?? null };
}

/** 하루 기록의 첫 카드(그날의 「오늘의 카드」) */
const firstDraw = (raw) => {
  const d = parseDraws(raw)[0];
  return d ? { card_id: d.c, focus: d.f } : null;
};

// ══════════════════════════════════════════════════════════════
// 날짜 바꾸기 시험 장치 — 스테이징 전용 (REQ-45)
// ══════════════════════════════════════════════════════════════

/** 시험 날짜를 담는 쿠키. 화면(스테이징 띠)이 기기에 직접 심는다 — 그 기기만 바뀐다 */
const TEST_DAY_COOKIE = "mg_testday";

/**
 * 타로가 쓰는 「오늘」.
 *
 * 올해의 카드(11/1~1/31)·작년의 올해 카드·이달의 질문(첫째 주 월요일)은 날짜가 와야만
 * 보이므로, 스테이징에서는 시험 쿠키의 날짜를 오늘로 쓴다.
 *
 * **운영에서는 쿠키를 읽지조차 않는다.** `isTestMode` 는 `TEST_MODE=on` **이고**
 * `ENV_NAME≠production` 일 때만 참이라(lib/testmode.js), 운영 요청에 쿠키가 붙어 와도
 * 첫 줄에서 실제 날짜로 돌아간다.
 */
export function tarotDay(env, request) {
  if (!isTestMode(env)) return dayKey();
  const raw = (request?.headers?.get("cookie") ?? "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${TEST_DAY_COOKIE}=`))
    ?.slice(TEST_DAY_COOKIE.length + 1);
  if (!raw || !/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)) return dayKey();
  const [y, m, d] = raw.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  // 2월 30일 같은 날짜는 받지 않는다
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? raw : dayKey();
}

/** YYYY-MM-DD 에서 n 일 뒤(음수면 앞) */
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ══════════════════════════════════════════════════════════════
// 3단계 날짜 규칙 (SPEC-04) — 전부 날짜만으로 정해진다
// ══════════════════════════════════════════════════════════════

const ymd = (day) => day.split("-").map(Number);

/** 그달 첫째 주 월요일인가 — 이달의 질문 칩이 열리는 날 (§2) */
export function isQuestionDay(day) {
  const [y, m, d] = ymd(day);
  return d <= 7 && new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

/** 이달의 질문 번호(1~36) — 시작 월부터 한 달에 하나씩, 36개 뒤 처음으로 (§2) */
export function questionNo(day) {
  const [y, m] = ymd(day);
  const [sy, sm] = TAROT.QUESTION_START_MONTH.split("-").map(Number);
  const k = (y - sy) * 12 + (m - sm);
  return (((k % TAROT.QUESTION_COUNT) + TAROT.QUESTION_COUNT) % TAROT.QUESTION_COUNT) + 1;
}

/**
 * 올해의 카드 기간 — 11·12월은 「다음 해의 카드」, 1월은 「그해의 카드」. 기간 밖이면 null (§3)
 */
export function yearCardPeriod(day) {
  const [y, m] = ymd(day);
  if (!TAROT.YEAR_CARD_OPEN_MONTHS.includes(m)) return null;
  return String(m === 1 ? y : y + 1);
}

/** 같은 날짜의 1년 전. 2월 29일은 전년에 없으므로 자연히 기록이 없다 */
const yearAgo = (day) => `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;

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

export async function today({ env, userId, request }) {
  const day = tarotDay(env, request);
  await touchUser(env, userId, day);

  const [st, meta, coll, suite, points, dust, gold, lastYear, specials] = await Promise.all([
    loadDay(env, userId, day),
    loadMeta(env, userId),
    collection(env, userId),
    dailyState(env, userId, day),
    pointState(env, userId, day),
    loadDust(env, userId),
    goldCards(env, userId),
    env.DB.prepare(`SELECT draws FROM tarot_daily WHERE user_id = ? AND day = ?`)
      .bind(userId, yearAgo(day))
      .first(),
    loadSpecials(env, userId),
  ]);
  const ly = firstDraw(lastYear?.draws);

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
    collection_count: coll.length,
    cards: TAROT.CARDS,
    fan: TAROT.FAN,
    milestones: TAROT.MILESTONES,
    dust,
    dust_max: TAROT.DUST_PER_EXCHANGE,
    // 금빛 도감 (SPEC-03) — 78장 완성 전엔 늘 빈 배열이다
    gold,
    gold_count: gold.length,
    gold_milestones: TAROT.GOLD_MILESTONES,
    // 78장을 다 모았는데 완성 화면을 아직 끝까지 안 봤다 → 화면이 첫머리에 띄운다 (§1-1)
    gold_intro_pending: coll.length >= TAROT.CARDS && !meta.goldIntroSeen,
    // 「작년 오늘」 — 1년 전 같은 날 기록이 있을 때만 (SPEC-03 §5)
    last_year: ly ? { day: yearAgo(day), ...ly } : null,
    // ── 3단계 (SPEC-04) ──
    // 이달의 질문: 번호만 준다(문구는 화면이 가진 은행). 지난날 달력도 같은 식으로 계산하라고
    // 시작 월을 같이 준다
    question: { open: isQuestionDay(day), n: questionNo(day) },
    question_start_month: TAROT.QUESTION_START_MONTH,
    special: specialState(day, specials),
    // 날짜 바꾸기 시험 장치 — **테스트 모드에서만** 실린다. 운영 응답에는 이 키가 없다(REQ-45)
    ...(isTestMode(env) ? { test_clock: { day, real: dayKey() } } : {}),
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
export async function draw({ env, userId, body, request }) {
  const day = tarotDay(env, request);
  // 첫째 주 월요일에는 5번째 칩 「이달의 질문」(`q`)이 열린다 (SPEC-04 §2)
  const focus = requireOneOf(body?.focus, "focus", isQuestionDay(day) ? [...TAROT.FOCUSES, "q"] : TAROT.FOCUSES);

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

  // 균등 추첨. 78장 전부 같은 확률이고 이미 뽑은 카드도 다시 나온다 —
  // 「오늘의 카드」는 그날의 뽑기다. 수집 속도는 확률이 아니라 별가루(T-08)가 맡는다.
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

  // 도감. 처음 뽑은 카드만 남긴다 — 중복은 별가루(완성 뒤엔 금빛)가 되어 잃는 것이 없다.
  // 「한 장 더」로 뽑은 중복도 같다.
  const { isNew, ex, goldNew, goldExchangedCardId } = await collectCard(env, userId, cardId, day);

  const [coll, gold] = await Promise.all([collection(env, userId), goldCards(env, userId)]);

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
  // 마일스톤은 교환 카드까지 센 뒤에 본다 — 교환으로 20장째가 되어도 받는다
  for (const m of TAROT.MILESTONES) {
    if (coll.length >= m.n) {
      grants.push({ key: `MILESTONE_TAROT_${m.n}`, reason: `MILESTONE_TAROT_${m.n}`, amount: m.p, day });
    }
  }
  // 금빛 마일스톤 — 카드별 적립은 없다(SPEC-03 §4 가안)
  for (const m of TAROT.GOLD_MILESTONES) {
    if (gold.length >= m.n) {
      const key = `MILESTONE_TAROT_GOLD_${m.n}`;
      grants.push({ key, reason: key, amount: m.p, day });
    }
  }
  const gained = (await grantMany(env, userId, grants)) + ex.gained;

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
    dust: await loadDust(env, userId),
    dust_gained: ex.dustGained,
    exchanged_card_id: ex.exchangedCardId,
    gold_new: goldNew, // 뽑은 은색 카드가 금빛이 됐다
    gold_exchanged_card_id: goldExchangedCardId, // 별가루로 금빛이 된 카드
    gold_count: gold.length,
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
// GET /api/tarot/collection
// ══════════════════════════════════════════════════════════════

/** 도감 78칸. 못 만난 칸은 `first_day: null` (SPEC-02 4절) */
export async function collectionView({ env, userId }) {
  const rows = await env.DB.prepare(
    `SELECT card_id, first_day, via, gold, gold_day, gold_via FROM tarot_coll WHERE user_id = ?`,
  )
    .bind(userId)
    .all();
  const got = new Map((rows?.results ?? []).map((r) => [r.card_id, r]));

  const cells = [];
  for (let id = 0; id < TAROT.CARDS; id++) {
    const r = got.get(id);
    cells.push({
      card_id: id,
      first_day: r?.first_day ?? null,
      via: r?.via ?? null,
      gold: Boolean(r?.gold),
      gold_day: r?.gold_day ?? null,
      gold_via: r?.gold_via ?? null,
    });
  }
  return {
    cells,
    count: got.size,
    gold_count: cells.filter((c) => c.gold).length,
    milestones: TAROT.MILESTONES,
    gold_milestones: TAROT.GOLD_MILESTONES,
    dust: await loadDust(env, userId),
    dust_max: TAROT.DUST_PER_EXCHANGE,
  };
}

// ══════════════════════════════════════════════════════════════
// 올해의 카드 · 이달의 카드 (SPEC-04 §3·§4)
// ══════════════════════════════════════════════════════════════

async function loadSpecials(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT kind, period, card_id, day FROM tarot_special WHERE user_id = ?`,
  )
    .bind(userId)
    .all();
  return rows?.results ?? [];
}

/**
 * 덱 화면이 칩을 띄울지 판단할 상태.
 *   year  : 기간 안이면 { period, card_id|null, last } — last 는 「작년의 올해 카드」
 *   month : { period, card_id|null } — 달마다 한 번
 */
function specialState(day, rows) {
  const find = (kind, period) => rows.find((r) => r.kind === kind && r.period === period);
  const yp = yearCardPeriod(day);
  const year = yp
    ? {
        period: yp,
        card_id: find("year", yp)?.card_id ?? null,
        last: find("year", String(Number(yp) - 1))?.card_id ?? null,
      }
    : null;
  const mp = day.slice(0, 7);
  return { year, month: { period: mp, card_id: find("month", mp)?.card_id ?? null } };
}

/**
 * POST /api/tarot/special  body: { kind: 'year' | 'month' }
 *
 * 일일 뽑기와 **별개**다 — 하루 장수·고민을 쓰지 않고, 광고도 없다. 도감·별가루·금빛 규칙은
 * 그대로 적용하되 **적립은 없다**(코어·신규·마일스톤 모두 · SPEC-04 §5 ③). 마일스톤은 다음
 * 일일 뽑기에서 도감 수를 다시 볼 때 들어온다.
 *
 * 기간당 1장은 `tarot_special` 의 PK 가 정한다 — 먼저 자리를 잡고(INSERT OR IGNORE) 그
 * 다음에 도감에 넣으므로, 연타해도 두 장이 되지 않는다.
 */
export async function special({ env, userId, body, request }) {
  const day = tarotDay(env, request);
  const kind = requireOneOf(body?.kind, "kind", ["year", "month"]);
  const period = kind === "year" ? yearCardPeriod(day) : day.slice(0, 7);
  if (!period) {
    throw new ApiError("NOT_OPEN", "올해의 카드는 11월 1일부터 1월 31일까지 뽑을 수 있어요.", 403);
  }

  await touchUser(env, userId, day);
  const cardId = randomInt(0, TAROT.CARDS - 1);
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO tarot_special (user_id, kind, period, card_id, day) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(userId, kind, period, cardId, day)
    .run();
  if ((ins?.meta?.changes ?? 0) === 0) {
    throw new ApiError(
      "ALREADY_DRAWN",
      kind === "year" ? "올해의 카드는 이미 뽑았어요." : "이달의 카드는 이미 뽑았어요.",
      409,
    );
  }

  const { isNew, ex, goldNew, goldExchangedCardId } = await collectCard(env, userId, cardId, day, {
    via: kind,
    grant: false,
  });
  const [coll, gold] = await Promise.all([collection(env, userId), goldCards(env, userId)]);

  return {
    kind,
    period,
    card_id: cardId,
    is_new: isNew,
    collection_count: coll.length,
    dust: await loadDust(env, userId),
    dust_gained: ex.dustGained,
    exchanged_card_id: ex.exchangedCardId,
    gold_new: goldNew,
    gold_exchanged_card_id: goldExchangedCardId,
    gold_count: gold.length,
    gained: 0,
  };
}

// ══════════════════════════════════════════════════════════════
// 한 마디 (SPEC-04 §1)
// ══════════════════════════════════════════════════════════════

/**
 * 같은 카드의 키워드별 수 — **오늘 포함 최근 30일 누적**(REQ-45). 합이 기준 미만이면 감춘다.
 *
 * 처음엔 「같은 날 같은 카드」였는데, 그러면 하루 이용자가 1,500명쯤 돼야 열려 출시 초기엔
 * 거의 안 보인다(기획 계산). 키워드는 카드의 성격이라 날짜가 달라도 뜻이 같다.
 * 집계 표는 날짜별 그대로 두고 읽을 때 30일을 더한다 — 창을 바꿔도 다시 쌓을 필요가 없다.
 */
async function wordDist(env, day, cardId) {
  const rows = await env.DB.prepare(
    `SELECT kw, SUM(cnt) AS cnt FROM tarot_word_agg
      WHERE card_id = ? AND day >= ? AND day <= ? GROUP BY kw`,
  )
    .bind(cardId, addDays(day, -(TAROT.WORD_WINDOW_DAYS - 1)), day)
    .all();
  const counts = new Array(TAROT.WORD_KEYWORDS).fill(0);
  for (const r of rows?.results ?? []) if (r.kw >= 0 && r.kw < counts.length) counts[r.kw] = Math.max(0, r.cnt);
  const total = counts.reduce((a, b) => a + b, 0);
  // 비공개면 **숫자를 하나도 보내지 않는다** — 합(n)도 규모를 드러낸다(REQ-45).
  // 화면이 감춰도 응답에 있으면 공개한 것이다
  if (total < TAROT.WORD_MIN_SAMPLES) return { open: false };
  return { open: true, pct: counts.map((c) => Math.round((c / total) * 100)) };
}

async function wordState(env, userId, day, cardId) {
  const pick = await env.DB.prepare(
    `SELECT kw, changed FROM tarot_word_pick WHERE user_id = ? AND day = ? AND card_id = ?`,
  )
    .bind(userId, day, cardId)
    .first();
  return {
    card_id: cardId,
    kw: pick ? pick.kw : null,
    changes_left: pick ? Math.max(0, TAROT.WORD_CHANGES - pick.changed) : TAROT.WORD_CHANGES,
    dist: pick ? await wordDist(env, day, cardId) : null, // 고르기 전에는 남의 선택을 안 보여 준다
  };
}

/** 오늘 뽑은 카드인가 — 한 마디는 오늘의 뽑기 카드에만 단다 */
async function drewToday(env, userId, day, cardId) {
  const st = await loadDay(env, userId, day);
  return st.draws.some((d) => d.c === cardId);
}

/** GET /api/tarot/word?card_id= */
export async function word({ env, userId, body, request }) {
  const day = tarotDay(env, request);
  const cardId = Number(body?.card_id);
  if (!Number.isInteger(cardId) || cardId < 0 || cardId >= TAROT.CARDS) {
    throw new ApiError("BAD_PARAM", "card_id 값이 올바르지 않습니다.");
  }
  return wordState(env, userId, day, cardId);
}

/**
 * POST /api/tarot/word  body: { card_id, kw }
 *
 * 처음 고르면 집계 +1. 다른 키워드로 바꾸면 **1회만** — 옛 키워드 −1, 새 키워드 +1.
 * 바꾸기는 판단과 반영을 한 batch 에 둔다(연타로 두 번 바뀌거나 집계가 어긋나지 않게):
 * 모든 문장이 「아직 안 바꿨고 키워드가 다르다」는 같은 조건을 보고, 마지막 문장이 그 조건을
 * 닫는다.
 */
export async function wordPick({ env, userId, body, request }) {
  const day = tarotDay(env, request);
  const cardId = Number(body?.card_id);
  const kw = Number(body?.kw);
  if (!Number.isInteger(cardId) || cardId < 0 || cardId >= TAROT.CARDS) {
    throw new ApiError("BAD_PARAM", "card_id 값이 올바르지 않습니다.");
  }
  if (!Number.isInteger(kw) || kw < 0 || kw >= TAROT.WORD_KEYWORDS) {
    throw new ApiError("BAD_PARAM", "kw 값이 올바르지 않습니다.");
  }
  if (!(await drewToday(env, userId, day, cardId))) {
    throw new ApiError("NOT_DRAWN", "오늘 뽑은 카드에만 한 마디를 고를 수 있어요.", 403);
  }

  const first = await env.DB.prepare(
    `INSERT OR IGNORE INTO tarot_word_pick (user_id, day, card_id, kw) VALUES (?, ?, ?, ?)`,
  )
    .bind(userId, day, cardId, kw)
    .run();

  if ((first?.meta?.changes ?? 0) > 0) {
    await env.DB.prepare(
      `INSERT INTO tarot_word_agg (day, card_id, kw, cnt) VALUES (?, ?, ?, 1)
       ON CONFLICT (day, card_id, kw) DO UPDATE SET cnt = cnt + 1`,
    )
      .bind(day, cardId, kw)
      .run();
    return wordState(env, userId, day, cardId);
  }

  const cur = await env.DB.prepare(
    `SELECT kw, changed FROM tarot_word_pick WHERE user_id = ? AND day = ? AND card_id = ?`,
  )
    .bind(userId, day, cardId)
    .first();
  if (cur.kw === kw) return wordState(env, userId, day, cardId); // 같은 칩 — 아무 일 없음
  if (cur.changed >= TAROT.WORD_CHANGES) {
    throw new ApiError("WORD_LOCKED", "오늘 이 카드의 한 마디는 이미 바꿨어요.", 409);
  }

  const can = `EXISTS (SELECT 1 FROM tarot_word_pick
                        WHERE user_id = ?1 AND day = ?2 AND card_id = ?3 AND changed < ?5 AND kw <> ?4)`;
  await env.DB.batch([
    // ① 옛 키워드 −1
    env.DB.prepare(
      `UPDATE tarot_word_agg SET cnt = cnt - 1
        WHERE day = ?2 AND card_id = ?3 AND ${can}
          AND kw = (SELECT kw FROM tarot_word_pick WHERE user_id = ?1 AND day = ?2 AND card_id = ?3)`,
    ).bind(userId, day, cardId, kw, TAROT.WORD_CHANGES),
    // ② 새 키워드 +1
    env.DB.prepare(
      `INSERT INTO tarot_word_agg (day, card_id, kw, cnt) SELECT ?2, ?3, ?4, 1 WHERE ${can}
       ON CONFLICT (day, card_id, kw) DO UPDATE SET cnt = cnt + 1`,
    ).bind(userId, day, cardId, kw, TAROT.WORD_CHANGES),
    // ③ 선택을 바꾸고 조건을 닫는다
    env.DB.prepare(
      `UPDATE tarot_word_pick SET kw = ?4, changed = changed + 1
        WHERE user_id = ?1 AND day = ?2 AND card_id = ?3 AND changed < ?5 AND kw <> ?4`,
    ).bind(userId, day, cardId, kw, TAROT.WORD_CHANGES),
  ]);
  return wordState(env, userId, day, cardId);
}

// ══════════════════════════════════════════════════════════════
// POST /api/tarot/gold-intro
// ══════════════════════════════════════════════════════════════

/**
 * 완성 화면을 끝까지 봤다(탭으로 닫았다) — 다음부터 다시 띄우지 않는다 (SPEC-03 §1-1).
 * 78장을 다 모으기 전에는 기록하지 않는다 — 미리 「봤음」이 되면 정작 완성 때 안 나온다.
 */
export async function goldIntroSeen({ env, userId }) {
  const owned = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tarot_coll WHERE user_id = ?`)
    .bind(userId)
    .first();
  if ((owned?.n ?? 0) < TAROT.CARDS) {
    throw new ApiError("NOT_COMPLETE", "도감을 다 모은 뒤에 볼 수 있는 화면이에요.", 400);
  }
  await env.DB.prepare(
    `INSERT INTO tarot_meta (user_id, gold_intro_seen, updated_at) VALUES (?, 1, ?)
     ON CONFLICT (user_id) DO UPDATE SET gold_intro_seen = 1, updated_at = excluded.updated_at`,
  )
    .bind(userId, now())
    .run();
  return { gold_intro_seen: true };
}

// ══════════════════════════════════════════════════════════════
// GET /api/tarot/calendar?month=YYYY-MM
// ══════════════════════════════════════════════════════════════

/**
 * 나의 카드 달력 (SPEC-03 §5). 날마다 **그날 첫 카드**만 — 「한 장 더」로 뽑은 카드는
 * 오늘의 카드가 아니다. 뽑지 않은 날은 아예 돌려주지 않는다(빈칸 = 벌점이 아니다).
 * 새로 모으는 것은 없다 — 이미 있는 `tarot_daily` 를 읽기만 한다.
 */
export async function calendar({ env, userId, body, request }) {
  const month = String(body?.month ?? tarotDay(env, request).slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ApiError("BAD_MONTH", "month 는 YYYY-MM 형식이어야 합니다.", 400);
  }
  const rows = await env.DB.prepare(
    `SELECT day, draws FROM tarot_daily WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day`,
  )
    .bind(userId, `${month}-01`, `${month}-31`)
    .all();

  const days = [];
  for (const r of rows?.results ?? []) {
    const f = firstDraw(r.draws);
    if (f) days.push({ day: r.day, ...f });
  }

  // 올해의 카드는 그 해 달력 위 고정 띠, 이달의 카드는 그달 위에 (SPEC-04 §3·§4)
  const sp = await env.DB.prepare(
    `SELECT kind, period, card_id FROM tarot_special
      WHERE user_id = ? AND ((kind = 'year' AND period = ?) OR (kind = 'month' AND period = ?))`,
  )
    .bind(userId, month.slice(0, 4), month)
    .all();
  const pick = (k) => (sp?.results ?? []).find((r) => r.kind === k)?.card_id ?? null;

  return { month, days, year_card: pick("year"), month_card: pick("month") };
}

// ══════════════════════════════════════════════════════════════
// GET /api/tarot/stats
// ══════════════════════════════════════════════════════════════

/**
 * 전국 분포. **광고를 봐야 열린다**(T-04) — 시청 여부는 `tarot_daily.ad_stats_seen`.
 * 표본이 임계 미만이면 「집계 중」으로 응답한다(SUITE 1.5).
 */
export async function stats({ env, userId, request }) {
  const day = tarotDay(env, request);
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
