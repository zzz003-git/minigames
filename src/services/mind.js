/**
 * 🔬 오늘의선택 — 서버
 * ==========================================================================
 *
 * 기획: MIND-SPEC-01 · 레퍼런스 구현 `mind/prototype/MIND-PROTO-01_오늘의선택.html`
 *
 * ── 유형은 서버가 다시 센다 ──────────────────────────────────────────────
 * 화면이 "나 3번 유형이야" 라고 신고하면 도감을 원하는 유형으로 채울 수 있다.
 * 그래서 **선택지 번호만 받고 유형은 서버가 계산한다**(기획서 M-02).
 * 규칙은 프로토와 같다 — 4문항의 `ty` 최다 득표, 동률이면 앞 인덱스.
 *
 * ── 원문을 남기지 않는다 ─────────────────────────────────────────────────
 * 어떤 선택지를 골랐는지는 유형과 축을 계산한 뒤 버린다(기획서 3절). 심리검사가
 * 아니라 오락이고, 원문을 쥐고 있을 이유가 없다. 그래서 `mind_daily` 에 응답
 * 컬럼이 없다.
 *
 * ── 전국 추측은 어디에도 기록하지 않는다 ─────────────────────────────────
 * 결과 화면의 「전국 추측 1문항」은 점수도 보상도 저장도 없다(기획서 M-01 · 검증
 * 항목). 그래서 이 파일에 그 API 가 **아예 없다** — 없는 것이 곧 구현이다.
 */

import { MIND, SUITE } from "../lib/config.js";
import { ApiError } from "../lib/http.js";
import { dayKey } from "../lib/time.js";
import { grantMany, completeDaily, dailyState, distribution, touchUser, pointState } from "../lib/suite.js";
import { createLink, answerLink, openLink, myLinks } from "../lib/pair.js";

/** 'YYYY-MM' — 지도의 월간 리셋 키 */
const monthKey = (day = dayKey()) => day.slice(0, 7);

/** KST 요일. dayKey 가 이미 KST 날짜라 여기서 다시 보정하지 않는다 */
function dowOf(day = dayKey()) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

const parseAx = (raw) => {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) && v.length === MIND.AXES ? v.map((n) => Number(n) || 0) : new Array(MIND.AXES).fill(0);
  } catch {
    return new Array(MIND.AXES).fill(0);
  }
};

async function loadDay(env, userId, day) {
  const row = await env.DB.prepare(
    `SELECT done, exp_id, type_idx, ad_archive_used, ad_stats FROM mind_daily
      WHERE user_id = ? AND day = ?`,
  )
    .bind(userId, day)
    .first();

  return {
    done: Boolean(row?.done),
    expId: row?.exp_id ?? null,
    typeIdx: row?.type_idx ?? null,
    adArchiveUsed: row?.ad_archive_used ?? 0,
    adStats: Boolean(row?.ad_stats),
  };
}

async function loadAxes(env, userId, month) {
  const row = await env.DB.prepare(
    `SELECT ax, portrait_paid FROM mind_axes WHERE user_id = ? AND month = ?`,
  )
    .bind(userId, month)
    .first();
  return { ax: parseAx(row?.ax), portraitPaid: Boolean(row?.portrait_paid) };
}

async function collection(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT exp_id, type_idx FROM mind_coll WHERE user_id = ?`,
  )
    .bind(userId)
    .all();
  return (rows?.results ?? []).map((r) => `${r.exp_id}:${r.type_idx}`);
}

// ══════════════════════════════════════════════════════════════
// 판정 — 화면과 같은 규칙이어야 한다
// ══════════════════════════════════════════════════════════════

/**
 * 4문항의 선택으로 유형과 축 증가분을 구한다.
 *
 * `public/mind/mind.js` 의 같은 이름 함수와 **같은 규칙**이다. 화면은 결과를 미리
 * 보여 주기 위해 계산하고, 서버는 그것을 믿지 않기 위해 계산한다. 어긋나면 화면이
 * 보여 준 유형과 도감에 들어간 유형이 달라진다.
 *
 * @param {Array<{opts:Array<{ty:number, ax:[number,number]}>}>} questions 실험의 문항
 * @param {number[]} answers 문항별 선택지 인덱스 (0~4)
 */
export function judge(questions, answers) {
  const votes = new Array(MIND.TYPES).fill(0);
  const gain = new Array(MIND.AXES).fill(0);

  questions.forEach((q, i) => {
    const pick = q.opts[answers[i]];
    if (!pick) return;
    if (pick.ty >= 0 && pick.ty < MIND.TYPES) votes[pick.ty] += 1;
    const [axIdx, delta] = pick.ax ?? [];
    if (Number.isInteger(axIdx) && axIdx >= 0 && axIdx < MIND.AXES) gain[axIdx] += delta ?? 1;
  });

  // 최다 득표. 동률이면 **앞 인덱스**가 이긴다(프로토 사양) — 무작위로 가르면
  // 같은 선택인데 결과가 달라져 「내 유형」이라는 말이 성립하지 않는다.
  let best = 0;
  for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;

  return { typeIdx: best, votes, gain };
}

// ══════════════════════════════════════════════════════════════
// GET /api/mind/state
// ══════════════════════════════════════════════════════════════

export async function state({ env, userId }) {
  const day = dayKey();
  await touchUser(env, userId, day);

  const month = monthKey(day);
  const [st, axes, coll, suite, points] = await Promise.all([
    loadDay(env, userId, day),
    loadAxes(env, userId, month),
    collection(env, userId),
    dailyState(env, userId, day),
    pointState(env, userId, day),
  ]);

  return {
    day,
    month,
    dow: dowOf(day),
    done: st.done,
    exp_id: st.expId,
    type_idx: st.typeIdx,
    axes: axes.ax,
    axes_goal: MIND.AXIS_GOAL,
    map_complete: axes.ax.every((n) => n >= MIND.AXIS_GOAL),
    portrait_paid: axes.portraitPaid,
    collection: coll,
    ad_archive_used: st.adArchiveUsed,
    ad_archive_max: MIND.AD_ARCHIVE_PER_DAY,
    ad_stats_seen: st.adStats,
    suite,
    points,
  };
}

// ══════════════════════════════════════════════════════════════
// POST /api/mind/submit
// ══════════════════════════════════════════════════════════════

/**
 * body: { exp_id, questions:[{opts:[{ty,ax}]}], answers:[4] }
 *
 * ── 왜 문항을 화면이 보내는가 ────────────────────────────────────────────
 * 콘텐츠 DB(691조각)가 화면에만 있기 때문이다. 서버가 같은 DB 를 갖게 하면 실험을
 * 추가할 때마다 두 곳을 고쳐야 하고(기획서 5절은 주 2~3개 공급을 전제한다),
 * 서버 번들이 콘텐츠 크기만큼 커진다.
 *
 * 그래서 **채점표를 함께 받되 형태를 검증한다.** 이것이 막는 것과 못 막는 것은
 * 분명하다 — 화면이 "내 유형은 3번" 이라고 신고하는 것은 막지만, 채점표 자체를
 * 조작해 원하는 유형이 나오게 만드는 것은 막지 못한다. 순위도 경쟁도 없고 적립이
 * 하루 한 번 고정이라 조작의 실익이 도감 칸 하나뿐이므로, 콘텐츠를 서버로 옮기는
 * 비용을 치르지 않는다(기존 게임들의 「이상치는 거부하지 않고 표시」와 같은 판단).
 */
export async function submit({ env, userId, body }) {
  const day = dayKey();
  const month = monthKey(day);

  const expId = String(body?.exp_id ?? "");
  const questions = body?.questions;
  const answers = body?.answers;

  if (!expId) throw new ApiError("BAD_PARAM", "실험이 지정되지 않았습니다.", 400);
  if (!Array.isArray(questions) || questions.length !== MIND.QUESTIONS) {
    throw new ApiError("BAD_PARAM", `문항은 ${MIND.QUESTIONS}개여야 합니다.`, 400);
  }
  if (!Array.isArray(answers) || answers.length !== MIND.QUESTIONS) {
    throw new ApiError("BAD_PARAM", "응답 수가 문항 수와 다릅니다.", 400);
  }
  for (const q of questions) {
    if (!Array.isArray(q?.opts) || q.opts.length !== MIND.OPTIONS) {
      throw new ApiError("BAD_PARAM", `선택지는 문항당 ${MIND.OPTIONS}개여야 합니다.`, 400);
    }
  }
  if (!answers.every((a) => Number.isInteger(a) && a >= 0 && a < MIND.OPTIONS)) {
    throw new ApiError("BAD_PARAM", "선택지 번호가 올바르지 않습니다.", 400);
  }

  const st = await loadDay(env, userId, day);
  if (st.done) {
    throw new ApiError("ALREADY_DONE", "오늘의 실험은 이미 마쳤어요. 결과를 다시 볼 수 있습니다.", 409);
  }

  // ── 서버가 다시 센다 ────────────────────────────────────────
  const { typeIdx, gain } = judge(questions, answers);

  await env.DB.prepare(
    `INSERT INTO mind_daily (user_id, day, done, exp_id, type_idx) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET done = 1, exp_id = excluded.exp_id, type_idx = excluded.type_idx`,
  )
    .bind(userId, day, expId, typeIdx)
    .run();

  // 마음 지도 — 이번 실험이 건드린 축만 올린다
  const before = await loadAxes(env, userId, month);
  const after = before.ax.map((n, i) => n + (gain[i] ?? 0));
  await env.DB.prepare(
    `INSERT INTO mind_axes (user_id, month, ax) VALUES (?, ?, ?)
     ON CONFLICT (user_id, month) DO UPDATE SET ax = excluded.ax`,
  )
    .bind(userId, month, JSON.stringify(after))
    .run();

  // 도감 — 같은 실험이라도 다른 유형이 나오면 새 칸이다
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO mind_coll (user_id, exp_id, type_idx, first_day) VALUES (?, ?, ?, ?)`,
  )
    .bind(userId, expId, typeIdx, day)
    .run();
  const isNew = (ins?.meta?.changes ?? 0) > 0;

  // ── 적립 ────────────────────────────────────────────────────
  const grants = [
    { key: `MIND_DONE:${day}`, reason: "MIND_DONE", amount: SUITE.POINTS.CORE_DONE, day },
  ];
  if (isNew) {
    grants.push({
      key: `MIND_NEW:${expId}:${typeIdx}`, // 실험·유형별 평생 1회
      reason: "MIND_NEW",
      amount: SUITE.POINTS.COLLECT_NEW,
      day,
    });
  }

  // 지도 완성 — 여덟 축이 전부 목표치에 닿으면 「마음 초상」
  const mapComplete = after.every((n) => n >= MIND.AXIS_GOAL);
  if (mapComplete) {
    grants.push({
      key: `MIND_PORTRAIT:${month}`, // 달마다 한 번 (지도가 월간 리셋이므로)
      reason: "MIND_PORTRAIT",
      amount: SUITE.POINTS.MILESTONE_FULL,
      day,
    });
  }

  const gained = await grantMany(env, userId, grants);

  if (mapComplete && !before.portraitPaid) {
    await env.DB.prepare(
      `UPDATE mind_axes SET portrait_paid = 1 WHERE user_id = ? AND month = ?`,
    )
      .bind(userId, month)
      .run();
  }

  const suiteResult = await completeDaily(env, userId, "mind", `${expId}:${typeIdx}`, day);

  return {
    type_idx: typeIdx,
    exp_id: expId,
    is_new: isNew,
    axes: after,
    axes_gain: gain,
    map_complete: mapComplete,
    portrait_new: mapComplete && !before.portraitPaid,
    gained,
    triple: suiteResult.triple,
    triple_gained: suiteResult.tripleGained,
    suite: await dailyState(env, userId, day),
    points: await pointState(env, userId, day),
  };
}

// ══════════════════════════════════════════════════════════════
// GET /api/mind/stats
// ══════════════════════════════════════════════════════════════

export async function stats({ env, userId }) {
  const day = dayKey();
  const st = await loadDay(env, userId, day);

  if (!st.adStats) {
    throw new ApiError("AD_REQUIRED", "광고를 시청하면 오늘의 유형 분포를 볼 수 있습니다.", 403);
  }

  const dist = await distribution(env, "mind", day);
  return { ...dist, mine: st.expId != null ? `${st.expId}:${st.typeIdx}` : null };
}

// ══════════════════════════════════════════════════════════════
// 광고 보상 (src/routes/ad.js 에서 호출)
// ══════════════════════════════════════════════════════════════

/**
 * 「지난 실험 열기」 — 직전 6일 안의 못 한 실험을 하나 연다.
 *
 * **적립은 없다**(기획서 M-04 「코어 1회 원칙」). 도감·지도에는 반영된다.
 * 무엇을 열지는 화면이 고르고, 서버는 횟수만 센다 — 어느 실험을 여는지는 보상과
 * 무관하기 때문이다.
 */
export async function grantArchive(env, userId, day = dayKey()) {
  await env.DB.prepare(
    `INSERT INTO mind_daily (user_id, day, ad_archive_used) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ad_archive_used = ad_archive_used + 1`,
  )
    .bind(userId, day)
    .run();

  const st = await loadDay(env, userId, day);
  return {
    kind: "MIND_ARCHIVE",
    ad_archive_used: st.adArchiveUsed,
    ad_archive_max: MIND.AD_ARCHIVE_PER_DAY,
    archive_days: MIND.ARCHIVE_DAYS,
  };
}

export async function unlockStats(env, userId, day = dayKey()) {
  await env.DB.prepare(
    `INSERT INTO mind_daily (user_id, day, ad_stats) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ad_stats = 1`,
  )
    .bind(userId, day)
    .run();
  return { kind: "UNLOCK", scope: "mind_stats" };
}

// ══════════════════════════════════════════════════════════════
// 페어 「너를 맞혀볼게」 (SUITE S-4)
// ══════════════════════════════════════════════════════════════

/**
 * 오늘·관계별로 뽑는 추측 문항 번호.
 *
 * 날짜와 관계로만 정해지므로 **서버와 화면이 따로 계산해도 같은 문항**이 나온다.
 * 저장할 상태가 없고, 같은 관계로 하루에 두 번 보내도 같은 문항이라 「문항 쇼핑」이
 * 성립하지 않는다.
 */
export function pairQuestionIds(day, relation, pool, count = SUITE.PAIR.QUESTIONS) {
  let h = 2166136261;
  for (const c of `${day}|${relation}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const seed = Math.abs(h);
  const out = [];
  for (let i = 0; out.length < count && i < pool * 4; i++) {
    const v = (seed + i * 7919) % pool;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * POST /api/mind/pair — 링크 생성
 *
 * body: { relation, guesses:[3], reasons:[3], pool }
 *   guesses 는 **내가 추측한 상대의 선택지**, reasons 는 문항별 근거 번호다.
 *   근거를 함께 받는 이유는 결과 화면에서 「무엇을 근거로 봤는가」를 되돌려 주기
 *   위해서다(기획서 M-05) — 맞히든 틀리든 그 한 줄이 대화 소재가 된다.
 *
 * **오늘의 실험을 마치기 전에는 만들 수 없다.** 자기 마음을 안 본 채 남을 맞히는
 * 것부터 하면 서비스의 순서가 뒤집힌다(기획서 1절 홈 엣지).
 */
export async function pairCreate({ env, userId, body }) {
  const day = dayKey();
  const st = await loadDay(env, userId, day);
  if (!st.done) {
    throw new ApiError("MIND_NOT_DONE", "오늘의 실험을 먼저 마쳐 주세요.", 409);
  }

  const relation = String(body?.relation ?? "");
  const pool = Number(body?.pool);
  const guesses = body?.guesses;
  const reasons = body?.reasons;
  const n = SUITE.PAIR.QUESTIONS;

  if (!Number.isInteger(pool) || pool < n) {
    throw new ApiError("BAD_PARAM", "문항 묶음이 올바르지 않습니다.", 400);
  }
  if (!Array.isArray(guesses) || guesses.length !== n) {
    throw new ApiError("BAD_PARAM", `추측은 ${n}개여야 합니다.`, 400);
  }
  if (!guesses.every((g) => Number.isInteger(g) && g >= 0 && g < MIND.OPTIONS)) {
    throw new ApiError("BAD_PARAM", "추측한 선택지 번호가 올바르지 않습니다.", 400);
  }
  // 근거는 문항마다 반드시 하나씩 골라야 한다 (기획서 1절 「근거 선택 없이는 진행 불가」)
  if (!Array.isArray(reasons) || reasons.length !== n || reasons.some((r) => !Number.isInteger(r))) {
    throw new ApiError("BAD_PARAM", "문항마다 근거를 하나씩 골라 주세요.", 400);
  }

  const q = pairQuestionIds(day, relation, pool);
  const link = await createLink(env, userId, {
    service: "mind",
    relation,
    payload: { q, guess: guesses, reasons },
  });

  return link;
}

/**
 * POST /api/pair/answer — 상대의 응답
 *
 * 응답자에게는 계정이 없다. 그래서 이 경로는 **로그인도 소유 확인도 하지 않는다** —
 * 토큰을 가진 사람이 곧 응답자다(기획서 3.2 마찰 0).
 */
export async function pairAnswer({ env, body }) {
  const picks = body?.answers;
  const n = SUITE.PAIR.QUESTIONS;

  if (!Array.isArray(picks) || picks.length !== n) {
    throw new ApiError("BAD_PARAM", `응답은 ${n}개여야 합니다.`, 400);
  }
  if (!picks.every((p) => Number.isInteger(p) && p >= 0 && p < MIND.OPTIONS)) {
    throw new ApiError("BAD_PARAM", "선택지 번호가 올바르지 않습니다.", 400);
  }

  const { row, payload, hits, pct, gained } = await answerLink(
    env,
    body?.token,
    picks,
    // 「맞혔다」의 뜻 — 심리는 **같은 선택지**다
    (p, ans) => {
      const guess = p.guess ?? [];
      const hitArr = ans.map((v, i) => v === guess[i]);
      return { hits: hitArr, pct: Math.round((hitArr.filter(Boolean).length / hitArr.length) * 100) };
    },
  );

  // 관계별 최고 지수 — "엄마와 64%" 를 다음에 보여 주기 위한 것
  await env.DB.prepare(
    `INSERT INTO mind_pair_best (user_id, relation, best_pct, last_day) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, relation) DO UPDATE SET
       best_pct = MAX(mind_pair_best.best_pct, excluded.best_pct),
       last_day = excluded.last_day`,
  )
    .bind(row.owner_id, row.relation, pct, dayKey())
    .run();

  return {
    pct,
    hits,
    question_ids: payload.q ?? [],
    // 응답자도 owner 와 **같은 데이터**를 본다(기획서 M-06). 받는 재미가 먼저다
    guess: payload.guess ?? [],
    reasons: payload.reasons ?? [],
    relation: row.relation,
    owner_gained: gained,
  };
}

/** GET /api/pair/open?token= — 응답자 화면이 여는 링크 */
export async function pairOpen({ env, url }) {
  return openLink(env, url.searchParams.get("token"));
}

/** GET /api/mind/pairs — 내가 오늘 보낸 링크들 (푸시가 없으므로 재방문 시 여기서 본다) */
export async function pairList({ env, userId }) {
  const day = dayKey();
  const links = await myLinks(env, userId, day);
  const rows = await env.DB.prepare(
    `SELECT relation, best_pct FROM mind_pair_best WHERE user_id = ?`,
  )
    .bind(userId)
    .all();

  return {
    links,
    best: Object.fromEntries((rows?.results ?? []).map((r) => [r.relation, r.best_pct])),
    max_per_day: SUITE.PAIR.MAX_PER_DAY,
    remaining_today: Math.max(0, SUITE.PAIR.MAX_PER_DAY - links.length),
  };
}

/** 케미 리포트 (광고) — 지수 구간 코멘트. 열람 해제만 하고 내용은 화면이 고른다 */
export async function unlockChemi(env, userId, day = dayKey()) {
  await env.DB.prepare(
    `INSERT INTO mind_daily (user_id, day, pair_reward_paid) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET pair_reward_paid = 1`,
  )
    .bind(userId, day)
    .run();
  return { kind: "UNLOCK", scope: "mind_chemi" };
}
