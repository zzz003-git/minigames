/**
 * 아케이드 런(run) 엔진 — 광고 리워드용 미니게임 10종의 공통 진행 규칙
 * ==========================================================================
 *
 * 기획: docs/arcade-10-games.md
 *
 * 게임 10개가 각자 세션을 만들고 기회를 차감하고 백분위를 계산하면 같은 코드가 10벌
 * 생깁니다. 게임마다 실제로 다른 것은 "라운드를 어떻게 만들고 어떻게 채점하는가" 뿐이므로,
 * 그 두 가지만 게임 파일(src/games/*.js)의 spec 으로 받고 나머지는 여기서 처리합니다.
 *
 * ── 엔진이 담당하는 것 ────────────────────────────────────────────────────
 *   도전 기회 차감 · 세션 생성/이어하기 · 목숨 · 라운드 시간 초과 판정
 *   광고 보상(_BOOST) 적용 · 리그(bucket) 분리 · 결과 저장 · 백분위 · 개인 최고 기록
 *
 * ── 게임 파일이 담당하는 것 (spec) ────────────────────────────────────────
 *   game        게임 코드 (config.ARCADE 의 키)
 *   mode        'ENDLESS' | 'BATCH'
 *
 *   [ENDLESS]
 *   initSecret(meta)                 런 내내 유지되는 비밀값 (예: 카드 배치). 선택
 *   makeRound(roundNo, meta)         { pub, secret, limitMs } | null
 *                                    pub    → 클라이언트에 내려보낼 라운드 데이터
 *                                    secret → 정답. 응답에 절대 포함되지 않음
 *                                    null 을 주면 라운드 데이터 없이 진행(카드 뒤집기 등)
 *   judgeRound(input)                { ok, fatal, done, data } — meta 를 직접 수정해도 됩니다
 *
 *   [BATCH]
 *   makeBatch(meta)                  { pub, secret, limitMs }
 *   gradeBatch(input)                { score, correct, detail, suspect, bucketHint }
 *
 *   [공통]
 *   bucketOf(meta)                   리그 키. 보상을 쓴 런은 엔진이 '+' 를 붙입니다
 *   rankMetricOf(meta, ctx)          순위 지표. "작을수록 좋은" 값으로 정규화
 *   scoreOf(meta, ctx)               결과 화면에 띄울 점수. 생략하면 meta.cleared
 *   applyBoost(meta, secret)         광고 보상 적용. { data, secret } 를 돌려줄 수 있음
 *   boostLabel                       보상 카드 문구 (예: '목숨 +1')
 * ==========================================================================
 */

import { ARCADE } from "./config.js";
import { ApiError } from "./http.js";
import { randomId } from "./crypto.js";
import { now } from "./time.js";
import {
  createSession,
  findOpenSession,
  getOpenSession,
  closeSession,
  insertResult,
  percentileOf,
  personalBest,
  consumeAttempt,
  getAttemptState,
  updateSessionMeta,
  updateSessionState,
  upsertProgress,
} from "./db.js";

/**
 * 라운드 제한 시간을 넘겼는지 판정할 때 주는 여유.
 * 네트워크 왕복 + 렌더링 지연이 사용자 잘못으로 기록되면 안 되므로 넉넉하게 둡니다.
 */
const ROUND_GRACE_MS = 1500;

/** BATCH 게임에서 클라이언트 신고 시간과 서버 관측 시간창의 허용 오차 */
const BATCH_GRACE_MS = 3000;

const cfgOf = (spec) => ARCADE[spec.game];

// ══════════════════════════════════════════════════════════════
// 런 시작
// ══════════════════════════════════════════════════════════════

/**
 * POST /game/session/start
 *
 * 새로고침으로 도전 기회가 날아가지 않도록, 진행 중인 런이 있으면 그대로 이어 씁니다.
 * 새 판을 강제하려면 { fresh: true } 로 요청합니다.
 */
export async function start(ctx, spec) {
  const { env, userId, ipHash, body } = ctx;
  const cfg = cfgOf(spec);

  if (!body?.fresh) {
    const existing = await findOpenSession(env, userId, spec.game);
    if (existing) {
      return {
        ...(await publicRun(env, userId, spec, existing, existing.meta)),
        resumed: true,
      };
    }
  }

  const attempts = await consumeAttempt(env, userId, spec.game, cfg.baseAttempts);

  const meta = {
    round: 1,
    cleared: 0,
    lives: cfg.lives ?? 0,
    boosts: 0,
    ext: {},
    issued_ts: now(),
  };

  let secret = { ext: spec.initSecret ? spec.initSecret(meta) : null, round: null };
  let pub = null;
  let limitMs = null;

  if (spec.mode === "ENDLESS") {
    const first = spec.makeRound ? spec.makeRound(1, meta) : null;
    secret.round = first?.secret ?? null;
    pub = first?.pub ?? null;
    limitMs = first?.limitMs ?? null;
  } else {
    const batch = spec.makeBatch(meta);
    secret.round = batch.secret;
    pub = batch.pub;
    limitMs = batch.limitMs ?? null;
  }

  meta.limit_ms = limitMs;
  meta.pub = pub; // 새로고침으로 돌아왔을 때 같은 라운드를 다시 그려 주기 위해 보관

  const sessionId = randomId();
  await createSession(env, {
    sessionId,
    gameType: spec.game,
    userId,
    secret,
    meta,
    attemptsLeft: meta.lives,
    ipHash,
  });

  return {
    session_id: sessionId,
    game: spec.game,
    mode: spec.mode,
    round: pub,
    round_no: 1,
    limit_ms: limitMs,
    lives: meta.lives,
    max_lives: cfg.lives ?? 0,
    boosts: 0,
    max_boosts: cfg.boostsPerRun ?? 0,
    attempts,
  };
}

/** 이어하기(새로고침 복구)용 현재 상태 */
async function publicRun(env, userId, spec, session, meta) {
  const cfg = cfgOf(spec);
  return {
    session_id: session.session_id,
    game: spec.game,
    mode: spec.mode,
    round: meta.pub ?? null,
    round_no: meta.round,
    limit_ms: meta.limit_ms ?? null,
    lives: meta.lives,
    max_lives: cfg.lives ?? 0,
    cleared: meta.cleared,
    boosts: meta.boosts,
    max_boosts: cfg.boostsPerRun ?? 0,
    ext: meta.ext ?? {},
    attempts: await getAttemptState(env, userId, spec.game, cfg.baseAttempts),
  };
}

/**
 * 라운드 진행 상태를 저장합니다.
 *
 * 정답(secret)이 그대로인 라운드는 meta 만 씁니다. secret 은 AES-GCM 으로 암호화해
 * 저장하므로, 바뀌지 않은 값을 매번 다시 암호화해서 쓰면 왕복 시간이 그만큼 늘어납니다.
 * 카드 짝 맞추기는 배치가 런 내내 고정인데 뒤집기마다 라운드가 돌아 이 차이가 매번 생깁니다.
 */
async function persistRound(env, sessionId, meta, secret, secretChanged) {
  if (secretChanged) await updateSessionState(env, sessionId, { meta, secret });
  else await updateSessionMeta(env, sessionId, meta);
}

// ══════════════════════════════════════════════════════════════
// ENDLESS — 라운드 1회 판정
// ══════════════════════════════════════════════════════════════

/**
 * POST /game/round
 *
 * 판정은 전부 서버가 합니다. 클라이언트는 "무엇을 눌렀는가" 만 보냅니다.
 */
export async function round(ctx, spec) {
  const { env, userId, body } = ctx;

  if (spec.mode !== "ENDLESS") {
    throw new ApiError("BAD_PARAM", `${spec.game} 은 라운드 방식 게임이 아닙니다.`);
  }

  const session = await getOpenSession(env, body.session_id, userId, spec.game);
  const meta = session.meta;
  const secret = session.secret ?? {};
  const cfg = cfgOf(spec);
  const usesLives = (cfg.lives ?? 0) > 0;

  // 목숨이 떨어진 런은 "이어하기 아니면 종료" 를 기다리는 상태입니다.
  // 여기서 답을 더 받아 주면 목숨이 계속 깎여 음수가 되고, 그 뒤에 광고로 목숨을 +1 해도
  // 여전히 0 이하라 곧바로 다시 소진됩니다 — 사용자가 광고를 보고 아무것도 못 받는 상황입니다.
  if (usesLives && meta.lives <= 0) {
    throw new ApiError(
      "RUN_EXHAUSTED",
      "목숨을 모두 사용했습니다. 이어하거나 결과를 확인해 주세요.",
      409,
    );
  }

  // 라운드 제한 시간 초과 — 클라이언트 신고와 서버 관측을 모두 봅니다.
  // 클라이언트가 timeout 을 숨겨도 서버 시계로 잡히고, 서버 시계가 네트워크 때문에
  // 늦게 도착해도 여유(ROUND_GRACE_MS) 안이면 사용자 잘못으로 보지 않습니다.
  const sinceIssued = now() - (meta.issued_ts ?? session.start_ts);
  const serverTimedOut = meta.limit_ms != null && sinceIssued > meta.limit_ms + ROUND_GRACE_MS;
  const timedOut = Boolean(body.timeout) || serverTimedOut;

  const verdict =
    spec.judgeRound({
      answer: body.answer,
      elapsedMs: typeof body.elapsed_ms === "number" ? body.elapsed_ms : null,
      timedOut,
      roundSecret: secret.round,
      runSecret: secret.ext,
      meta,
      roundNo: meta.round,
      sinceIssuedMs: sinceIssued,
    }) ?? {};

  // 라운드 판정 결과. 응답 필드 이름은 `correct` 입니다 —
  // `ok` 로 내보내면 http.js 의 성공 봉투(ok: true)와 이름이 겹쳐 혼동을 부릅니다.
  const correct = Boolean(verdict.ok);
  const fatal = verdict.fatal ?? !correct;

  if (correct) meta.cleared += 1;
  // 0 아래로는 내려가지 않게 둡니다. 저장되는 상태가 음수가 되면
  // 이어하기(+1)로도 0을 넘지 못해 보상이 무효가 됩니다.
  if (fatal) meta.lives = Math.max(0, meta.lives - 1);
  if (verdict.suspect) meta.suspect = true;

  // 목숨을 쓰지 않는 게임(카드 짝 맞추기)은 lives 가 0으로 시작하므로 목숨으로 끝내지 않습니다.
  const outOfLives = usesLives && meta.lives <= 0;
  const boostsLeft = (cfg.boostsPerRun ?? 0) - (meta.boosts ?? 0);

  // 목숨이 떨어졌지만 아직 이어하기가 남아 있으면 세션을 닫지 않습니다.
  // 여기서 바로 결과를 확정해 버리면 "광고 보고 이어하기" 가 성립하지 않습니다.
  // (숫자야구에서 기회 소진 시 정답을 감춘 채 선택지를 주는 것과 같은 처리)
  if (outOfLives && boostsLeft > 0) {
    await persistRound(env, session.session_id, meta, secret, false);
    return {
      correct,
      fatal,
      data: verdict.data ?? null,
      round_no: meta.round,
      lives: 0,
      cleared: meta.cleared,
      ext: meta.ext ?? {},
      game_over: false,
      exhausted: true,
      can_boost: true,
      boosts: meta.boosts,
      max_boosts: cfg.boostsPerRun,
    };
  }

  if (verdict.done || outOfLives) {
    const result = await finalize(env, userId, spec, session, meta, {
      completed: Boolean(verdict.done),
    });
    return {
      correct,
      fatal,
      data: verdict.data ?? null,
      round_no: meta.round,
      lives: Math.max(0, meta.lives),
      cleared: meta.cleared,
      game_over: true,
      result,
    };
  }

  // 다음 라운드 준비. makeRound 가 없거나 null 을 주면 라운드 데이터 없이 진행합니다.
  meta.round += 1;
  const next = spec.makeRound ? spec.makeRound(meta.round, meta) : null;
  if (next) {
    secret.round = next.secret ?? null;
    meta.limit_ms = next.limitMs ?? null;
    meta.pub = next.pub ?? null;
  }
  meta.issued_ts = now();

  await persistRound(env, session.session_id, meta, secret, Boolean(next));

  return {
    correct,
    fatal,
    data: verdict.data ?? null,
    round_no: meta.round,
    round: next?.pub ?? null,
    limit_ms: meta.limit_ms ?? null,
    lives: meta.lives,
    cleared: meta.cleared,
    ext: meta.ext ?? {},
    game_over: false,
  };
}

// ══════════════════════════════════════════════════════════════
// BATCH — 답안 일괄 제출
// ══════════════════════════════════════════════════════════════

/**
 * POST /game/submit
 *
 * 클라이언트가 로컬에서 빠르게 진행한 뒤 답안 전체와 문항별 응답 시간을 보냅니다.
 * 서버는 원본 문제로 전부 다시 채점하므로 점수를 클라이언트가 정할 수 없습니다.
 */
export async function submitBatch(ctx, spec) {
  const { env, userId, body } = ctx;

  if (spec.mode !== "BATCH") {
    throw new ApiError("BAD_PARAM", `${spec.game} 은 일괄 제출 방식 게임이 아닙니다.`);
  }

  const session = await getOpenSession(env, body.session_id, userId, spec.game);
  const meta = session.meta;

  const answers = Array.isArray(body.answers) ? body.answers : [];
  const times = Array.isArray(body.times) ? body.times : [];

  if (answers.length > 500) {
    throw new ApiError("BAD_PARAM", "제출 문항 수가 너무 많습니다.");
  }
  if (times.length !== answers.length) {
    throw new ApiError("BAD_PARAM", "답안 수와 응답 시간 수가 일치하지 않습니다.");
  }

  const endTs = now();
  const serverWindowMs = endTs - (session.armed_ts ?? session.start_ts);
  const reportedMs = Number(body.elapsed_ms);

  // 신고한 플레이 시간이 서버가 관측한 시간창을 넘으면 시간을 부풀린 것입니다.
  if (Number.isFinite(reportedMs) && reportedMs > serverWindowMs + BATCH_GRACE_MS) {
    throw new ApiError(
      "TIME_TAMPERED",
      "기록이 서버가 관측한 시간 범위를 벗어났습니다. 다시 시도해 주세요.",
      400,
    );
  }

  const graded = spec.gradeBatch({
    answers,
    times,
    meta,
    roundSecret: session.secret?.round,
    runSecret: session.secret?.ext,
    elapsedMs: Number.isFinite(reportedMs) ? reportedMs : serverWindowMs,
    serverWindowMs,
  });

  meta.cleared = graded.cleared ?? graded.correct ?? 0;
  if (graded.suspect) meta.suspect = true;
  Object.assign(meta.ext, graded.ext ?? {});

  const result = await finalize(env, userId, spec, session, meta, {
    completed: true,
    detail: graded.detail,
    score: graded.score,
    endTs,
  });

  return { game_over: true, result, detail: graded.detail ?? null };
}

// ══════════════════════════════════════════════════════════════
// 런 종료
// ══════════════════════════════════════════════════════════════

/**
 * POST /game/finish — 사용자가 중도에 그만두거나 라운드 시간이 끝난 경우.
 * 그 시점까지의 기록은 정상 기록으로 남깁니다.
 */
export async function finish(ctx, spec) {
  const { env, userId, body } = ctx;
  const session = await getOpenSession(env, body.session_id, userId, spec.game);
  const result = await finalize(env, userId, spec, session, session.meta, { completed: false });
  return { game_over: true, result };
}

/**
 * 결과를 저장하고 순위·개인 최고 기록을 계산합니다.
 *
 * 리그(bucket): 광고 보상을 쓴 런은 안 쓴 런보다 유리하므로 '+' 를 붙여 따로 집계합니다.
 * 그러지 않으면 순위표가 실력 순위가 아니라 광고 시청량 순위가 됩니다.
 */
async function finalize(env, userId, spec, session, meta, { completed, detail, score, endTs } = {}) {
  const cfg = cfgOf(spec);
  const finishedTs = endTs ?? now();
  const elapsedMs = Math.max(0, finishedTs - session.start_ts);

  const baseBucket = spec.bucketOf ? spec.bucketOf(meta) : "all";
  // 60초 암산처럼 bucket 자체가 이미 보상 사용량을 담고 있으면 '+' 를 붙이지 않습니다.
  const suffix = spec.boostBucketSuffix === false ? "" : "+";
  const bucket = meta.boosts > 0 && suffix ? `${baseBucket}${suffix}` : baseBucket;

  const rankMetric = spec.rankMetricOf(meta, { elapsedMs, completed });
  const displayScore = score ?? (spec.scoreOf ? spec.scoreOf(meta, { elapsedMs }) : meta.cleared);
  const suspect = Boolean(meta.suspect);

  // 이번 판을 저장하기 전에 조회해야 "직전까지의 최고 기록" 이 나옵니다.
  const before = await personalBest(env, userId, spec.game, bucket);

  await insertResult(env, {
    sessionId: session.session_id,
    gameType: spec.game,
    userId,
    bucket,
    rankMetric,
    score: displayScore,
    accuracy: null,
    detail: {
      cleared: meta.cleared,
      lives_left: Math.max(0, meta.lives ?? 0),
      boosts: meta.boosts,
      completed: Boolean(completed),
      elapsed_ms: elapsedMs,
      ...(detail ?? {}),
    },
    suspect,
  });

  await closeSession(env, session.session_id, finishedTs);
  await upsertProgress(env, userId, spec.game, { level: meta.cleared, score: displayScore });

  const pct = await percentileOf(env, spec.game, bucket, rankMetric);
  const attempts = await getAttemptState(env, userId, spec.game, cfg.baseAttempts);

  return {
    game: spec.game,
    bucket,
    boosted: meta.boosts > 0,
    completed: Boolean(completed),
    score: displayScore,
    cleared: meta.cleared,
    rank_metric: rankMetric,
    // 이전 최고 기록과 신기록 여부. 결과 화면의 재도전 동기가 여기서 나옵니다.
    // 이상치로 표시된 판은 신기록으로 축하하지 않습니다 (최고 기록에도 남지 않으므로).
    prev_best: before.best,
    is_best: !suspect && (before.best == null || rankMetric < before.best),
    plays: before.plays + 1,
    rank_pct: pct.rankPct,
    bucket_total: pct.total,
    elapsed_ms: elapsedMs,
    suspect,
    detail: detail ?? null,
    attempts,
  };
}

// ══════════════════════════════════════════════════════════════
// 광고 보상 (_BOOST)
// ══════════════════════════════════════════════════════════════

/**
 * routes/ad.js 에서 호출합니다. 광고 시청이 확인된 뒤 런에 보상을 적용합니다.
 * 한도는 "1런당 N회" 라서 일일 카운터가 아니라 세션의 ad_views 로 셉니다 (숫자야구와 같은 방식).
 */
export async function applyBoost(env, userId, spec, sessionId) {
  const cfg = cfgOf(spec);
  const limit = cfg.boostsPerRun ?? 0;

  if (limit <= 0) {
    throw new ApiError("AD_LIMIT", `${cfg.label} 에는 이어하기 보상이 없습니다.`, 400);
  }

  const session = await getOpenSession(env, sessionId, userId, spec.game);
  const meta = session.meta;

  if ((meta.boosts ?? 0) >= limit) {
    throw new ApiError(
      "AD_LIMIT",
      `이 판에서는 광고 보상을 최대 ${limit}회까지만 받을 수 있습니다.`,
      429,
    );
  }

  const secret = session.secret ?? {};
  const applied = spec.applyBoost(meta, secret) ?? {};
  const nextSecret = applied.secret ?? secret;
  meta.boosts = (meta.boosts ?? 0) + 1;

  // 목숨을 되찾은 ENDLESS 게임은 곧바로 다음 라운드를 발급합니다.
  // 그러지 않으면 클라이언트가 라운드를 받으려고 한 번 더 왕복해야 합니다.
  let next = null;
  if (spec.mode === "ENDLESS" && meta.lives > 0 && spec.makeRound) {
    meta.round += 1;
    next = spec.makeRound(meta.round, meta);
    nextSecret.round = next?.secret ?? nextSecret.round;
    meta.limit_ms = next?.limitMs ?? null;
    meta.pub = next?.pub ?? null;
  }

  meta.issued_ts = now();

  await updateSessionState(env, session.session_id, { meta, secret: nextSecret });

  await env.DB.prepare(`UPDATE sessions SET ad_views = ad_views + 1 WHERE session_id = ?`)
    .bind(session.session_id)
    .run();

  return {
    kind: "BOOST",
    label: spec.boostLabel ?? "이어하기",
    amount: 1,
    boosts: meta.boosts,
    max_boosts: limit,
    lives: meta.lives,
    limit_ms: meta.limit_ms ?? null,
    round: next?.pub ?? null,
    round_no: meta.round,
    data: applied.data ?? null,
  };
}

// ══════════════════════════════════════════════════════════════
// 게임 파일에서 공통으로 쓰는 작은 유틸
// ══════════════════════════════════════════════════════════════

/** 라운드가 올라갈수록 값이 줄어드는 곡선 (제한 시간·노출 시간·색 차이 등) */
export const decay = (roundNo, start, step, min) => Math.max(min, start - (roundNo - 1) * step);

/** 라운드가 올라갈수록 값이 커지는 곡선 (속도·점 개수 등) */
export const growth = (roundNo, start, step, max) => Math.min(max, start + (roundNo - 1) * step);

/**
 * 문항별 응답 시간이 사람이 낼 수 있는 범위인지 봅니다.
 *
 * 한 문항이라도 하한 미만이면 이상치로 처리하는 것은 너무 가혹합니다 —
 * 손가락이 미끄러져 두 번 눌리는 것만으로 판 전체가 순위에서 빠지게 됩니다.
 * 자동화는 "거의 모든 문항" 이 빠르므로, 비율로 판단하면 오탐 없이 잡을 수 있습니다.
 *
 * 기준: 하한 미만 응답이 3개를 넘고, 동시에 전체의 20% 이상일 때만 이상치.
 */
export function hasImpossibleTiming(times, minMs) {
  const valid = times.filter((t) => typeof t === "number" && t >= 0);
  if (valid.length === 0) return false;

  const tooFast = valid.filter((t) => t < minMs).length;
  return tooFast > 3 && tooFast / valid.length >= 0.2;
}

/** 배열 평균 (빈 배열이면 null) */
export const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** 문항별 제한 시간을 볼 때 주는 여유 (렌더링 지연 · 입력 이벤트 지연) */
const ITEM_GRACE_MS = 250;

/**
 * "하나 틀리면 끝" 방식 게임(스트룹 · 이겨라/져라)의 공통 채점.
 *
 * 광고 보상으로 얻은 면제권(forgive)만큼은 오답을 건너뛰고 연속을 유지합니다.
 * 면제된 문항은 정답으로 치지 않습니다 — 광고로 점수를 사는 것이 아니라
 * 실수를 한 번 지워 주는 것이라는 규칙을 서버가 그대로 재현합니다.
 *
 * @returns {{ streak:number, answered:number, forgiven:number, wrongAt:number|null,
 *             avgMs:number|null, suspect:boolean }}
 */
export function gradeStreak({ answers, times, expected, limits = [], forgive = 0, minAnswerMs = 150 }) {
  let streak = 0;
  let answered = 0;
  let forgiven = 0;
  let wrongAt = null;
  const spent = [];

  for (let i = 0; i < answers.length && i < expected.length; i++) {
    const t = Number(times[i]);
    const limit = limits[i];
    const overtime = Number.isFinite(t) && limit != null && t > limit + ITEM_GRACE_MS;
    const hit = answers[i] === expected[i] && !overtime;

    answered += 1;
    if (Number.isFinite(t)) spent.push(Math.max(0, t));

    if (hit) {
      streak += 1;
      continue;
    }
    if (forgiven < forgive) {
      forgiven += 1;
      continue;
    }
    wrongAt = i;
    break;
  }

  return {
    streak,
    answered,
    forgiven,
    wrongAt,
    avgMs: mean(spent),
    suspect: hasImpossibleTiming(spent, minAnswerMs),
  };
}

/**
 * 연속 정답형 게임의 순위 지표.
 * 연속이 우선, 같으면 평균 응답 시간이 빠른 쪽이 상위입니다. (작을수록 좋은 값)
 */
export const streakMetric = (streak, avgMs) =>
  -(streak * 1000) + Math.min(999, Math.round((avgMs ?? 9990) / 10));

// ══════════════════════════════════════════════════════════════
// spec 계약 검증
// ══════════════════════════════════════════════════════════════

/**
 * 게임 spec 이 엔진이 기대하는 형태인지 검사합니다.
 *
 * 게임을 추가할 때 필드를 빠뜨리면 런타임에 엉뚱한 곳에서 터지거나,
 * 더 나쁘게는 조용히 잘못 동작합니다. 예를 들어 ENDLESS 게임이 config 에
 * `lives` 를 빠뜨리면 목숨 개념이 없는 게임으로 취급되어 절대 끝나지 않습니다.
 *
 * `npm run test:api` 가 등록된 모든 게임에 대해 이 함수를 돌립니다.
 *
 * @returns {string[]} 문제 목록 (빈 배열이면 정상)
 */
export function validateSpec(spec) {
  const problems = [];
  const cfg = ARCADE[spec?.game];

  if (!spec?.game) return ["spec.game 이 없습니다"];
  if (!cfg) problems.push(`config.ARCADE 에 ${spec.game} 항목이 없습니다`);
  if (!["ENDLESS", "BATCH"].includes(spec.mode)) {
    problems.push(`mode 가 ENDLESS/BATCH 가 아닙니다 (${spec.mode})`);
  }
  if (cfg && cfg.mode !== spec.mode) {
    problems.push(`config.mode(${cfg.mode}) 와 spec.mode(${spec.mode}) 가 다릅니다`);
  }

  for (const fn of ["bucketOf", "rankMetricOf"]) {
    if (typeof spec[fn] !== "function") problems.push(`${fn} 가 함수가 아닙니다`);
  }

  if (spec.mode === "ENDLESS") {
    if (typeof spec.judgeRound !== "function") problems.push("ENDLESS 인데 judgeRound 가 없습니다");
    // 라운드 데이터가 없는 게임(카드 뒤집기)은 makeRound 를 생략할 수 있지만,
    // 그때는 initSecret 으로 런 전체의 문제를 미리 만들어 두어야 합니다.
    if (typeof spec.makeRound !== "function" && typeof spec.initSecret !== "function") {
      problems.push("makeRound 도 initSecret 도 없으면 문제를 만들 수단이 없습니다");
    }
    // 목숨을 쓰지 않는 ENDLESS 게임은 done 으로만 끝나므로, 끝낼 방법이 있어야 합니다.
    if ((cfg?.lives ?? 0) <= 0 && typeof spec.makeRound === "function") {
      problems.push(
        "라운드를 계속 만드는데 목숨(config.lives)이 없습니다 — 런이 끝나지 않습니다",
      );
    }
  }

  if (spec.mode === "BATCH") {
    for (const fn of ["makeBatch", "gradeBatch"]) {
      if (typeof spec[fn] !== "function") problems.push(`BATCH 인데 ${fn} 가 없습니다`);
    }
  }

  if ((cfg?.boostsPerRun ?? 0) > 0) {
    if (typeof spec.applyBoost !== "function") {
      problems.push("boostsPerRun > 0 인데 applyBoost 가 없습니다 (광고 보상이 아무 일도 안 합니다)");
    }
    if (!spec.boostLabel) problems.push("boostsPerRun > 0 인데 boostLabel 이 없습니다");
  }

  for (const key of ["baseAttempts", "adAttemptsPerDay", "label", "icon", "tagline"]) {
    if (cfg && cfg[key] == null) problems.push(`config.${key} 가 없습니다`);
  }

  return problems;
}

/** Fisher-Yates 셔플 (crypto 난수 사용 — 예측 가능한 배치는 어뷰징 경로가 됩니다) */
export function shuffled(items, randomInt) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
