/**
 * 🌤️ 오늘의 기운 — 서버
 * ==========================================================================
 *
 * 기획: SAJU-SPEC-01 · 만세력 확정: docs/saju-calendar.md
 *
 * ── 계산은 전부 서버가 한다 ──────────────────────────────────────────────
 * 명식(네 기둥)·일진·십신·지지관계·오행은 서버가 정한다. 화면이 정할 수 있으면
 * 도장판을 원하는 간지로 채울 수 있고, 그건 순(10칸) 완성 +20P·6순 대완성 +100P 에
 * 직접 닿는다. 화면은 **문장 회전만** 한다(콘텐츠는 보상과 무관하다).
 *
 * ── 남의 생년월일은 서버로 오지 않는다 ───────────────────────────────────
 * 「소중한 사람의 오늘」(S-05)은 화면에서 계산하고 즉시 버린다. 그래서 이 파일에
 * 그 API 가 **없다** — 없는 것이 곧 구현이다(심리의 전국 추측과 같은 처리).
 */

import { SUITE, SAJU } from "../lib/config.js";
import { ApiError } from "../lib/http.js";
import { dayKey, now } from "../lib/time.js";
import { natalChart, dayGanzhi, ganzhiName, STEMS, BRANCHES } from "../lib/saju-calendar.js";
import { grantMany, completeDaily, dailyState, distribution, touchUser, pointState } from "../lib/suite.js";

// ══════════════════════════════════════════════════════════════
// 명리 기초 — 오행·십신·지지관계
// ══════════════════════════════════════════════════════════════

/** 천간의 오행 (0=목 1=화 2=토 3=금 4=수) */
const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
/** 지지의 오행 */
const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];

const GEN = [1, 2, 3, 4, 0]; // 목생화 …
const CTRL = [2, 3, 4, 0, 1]; // 목극토 …

/**
 * 십신 — 내 일간이 오늘의 천간을 어떻게 보는가.
 *
 * 0 비견 1 겁재 2 식신 3 상관 4 편재 5 정재 6 편관 7 정관 8 편인 9 정인
 * 음양이 같으면 앞쪽(비견·식신·편재·편관·편인), 다르면 뒤쪽이다.
 */
export function tenGod(me, other) {
  const em = STEM_EL[me];
  const eo = STEM_EL[other];
  const same = me % 2 === other % 2;

  if (em === eo) return same ? 0 : 1; // 비견 / 겁재
  if (GEN[em] === eo) return same ? 2 : 3; // 식신 / 상관
  if (CTRL[em] === eo) return same ? 4 : 5; // 편재 / 정재
  if (CTRL[eo] === em) return same ? 6 : 7; // 편관 / 정관
  return same ? 8 : 9; // 편인 / 정인
}

/**
 * 지지관계 — 내 일지와 오늘 일지 사이.
 *
 * 우선순위가 있다: 육합 > 삼합 > 충 > 형 > 동기 > 평온 (기획서 S-03).
 * **파·해·원진은 넣지 않는다** — 유파가 갈려 기획서가 도입을 금지했다.
 */
const YUKHAP = [[0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7]];
const SAMHAP = [[8, 0, 4], [2, 6, 10], [11, 3, 7], [5, 9, 1]];
const HYUNG = [[2, 5, 8], [1, 10, 7], [3, 0], [4], [6], [9], [11]];

export function branchRelation(mine, today) {
  const pair = (a) => a.includes(mine) && a.includes(today) && mine !== today;
  if (YUKHAP.some(pair)) return "yukhap";
  if (SAMHAP.some(pair)) return "samhap";
  if ((mine + 6) % 12 === today) return "chung";
  if (HYUNG.some(pair)) return "hyung";
  if (mine === today) return "donggi";
  return "pyeongon";
}

// ══════════════════════════════════════════════════════════════
// 상태
// ══════════════════════════════════════════════════════════════

const parseProfile = (raw) => {
  try {
    return JSON.parse(raw ?? "");
  } catch {
    return null;
  }
};

async function loadProfile(env, userId) {
  const row = await env.DB.prepare(
    `SELECT saju_profile, saju_profile_changed_day FROM suite_user WHERE user_id = ?`,
  )
    .bind(userId)
    .first();
  return { profile: parseProfile(row?.saju_profile), changedDay: row?.saju_profile_changed_day ?? null };
}

async function loadDay(env, userId, day) {
  const row = await env.DB.prepare(
    `SELECT done, ganzhi, ad_tomorrow, ad_person, ad_stats FROM saju_daily
      WHERE user_id = ? AND day = ?`,
  )
    .bind(userId, day)
    .first();
  return {
    done: Boolean(row?.done),
    ganzhi: row?.ganzhi ?? null,
    adTomorrow: Boolean(row?.ad_tomorrow),
    adPerson: Boolean(row?.ad_person),
    adStats: Boolean(row?.ad_stats),
  };
}

async function stamps(env, userId) {
  const rows = await env.DB.prepare(`SELECT ganzhi FROM saju_stamp WHERE user_id = ?`)
    .bind(userId)
    .all();
  return (rows?.results ?? []).map((r) => r.ganzhi);
}

/** 순(旬) — 60갑자를 10칸씩 여섯 묶음으로 본다 */
const soonOf = (ganzhi) => Math.floor(ganzhi / 10);

// ══════════════════════════════════════════════════════════════
// POST /api/saju/profile
// ══════════════════════════════════════════════════════════════

/**
 * 사주 등록·변경. body: { birth: 'YYYY-MM-DD', hour: 0~23|null }
 *
 * **변경은 월 1회**다(기획서 S-01). 생년월일을 바꿔 가며 마음에 드는 리딩을 찾는
 * 것을 막는다 — 리딩이 매일 바뀌는 서비스라 그 여지를 열어 두면 안 된다.
 */
export async function profile({ env, userId, body }) {
  const day = dayKey();
  const birth = String(body?.birth ?? "");
  const hour = body?.hour == null ? null : Number(body.hour);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    throw new ApiError("BAD_PARAM", "생년월일을 확인해 주세요.", 400);
  }
  if (hour != null && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
    throw new ApiError("BAD_PARAM", "태어난 시간을 확인해 주세요.", 400);
  }

  // 만 14세 미만 차단 (기획서 1절)
  const age = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${birth}T00:00:00Z`)) / (365.2425 * 86400000);
  if (!(age >= SAJU.MIN_AGE)) {
    throw new ApiError("TOO_YOUNG", `만 ${SAJU.MIN_AGE}세부터 이용할 수 있어요.`, 403);
  }

  const cur = await loadProfile(env, userId);
  if (cur.profile && cur.changedDay && cur.changedDay.slice(0, 7) === day.slice(0, 7)) {
    throw new ApiError("PROFILE_LOCKED", "사주 정보는 한 달에 한 번만 바꿀 수 있어요.", 429);
  }

  // 명식은 서버가 세운다 (표 범위 밖이면 여기서 거부된다)
  const chart = natalChart(birth, hour);

  await touchUser(env, userId, day);
  await env.DB.prepare(
    `UPDATE suite_user SET saju_profile = ?, saju_profile_changed_day = ? WHERE user_id = ?`,
  )
    .bind(JSON.stringify({ birth, hour }), day, userId)
    .run();

  return { profile: { birth, hour }, chart: publicChart(chart) };
}

/** 화면에 내려보낼 명식 — 계산 근거(보정 메모)까지 함께 준다 */
const publicChart = (c) => ({
  year: c.year,
  month: c.month,
  day: c.day,
  hour: c.hour,
  jeol: c.jeol,
  notes: c.notes,
  day_master: { stem: c.day.stem, name: STEMS[c.day.stem], element: STEM_EL[c.day.stem] },
});

// ══════════════════════════════════════════════════════════════
// GET /api/saju/state
// ══════════════════════════════════════════════════════════════

export async function state({ env, userId }) {
  const day = dayKey();
  await touchUser(env, userId, day);

  const [{ profile: p, changedDay }, st, got, suite, points] = await Promise.all([
    loadProfile(env, userId),
    loadDay(env, userId, day),
    stamps(env, userId),
    dailyState(env, userId, day),
    pointState(env, userId, day),
  ]);

  const todayGz = dayGanzhi(day);
  const soonDone = [0, 1, 2, 3, 4, 5].map(
    (s) => got.filter((g) => soonOf(g) === s).length,
  );

  return {
    day,
    registered: Boolean(p),
    profile: p,
    profile_changed_day: changedDay,
    chart: p ? publicChart(natalChart(p.birth, p.hour)) : null,
    today: { ganzhi: todayGz, name: ganzhiName(todayGz) },
    done: st.done,
    stamps: got,
    stamp_count: got.length,
    soon_done: soonDone,
    ad_tomorrow: st.adTomorrow,
    ad_person: st.adPerson,
    ad_stats_seen: st.adStats,
    suite,
    points,
  };
}

// ══════════════════════════════════════════════════════════════
// POST /api/saju/today — 일일 꽂기
// ══════════════════════════════════════════════════════════════

export async function today({ env, userId }) {
  const day = dayKey();
  const { profile: p } = await loadProfile(env, userId);
  if (!p) throw new ApiError("NOT_REGISTERED", "먼저 사주를 등록해 주세요.", 409);

  const st = await loadDay(env, userId, day);
  if (st.done) {
    throw new ApiError("ALREADY_DONE", "오늘의 기운은 이미 꽂았어요. 리딩을 다시 볼 수 있습니다.", 409);
  }

  const chart = natalChart(p.birth, p.hour);
  const gz = dayGanzhi(day);
  const todayStem = gz % 10;
  const todayBranch = gz % 12;

  // 리딩 파라미터 — 문장 선택은 화면이 한다(보상과 무관)
  const god = tenGod(chart.day.stem, todayStem);
  const rel = branchRelation(chart.day.branch, todayBranch);
  const myEl = STEM_EL[chart.day.stem];
  const todayEl = STEM_EL[todayStem];

  await env.DB.prepare(
    `INSERT INTO saju_daily (user_id, day, done, ganzhi) VALUES (?, ?, 1, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET done = 1, ganzhi = excluded.ganzhi`,
  )
    .bind(userId, day, gz)
    .run();

  // 도장 — 같은 간지는 60일에 한 번만 오므로 간지가 기본키다.
  // 놓친 칸은 60일 뒤 같은 간지 날에 저절로 채워진다(기획서 S-07).
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO saju_stamp (user_id, ganzhi, day) VALUES (?, ?, ?)`,
  )
    .bind(userId, gz, day)
    .run();
  const isNew = (ins?.meta?.changes ?? 0) > 0;

  const got = await stamps(env, userId);
  const soon = soonOf(gz);
  const soonCount = got.filter((g) => soonOf(g) === soon).length;

  // ── 적립 ────────────────────────────────────────────────────
  const grants = [
    { key: `SAJU_STAMP:${day}`, reason: "SAJU_STAMP", amount: SUITE.POINTS.CORE_DONE, day },
  ];
  if (isNew) {
    grants.push({
      key: `SAJU_NEW:${gz}`, // 간지별 평생 1회
      reason: "SAJU_NEW",
      amount: SUITE.POINTS.COLLECT_NEW,
      day,
    });
  }
  if (soonCount >= SAJU.SOON_SIZE) {
    grants.push({
      key: `MILESTONE_SAJU_SOON:${soon}`, // 순마다 1회
      reason: "MILESTONE_SAJU_SOON",
      amount: SUITE.POINTS.MILESTONE_HALF,
      day,
    });
  }
  if (got.length >= SAJU.STAMPS_TOTAL) {
    grants.push({
      key: "MILESTONE_SAJU_GRAND",
      reason: "MILESTONE_SAJU_GRAND",
      amount: SUITE.POINTS.MILESTONE_GRAND,
      day,
    });
  }
  const gained = await grantMany(env, userId, grants);

  // 허브 축은 **십신**이다 — 교차 리딩(십신 10 × 타로 22)의 사주 축
  const suiteResult = await completeDaily(env, userId, "saju", String(god), day);

  return {
    ganzhi: gz,
    name: ganzhiName(gz),
    reading: {
      ten_god: god,
      relation: rel,
      my_element: myEl,
      today_element: todayEl,
      today_stem: todayStem,
      today_branch: todayBranch,
    },
    is_new: isNew,
    stamp_count: got.length,
    soon,
    soon_count: soonCount,
    gained,
    triple: suiteResult.triple,
    triple_gained: suiteResult.tripleGained,
    suite: await dailyState(env, userId, day),
    points: await pointState(env, userId, day),
  };
}

// ══════════════════════════════════════════════════════════════
// GET /api/saju/stats
// ══════════════════════════════════════════════════════════════

export async function stats({ env, userId }) {
  const day = dayKey();
  const st = await loadDay(env, userId, day);
  if (!st.adStats) {
    throw new ApiError("AD_REQUIRED", "광고를 시청하면 오늘의 분포를 볼 수 있습니다.", 403);
  }
  const dist = await distribution(env, "saju", day);
  const { profile: p } = await loadProfile(env, userId);
  const mine = p ? String(tenGod(natalChart(p.birth, p.hour).day.stem, dayGanzhi(day) % 10)) : null;
  return { ...dist, mine };
}

// ══════════════════════════════════════════════════════════════
// 광고 보상
// ══════════════════════════════════════════════════════════════

const flag = (col) => async (env, userId, day = dayKey()) => {
  await env.DB.prepare(
    `INSERT INTO saju_daily (user_id, day, ${col}) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ${col} = 1`,
  )
    .bind(userId, day)
    .run();
  return { kind: "UNLOCK", scope: col };
};

/** 「내일 미리보기」 — 내일 일진을 함께 준다 */
export async function unlockTomorrow(env, userId, day = dayKey()) {
  await flag("ad_tomorrow")(env, userId, day);
  const [y, m, d] = day.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const gz = dayGanzhi(tomorrow);
  return { kind: "SAJU_TOMORROW", day: tomorrow, ganzhi: gz, name: ganzhiName(gz) };
}

/**
 * 「소중한 사람의 오늘」 — **열람 해제만** 한다.
 *
 * 남의 생년월일은 서버로 오지 않는다. 화면이 계산하고 즉시 버린다(기획서 S-05).
 * 그래서 이 함수는 받을 것도 돌려줄 것도 없다.
 */
export const unlockPerson = flag("ad_person");
export const unlockStats = flag("ad_stats");
