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
 * 자기 링크에 자기가 답하지 못하게 한다 (REQ-65 묶음 0 · Master ① · impact P2).
 *
 * 응답자에겐 계정이 없지만 요청마다 쿠키 사용자는 있다. 그 사용자가 링크 주인이면
 * 같은 브라우저에서 자기 링크에 답해 하루 +10P(PAIR_OK)를 받을 수 있었다.
 * 다른 브라우저·기기로 돌아가는 길은 남는다 — 하루 10P 상한으로 수용(Master 결정).
 */
function notOwner(row, userId) {
  if (userId && row.owner_id === userId) {
    throw new ApiError("PAIR_SELF", "내가 보낸 링크예요 — 그 사람에게 보내 주세요.", 409);
  }
}

/**
 * 응답자가 여는 화면의 데이터.
 *
 * **owner 가 무엇을 추측했는지는 내려보내지 않는다.** 그걸 보여 주면 응답자가
 * 맞춰 주게 되고, 지수가 「서로 아는 정도」가 아니라 「배려한 정도」가 된다.
 */
export async function openLink(env, token, userId) {
  const row = await fetchRow(env, token);
  notOwner(row, userId);

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
    expire_hours: Math.round(SUITE.PAIR.EXPIRE_MS / 3600000), // 「72시간」 문구를 서버 값으로
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
export async function answerLink(env, token, answer, score, userId) {
  const row = await fetchRow(env, token);
  notOwner(row, userId); // 문항도 답도 적립(PAIR_OK)도 없이 끊는다

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

/**
 * owner 가 결과를 볼 때 (REQ-65 S1 — 보낸 사람이 결과를 볼 화면이 없었다).
 *
 * 내 추측·근거와 적중 배열·지수만 준다. **상대의 실제 답은 원래 저장하지 않으므로 줄 수 없다**
 * (answerLink 의 요약 치환 · Master ③ 안 보임 유지). 답이 온 링크를 처음 열면 owner_seen_at 을
 * 남긴다 — 결과 도착 알림(`pair_unseen`)이 그걸로 꺼진다.
 */
export async function ownerView(env, ownerId, token) {
  const row = await fetchRow(env, token);
  if (row.owner_id !== ownerId) {
    throw new ApiError("PAIR_NOT_FOUND", "내가 만든 링크가 아니에요.", 404);
  }

  if (row.status === "answered") {
    await env.DB.prepare(`UPDATE pair_link SET owner_seen_at = ? WHERE token = ? AND owner_seen_at IS NULL`)
      .bind(now(), row.token)
      .run();
  }

  const expired = isExpired(row) && row.status === "open";
  const payload = parse(row.payload, {}) ?? {};
  const summary = parse(row.answer, null);
  return {
    token: row.token,
    service: row.service,
    relation: row.relation,
    status: expired ? "expired" : row.status,
    pct: summary?.pct ?? null,
    hits: summary?.hits ?? null,
    question_ids: payload.q ?? [],
    guess: payload.guess ?? [],
    reasons: payload.reasons ?? [],
    answered_at: row.answered_at ?? null,
  };
}

/**
 * 결과 도착 알림 — 답이 왔는데 보낸 사람이 아직 안 본 링크 수와 가장 최근 하나 (REQ-65 F2).
 * 목록과 같은 시각 범위(72시간 + 보관 24시간)만 본다. 오늘의 선택 완료 여부와 무관하다.
 */
export async function unseenArrivals(env, ownerId) {
  const rows = await env.DB.prepare(
    `SELECT token, relation, answer FROM pair_link
      WHERE owner_id = ? AND created_at >= ? AND status = 'answered' AND owner_seen_at IS NULL
      ORDER BY answered_at DESC`,
  )
    .bind(ownerId, now() - SUITE.PAIR.EXPIRE_MS - SUITE.PAIR.SHOW_AFTER_MS)
    .all();
  const list = rows?.results ?? [];
  const top = list[0];
  return {
    unseen: list.length,
    latest: top ? { token: top.token, relation: top.relation, pct: parse(top.answer, null)?.pct ?? null } : null,
  };
}

/**
 * 내가 보낸 링크들 (결과 확인용 — 푸시가 없으므로 재방문 시 여기서 본다)
 *
 * ── 날짜가 아니라 시각 범위로 읽는다 (REQ-65 S2) ──────────────────────────
 * 예전엔 「오늘 만든 것」만 읽어서 어제 보낸 링크와 그 결과가 다음 날 통째로 사라졌다.
 * 이제 만든 지 72시간(답 받는 시간) + 24시간(보관) 안의 것을 모두 준다. 오늘 남은 개수는
 * 호출하는 쪽이 `day` 로 오늘 것만 센다.
 *
 * ── 아직 답을 기다리는 링크는 주소를 함께 준다 ──────────────────────────
 * 만든 직후 복사하지 않고 화면을 떠나면 그 링크를 **다시 얻을 방법이 없었다.**
 * 하루 3건 상한이라 슬롯 하나가 통째로 날아갔다(2026-08-04 검수 1번).
 *
 * 주소를 내려보내도 보안이 낮아지지 않는다 — **링크는 원래 상대에게 건네는
 * 값**이고, 이 조회는 `owner_id = ?` 로 본인 것만 본다. 다만 이미 답이 왔거나
 * 만료된 링크는 다시 보낼 이유가 없으므로 주소를 빼서 오해를 만들지 않는다.
 */
export async function myLinks(env, ownerId) {
  const rows = await env.DB.prepare(
    `SELECT token, service, relation, day, status, answer, created_at, owner_seen_at FROM pair_link
      WHERE owner_id = ? AND created_at >= ? ORDER BY created_at DESC`,
  )
    .bind(ownerId, now() - SUITE.PAIR.EXPIRE_MS - SUITE.PAIR.SHOW_AFTER_MS)
    .all();

  return (rows?.results ?? []).map((r) => {
    const status = isExpired(r) && r.status === "open" ? "expired" : r.status;
    const expiresAt = (r.created_at ?? 0) + SUITE.PAIR.EXPIRE_MS;

    return {
      token: r.token,
      service: r.service,
      relation: r.relation,
      day: r.day, // 만든 날(KST) — 오늘 남은 개수는 오늘 것만 센다
      status,
      owner_seen: Boolean(r.owner_seen_at), // 「새 결과」 배지 = 답이 왔는데 아직 안 봄
      created_at: r.created_at ?? null,
      expires_at: expiresAt,
      // 남은 시간은 서버 시계로 센다 — 기기 시계가 틀어져도 만료 표시가 어긋나지 않는다
      expires_in_ms: status === "open" ? Math.max(0, expiresAt - now()) : 0,
      ...(status === "open" ? { url: `/p/${r.token}` } : {}),
      summary: parse(r.answer, null),
    };
  });
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
