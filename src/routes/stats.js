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
  STATS_UNLOCK_TRIGGER,
  STOPWATCH,
  TYPING,
  MEMORY,
  BASEBALL,
} from "../lib/config.js";
import { ApiError, requireOneOf } from "../lib/http.js";
import { hasAdUnlock, histogram, topList, popularBuckets, getAttemptState, getProgress } from "../lib/db.js";

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

  if (gameType === "STOPWATCH") {
    // 같은 목표 타임 도전자들의 오차 분포 + 인기 목표 타임 3개
    const dist = targetBucket ? await histogram(env, gameType, targetBucket) : null;
    const popular = await popularBuckets(env, gameType, 3);
    return { ...base, unit: "ms", distribution: dist, popular_buckets: popular };
  }

  if (gameType === "BASEBALL") {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN bucket = 'solved' THEN 1 ELSE 0 END) AS solved,
         SUM(CASE WHEN bucket = 'failed' THEN 1 ELSE 0 END) AS failed,
         AVG(CASE WHEN bucket = 'solved' THEN rank_metric END) AS avg_attempts
       FROM results WHERE game_type = 'BASEBALL' AND suspect = 0`,
    ).first();

    const solved = row?.solved ?? 0;
    const failed = row?.failed ?? 0;
    const total = solved + failed;

    // 시도 횟수 분포 (성공한 게임만)
    const { results: attemptRows } = await env.DB.prepare(
      `SELECT rank_metric AS attempts, COUNT(*) AS n FROM results
       WHERE game_type = 'BASEBALL' AND bucket = 'solved' AND suspect = 0
       GROUP BY rank_metric ORDER BY rank_metric ASC`,
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
      `SELECT bucket, COUNT(*) AS n, AVG(score) AS avg_score, AVG(accuracy) AS avg_accuracy
       FROM results WHERE game_type = 'TYPING' AND suspect = 0
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
     FROM results WHERE game_type = 'MEMORY' AND suspect = 0
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
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS better FROM results
       WHERE game_type = ? AND bucket = ? AND suspect = 0 AND rank_metric < ?`,
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

export async function attempts({ env, userId, url }) {
  const gameType = gameParam(url);
  const state = await getAttemptState(env, userId, gameType, BASE_ATTEMPTS[gameType]);
  const progress = await getProgress(env, userId, gameType);
  const unlocked = await hasAdUnlock(env, userId, gameType, STATS_UNLOCK_TRIGGER[gameType]);

  return {
    game: gameType,
    attempts: state,
    base_attempts: BASE_ATTEMPTS[gameType],
    best_level: progress.bestLevel,
    best_score: progress.bestScore,
    play_count: progress.playCount,
    stats_unlocked: unlocked,
  };
}
