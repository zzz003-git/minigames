/**
 * 페어 링크 — 스위트 3종이 공유하는 단일 인프라
 * ==========================================================================
 *
 * 기획: SUITE-SPEC-01 §1.6 · 선행 구현 서비스는 심리(S-4), 이후 사주·타로(S-5)
 *
 * ── 링크만으로 참여한다 ──────────────────────────────────────────────────
 * 상대는 가입도 설치도 이름 입력도 하지 않는다. `/p/{token}` 하나로 끝난다.
 * 그래서 이 파일에는 **응답자를 식별하는 코드가 없다** — 응답자에게 계정이 없는
 * 것이 이 설계의 전제이고, 그 사실이 그대로 전환의 근거가 된다(기획서 3.2-5).
 *
 * ── 원문을 오래 갖고 있지 않는다 ─────────────────────────────────────────
 * `answer` 원문은 지수를 계산하는 그 함수 안에서만 존재하고, 저장되는 것은
 * **요약(적중 배열·지수)** 이다. 남의 답을 원문으로 쥐고 있을 이유가 없다.
 */

import { SUITE } from "./config.js";
import { ApiError } from "./http.js";
import { randomId } from "./crypto.js";
import { dayKey, now } from "./time.js";
import { grantPoints } from "./suite.js";

const parse = (raw, fallback = null) => {
  try {
    return JSON.parse(raw ?? "");
  } catch {
    return fallback;
  }
};

/** 만료됐는가. 상태 컬럼이 아니라 시각으로 판단한다 — 배치가 늦어도 정확하다 */
const isExpired = (row) => now() - (row.created_at ?? 0) > SUITE.PAIR.EXPIRE_MS;

// ══════════════════════════════════════════════════════════════
// 생성
// ══════════════════════════════════════════════════════════════

/**
 * 링크를 만든다.
 *
 * 생성 상한은 **서비스 통합 하루 3건**이다(기획서 1.6). 서비스별로 3건씩 두면
 * 하루 9건이 되고, 그건 초대가 아니라 스팸이다.
 *
 * @param {{ service:string, relation:string, payload:object }} spec
 */
export async function createLink(env, ownerId, { service, relation, payload }) {
  const day = dayKey();

  if (!SUITE.SERVICES.includes(service)) {
    throw new ApiError("BAD_PARAM", "알 수 없는 서비스입니다.", 400);
  }
  if (!SUITE.PAIR.RELATIONS.includes(relation)) {
    throw new ApiError("BAD_PARAM", "관계를 골라 주세요.", 400);
  }

  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pair_link WHERE owner_id = ? AND day = ?`,
  )
    .bind(ownerId, day)
    .first();

  if ((row?.n ?? 0) >= SUITE.PAIR.MAX_PER_DAY) {
    throw new ApiError(
      "PAIR_LIMIT",
      `링크는 하루 ${SUITE.PAIR.MAX_PER_DAY}개까지 만들 수 있어요. 내일 다시 보내 보세요.`,
      429,
    );
  }

  const token = `${randomId()}${randomId()}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  await env.DB.prepare(
    `INSERT INTO pair_link (token, service, owner_id, relation, day, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(token, service, ownerId, relation, day, JSON.stringify(payload ?? {}), now())
    .run();

  return {
    token,
    url: `/p/${token}`,
    expires_in_hours: Math.round(SUITE.PAIR.EXPIRE_MS / 3600000),
    remaining_today: Math.max(0, SUITE.PAIR.MAX_PER_DAY - (row?.n ?? 0) - 1),
  };
}

// ══════════════════════════════════════════════════════════════
// 조회
// ══════════════════════════════════════════════════════════════

async function fetchRow(env, token) {
  const row = await env.DB.prepare(
    `SELECT token, service, owner_id, relation, day, payload, status, answer, created_at, answered_at
       FROM pair_link WHERE token = ?`,
  )
    .bind(String(token ?? ""))
    .first();

  if (!row) {
    throw new ApiError("PAIR_NOT_FOUND", "링크를 찾을 수 없어요. 주소를 다시 확인해 주세요.", 404);
  }
  return row;
}

/**
 * 응답자가 여는 화면의 데이터.
 *
 * **owner 가 무엇을 추측했는지는 내려보내지 않는다.** 그걸 보여 주면 응답자가
 * 맞춰 주게 되고, 지수가 「서로 아는 정도」가 아니라 「배려한 정도」가 된다.
 */
export async function openLink(env, token) {
  const row = await fetchRow(env, token);

  if (isExpired(row)) {
    throw new ApiError("PAIR_EXPIRED", "링크가 만료됐어요 — 새로 받아 보세요.", 410);
  }
  if (row.status === "answered") {
    throw new ApiError("PAIR_ANSWERED", "이미 답한 링크예요. 결과는 보낸 사람에게 있어요.", 409);
  }

  const payload = parse(row.payload, {}) ?? {};
  return {
    token: row.token,
    service: row.service,
    relation: row.relation,
    day: row.day,
    // 서비스가 화면을 그리는 데 필요한 것만. `guess`(내 추측)·`reasons`는 뺀다.
    question_ids: payload.q ?? [],
    count: (payload.q ?? []).length,
  };
}

/**
 * 응답을 받아 지수를 계산하고 **원문을 요약으로 치환해** 저장한다.
 *
 * `score` 는 서비스가 넘긴 채점 함수다 — 서비스마다 「맞혔다」의 뜻이 다르기 때문이다
 * (심리는 같은 선택지, 사주는 궁합 문장, 타로는 같은 카드).
 *
 * @param {(payload:object, answer:any)=>{hits:boolean[], pct:number}} score
 */
export async function answerLink(env, token, answer, score) {
  const row = await fetchRow(env, token);

  if (isExpired(row)) {
    throw new ApiError("PAIR_EXPIRED", "링크가 만료됐어요 — 새로 받아 보세요.", 410);
  }
  // 재응답 불가. 두 번째 답으로 지수를 올릴 수 있으면 「서로 아는 정도」가 아니다.
  if (row.status === "answered") {
    throw new ApiError("PAIR_ANSWERED", "이미 답한 링크예요.", 409);
  }

  const payload = parse(row.payload, {}) ?? {};
  const { hits, pct } = score(payload, answer);

  // ── 여기가 원문이 사라지는 지점이다 ─────────────────────────
  // 상대가 무엇을 골랐는지는 이 함수 밖으로 나가지 않는다. 남는 것은 적중 배열과
  // 지수뿐이고, 그것이 결과 화면에 필요한 전부다.
  const summary = { hits, pct, answered_day: dayKey() };

  const res = await env.DB.prepare(
    `UPDATE pair_link SET status = 'answered', answer = ?, answered_at = ?
      WHERE token = ? AND status = 'open'`,
  )
    .bind(JSON.stringify(summary), now(), row.token)
    .run();

  // 동시에 두 번 답한 경우 — 먼저 들어온 쪽만 성사다
  if ((res?.meta?.changes ?? 0) === 0) {
    throw new ApiError("PAIR_ANSWERED", "이미 답한 링크예요.", 409);
  }

  // 성사 보상은 **하루 1회·3종 통합**이다(기획서 1.3). 링크를 여러 개 보내
  // 여러 번 받는 것을 막는다 — 멱등키가 그 자체로 상한이 된다.
  const gained = (await grantPoints(env, row.owner_id, {
    key: `PAIR_OK:${dayKey()}`,
    reason: "PAIR_OK",
    amount: SUITE.POINTS.PAIR_OK,
  }))
    ? SUITE.POINTS.PAIR_OK
    : 0;

  return { row, payload, hits, pct, gained };
}

/** owner 가 결과를 다시 볼 때. 응답 전이면 status 만 돌려준다 */
export async function ownerView(env, ownerId, token) {
  const row = await fetchRow(env, token);
  if (row.owner_id !== ownerId) {
    throw new ApiError("PAIR_NOT_FOUND", "내가 만든 링크가 아니에요.", 404);
  }

  const expired = isExpired(row) && row.status === "open";
  return {
    token: row.token,
    service: row.service,
    relation: row.relation,
    status: expired ? "expired" : row.status,
    payload: parse(row.payload, {}),
    summary: parse(row.answer, null),
  };
}

/** 내가 오늘 만든 링크들 (결과 확인용 — 푸시가 없으므로 재방문 시 여기서 본다) */
export async function myLinks(env, ownerId, day = dayKey()) {
  const rows = await env.DB.prepare(
    `SELECT token, service, relation, status, answer, created_at FROM pair_link
      WHERE owner_id = ? AND day = ? ORDER BY created_at DESC`,
  )
    .bind(ownerId, day)
    .all();

  return (rows?.results ?? []).map((r) => ({
    token: r.token,
    service: r.service,
    relation: r.relation,
    status: isExpired(r) && r.status === "open" ? "expired" : r.status,
    summary: parse(r.answer, null),
  }));
}

/** 30일 지난 행 삭제 (Cron) — 요약만 남아 있어도 영구 보관할 이유가 없다 */
export async function cleanupPairLinks(env, { keepMs = SUITE.PAIR.KEEP_MS, limit = 2000 } = {}) {
  const res = await env.DB.prepare(
    `DELETE FROM pair_link WHERE token IN (
       SELECT token FROM pair_link WHERE created_at < ? LIMIT ?
     )`,
  )
    .bind(now() - keepMs, limit)
    .run();
  return { deleted: res?.meta?.changes ?? 0 };
}
