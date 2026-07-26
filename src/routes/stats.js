/**
 * 통계 · 랭킹 · 도전 기회 조회
 *
 *   GET /game/stats?game=STOPWATCH&bucket=3.47   전체 통계 (Interstitial 시청 후 열람)
 *   GET /game/rank?game=TYPING&bucket=ko:normal  전체 순위 (Interstitial 시청 후 열람)
 *   GET /user/attempts?game=STOPWATCH            도전 기회 잔여 (광고 불필요)
 *
 * 결과 화면에 표시되는 "내 순위 TOP 18%" 는 제출 응답에 이미 포함되므로 광고가 필요 없습니다.
 * 광고로 잠기는 것은 "전체" 통계·랭킹 화면입니다 (기획서 11장 트리거 명세).
 */

import {
  GAME_TYPES,
  ARCADE,
  COMMON,
  STATS_UNLOCK_TRIGGER,
  STOPWATCH,
  TYPING,
  MEMORY,
  BASEBALL,
} from "../lib/config.js";
import { ApiError, requireOneOf } from "../lib/http.js";
import { isArcade } from "../games/arcade/index.js";
import {
  hasAdUnlock,
  histogram,
  topList,
  popularBuckets,
  getProgress,
  personalBest,
  getReadyState,
} from "../lib/db.js";

function gameParam(url) {
  return requireOneOf(url.searchParams.get("game"), "game", GAME_TYPES);
}

/** 광고 잠금 확인 — 열려 있지 않으면 AD_REQUIRED 로 응답합니다. */
async function assertUnlocked(env, userId, gameType) {
  const trigger = STATS_UNLOCK_TRIGGER[gameType];
  if (!(await hasAdUnlock(env, userId, gameType, trigger))) {
    throw new ApiError(
      "AD_REQUIRED",
      "전체 통계를 열람하려면 광고 시청이 필요합니다.",
      403,
    );
  }
  return trigger;
}

/** 내 최근 기록 1건 */
async function myLastResult(env, userId, gameType) {
  const row = await env.DB.prepare(
    `SELECT bucket, rank_metric, score, accuracy, detail_json, created_at
     FROM results WHERE user_id = ? AND game_type = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId, gameType)
    .first();
  return row ? { ...row, detail: JSON.parse(row.detail_json) } : null;
}

// ═══════════════════════════════════════════════════════════════
// GET /game/stats
// ═══════════════════════════════════════════════════════════════

export async function stats({ env, userId, url }) {
  const gameType = gameParam(url);
  await assertUnlocked(env, userId, gameType);

  const bucket = url.searchParams.get("bucket");
  const last = await myLastResult(env, userId, gameType);
  const targetBucket = bucket ?? last?.bucket ?? null;

  const base = {
    game: gameType,
    bucket: targetBucket,
    my_last: last,
  };

  // 아케이드 10종은 지표가 rank_metric 하나로 정규화되어 있어 처리가 같습니다.
  // 게임별로 다른 것은 "그 숫자를 어떻게 읽어 주는가" 뿐이고, 그건 클라이언트가 합니다.
  if (isArcade(gameType)) {
    const dist = targetBucket ? await histogram(env, gameType, targetBucket) : null;
    const mine = await personalBest(env, userId, gameType, targetBucket);
    const { results: buckets } = await env.DB.prepare(
      // 최근 STATS_WINDOW 건만 집계합니다. 게임 전체 기록을 GROUP BY 하면 기록 수에
      // 비례해 느려집니다 (로컬 측정: 20만 건 399ms → 100만 건 1,886ms).
      `SELECT bucket, COUNT(*) AS n, AVG(score) AS avg_score, MIN(rank_metric) AS best
       FROM (
         SELECT bucket, score, rank_metric FROM results
         WHERE game_type = ? AND suspect = 0
         ORDER BY created_at DESC LIMIT ${COMMON.STATS_WINDOW}
       )
       GROUP BY bucket ORDER BY n DESC`,
    )
      .bind(gameType)
      .all();

    return {
      ...base,
      mode: ARCADE[gameType].mode,
      label: ARCADE[gameType].label,
      distribution: dist,
      my_best: mine.best,
      my_plays: mine.plays,
      leagues: (buckets ?? []).map((b) => ({
        bucket: b.bucket,
        count: b.n,
        avg_score: Number((b.avg_score ?? 0).toFixed(1)),
        best: b.best,
        // '+' 가 붙은 리그는 광고 보상을 쓴 런의 집계입니다.
        boosted: String(b.bucket).endsWith("+"),
      })),
    };
  }

  if (gameType === "STOPWATCH") {
    // 같은 목표 타임 도전자들의 오차 분포 + 인기 목표 타임 3개
    const dist = targetBucket ? await histogram(env, gameType, targetBucket) : null;
    const popular = await popularBuckets(env, gameType, 3);
    return { ...base, unit: "ms", distribution: dist, popular_buckets: popular };
  }

  if (gameType === "BASEBALL") {
    // 최근 구간만 집계 (전체 역사를 세면 기록 수에 비례해 느려집니다)
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN bucket = 'solved' THEN 1 ELSE 0 END) AS solved,
         SUM(CASE WHEN bucket = 'failed' THEN 1 ELSE 0 END) AS failed,
         AVG(CASE WHEN bucket = 'solved' THEN rank_metric END) AS avg_attempts
       FROM (
         SELECT bucket, rank_metric FROM results
         WHERE game_type = 'BASEBALL' AND suspect = 0
         ORDER BY created_at DESC LIMIT ${COMMON.STATS_WINDOW}
       )`,
    ).first();

    const solved = row?.solved ?? 0;
    const failed = row?.failed ?? 0;
    const total = solved + failed;

    // 시도 횟수 분포 (성공한 게임만)
    const { results: attemptRows } = await env.DB.prepare(
      `SELECT attempts, COUNT(*) AS n FROM (
         SELECT rank_metric AS attempts FROM results
         WHERE game_type = 'BASEBALL' AND bucket = 'solved' AND suspect = 0
         ORDER BY created_at DESC LIMIT ${COMMON.STATS_WINDOW}
       ) GROUP BY attempts ORDER BY attempts ASC`,
    ).all();

    // 자리별 정답 분포 — 최근 2000게임의 정답을 모아 집계
    const { results: answerRows } = await env.DB.prepare(
      `SELECT json_extract(detail_json, '$.answer') AS answer FROM results
       WHERE game_type = 'BASEBALL' AND suspect = 0
       ORDER BY created_at DESC LIMIT 2000`,
    ).all();

    const positionDist = Array.from({ length: BASEBALL.DIGITS }, () => Array(10).fill(0));
    for (const r of answerRows ?? []) {
      const a = String(r.answer ?? "");
      for (let i = 0; i < Math.min(a.length, BASEBALL.DIGITS); i++) {
        const d = Number(a[i]);
        if (Number.isInteger(d)) positionDist[i][d]++;
      }
    }

    return {
      ...base,
      total_games: total,
      solved,
      failed,
      success_rate: total > 0 ? Number(((solved / total) * 100).toFixed(1)) : 0,
      avg_attempts: row?.avg_attempts != null ? Number(row.avg_attempts.toFixed(2)) : null,
      attempt_distribution: attemptRows ?? [],
      position_distribution: positionDist,
    };
  }

  if (gameType === "TYPING") {
    const dist = targetBucket ? await histogram(env, gameType, targetBucket) : null;
    const { results: buckets } = await env.DB.prepare(
      // 아케이드와 같은 이유로 최근 구간만 집계합니다
      `SELECT bucket, COUNT(*) AS n, AVG(score) AS avg_score, AVG(accuracy) AS avg_accuracy
       FROM (
         SELECT bucket, score, accuracy FROM results
         WHERE game_type = 'TYPING' AND suspect = 0
         ORDER BY created_at DESC LIMIT ${COMMON.STATS_WINDOW}
       )
       GROUP BY bucket ORDER BY n DESC`,
    ).all();
    return {
      ...base,
      // rank_metric 은 -score 로 저장되어 있으므로 분포 해석 시 부호를 뒤집어야 합니다.
      distribution: dist,
      metric_is_negated_score: true,
      by_bucket: (buckets ?? []).map((b) => ({
        bucket: b.bucket,
        count: b.n,
        avg_score: Math.round(b.avg_score ?? 0),
        avg_accuracy: Number((b.avg_accuracy ?? 0).toFixed(1)),
      })),
      langs: TYPING.LANGS,
      difficulties: TYPING.DIFFICULTIES,
    };
  }

  // MEMORY
  const { results: levelRows } = await env.DB.prepare(
    `SELECT bucket,
            COUNT(*) AS n,
            SUM(CASE WHEN json_extract(detail_json, '$.cleared') = 1 THEN 1 ELSE 0 END) AS cleared,
            AVG(score) AS avg_correct
     FROM (
       SELECT bucket, detail_json, score FROM results
       WHERE game_type = 'MEMORY' AND suspect = 0
       ORDER BY created_at DESC LIMIT ${COMMON.STATS_WINDOW}
     )
     GROUP BY bucket`,
  ).all();

  const byLevel = (levelRows ?? [])
    .map((r) => ({
      level: Number(String(r.bucket).replace("LV", "")),
      count: r.n,
      cleared: r.cleared ?? 0,
      clear_rate: r.n > 0 ? Number((((r.cleared ?? 0) / r.n) * 100).toFixed(1)) : 0,
      avg_correct: Number((r.avg_correct ?? 0).toFixed(2)),
    }))
    .sort((a, b) => a.level - b.level);

  const progress = await getProgress(env, userId, "MEMORY");

  return { ...base, by_level: byLevel, my_best_level: progress.bestLevel, max_level: MEMORY.MAX_LEVEL };
}

// ═══════════════════════════════════════════════════════════════
// GET /game/rank
// ═══════════════════════════════════════════════════════════════

export async function rank({ env, userId, url }) {
  const gameType = gameParam(url);
  await assertUnlocked(env, userId, gameType);

  const last = await myLastResult(env, userId, gameType);
  const bucket = url.searchParams.get("bucket") ?? last?.bucket ?? (gameType === "BASEBALL" ? "solved" : null);

  if (!bucket) {
    return { game: gameType, bucket: null, list: [], my_last: last };
  }

  const list = await topList(env, gameType, bucket);

  let myRank = null;
  if (last && last.bucket === bucket) {
    // 백분위(percentileOf)와 같은 최근 구간을 기준으로 셉니다.
    // 한쪽만 전체 기록을 보면 "TOP 12%" 와 "내 순위" 가 서로 어긋납니다.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS better FROM (
         SELECT rank_metric FROM results
         WHERE game_type = ? AND bucket = ? AND suspect = 0
         ORDER BY created_at DESC LIMIT ${COMMON.STATS_WINDOW}
       ) WHERE rank_metric < ?`,
    )
      .bind(gameType, bucket, last.rank_metric)
      .first();
    myRank = (row?.better ?? 0) + 1;
  }

  return { game: gameType, bucket, list, my_last: last, my_rank: myRank };
}

// ═══════════════════════════════════════════════════════════════
// GET /user/attempts
// ═══════════════════════════════════════════════════════════════

const BASE_ATTEMPTS = {
  STOPWATCH: STOPWATCH.BASE_ATTEMPTS_PER_DAY,
  TYPING: TYPING.BASE_ATTEMPTS_PER_DAY,
  MEMORY: 0, // 광고로 받은 레벨 도전권만 사용
  BASEBALL: 0, // 세션(게임) 단위로 관리되므로 일일 기회 개념이 없음
};

/** 아케이드 10종은 전부 "하루 N회 + 광고로 추가" 구조라 config 에서 그대로 가져옵니다. */
const baseAttemptsOf = (gameType) =>
  isArcade(gameType) ? ARCADE[gameType].baseAttempts : BASE_ATTEMPTS[gameType];

export async function attempts({ env, userId, url }) {
  const gameType = gameParam(url);
  const base = baseAttemptsOf(gameType);

  // 시작 화면은 게임을 켤 때마다 지나는 경로입니다. 필요한 값이 서로 독립이라
  // 한 번의 왕복으로 묶어 가져옵니다 (순차 조회 시 D1 왕복이 4번 쌓입니다).
  const { attempts: state, progress, unlocked, best } = await getReadyState(env, userId, gameType, {
    baseAttempts: base,
    unlockTrigger: STATS_UNLOCK_TRIGGER[gameType],
    bucket: url.searchParams.get("bucket"),
  });

  return {
    game: gameType,
    attempts: state,
    base_attempts: base,
    best_level: progress.bestLevel,
    best_score: progress.bestScore,
    play_count: progress.playCount,
    stats_unlocked: unlocked,
    // "내 최고 기록" 은 아케이드 시작 화면에서만 씁니다 (rank_metric 해석이 게임별로 달라서)
    ...(isArcade(gameType) ? { my_best: best.best, my_plays: best.plays } : {}),
  };
}
