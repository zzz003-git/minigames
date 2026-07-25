/**
 * ④ 숫자 기억력 챌린지 (기획서 9~10장)
 *
 * 레벨 설계표(자릿수·노출 시간·힌트)는 lib/config.js 의 MEMORY.LEVELS 에 있습니다.
 * 자기 최고 레벨보다 높은 레벨에 도전하려면 광고로 얻은 "레벨 도전권" 이 필요합니다.
 *
 * 보안 한계 (정직하게 기록):
 *   기억력 게임은 정답 숫자를 화면에 반드시 보여줘야 하므로, 클라이언트가 그 값을
 *   가지고 있는 것을 피할 수 없습니다. 개발자도구로 값을 읽는 행위는 원리적으로 차단
 *   불가능합니다. 완전히 막으려면 숫자를 서버에서 이미지로 렌더링해 내려보내야 합니다.
 *   채점 자체는 서버가 원본과 비교하므로, 입력 결과를 위조하는 것은 불가능합니다.
 */

import { MEMORY } from "../lib/config.js";
import { randomId, randomDigits } from "../lib/crypto.js";
import { ApiError, requireInt } from "../lib/http.js";
import { requireDigits } from "../lib/validate.js";
import { now } from "../lib/time.js";
import {
  createSession,
  getOpenSession,
  closeSession,
  insertResult,
  percentileOf,
  getAttemptState,
  consumeAttempt,
  getProgress,
  upsertProgress,
} from "../lib/db.js";

const GAME = "MEMORY";

export async function start({ env, userId, ipHash, body }) {
  const level = requireInt(body.level, "level", 1, MEMORY.MAX_LEVEL);
  const spec = MEMORY.LEVELS[level];

  const progress = await getProgress(env, userId, GAME);

  // 최고 레벨 이하는 자유롭게 재도전. 그보다 높은 레벨은 광고 도전권이 필요합니다.
  // (기획서 11장: ④ 숫자기억 / 다음 레벨 도전 요청 / 레벨 도전권 / Rewarded / 3회·일)
  const needsTicket = level > Math.max(1, progress.bestLevel);
  if (needsTicket) {
    const tickets = await getAttemptState(env, userId, GAME, 0);
    if (tickets.remaining <= 0) {
      throw new ApiError(
        "AD_REQUIRED",
        `LV${level} 도전권이 필요합니다. 광고를 시청하면 도전권이 지급됩니다.`,
        403,
      );
    }
    await consumeAttempt(env, userId, GAME, 0);
  }

  const digits = randomDigits(spec.digits);
  const sessionId = randomId();

  await createSession(env, {
    sessionId,
    gameType: GAME,
    userId,
    secret: { digits },
    meta: { level, digit_count: spec.digits, expose_ms: spec.exposeMs, hints: spec.hints },
    attemptsLeft: spec.hints,
    ipHash,
  });

  return {
    session_id: sessionId,
    level,
    // 암기용으로 화면에 보여줘야 하는 값이라 응답에 포함합니다. 채점 기준은 서버가 보관합니다.
    digits,
    digit_count: spec.digits,
    expose_ms: spec.exposeMs,
    hints: spec.hints,
    input_time_limit_ms: MEMORY.INPUT_TIME_LIMIT_MS,
    best_level: progress.bestLevel,
    used_ticket: needsTicket,
  };
}

/** 힌트 1회 사용 — 아직 비어 있는 자리 하나의 정답을 알려 줍니다. */
export async function hint({ env, userId, body }) {
  const session = await getOpenSession(env, body.session_id, userId, GAME);
  if (session.attempts_left <= 0) {
    throw new ApiError("NO_HINT", "이 레벨에서 사용할 수 있는 힌트가 없습니다.", 403);
  }

  const answer = session.secret.digits;
  const filled = typeof body.filled === "string" ? body.filled : "";
  const index = Math.min(filled.length, answer.length - 1);

  await env.DB.prepare(`UPDATE sessions SET attempts_left = attempts_left - 1 WHERE session_id = ?`)
    .bind(session.session_id)
    .run();

  return { index, digit: answer[index], hints_left: session.attempts_left - 1 };
}

export async function submit({ env, userId, body }) {
  const session = await getOpenSession(env, body.session_id, userId, GAME);
  const answer = session.secret.digits;
  const { level } = session.meta;

  requireDigits(body.input ?? "", "input", {});
  if (body.input.length > answer.length) {
    throw new ApiError("BAD_PARAM", `입력이 ${answer.length}자리를 초과했습니다.`);
  }

  const endTs = now();
  const elapsedMs = Math.max(0, endTs - session.start_ts);

  // 자리별 채점 (기획서 화면④ — 맞은 자리 초록, 틀린 자리 빨강)
  const perDigit = [...answer].map((expected, i) => ({
    index: i,
    expected,
    got: body.input[i] ?? null,
    correct: body.input[i] === expected,
  }));
  const correctCount = perDigit.filter((d) => d.correct).length;
  const cleared = correctCount === answer.length;

  const bucket = `LV${level}`;
  // 틀린 자리 수가 우선, 같으면 빠른 쪽이 상위
  const rankMetric = (answer.length - correctCount) * 1_000_000 + Math.min(elapsedMs, 999_999);

  await insertResult(env, {
    sessionId: session.session_id,
    gameType: GAME,
    userId,
    bucket,
    rankMetric,
    score: correctCount,
    accuracy: Number(((correctCount / answer.length) * 100).toFixed(2)),
    detail: {
      level,
      digit_count: answer.length,
      correct_count: correctCount,
      cleared,
      answer,
      input: body.input,
      per_digit: perDigit,
      elapsed_ms: elapsedMs,
      hints_used: session.meta.hints - session.attempts_left,
    },
    suspect: false,
  });

  await closeSession(env, session.session_id, endTs);

  if (cleared) {
    await upsertProgress(env, userId, GAME, { level, score: correctCount });
  } else {
    await upsertProgress(env, userId, GAME, { level: 0, score: 0 });
  }

  const pct = await percentileOf(env, GAME, bucket, rankMetric);
  const progress = await getProgress(env, userId, GAME);
  const tickets = await getAttemptState(env, userId, GAME, 0);

  return {
    level,
    cleared,
    correct_count: correctCount,
    digit_count: answer.length,
    answer,
    per_digit: perDigit,
    elapsed_ms: elapsedMs,
    rank_pct: pct.rankPct,
    bucket_total: pct.total,
    best_level: progress.bestLevel,
    next_level: level < MEMORY.MAX_LEVEL ? level + 1 : null,
    tickets,
  };
}

/** 레벨 선택 화면(화면①)용 정보 */
export async function levels({ env, userId }) {
  const progress = await getProgress(env, userId, GAME);
  const tickets = await getAttemptState(env, userId, GAME, 0);
  return {
    best_level: progress.bestLevel,
    play_count: progress.playCount,
    tickets,
    levels: Object.entries(MEMORY.LEVELS).map(([lv, s]) => ({
      level: Number(lv),
      digits: s.digits,
      expose_ms: s.exposeMs,
      hints: s.hints,
      unlocked: Number(lv) <= Math.max(1, progress.bestLevel),
    })),
  };
}
