/** D1 접근 계층 — 세션 / 도전 기회 / 광고 기록 / 통계 집계 */

import { ApiError } from "./http.js";
import { dayKey, now } from "./time.js";
import { COMMON } from "./config.js";
import { encryptJSON, decryptJSON } from "./crypto.js";

// ═══════════════════════════════════════════════════════════════
// 도전 기회 (일일 리셋)
// ═══════════════════════════════════════════════════════════════

/**
 * 조회 하나를 "구문(statement)" 과 "행 변환(map)" 으로 나눠 둡니다.
 *
 * 이렇게 두면 같은 SQL 을 단독 조회에도, batch() 로 묶은 조회에도 쓸 수 있습니다.
 * D1 은 쿼리 1회가 왕복 1회라 (프로덕션 실측 약 150ms) 서로 의존하지 않는 조회를
 * 순차로 하면 그만큼 그대로 쌓입니다. getReadyState 가 이 구문들을 묶어 씁니다.
 */
const attemptStateStmt = (env, userId, gameType) =>
  env.DB.prepare(
    `SELECT used, granted FROM attempts WHERE user_id = ? AND game_type = ? AND day = ?`,
  ).bind(userId, gameType, dayKey());

function mapAttemptState(row, baseAttempts) {
  const used = row?.used ?? 0;
  const granted = row?.granted ?? 0;
  const total = baseAttempts + granted;
  return { used, granted, total, remaining: Math.max(0, total - used) };
}

/**
 * 오늘 사용한/추가로 받은 기회를 조회합니다.
 * @returns {{ used:number, granted:number, total:number, remaining:number }}
 */
export async function getAttemptState(env, userId, gameType, baseAttempts) {
  const row = await attemptStateStmt(env, userId, gameType).first();
  return mapAttemptState(row, baseAttempts);
}

/** 기회 1회를 소모합니다. 남은 기회가 없으면 NO_ATTEMPTS 에러. */
export async function consumeAttempt(env, userId, gameType, baseAttempts) {
  const state = await getAttemptState(env, userId, gameType, baseAttempts);
  if (state.remaining <= 0) {
    throw new ApiError(
      "NO_ATTEMPTS",
      "오늘 도전 기회를 모두 사용했습니다. 광고를 시청하면 기회가 추가됩니다.",
      403,
    );
  }
  await env.DB.prepare(
    `INSERT INTO attempts (user_id, game_type, day, used, granted, updated_at)
     VALUES (?, ?, ?, 1, 0, ?)
     ON CONFLICT (user_id, game_type, day)
     DO UPDATE SET used = used + 1, updated_at = excluded.updated_at`,
  )
    .bind(userId, gameType, dayKey(), now())
    .run();

  return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}

/** 광고 보상으로 기회를 추가 지급합니다. */
export async function grantAttempts(env, userId, gameType, count) {
  await env.DB.prepare(
    `INSERT INTO attempts (user_id, game_type, day, used, granted, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT (user_id, game_type, day)
     DO UPDATE SET granted = granted + excluded.granted, updated_at = excluded.updated_at`,
  )
    .bind(userId, gameType, dayKey(), count, now())
    .run();
}

// ═══════════════════════════════════════════════════════════════
// 광고 시청 기록
// ═══════════════════════════════════════════════════════════════

export async function countAdViews(env, userId, gameType, trigger) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ad_views
     WHERE user_id = ? AND game_type = ? AND trigger = ? AND day = ?`,
  )
    .bind(userId, gameType, trigger, dayKey())
    .first();
  return row?.n ?? 0;
}

/** 동일 IP 일일 광고 시청 한도 (기획서 12장: 20회) */
export async function assertIpAdLimit(env, ipHash) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ad_views WHERE ip_hash = ? AND day = ?`,
  )
    .bind(ipHash, dayKey())
    .first();
  if ((row?.n ?? 0) >= COMMON.IP_AD_VIEWS_PER_DAY) {
    throw new ApiError(
      "IP_AD_LIMIT",
      `동일 네트워크에서 하루 광고 시청 한도(${COMMON.IP_AD_VIEWS_PER_DAY}회)를 초과했습니다.`,
      429,
    );
  }
}

export async function recordAdView(env, { userId, sessionId, gameType, trigger, adType, ipHash }) {
  await env.DB.prepare(
    `INSERT INTO ad_views (user_id, session_id, game_type, trigger, ad_type, ip_hash, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, sessionId ?? null, gameType, trigger, adType, ipHash, dayKey(), now())
    .run();
}

const adUnlockStmt = (env, userId, gameType, trigger) =>
  env.DB.prepare(
    `SELECT 1 AS hit FROM ad_views
     WHERE user_id = ? AND game_type = ? AND trigger = ? AND created_at >= ?
     LIMIT 1`,
  ).bind(userId, gameType, trigger, now() - COMMON.AD_UNLOCK_WINDOW_MS);

/** 통계·랭킹 열람 잠금 해제 여부 — 최근 유효시간 내 Interstitial 시청 기록이 있는지 */
export async function hasAdUnlock(env, userId, gameType, trigger) {
  return Boolean(await adUnlockStmt(env, userId, gameType, trigger).first());
}

// ═══════════════════════════════════════════════════════════════
// 세션
// ═══════════════════════════════════════════════════════════════

export async function createSession(env, { sessionId, gameType, userId, secret, meta, attemptsLeft, ipHash }) {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO sessions
       (session_id, game_type, user_id, start_ts, secret_json, meta_json, status, attempts_left, ad_views, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, 0, ?, ?)`,
  )
    .bind(
      sessionId,
      gameType,
      userId,
      ts,
      await encryptJSON(env, secret ?? {}),
      JSON.stringify(meta ?? {}),
      attemptsLeft ?? 0,
      ipHash,
      ts,
    )
    .run();
  return ts;
}

/**
 * 열려 있는 세션을 가져옵니다. 소유자·게임 종류·상태·만료를 모두 검증합니다.
 * secret 은 복호화해서 함께 돌려줍니다.
 */
export async function getOpenSession(env, sessionId, userId, gameType) {
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/.test(sessionId)) {
    throw new ApiError("BAD_SESSION", "세션 ID 형식이 올바르지 않습니다.");
  }
  const row = await env.DB.prepare(`SELECT * FROM sessions WHERE session_id = ?`)
    .bind(sessionId)
    .first();

  if (!row) throw new ApiError("SESSION_NOT_FOUND", "세션을 찾을 수 없습니다.", 404);
  if (row.user_id !== userId) throw new ApiError("FORBIDDEN", "다른 사용자의 세션입니다.", 403);
  if (row.game_type !== gameType) throw new ApiError("BAD_SESSION", "세션의 게임 종류가 다릅니다.");
  if (row.status !== "OPEN") throw new ApiError("SESSION_CLOSED", "이미 종료된 세션입니다.", 409);
  if (now() - row.start_ts > COMMON.SESSION_MAX_AGE_MS) {
    await closeSession(env, sessionId);
    throw new ApiError("SESSION_EXPIRED", "세션이 만료되었습니다. 다시 시작해 주세요.", 410);
  }

  return { ...row, secret: await decryptJSON(env, row.secret_json), meta: JSON.parse(row.meta_json) };
}

/**
 * 아직 끝나지 않은 세션을 찾습니다.
 * 페이지를 새로고침해도 도전 기회가 낭비되지 않도록, 진행 중인 게임은 이어서 씁니다.
 */
export async function findOpenSession(env, userId, gameType) {
  const row = await env.DB.prepare(
    `SELECT * FROM sessions
     WHERE user_id = ? AND game_type = ? AND status = 'OPEN' AND start_ts > ?
     ORDER BY start_ts DESC LIMIT 1`,
  )
    .bind(userId, gameType, now() - COMMON.SESSION_MAX_AGE_MS)
    .first();

  if (!row) return null;
  return { ...row, secret: await decryptJSON(env, row.secret_json), meta: JSON.parse(row.meta_json) };
}

export async function closeSession(env, sessionId, endTs = now()) {
  await env.DB.prepare(`UPDATE sessions SET status = 'CLOSED', end_ts = ? WHERE session_id = ?`)
    .bind(endTs, sessionId)
    .run();
}

/**
 * 실제 플레이가 시작된 시각을 기록합니다 (START 탭 / 카운트다운 종료 시점).
 *
 * 이 값이 있으면 검증 시간창이 "세션 생성부터"가 아니라 "플레이 시작부터"가 되어
 * 훨씬 촘촘해집니다. 이미 기록된 세션은 덮어쓰지 않습니다(재요청으로 창을 늘리는 것 방지).
 */
export async function armSession(env, sessionId) {
  const ts = now();
  const res = await env.DB.prepare(
    `UPDATE sessions SET armed_ts = ? WHERE session_id = ? AND status = 'OPEN' AND armed_ts IS NULL`,
  )
    .bind(ts, sessionId)
    .run();
  return { armed_ts: ts, applied: (res.meta?.changes ?? 0) > 0 };
}

export async function updateSessionAttempts(env, sessionId, attemptsLeft) {
  await env.DB.prepare(`UPDATE sessions SET attempts_left = ? WHERE session_id = ?`)
    .bind(attemptsLeft, sessionId)
    .run();
}

/** meta_json 갱신 (숫자야구 시도 기록 등 — 정답이 아닌 공개 가능한 진행 상태) */
export async function updateSessionMeta(env, sessionId, meta) {
  await env.DB.prepare(`UPDATE sessions SET meta_json = ? WHERE session_id = ?`)
    .bind(JSON.stringify(meta), sessionId)
    .run();
}

/**
 * secret_json 갱신 — 라운드가 진행되면서 정답이 바뀌는 아케이드 게임용.
 * meta 와 달리 암호화해서 저장하므로 DB 가 유출되어도 진행 중인 라운드의 정답은 읽을 수 없습니다.
 */
export async function updateSessionSecret(env, sessionId, secret) {
  await env.DB.prepare(`UPDATE sessions SET secret_json = ? WHERE session_id = ?`)
    .bind(await encryptJSON(env, secret ?? {}), sessionId)
    .run();
}

/** 라운드 진행 상태(meta)와 정답(secret)을 함께 저장합니다. */
export async function updateSessionState(env, sessionId, { meta, secret }) {
  await env.DB.prepare(`UPDATE sessions SET meta_json = ?, secret_json = ? WHERE session_id = ?`)
    .bind(JSON.stringify(meta ?? {}), await encryptJSON(env, secret ?? {}), sessionId)
    .run();
}

export async function bumpSessionAdViews(env, sessionId, attemptsLeft) {
  await env.DB.prepare(
    `UPDATE sessions SET ad_views = ad_views + 1, attempts_left = ? WHERE session_id = ?`,
  )
    .bind(attemptsLeft, sessionId)
    .run();
}

// ═══════════════════════════════════════════════════════════════
// 결과 저장
// ═══════════════════════════════════════════════════════════════

export async function insertResult(env, { sessionId, gameType, userId, bucket, rankMetric, score, accuracy, detail, suspect }) {
  try {
    await env.DB.prepare(
      `INSERT INTO results
         (session_id, game_type, user_id, bucket, rank_metric, score, accuracy, detail_json, suspect, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        sessionId,
        gameType,
        userId,
        bucket,
        rankMetric,
        score ?? 0,
        accuracy ?? null,
        JSON.stringify(detail ?? {}),
        suspect ? 1 : 0,
        now(),
      )
      .run();
  } catch (err) {
    // results.session_id 에 UNIQUE 제약이 있어 중복 제출은 여기서 걸립니다.
    if (String(err?.message ?? "").includes("UNIQUE")) {
      throw new ApiError("DUPLICATE_SUBMIT", "이미 제출된 세션입니다.", 409);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// 통계 · 랭킹
// ═══════════════════════════════════════════════════════════════

/**
 * 같은 bucket 안에서 내 기록의 상위 백분율을 계산합니다.
 * rank_metric 은 "작을수록 좋은" 값으로 정규화되어 저장됩니다.
 * @returns {{ rankPct:number, total:number, better:number }}
 */
export async function percentileOf(env, gameType, bucket, rankMetric) {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN rank_metric < ? THEN 1 ELSE 0 END) AS better
     FROM results
     WHERE game_type = ? AND bucket = ? AND suspect = 0`,
  )
    .bind(rankMetric, gameType, bucket)
    .first();

  const total = row?.total ?? 0;
  const better = row?.better ?? 0;
  // 참가자가 나 혼자면 TOP 100%. 그 외에는 (나보다 나은 사람 + 1) / 전체
  const rankPct = total > 0 ? Math.max(1, Math.ceil(((better + 1) / total) * 100)) : 100;
  return { rankPct, total, better };
}

/**
 * 내 개인 최고 기록 (rank_metric 은 작을수록 좋은 값으로 정규화되어 있습니다).
 * 결과 화면의 "신기록!" 판정과 "최고 기록 대비" 표시에 씁니다.
 * 이번 판을 저장하기 *전에* 호출해야 직전 최고 기록이 나옵니다.
 *
 * 이상치(suspect)로 표시된 판은 최고 기록에서 제외합니다.
 * 포함하면 조작되거나 검증에 걸린 한 판이 영구히 최고 기록으로 남아, 정상 플레이로는
 * 절대 깰 수 없는 목표가 됩니다 — 재도전 동기(신기록 갱신)를 스스로 죽이는 셈입니다.
 * 순위표에서 제외하는 것과 같은 이유입니다.
 * (plays 는 "몇 판 했는지" 이므로 이상치도 함께 셉니다)
 */
const personalBestStmt = (env, userId, gameType, bucket) =>
  bucket
    ? env.DB.prepare(
        `SELECT MIN(CASE WHEN suspect = 0 THEN rank_metric END) AS best,
                COUNT(*) AS plays
         FROM results WHERE user_id = ? AND game_type = ? AND bucket = ?`,
      ).bind(userId, gameType, bucket)
    : env.DB.prepare(
        `SELECT MIN(CASE WHEN suspect = 0 THEN rank_metric END) AS best,
                COUNT(*) AS plays
         FROM results WHERE user_id = ? AND game_type = ?`,
      ).bind(userId, gameType);

const mapPersonalBest = (row) => ({ best: row?.best ?? null, plays: row?.plays ?? 0 });

export async function personalBest(env, userId, gameType, bucket = null) {
  return mapPersonalBest(await personalBestStmt(env, userId, gameType, bucket).first());
}

/**
 * 시작 화면에 필요한 값 전부를 **한 번의 왕복**으로 가져옵니다.
 *
 * 남은 기회 · 진행도 · 광고 열람 해제 여부 · 개인 최고 기록은 서로 의존하지 않는데,
 * 순차로 조회하면 D1 왕복(프로덕션 실측 약 150ms)이 그대로 4번 쌓여 시작 화면이
 * 0.7초 넘게 비어 있습니다. 게임을 켤 때마다 지나는 경로라 체감이 큽니다.
 * batch() 는 여러 구문을 한 요청으로 보내므로 왕복이 1회로 줄어듭니다.
 *
 * @returns {{ attempts:object, progress:object, unlocked:boolean, best:object }}
 */
export async function getReadyState(env, userId, gameType, { baseAttempts, unlockTrigger, bucket = null }) {
  const [attempts, progress, unlock, best] = await env.DB.batch([
    attemptStateStmt(env, userId, gameType),
    progressStmt(env, userId, gameType),
    adUnlockStmt(env, userId, gameType, unlockTrigger),
    personalBestStmt(env, userId, gameType, bucket),
  ]);

  // batch 결과는 구문별로 { results: [행...] } 형태입니다.
  const first = (res) => res?.results?.[0];

  return {
    attempts: mapAttemptState(first(attempts), baseAttempts),
    progress: mapProgress(first(progress)),
    unlocked: Boolean(first(unlock)),
    best: mapPersonalBest(first(best)),
  };
}

/** bucket 안 rank_metric 분포를 bins 개 구간으로 나눈 히스토그램 */
export async function histogram(env, gameType, bucket, bins = COMMON.STATS_HISTOGRAM_BINS) {
  const { results } = await env.DB.prepare(
    `SELECT rank_metric FROM results
     WHERE game_type = ? AND bucket = ? AND suspect = 0
     ORDER BY rank_metric ASC`,
  )
    .bind(gameType, bucket)
    .all();

  const values = (results ?? []).map((r) => r.rank_metric);
  if (values.length === 0) return { bins: [], min: 0, max: 0, count: 0 };

  const min = values[0];
  const max = values[values.length - 1];
  const width = (max - min) / bins || 1;

  const buckets = Array.from({ length: bins }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));

  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    buckets[idx].count++;
  }

  return { bins: buckets, min, max, count: values.length };
}

/** bucket 상위 기록 목록 */
export async function topList(env, gameType, bucket, limit = COMMON.RANK_LIST_SIZE) {
  const { results } = await env.DB.prepare(
    `SELECT user_id, rank_metric, score, accuracy, detail_json, created_at
     FROM results
     WHERE game_type = ? AND bucket = ? AND suspect = 0
     ORDER BY rank_metric ASC, created_at ASC
     LIMIT ?`,
  )
    .bind(gameType, bucket, limit)
    .all();

  return (results ?? []).map((r, i) => ({
    rank: i + 1,
    // 익명 서비스이므로 user_id 앞 4글자만 노출합니다.
    label: `USER-${String(r.user_id).slice(0, 4).toUpperCase()}`,
    rank_metric: r.rank_metric,
    score: r.score,
    accuracy: r.accuracy,
    detail: JSON.parse(r.detail_json),
    created_at: r.created_at,
  }));
}

/** 해당 게임에서 가장 많이 플레이된 bucket 목록 (스탑워치 "타임별 랭킹" 등) */
export async function popularBuckets(env, gameType, limit = 3) {
  const { results } = await env.DB.prepare(
    `SELECT bucket, COUNT(*) AS n FROM results
     WHERE game_type = ? AND suspect = 0
     GROUP BY bucket ORDER BY n DESC LIMIT ?`,
  )
    .bind(gameType, limit)
    .all();
  return results ?? [];
}

// ═══════════════════════════════════════════════════════════════
// 유저 진행도
// ═══════════════════════════════════════════════════════════════

const progressStmt = (env, userId, gameType) =>
  env.DB.prepare(
    `SELECT best_level, best_score, play_count FROM user_progress WHERE user_id = ? AND game_type = ?`,
  ).bind(userId, gameType);

const mapProgress = (row) => ({
  bestLevel: row?.best_level ?? 0,
  bestScore: row?.best_score ?? 0,
  playCount: row?.play_count ?? 0,
});

export async function getProgress(env, userId, gameType) {
  return mapProgress(await progressStmt(env, userId, gameType).first());
}

export async function upsertProgress(env, userId, gameType, { level = 0, score = 0 }) {
  await env.DB.prepare(
    `INSERT INTO user_progress (user_id, game_type, best_level, best_score, play_count, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT (user_id, game_type) DO UPDATE SET
       best_level = MAX(best_level, excluded.best_level),
       best_score = MAX(best_score, excluded.best_score),
       play_count = play_count + 1,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, gameType, level, score, now())
    .run();
}
