/**
 * ② 숫자야구 (기획서 5~6장)
 *
 * 정답(0~9 중 중복 없는 3자리)은 서버에서 생성해 AES-256-GCM 으로 암호화 저장하며,
 * 게임이 끝날 때까지 어떤 응답에도 포함되지 않습니다.
 * 따라서 S/B/Out 판정도 서버가 수행합니다 → POST /game/guess
 * (기획서 엔드포인트 목록에는 없지만, "정답 절대 노출 금지" 를 지키려면 필요한 추가 엔드포인트입니다.)
 *
 * ── 기획서 모순 처리 ──────────────────────────────────────────────────────
 * 기획서 화면④는 정답을 공개하면서 동시에 "기회 +3 충전" 버튼을 함께 둡니다.
 * 정답을 알려준 뒤 같은 정답으로 3번 더 도전하는 것은 게임이 성립하지 않으므로,
 * 기회가 0이 된 시점에는 정답을 아직 감춘 채 두 갈래를 제시합니다.
 *   - 광고 시청 → 기회 +3 충전 → 같은 정답으로 계속 도전
 *   - 포기(POST /game/giveup) → 그때 정답 공개 + 실패로 기록
 * 광고 한도(3회)를 이미 다 쓴 상태에서 기회가 0이 되면 바로 실패 처리합니다.
 */

import { BASEBALL } from "../lib/config.js";
import { randomId, randomUniqueDigits } from "../lib/crypto.js";
import { requireDigits } from "../lib/validate.js";
import { ApiError } from "../lib/http.js";
import { now } from "../lib/time.js";
import {
  createSession,
  getOpenSession,
  findOpenSession,
  closeSession,
  insertResult,
  percentileOf,
  updateSessionAttempts,
  updateSessionMeta,
} from "../lib/db.js";

const GAME = "BASEBALL";

/** 이 세션에서 지금까지 쓴 시도 횟수 */
const usedAttempts = (session) =>
  BASEBALL.BASE_ATTEMPTS + session.ad_views * BASEBALL.AD_ATTEMPTS_PER_VIEW - session.attempts_left;

export async function start({ env, userId, ipHash, body }) {
  // 진행 중인 게임이 있으면 이어서 합니다. 새 게임을 강제하려면 { fresh: true } 로 요청하세요.
  if (!body?.fresh) {
    const existing = await findOpenSession(env, userId, GAME);
    if (existing) {
      return {
        session_id: existing.session_id,
        digits: BASEBALL.DIGITS,
        attempts_left: existing.attempts_left,
        ad_views: existing.ad_views,
        max_ad_views: BASEBALL.AD_VIEWS_PER_GAME,
        history: existing.meta.history ?? [],
        exhausted: existing.attempts_left <= 0,
        can_refill: existing.ad_views < BASEBALL.AD_VIEWS_PER_GAME,
        resumed: true,
      };
    }
  }

  const sessionId = randomId();
  const answer = randomUniqueDigits(BASEBALL.DIGITS);

  await createSession(env, {
    sessionId,
    gameType: GAME,
    userId,
    secret: { answer },
    meta: { history: [] },
    attemptsLeft: BASEBALL.BASE_ATTEMPTS,
    ipHash,
  });

  return {
    session_id: sessionId,
    digits: BASEBALL.DIGITS,
    attempts_left: BASEBALL.BASE_ATTEMPTS,
    ad_views: 0,
    max_ad_views: BASEBALL.AD_VIEWS_PER_GAME,
    history: [],
    exhausted: false,
    can_refill: true,
  };
}

/** Strike: 숫자와 자리 모두 일치 / Ball: 숫자는 있으나 자리 불일치 / 둘 다 0이면 Out */
function judge(answer, guess) {
  let strikes = 0;
  let balls = 0;
  for (let i = 0; i < guess.length; i++) {
    const ch = guess[i];
    if (answer[i] === ch) strikes++;
    else if (answer.includes(ch)) balls++;
  }
  return { strikes, balls, out: strikes === 0 && balls === 0 };
}

/** 게임을 종료하고 결과를 기록합니다. 성공/실패를 다른 bucket 에 저장합니다. */
async function finalize(env, userId, session, { solved, attemptNo, history }) {
  const endTs = now();
  const elapsedMs = endTs - session.start_ts;
  const answer = session.secret.answer;
  const bucket = solved ? "solved" : "failed";

  await insertResult(env, {
    sessionId: session.session_id,
    gameType: GAME,
    userId,
    bucket,
    rankMetric: solved ? attemptNo : 999, // 시도 횟수가 적을수록 좋은 기록
    score: solved ? Math.max(0, 100 - attemptNo * 5) : 0,
    accuracy: null,
    detail: {
      solved,
      answer, // 게임이 끝난 뒤이므로 기록해도 됩니다.
      attempts: attemptNo,
      ad_views: session.ad_views,
      elapsed_ms: elapsedMs,
      history,
    },
    suspect: false,
  });

  await closeSession(env, session.session_id, endTs);

  const pct = solved ? await percentileOf(env, GAME, "solved", attemptNo) : null;

  return {
    solved,
    game_over: true,
    attempt_no: attemptNo,
    answer, // 성공·실패 두 화면 모두 정답을 공개합니다 (기획서 화면③④)
    elapsed_ms: elapsedMs,
    history,
    ad_views: session.ad_views,
    rank_pct: pct?.rankPct ?? null,
    bucket_total: pct?.total ?? null,
  };
}

export async function guess({ env, userId, body }) {
  const session = await getOpenSession(env, body.session_id, userId, GAME);
  const answer = session.secret.answer;

  requireDigits(body.guess, "guess", { length: BASEBALL.DIGITS, unique: true });

  if (session.attempts_left <= 0) {
    throw new ApiError("NO_ATTEMPTS", "남은 기회가 없습니다. 광고를 시청하면 기회가 충전됩니다.", 403);
  }

  const verdict = judge(answer, body.guess);
  const attemptsLeft = session.attempts_left - 1;
  const attemptNo = usedAttempts(session) + 1;

  // 시도 기록은 정답이 아니므로 meta 에 저장해 새로고침 후에도 복원할 수 있게 합니다.
  const history = [
    ...(session.meta.history ?? []),
    { guess: body.guess, strikes: verdict.strikes, balls: verdict.balls },
  ];
  await updateSessionMeta(env, session.session_id, { ...session.meta, history });
  await updateSessionAttempts(env, session.session_id, attemptsLeft);

  const solved = verdict.strikes === BASEBALL.DIGITS;
  const canRefill = session.ad_views < BASEBALL.AD_VIEWS_PER_GAME;

  if (solved) {
    return { ...verdict, ...(await finalize(env, userId, session, { solved: true, attemptNo, history })), attempts_left: attemptsLeft };
  }

  // 아직 기회가 남았으면 계속 진행
  if (attemptsLeft > 0) {
    return { ...verdict, solved: false, game_over: false, exhausted: false, attempt_no: attemptNo, attempts_left: 0 + attemptsLeft, history };
  }

  // 기회 소진 — 광고로 충전할 수 있으면 정답을 아직 감춘 채 세션을 열어 둡니다.
  if (canRefill) {
    return {
      ...verdict,
      solved: false,
      game_over: false,
      exhausted: true,
      can_refill: true,
      attempt_no: attemptNo,
      attempts_left: 0,
      history,
    };
  }

  // 광고 한도까지 소진 → 실패 확정
  return { ...verdict, ...(await finalize(env, userId, session, { solved: false, attemptNo, history })), attempts_left: 0 };
}

/**
 * POST /game/giveup — 포기하고 정답 확인.
 * 기회가 남아 있는 상태에서도 호출할 수 있습니다(사용자가 그만두고 싶을 때).
 */
export async function giveUp({ env, userId, body }) {
  const session = await getOpenSession(env, body.session_id, userId, GAME);
  const history = session.meta.history ?? [];
  const attemptNo = usedAttempts(session);
  return { ...(await finalize(env, userId, session, { solved: false, attemptNo, history })), attempts_left: session.attempts_left };
}
