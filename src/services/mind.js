/**
 * 🔬 오늘의 선택 — 서버
 * ==========================================================================
 *
 * 기획: MIND-SPEC-01 · 레퍼런스 구현 `mind/prototype/MIND-PROTO-01_마음연구소.html`
 * (파일명은 개명 전 이름 그대로다)
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
 * ── 전국 추측은 없앴다 (REQ-62 ⑮ · E1) ──────────────────────────────────
 * 결과 화면의 「사람들은?」 추측은 그날 모두에게 같은 답이라 공유되면 분포 광고를
 * 우회했다(정답 있는 게임 금지). 원래 서버에 저장·API 가 없었으므로 여기는 바뀐 것이 없다.
 */

import { MIND, SUITE } from "../lib/config.js";
import { ApiError } from "../lib/http.js";
import { dayKey } from "../lib/time.js";
import { grantMany, completeDaily, dailyState, distribution, distOpen, touchUser, pointState } from "../lib/suite.js";
import { createLink, answerLink, openLink, myLinks } from "../lib/pair.js";
// 도감용 목록(id·요일·months·제목·유형 이름)과 그날의 선택 고르기 — 화면과 **같은 파일**을 쓴다.
// 본문(장면·문항)은 여전히 서버에 없다. 목록만 있으면 「그날 회전 결과가 이 실험인가」와
// 「목록에 있는 실험인가」를 판정할 수 있다 (REQ-47)
import { MIND_INDEX } from "../../public/mind/mind-index.js";
import { expOfDay } from "../../public/mind/mind-pick.js";

const KNOWN_EXP = new Set(MIND_INDEX.experiments.map((e) => e.id));

/** 그날 회전으로 나오는 실험 id — 화면과 같은 규칙(mind-pick.js) */
const rotationOf = (day) => expOfDay(MIND_INDEX.experiments, dowOf(day), day)?.id ?? null;

/** YYYY-MM-DD 에서 n 일 뒤(음수면 앞) */
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

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
  // 목록에 있는 실험만 센다 — 예전엔 exp_id 를 검증하지 않아 엉뚱한 키가 섞였을 수 있다 (REQ-47)
  return (rows?.results ?? []).filter((r) => KNOWN_EXP.has(r.exp_id)).map((r) => `${r.exp_id}:${r.type_idx}`);
}

/**
 * 「지난 선택」 창 — 오늘을 뺀 직전 6일(MIND-SPEC-01 M-04).
 *
 *   played    그날 오늘의 선택을 했다(done=1)
 *   opened    광고로 열어 두었고 아직 안 했다 — 행이 있고 exp_id 가 있고 done=0
 *   available 아무것도 없다 → 광고로 열 수 있다
 *
 * 「열어 둠」을 따로 표에 두지 않고 **그날의 mind_daily 행**에 적는다(그날 회전 실험 id, done=0).
 * 새 열이 필요 없고(마이그레이션 없음), 그날을 하면 같은 행이 done=1 이 된다.
 */
async function archiveWindow(env, userId, day) {
  const days = Array.from({ length: MIND.ARCHIVE_DAYS }, (_, i) => addDays(day, -(i + 1))); // 최근 날부터
  const rows = await env.DB.prepare(
    `SELECT day, done, exp_id FROM mind_daily WHERE user_id = ? AND day >= ? AND day <= ?`,
  )
    .bind(userId, days.at(-1), days[0])
    .all();
  const byDay = new Map((rows?.results ?? []).map((r) => [r.day, r]));
  return days.map((d) => {
    const r = byDay.get(d);
    const status = r?.done ? "played" : r?.exp_id ? "opened" : "available";
    return { day: d, status, exp_id: status === "opened" ? r.exp_id : rotationOf(d) };
  });
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
    // 축은 「드러난 횟수」다 — 부호(양끝)와 무관하게 +1 (REQ-62 ⑬ · D5). 화면 judge 와 같은 규칙
    const [axIdx] = pick.ax ?? [];
    if (Number.isInteger(axIdx) && axIdx >= 0 && axIdx < MIND.AXES) gain[axIdx] += 1;
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
  const [st, axes, coll, suite, points, win, open, mindToday] = await Promise.all([
    loadDay(env, userId, day),
    loadAxes(env, userId, month),
    collection(env, userId),
    dailyState(env, userId, day),
    pointState(env, userId, day),
    archiveWindow(env, userId, day),
    distOpen(env, "mind", day),
    // 오늘 선택으로 받은 포인트(재열람 결과 화면) — 셋 다 보너스는 빼고 선택 몫만 (REQ-63 v2)
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS p FROM suite_points
        WHERE user_id = ? AND day = ? AND reason LIKE 'MIND\\_%' ESCAPE '\\'`,
    )
      .bind(userId, day)
      .first(),
  ]);

  return {
    day,
    month,
    dow: dowOf(day),
    // 같은 요일 실험이 여럿일 때 화면이 주 단위로 돌리려면 날짜가 필요하다
    day,
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
    // 지난 선택 (M-04) — 열 수 있는 날 수와, 열어 두고 아직 안 한 날들(최근 날부터).
    // 열 것이 없으면 화면은 광고 카드를 아예 숨긴다(광고 보고 아무것도 없는 상황 금지)
    archive: {
      available: win.filter((w) => w.status === "available").length,
      opened: win.filter((w) => w.status === "opened").map(({ day: d, exp_id }) => ({ day: d, exp_id })),
    },
    ad_stats_seen: st.adStats,
    dist_open: open, // 분포가 열렸는가 — 닫혀 있으면 화면이 분포 광고 카드를 숨긴다 (REQ-62 ⑭)
    // 화면이 금액을 상수로 쓰지 않게 (REQ-63 v2) — 예고 「+{core}P부터」 · 지도 완성 「+{portrait}P」 · 재열람 합계
    core_points: SUITE.POINTS.CORE_DONE,
    portrait_points: SUITE.POINTS.MILESTONE_FULL,
    today_points: mindToday?.p ?? 0,
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

  if (!expId) throw new ApiError("BAD_PARAM", "선택이 지정되지 않았습니다.", 400);
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
  // 목록에 없는 실험은 받지 않는다 — 도감 칸이 엉뚱한 키로 늘지 않게 (REQ-47)
  if (!KNOWN_EXP.has(expId)) throw new ApiError("BAD_PARAM", "알 수 없는 선택입니다.", 400);

  // 지난 선택(광고로 연 날)은 길이 따로다 — 오늘 행·적립을 건드리지 않는다 (M-04)
  if (body?.archive_day != null) return submitArchive(env, userId, day, String(body.archive_day), expId, questions, answers);

  const st = await loadDay(env, userId, day);
  if (st.done) {
    throw new ApiError("ALREADY_DONE", "오늘의 선택은 이미 마쳤어요. 결과를 다시 볼 수 있습니다.", 409);
  }
  // 오늘 회전이 아닌 장면은 받지 않는다 — 23:59 에 연 어제 장면이 0시 넘어 오늘로 기록되거나,
  // 배포로 회전이 바뀐 뒤 옛 장면이 들어오는 경우다. 저장·적립 전에 끊고, 열어야 할 장면을
  // 함께 준다 (REQ-62 ⑨)
  const expected = rotationOf(day);
  if (expected !== expId) {
    throw new ApiError("DAY_CHANGED", "오늘의 선택이 바뀌었어요.", 409, { expected_exp_id: expected, day });
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

  const detail = []; // 적립 내역 (REQ-63 gain_detail)
  const gained = await grantMany(env, userId, grants, detail);

  if (mapComplete && !before.portraitPaid) {
    await env.DB.prepare(
      `UPDATE mind_axes SET portrait_paid = 1 WHERE user_id = ? AND month = ?`,
    )
      .bind(userId, month)
      .run();
  }

  const suiteResult = await completeDaily(env, userId, "mind", `${expId}:${typeIdx}`, day);
  if (suiteResult.tripleGained > 0) detail.push({ kind: "triple", p: suiteResult.tripleGained });

  return {
    type_idx: typeIdx,
    exp_id: expId,
    is_new: isNew,
    axes: after,
    axes_gain: gain,
    map_complete: mapComplete,
    portrait_new: mapComplete && !before.portraitPaid,
    gained,
    gain_detail: detail,
    triple: suiteResult.triple,
    triple_gained: suiteResult.tripleGained,
    suite: await dailyState(env, userId, day),
    points: await pointState(env, userId, day),
  };
}

/**
 * 지난 선택 제출 (MIND-SPEC-01 M-04 · REQ-47).
 *
 * 검증: 직전 6일 안 · 오늘이 아님 · 그날 회전 결과가 그 실험 · 그날 행이 「광고로 열어 둠」(done=0).
 * 반영: **그날 행**만 done=1 · 도감(mind_coll)·이번 달 마음 지도 축.
 * 반영하지 않음: 오늘 행 · 코어(MIND_DONE)·신규(MIND_NEW)·초상·3종 완료 적립 · 허브 · 전국 분포.
 *
 * 「열어 둠 → 함」 전환을 조건부 UPDATE 하나로 한다(`AND done = 0`). 같은 날을 두 번 동시에
 * 내도 한쪽만 changes 1 을 받고, 도감·지도는 그쪽만 반영한다.
 */
async function submitArchive(env, userId, today, archiveDay, expId, questions, answers) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(archiveDay)) throw new ApiError("BAD_PARAM", "날짜 형식이 올바르지 않습니다.", 400);
  const win = await archiveWindow(env, userId, today);
  const slot = win.find((w) => w.day === archiveDay);
  if (!slot) {
    throw new ApiError("ARCHIVE_RANGE", `지난 선택은 직전 ${MIND.ARCHIVE_DAYS}일 안의 날만 할 수 있어요.`, 400);
  }
  if (rotationOf(archiveDay) !== expId) {
    throw new ApiError("ARCHIVE_MISMATCH", "그날의 선택이 아니에요.", 400);
  }
  if (slot.status !== "opened") {
    throw new ApiError(
      slot.status === "played" ? "ALREADY_DONE" : "ARCHIVE_NOT_OPENED",
      slot.status === "played" ? "그날의 선택은 이미 했어요." : "광고로 먼저 열어야 하는 날이에요.",
      409,
    );
  }

  const { typeIdx, gain } = judge(questions, answers);
  const upd = await env.DB.prepare(
    `UPDATE mind_daily SET done = 1, type_idx = ? WHERE user_id = ? AND day = ? AND exp_id = ? AND done = 0`,
  )
    .bind(typeIdx, userId, archiveDay, expId)
    .run();
  if ((upd?.meta?.changes ?? 0) === 0) {
    throw new ApiError("ALREADY_DONE", "그날의 선택은 이미 했어요.", 409);
  }

  // 마음 지도 — **이번 달** 지도에 반영한다(지난 날을 해도 지금 그리는 지도다)
  const month = monthKey(today);
  const before = await loadAxes(env, userId, month);
  const after = before.ax.map((n, i) => n + (gain[i] ?? 0));
  await env.DB.prepare(
    `INSERT INTO mind_axes (user_id, month, ax) VALUES (?, ?, ?)
     ON CONFLICT (user_id, month) DO UPDATE SET ax = excluded.ax`,
  )
    .bind(userId, month, JSON.stringify(after))
    .run();

  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO mind_coll (user_id, exp_id, type_idx, first_day) VALUES (?, ?, ?, ?)`,
  )
    .bind(userId, expId, typeIdx, today)
    .run();

  return {
    archive_day: archiveDay,
    type_idx: typeIdx,
    exp_id: expId,
    is_new: (ins?.meta?.changes ?? 0) > 0,
    axes: after,
    axes_gain: gain,
    map_complete: after.every((n) => n >= MIND.AXIS_GOAL),
    portrait_new: false,
    gained: 0, // 적립 없음 — 코어 1회 원칙
    points: await pointState(env, userId, today),
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
 * 「지난 선택 열기」 — 직전 6일 중 **안 한 날 하나**(가장 최근 날)를 연다 (M-04 · REQ-47).
 *
 * 처음엔 횟수만 세고 아무것도 열지 않았다(광고를 보고 아무 일도 없었다). 이제 그날 행에
 * 회전 실험 id 를 적어 「열어 둠」으로 둔다 — 화면은 그 목록을 보고 그날 선택을 받아 연다.
 *
 * **적립은 없다**(코어 1회 원칙). 도감·지도에는 반영된다(submitArchive).
 * 열 날이 없으면 오류 — 광고 기록도 남지 않는다(지급이 실패하면 기록 전에 끝난다).
 * 조건부 INSERT(`DO UPDATE … WHERE done = 0 AND exp_id IS NULL`)라 동시에 두 번 와도 같은 날을
 * 두 번 「열지」 않고, 다음 날로 넘어간다.
 */
export async function grantArchive(env, userId, day = dayKey()) {
  let openedDay = null;
  for (const w of await archiveWindow(env, userId, day)) {
    if (w.status !== "available" || !w.exp_id) continue;
    const r = await env.DB.prepare(
      `INSERT INTO mind_daily (user_id, day, exp_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET exp_id = excluded.exp_id
         WHERE mind_daily.done = 0 AND mind_daily.exp_id IS NULL`,
    )
      .bind(userId, w.day, w.exp_id)
      .run();
    if ((r?.meta?.changes ?? 0) > 0) {
      openedDay = w;
      break;
    }
  }
  if (!openedDay) {
    throw new ApiError("ARCHIVE_EMPTY", `직전 ${MIND.ARCHIVE_DAYS}일 중 열 수 있는 선택이 없어요.`, 409);
  }

  await env.DB.prepare(
    `INSERT INTO mind_daily (user_id, day, ad_archive_used) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ad_archive_used = ad_archive_used + 1`,
  )
    .bind(userId, day)
    .run();

  const st = await loadDay(env, userId, day);
  return {
    kind: "MIND_ARCHIVE",
    opened: { day: openedDay.day, exp_id: openedDay.exp_id },
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
/**
 * `GET /api/mind/pair/new?relation=…` — 발급 화면이 물어볼 **문항 번호**를 준다.
 *
 * 문항은 `hash(day|relation)` 으로 정해진다. 화면이 같은 해시를 다시 구현하면
 * **두 곳이 어긋날 수 있고**(한쪽만 고치면 발급 때 보여 준 문항과 서버가 저장한
 * 문항이 달라진다), 그건 링크를 받은 사람이 엉뚱한 문제를 푸는 결과가 된다.
 * 그래서 번호는 서버가 정하고 **문장만 화면이 갖는다** — 콘텐츠는 화면, 규칙은
 * 서버라는 이 저장소의 분업 그대로다.
 */
export async function pairNew({ env, userId, body }) {
  const day = dayKey();
  const st = await loadDay(env, userId, day);
  if (!st.done) {
    throw new ApiError("MIND_NOT_DONE", "오늘의 선택을 먼저 마쳐 주세요.", 409);
  }

  const relation = String(body?.relation ?? "");
  if (!SUITE.PAIR.RELATIONS.includes(relation)) {
    throw new ApiError("BAD_PARAM", "관계를 골라 주세요.", 400);
  }

  const pool = Number(body?.pool);
  if (!Number.isInteger(pool) || pool < SUITE.PAIR.QUESTIONS) {
    throw new ApiError("BAD_PARAM", "문항 묶음이 올바르지 않습니다.", 400);
  }

  const links = await myLinks(env, userId, day);
  return {
    relation,
    q: pairQuestionIds(day, relation, pool),
    remaining_today: Math.max(0, SUITE.PAIR.MAX_PER_DAY - links.length),
    expire_hours: Math.round(SUITE.PAIR.EXPIRE_MS / 3600000),
  };
}

export async function pairCreate({ env, userId, body }) {
  const day = dayKey();
  const st = await loadDay(env, userId, day);
  if (!st.done) {
    throw new ApiError("MIND_NOT_DONE", "오늘의 선택을 먼저 마쳐 주세요.", 409);
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
