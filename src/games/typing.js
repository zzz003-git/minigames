/**
 * ③ 타이핑 스피드 챌린지 (기획서 7~8장)
 *
 * 정확도와 최종 점수는 클라이언트가 보낸 숫자를 믿지 않고 서버가 다시 계산합니다.
 * (제출된 입력 문자열 + DB의 원본 문장을 비교 → 위조 불가)
 */

import { TYPING } from "../lib/config.js";
import { randomId } from "../lib/crypto.js";
import { ApiError, requireOneOf } from "../lib/http.js";
import { checkElapsed } from "../lib/validate.js";
import { now } from "../lib/time.js";
import {
  createSession,
  getOpenSession,
  closeSession,
  insertResult,
  percentileOf,
  consumeAttempt,
  getAttemptState,
  upsertProgress,
} from "../lib/db.js";

const GAME = "TYPING";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export async function start({ env, userId, ipHash, body }) {
  const lang = requireOneOf(body.lang, "lang", TYPING.LANGS);
  const difficulty = requireOneOf(body.difficulty, "difficulty", TYPING.DIFFICULTIES);

  const attempts = await consumeAttempt(env, userId, GAME, TYPING.BASE_ATTEMPTS_PER_DAY);

  const sentence = await env.DB.prepare(
    `SELECT id, text, char_count, word_count FROM sentences
     WHERE lang = ? AND difficulty = ? ORDER BY RANDOM() LIMIT 1`,
  )
    .bind(lang, difficulty)
    .first();

  if (!sentence) {
    throw new ApiError("NO_SENTENCE", "해당 조건의 문장이 없습니다. 문장 DB 시드를 확인해 주세요.", 500);
  }

  const timeLimitMs = clamp(
    Math.round(sentence.char_count * TYPING.MS_PER_CHAR[lang]),
    TYPING.TIME_LIMIT_MIN_MS,
    TYPING.TIME_LIMIT_MAX_MS,
  );

  const sessionId = randomId();
  await createSession(env, {
    sessionId,
    gameType: GAME,
    userId,
    secret: { sentence_id: sentence.id },
    meta: { lang, difficulty, time_limit_ms: timeLimitMs },
    ipHash,
  });

  return {
    session_id: sessionId,
    text: sentence.text,
    char_count: sentence.char_count,
    word_count: sentence.word_count,
    lang,
    difficulty,
    time_limit_ms: timeLimitMs,
    primary_metric: TYPING.PRIMARY_METRIC[lang],
    attempts,
  };
}

/**
 * 자리별로 비교해 정확히 입력된 글자 수를 셉니다.
 * 초과 입력분은 오탈자로 계산합니다.
 */
function scoreText(target, typed) {
  const t = [...target];
  const u = [...typed];
  let correct = 0;
  for (let i = 0; i < Math.min(t.length, u.length); i++) {
    if (t[i] === u[i]) correct++;
  }
  const extra = Math.max(0, u.length - t.length);
  const typos = t.length - correct + extra;
  return {
    correct,
    typos,
    targetLen: t.length,
    typedLen: u.length,
    accuracy: t.length > 0 ? (correct / t.length) * 100 : 0,
  };
}

export async function submit({ env, userId, body }) {
  const session = await getOpenSession(env, body.session_id, userId, GAME);
  const { lang, difficulty } = session.meta;

  if (typeof body.typed_text !== "string") {
    throw new ApiError("BAD_PARAM", "typed_text 가 없습니다.");
  }
  if (body.typed_text.length > 4000) {
    throw new ApiError("BAD_PARAM", "입력이 비정상적으로 깁니다.");
  }

  const sentence = await env.DB.prepare(`SELECT text FROM sentences WHERE id = ?`)
    .bind(session.secret.sentence_id)
    .first();
  if (!sentence) throw new ApiError("NO_SENTENCE", "원본 문장을 찾을 수 없습니다.", 500);

  const endTs = now();
  // 카운트다운이 끝난 시각(armed_ts)이 있으면 그것을 기준으로 검증합니다.
  const baseTs = session.armed_ts ?? session.start_ts;
  const { serverWindowMs, suspect, reasons } = checkElapsed({
    elapsedMs: body.elapsed_ms,
    startTs: baseTs,
    endTs,
    minMs: TYPING.ELAPSED_MIN_MS,
    maxMs: TYPING.TIME_LIMIT_MAX_MS + 10000,
    toleranceMs: 1000,
    maxIdleMs: session.armed_ts ? 5000 : 30000,
  });

  const elapsedMs = body.elapsed_ms;
  const graded = scoreText(sentence.text, body.typed_text);

  const minutes = elapsedMs / 60000;
  const typedWords = body.typed_text.trim().split(/\s+/).filter(Boolean).length;
  const wpm = minutes > 0 ? typedWords / minutes : 0;
  const cpm = minutes > 0 ? graded.typedLen / minutes : 0;

  const primary = TYPING.PRIMARY_METRIC[lang];
  const metricValue = primary === "wpm" ? wpm : cpm;

  // 기획서 7장: 최종 점수 = WPM(또는 CPM) × 정확도%
  const score = Math.round(metricValue * graded.accuracy);

  const bucket = `${lang}:${difficulty}`;
  const flags = [...reasons];

  // 기획서 12장: 비정상 WPM(600+) 자동 차단
  const abnormal = wpm > TYPING.MAX_PLAUSIBLE_WPM;
  if (abnormal) flags.push("ABNORMAL_WPM");

  await insertResult(env, {
    sessionId: session.session_id,
    gameType: GAME,
    userId,
    bucket,
    rankMetric: -score, // 점수가 높을수록 좋으므로 부호를 뒤집어 "작을수록 좋은 값" 으로 저장
    score,
    accuracy: Number(graded.accuracy.toFixed(2)),
    detail: {
      wpm: Number(wpm.toFixed(1)),
      cpm: Number(cpm.toFixed(1)),
      primary_metric: primary,
      accuracy: Number(graded.accuracy.toFixed(2)),
      typos: graded.typos,
      correct_chars: graded.correct,
      target_chars: graded.targetLen,
      typed_chars: graded.typedLen,
      elapsed_ms: elapsedMs,
      server_window_ms: serverWindowMs,
      lang,
      difficulty,
      flags,
    },
    suspect: suspect || abnormal,
  });

  await closeSession(env, session.session_id, endTs);

  if (abnormal) {
    // 기록은 이상치로 남기고(감사용) 요청 자체는 실패로 응답합니다.
    throw new ApiError(
      "ABNORMAL_SPEED",
      `측정값이 비정상입니다(${Math.round(wpm)} WPM). 기록이 순위에 반영되지 않습니다.`,
      400,
    );
  }

  await upsertProgress(env, userId, GAME, { level: 0, score });

  const pct = await percentileOf(env, GAME, bucket, -score);
  const attempts = await getAttemptState(env, userId, GAME, TYPING.BASE_ATTEMPTS_PER_DAY);

  return {
    wpm: Number(wpm.toFixed(1)),
    cpm: Number(cpm.toFixed(1)),
    primary_metric: primary,
    accuracy: Number(graded.accuracy.toFixed(2)),
    typos: graded.typos,
    score,
    elapsed_ms: elapsedMs,
    // 정확도는 기획서 정의대로 "원본 전체 글자 수" 기준이라, 문장을 끝까지 치지 못하면
    // 그만큼 낮게 나옵니다. 결과 화면에서 오해가 없도록 완성도를 함께 내려줍니다.
    target_chars: graded.targetLen,
    typed_chars: graded.typedLen,
    completion: Number(((Math.min(graded.typedLen, graded.targetLen) / graded.targetLen) * 100).toFixed(1)),
    bucket,
    rank: pct.better + 1,
    rank_pct: pct.rankPct,
    bucket_total: pct.total,
    attempts,
  };
}

/**
 * 문장 선택 화면(화면④)용 — 난이도별로 무작위 1문장씩 미리보기.
 * 난이도마다 별도 서브쿼리로 뽑아야 각 그룹에서 실제로 랜덤하게 선택됩니다.
 */
export async function previews({ env, body }) {
  const lang = requireOneOf(body.lang ?? "ko", "lang", TYPING.LANGS);

  const rows = await Promise.all(
    TYPING.DIFFICULTIES.map((difficulty) =>
      env.DB.prepare(
        `SELECT id, difficulty, text, char_count, word_count FROM sentences
         WHERE lang = ? AND difficulty = ? ORDER BY RANDOM() LIMIT 1`,
      )
        .bind(lang, difficulty)
        .first(),
    ),
  );

  return { lang, previews: rows.filter(Boolean) };
}
