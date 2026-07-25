/**
 * ① 스탑워치 챌린지 (기획서 3~4장)
 *
 * 서버가 1.00~9.99초 사이 목표 타임을 매 도전마다 새로 생성하고,
 * 사용자가 START/STOP 으로 그 시간을 맞추면 오차를 소수점 3자리까지 계산합니다.
 * 통계는 "같은 목표 타임" 도전자끼리 비교합니다 (Target-specific).
 */

import { STOPWATCH } from "../lib/config.js";
import { randomId, randomInt } from "../lib/crypto.js";
import { checkElapsed } from "../lib/validate.js";
import { now } from "../lib/time.js";
import {
  createSession,
  getOpenSession,
  findOpenSession,
  closeSession,
  insertResult,
  percentileOf,
  consumeAttempt,
  getAttemptState,
} from "../lib/db.js";

const GAME = "STOPWATCH";

/** 목표 타임을 bucket 문자열로 (예: 3470 → '3.47') */
const bucketOf = (targetMs) => (targetMs / 1000).toFixed(2);

export async function start({ env, userId, ipHash }) {
  // 새로고침으로 도전 기회가 낭비되지 않도록, 아직 STOP 하지 않은 세션이 있으면 그대로 이어 씁니다.
  const existing = await findOpenSession(env, userId, GAME);
  if (existing) {
    return {
      session_id: existing.session_id,
      target_ms: existing.secret.target_ms,
      attempts: await getAttemptState(env, userId, GAME, STOPWATCH.BASE_ATTEMPTS_PER_DAY),
      resumed: true,
    };
  }

  const attempts = await consumeAttempt(env, userId, GAME, STOPWATCH.BASE_ATTEMPTS_PER_DAY);

  // 1.00 ~ 9.99초, 0.01초 단위 = 900가지 중 하나
  const steps = (STOPWATCH.TARGET_MAX_MS - STOPWATCH.TARGET_MIN_MS) / STOPWATCH.TARGET_STEP_MS;
  const targetMs = STOPWATCH.TARGET_MIN_MS + randomInt(0, steps) * STOPWATCH.TARGET_STEP_MS;

  const sessionId = randomId();
  await createSession(env, {
    sessionId,
    gameType: GAME,
    userId,
    secret: { target_ms: targetMs },
    meta: { bucket: bucketOf(targetMs) },
    ipHash,
  });

  return {
    session_id: sessionId,
    // 목표 타임은 화면에 표시해야 하는 값이라 응답에 포함합니다.
    // 보호 대상은 "생성 규칙과 다음 목표값" 이며, 이것들은 노출되지 않습니다.
    target_ms: targetMs,
    attempts,
  };
}

export async function stop({ env, userId, body }) {
  const session = await getOpenSession(env, body.session_id, userId, GAME);
  const targetMs = session.secret.target_ms;
  const endTs = now();

  // START 탭 시각이 기록되어 있으면 그것을 기준으로 검증합니다(훨씬 촘촘함).
  const baseTs = session.armed_ts ?? session.start_ts;
  const { serverWindowMs, suspect, reasons } = checkElapsed({
    elapsedMs: body.elapsed_ms,
    startTs: baseTs,
    endTs,
    minMs: STOPWATCH.ELAPSED_MIN_MS,
    maxMs: STOPWATCH.ELAPSED_MAX_MS,
    toleranceMs: STOPWATCH.DRIFT_TOLERANCE_MS,
    maxIdleMs: session.armed_ts ? STOPWATCH.ARMED_IDLE_MS : STOPWATCH.MAX_IDLE_MS,
  });

  const elapsedMs = body.elapsed_ms;
  const signedGapMs = elapsedMs - targetMs; // 양수면 늦게 멈춤, 음수면 일찍 멈춤
  const gapMs = Math.abs(signedGapMs);

  // 사람이 물리적으로 내기 어려운 정확도는 이상치로 표시해 통계에서 제외합니다.
  const allReasons = [...reasons];
  if (gapMs < STOPWATCH.IMPOSSIBLE_GAP_MS) allReasons.push("GAP_IMPLAUSIBLE");
  const isSuspect = suspect || allReasons.includes("GAP_IMPLAUSIBLE");

  const bucket = bucketOf(targetMs);

  await insertResult(env, {
    sessionId: session.session_id,
    gameType: GAME,
    userId,
    bucket,
    rankMetric: gapMs, // 오차가 작을수록 좋은 기록
    score: Math.max(0, 10000 - gapMs),
    accuracy: null,
    detail: {
      target_ms: targetMs,
      elapsed_ms: elapsedMs,
      gap_ms: signedGapMs,
      server_window_ms: serverWindowMs,
      armed: Boolean(session.armed_ts),
      flags: allReasons,
    },
    suspect: isSuspect,
  });

  await closeSession(env, session.session_id, endTs);

  const pct = await percentileOf(env, GAME, bucket, gapMs);
  const attempts = await getAttemptState(env, userId, GAME, STOPWATCH.BASE_ATTEMPTS_PER_DAY);

  return {
    target_ms: targetMs,
    elapsed_ms: elapsedMs,
    gap_ms: signedGapMs,
    abs_gap_ms: gapMs,
    bucket,
    rank_pct: pct.rankPct,
    bucket_total: pct.total,
    suspect: isSuspect,
    attempts,
  };
}
