/**
 * POST /ad/reward — 광고 시청 완료 → 보상 지급 (기획서 11장 트리거 명세)
 *
 * 실제 광고 플랫폼 검증은 lib/adverify.js 의 스텁이 담당합니다(연동 대기).
 * 다만 "몇 번까지 받을 수 있는지" 한도는 지금부터 서버가 강제합니다.
 * 목업 광고라도 클라이언트가 무한히 보상을 요청할 수는 없습니다.
 */

import { AD_TRIGGERS, BASEBALL, STOPWATCH, TYPING } from "../lib/config.js";
import { ApiError, requireOneOf } from "../lib/http.js";
import { verifyRewardedCallback, verifyInterstitialImpression } from "../lib/adverify.js";
import {
  assertIpAdLimit,
  countAdViews,
  recordAdView,
  grantAttempts,
  getAttemptState,
  getOpenSession,
  bumpSessionAdViews,
} from "../lib/db.js";

export async function reward({ env, userId, ipHash, body }) {
  const triggerKey = requireOneOf(body.trigger, "trigger", Object.keys(AD_TRIGGERS));
  const spec = AD_TRIGGERS[triggerKey];
  const gameType = spec.game;

  // 동일 IP 일일 광고 시청 한도 (기획서 12장)
  await assertIpAdLimit(env, ipHash);

  // 광고 플랫폼 검증 (현재는 목업 통과 / AD_MODE=live 이면 미구현 오류)
  const verification =
    spec.type === "REWARDED"
      ? await verifyRewardedCallback(env, body)
      : await verifyInterstitialImpression(env, body);

  // ── 트리거별 한도 검사 및 보상 지급 ─────────────────────────
  let reward = { kind: "UNLOCK", amount: 0 };

  if (spec.type === "REWARDED") {
    if (triggerKey === "BASEBALL_ATTEMPT") {
      // 숫자야구는 "1게임당" 광고 3회 제한이라 세션 기준으로 셉니다.
      const session = await getOpenSession(env, body.session_id, userId, "BASEBALL");
      if (session.ad_views >= BASEBALL.AD_VIEWS_PER_GAME) {
        throw new ApiError(
          "AD_LIMIT",
          `이 게임에서는 광고를 최대 ${BASEBALL.AD_VIEWS_PER_GAME}회까지만 시청할 수 있습니다.`,
          429,
        );
      }
      const nextAttempts = session.attempts_left + BASEBALL.AD_ATTEMPTS_PER_VIEW;
      await bumpSessionAdViews(env, session.session_id, nextAttempts);
      reward = {
        kind: "ATTEMPTS",
        amount: BASEBALL.AD_ATTEMPTS_PER_VIEW,
        attempts_left: nextAttempts,
        ad_views: session.ad_views + 1,
      };
    } else {
      // 그 외 보상형 광고는 "하루 N회" 제한
      const viewed = await countAdViews(env, userId, gameType, triggerKey);
      if (spec.perDay != null && viewed >= spec.perDay) {
        throw new ApiError(
          "AD_LIMIT",
          `오늘 이 보상은 ${spec.perDay}회까지만 받을 수 있습니다. 내일 다시 시도해 주세요.`,
          429,
        );
      }

      const grantMap = {
        STOPWATCH_ATTEMPT: { count: STOPWATCH.AD_ATTEMPTS_PER_VIEW, base: STOPWATCH.BASE_ATTEMPTS_PER_DAY },
        TYPING_SENTENCE: { count: TYPING.AD_ATTEMPTS_PER_VIEW, base: TYPING.BASE_ATTEMPTS_PER_DAY },
        MEMORY_LEVEL: { count: 1, base: 0 },
      };
      const g = grantMap[triggerKey];
      await grantAttempts(env, userId, gameType, g.count);
      const state = await getAttemptState(env, userId, gameType, g.base);
      reward = {
        kind: triggerKey === "MEMORY_LEVEL" ? "LEVEL_TICKET" : "ATTEMPTS",
        amount: g.count,
        attempts: state,
        remaining_today: spec.perDay != null ? spec.perDay - viewed - 1 : null,
      };
    }
  }

  await recordAdView(env, {
    userId,
    sessionId: body.session_id ?? null,
    gameType,
    trigger: triggerKey,
    adType: spec.type,
    ipHash,
  });

  return {
    trigger: triggerKey,
    ad_type: spec.type,
    verified: verification.verified,
    mock: verification.mock,
    reward,
  };
}
