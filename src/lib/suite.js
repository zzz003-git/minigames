/**
 * 스위트 「심리테스트」 공통 층 — 적립 · 허브 진행 · 전국 분포
 * ==========================================================================
 *
 * 기획: SUITE-SPEC-01 §1 (공통 인프라)
 *
 * 타로·사주·심리 세 서비스가 공유한다. **세 서비스는 허브 없이도 각자 완결되므로**,
 * 여기 있는 것은 서비스가 서로를 몰라도 되게 하는 최소한의 접점뿐이다.
 * 서비스 파일은 코어 완료 시 `completeDaily()` 한 번만 부르면 된다.
 *
 * ── 적립은 멱등키로 막는다 ──────────────────────────────────────────────
 * 기획서가 반복해 요구하는 것이 「중복 지급 불가」다(트리플·마일스톤·순 완성).
 * 서비스마다 플래그 컬럼을 두면 그 수만큼 검사 코드가 생기고 동시 요청에서 샌다.
 * 그래서 **지급 사유 자체를 기본키**로 두고 `INSERT OR IGNORE` 로 넣는다 —
 * 두 번째 시도는 조용히 무시되므로 동시 요청이 와도 한 번만 들어간다.
 */

import { MIND, SAJU, SUITE, TAROT } from "./config.js";
import { dayKey, now } from "./time.js";

// ══════════════════════════════════════════════════════════════
// 적립
// ══════════════════════════════════════════════════════════════

/**
 * 포인트를 적립한다. **같은 키로 두 번 부르면 두 번째는 아무 일도 하지 않는다.**
 *
 * @param {object} env
 * @param {string} userId
 * @param {{ key:string, reason:string, amount:number, day?:string }} grant
 *   key    멱등키. 하루 단위 사유는 날짜를, 항목별 사유는 항목을 넣는다
 *          (`TAROT_DRAW:2026-08-03` · `TAROT_NEW:12` · `MILESTONE_TAROT11`)
 *   reason 집계용 사유 코드
 * @returns {Promise<boolean>} 이번 호출로 실제 지급됐으면 true
 */
export async function grantPoints(env, userId, { key, reason, amount, day = dayKey() }) {
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO suite_points (user_id, key, reason, amount, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, key, reason, Math.round(amount), day, now())
    .run();

  // D1 은 무시된 INSERT 를 changes 0 으로 알려 준다 — 이것이 "이미 받았다" 의 신호다
  return (res?.meta?.changes ?? 0) > 0;
}

/** 여러 건을 한 번에. 실제로 지급된 것들의 합계를 돌려준다 */
export async function grantMany(env, userId, grants) {
  let gained = 0;
  for (const g of grants) {
    if (await grantPoints(env, userId, g)) gained += Math.round(g.amount);
  }
  return gained;
}

/** 계정 잔액과 오늘 적립분. 잔액 컬럼을 따로 두지 않는 이유는 마이그레이션 주석 참조 */
export async function pointState(env, userId, day = dayKey()) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN day = ? THEN amount ELSE 0 END), 0) AS today
       FROM suite_points WHERE user_id = ?`,
  )
    .bind(day, userId)
    .first();
  return { total: row?.total ?? 0, today: row?.today ?? 0 };
}

/**
 * 세 서비스의 **모으기 진행도**. 허브 카드의 진행 막대가 쓴다.
 *
 * ── 마음만 기준이 다른 이유 ──────────────────────────────────────────────
 * 타로(22장)와 사주(60갑자)는 총계가 서버 상수라 「모은 칸 / 전체」가 바로 나온다.
 * 마음은 다르다 — 실험 목록(`public/mind/mind-db.js`)을 **화면이 가진다.** 서버는
 * 실험이 몇 개인지 모르고, 알아서도 안 된다(config.js MIND 주석: 주 2~3개씩 공급).
 *
 * 그래서 마음은 도감 대신 **축**으로 잰다. `mind_axes` 는 서버가 온전히 아는 값이고,
 * 「마음 지도가 얼마나 또렷해졌나」가 카드에 적히기에도 도감보다 낫다.
 */
export async function collectionState(env, userId, day = dayKey()) {
  const month = day.slice(0, 7);

  const [tarot, saju, axes] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM tarot_coll WHERE user_id = ?`).bind(userId).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM saju_stamp WHERE user_id = ?`).bind(userId).first(),
    env.DB.prepare(`SELECT ax FROM mind_axes WHERE user_id = ? AND month = ?`)
      .bind(userId, month)
      .first(),
  ]);

  // 축은 |값| 이 기준치를 넘으면 「또렷하다」고 본다. 부호는 방향일 뿐이라 절댓값이다.
  let clear = 0;
  try {
    for (const v of JSON.parse(axes?.ax ?? "[]")) {
      if (Math.abs(v) >= MIND.AXIS_GOAL) clear += 1;
    }
  } catch {
    // 값이 깨져 있어도 허브는 떠야 한다 — 0 으로 둔다
  }

  return {
    tarot: { got: tarot?.n ?? 0, total: TAROT.CARDS, unit: "장" },
    saju: { got: saju?.n ?? 0, total: SAJU.STAMPS_TOTAL, unit: "칸" },
    mind: { got: clear, total: MIND.AXES, unit: "축" },
  };
}

// ══════════════════════════════════════════════════════════════
// 허브 진행 (오늘의 3종)
// ══════════════════════════════════════════════════════════════

const FLAG = { tarot: "tarot_done", saju: "saju_done", mind: "mind_done" };
const KEYCOL = { tarot: "tarot_key", saju: "saju_key", mind: "mind_key" };

/**
 * 서비스 코어 완료를 허브에 알리고, 분포를 올리고, 트리플을 판정한다.
 *
 * **서비스 결합의 유일한 쓰기 지점**이다. 서비스 파일은 이 함수만 알면 되고
 * 서로를 몰라도 된다.
 *
 * @param {string} service 'tarot' | 'saju' | 'mind'
 * @param {string|number} itemKey 분포·합성 카드가 쓰는 축 (카드id / 십신idx / 유형key)
 * @returns {Promise<{ triple:boolean, tripleGained:number, done:{tarot:boolean,saju:boolean,mind:boolean} }>}
 */
export async function completeDaily(env, userId, service, itemKey, day = dayKey()) {
  const flag = FLAG[service];
  const keyCol = KEYCOL[service];
  if (!flag) throw new Error(`알 수 없는 서비스: ${service}`);

  // 오늘 행을 만들거나 내 칸만 갱신한다. 다른 서비스의 칸은 건드리지 않는다.
  await env.DB.prepare(
    `INSERT INTO suite_daily (user_id, day, ${flag}, ${keyCol})
     VALUES (?, ?, 1, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET ${flag} = 1, ${keyCol} = excluded.${keyCol}`,
  )
    .bind(userId, day, String(itemKey))
    .run();

  // 전국 분포 — 원문이 아니라 항목 카운트만 올린다
  await env.DB.prepare(
    `INSERT INTO daily_agg (day, service, item_key, cnt) VALUES (?, ?, ?, 1)
     ON CONFLICT (day, service, item_key) DO UPDATE SET cnt = cnt + 1`,
  )
    .bind(day, service, String(itemKey))
    .run();

  const row = await env.DB.prepare(
    `SELECT tarot_done, saju_done, mind_done, triple_paid FROM suite_daily
      WHERE user_id = ? AND day = ?`,
  )
    .bind(userId, day)
    .first();

  const done = {
    tarot: Boolean(row?.tarot_done),
    saju: Boolean(row?.saju_done),
    mind: Boolean(row?.mind_done),
  };
  const triple = done.tarot && done.saju && done.mind;

  // 트리플 보상. 중복 방지는 멱등키가 하고, `triple_paid` 는 화면 표시용이다.
  let tripleGained = 0;
  if (triple) {
    const paid = await grantPoints(env, userId, {
      key: `TRIPLE_DONE:${day}`,
      reason: "TRIPLE_DONE",
      amount: SUITE.POINTS.TRIPLE_DONE,
      day,
    });
    if (paid) {
      tripleGained = SUITE.POINTS.TRIPLE_DONE;
      await env.DB.prepare(
        `UPDATE suite_daily SET triple_paid = 1 WHERE user_id = ? AND day = ?`,
      )
        .bind(userId, day)
        .run();
    }
  }

  return { triple, tripleGained, done };
}

/** 허브·크로스 칩이 쓰는 오늘 진행 상태 */
export async function dailyState(env, userId, day = dayKey()) {
  const row = await env.DB.prepare(
    `SELECT tarot_done, saju_done, mind_done, tarot_key, saju_key, mind_key, triple_paid
       FROM suite_daily WHERE user_id = ? AND day = ?`,
  )
    .bind(userId, day)
    .first();

  return {
    tarot: { done: Boolean(row?.tarot_done), key: row?.tarot_key ?? null },
    saju: { done: Boolean(row?.saju_done), key: row?.saju_key ?? null },
    mind: { done: Boolean(row?.mind_done), key: row?.mind_key ?? null },
    progress:
      Number(Boolean(row?.tarot_done)) +
      Number(Boolean(row?.saju_done)) +
      Number(Boolean(row?.mind_done)),
    triple_paid: Boolean(row?.triple_paid),
  };
}

// ══════════════════════════════════════════════════════════════
// 전국 분포
// ══════════════════════════════════════════════════════════════

/**
 * 항목별 분포를 % 로 돌려준다.
 *
 * **표본이 적으면 공개하지 않는다.** 참여자가 몇십 명일 때 "4.5%" 를 보여 주면
 * 그 값은 사람 한두 명을 뜻하고, 다음 사람의 선택을 그쪽으로 끌어당긴다
 * (원리 10 경고 — SUITE 1.5). 임계 미만이면 `open: false` 로 응답한다.
 */
export async function distribution(env, service, day = dayKey()) {
  const rows = await env.DB.prepare(
    `SELECT item_key, cnt FROM daily_agg WHERE day = ? AND service = ? ORDER BY cnt DESC`,
  )
    .bind(day, service)
    .all();

  const list = rows?.results ?? [];
  const total = list.reduce((a, r) => a + (r.cnt ?? 0), 0);

  if (total < SUITE.DIST_MIN_SAMPLES) {
    return { open: false, total, threshold: SUITE.DIST_MIN_SAMPLES, items: [] };
  }

  return {
    open: true,
    total,
    threshold: SUITE.DIST_MIN_SAMPLES,
    items: list.map((r) => ({
      key: r.item_key,
      cnt: r.cnt,
      pct: Number(((r.cnt / total) * 100).toFixed(1)), // 소수점 1자리 (SUITE 1.5)
    })),
  };
}

/** 이용자가 처음 온 날을 남긴다(스위트 진입점 공통) */
export async function touchUser(env, userId, day = dayKey()) {
  await env.DB.prepare(
    `INSERT INTO suite_user (user_id, created_day, last_seen_day) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET last_seen_day = excluded.last_seen_day`,
  )
    .bind(userId, day, day)
    .run();
}
