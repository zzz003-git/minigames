/**
 * POST /ad/reward — 광고 시청 완료 → 보상 지급 (기획서 11장 트리거 명세)
 *
 * 실제 광고 플랫폼 검증은 lib/adverify.js 의 스텁이 담당합니다(연동 대기).
 * 다만 "몇 번까지 받을 수 있는지" 한도는 지금부터 서버가 강제합니다.
 * 목업 광고라도 클라이언트가 무한히 보상을 요청할 수는 없습니다.
 */

import { AD_TRIGGERS, ARCADE, BASEBALL, STOPWATCH, TYPING } from "../lib/config.js";
import { ApiError, requireOneOf } from "../lib/http.js";
import { verifyRewardedCallback, verifyInterstitialImpression } from "../lib/adverify.js";
import { arcadeSpec } from "../games/arcade/index.js";
import { applyBoost } from "../lib/arcade.js";
import { isTestMode } from "../lib/testmode.js";
import * as tarot from "../services/tarot.js";
import * as mind from "../services/mind.js";
import * as saju from "../services/saju.js";

/**
 * 스위트 서비스의 광고 보상.
 *
 * 서비스가 늘어나면 여기에 한 줄씩 는다. 게임 분기와 달리 「무엇을 주는가」가
 * 트리거마다 다르므로 표 하나로 묶지 않고 서비스 모듈에 위임한다.
 */
function grantServiceReward(env, userId, triggerKey) {
  switch (triggerKey) {
    case "TAROT_ATTEMPT":
      return tarot.grantExtraDraw(env, userId);
    case "TAROT_STATS":
      return tarot.unlockStats(env, userId);
    case "SAJU_TOMORROW":
      return saju.unlockTomorrow(env, userId);
    case "SAJU_PERSON":
      return saju.unlockPerson(env, userId);
    case "SAJU_STATS":
      return saju.unlockStats(env, userId);
    case "MIND_ARCHIVE":
      return mind.grantArchive(env, userId);
    case "MIND_CHEMI":
      return mind.unlockChemi(env, userId);
    case "MIND_STATS":
      return mind.unlockStats(env, userId);
    default:
      throw new ApiError("BAD_PARAM", `보상 처리가 없는 트리거입니다: ${triggerKey}`, 400);
  }
}
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
  // 스위트 서비스(타로·사주·심리)는 `game` 이 없다. 광고 기록은 게임과 같은 표를
  // 쓰므로 서비스 이름을 대문자로 넣어 구분한다(ad_views.game_type 은 형식 제약이 없다).
  const gameType = spec.game ?? spec.service.toUpperCase();

  // 동일 IP 일일 광고 시청 한도 (기획서 12장)
  await assertIpAdLimit(env, ipHash);

  // 광고 플랫폼 검증 (현재는 목업 통과 / AD_MODE=live 이면 미구현 오류)
  const verification =
    spec.type === "REWARDED"
      ? await verifyRewardedCallback(env, body)
      : await verifyInterstitialImpression(env, body);

  // ── 트리거별 한도 검사 및 보상 지급 ─────────────────────────
  let reward = { kind: "UNLOCK", amount: 0 };

  if (spec.service) {
    // ── 스위트 서비스 (타로·사주·심리) ──────────────────────────
    //
    // 게임과 다른 점은 보상의 정체다. 게임은 전부 「도전 기회」인데 이쪽은 서비스마다
    // 다르다(뽑기 1회 / 열람 해제 / 내일 미리보기…). 그래서 게임 분기와 섞지 않는다.
    //
    // 상한은 Rewarded·Interstitial 둘 다 건다. 전면 광고도 하루 1회 보고 나면 당일
    // 상시 열람이므로, 매번 다시 보게 하면 이용자만 손해다.
    const viewed = await countAdViews(env, userId, gameType, triggerKey);
    if (!isTestMode(env) && spec.perDay != null && viewed >= spec.perDay) {
      throw new ApiError(
        "AD_LIMIT",
        `오늘 이 보상은 ${spec.perDay}회까지만 받을 수 있습니다. 내일 다시 시도해 주세요.`,
        429,
      );
    }
    reward = await grantServiceReward(env, userId, triggerKey);
    reward.remaining_today =
      spec.perDay != null ? Math.max(0, spec.perDay - viewed - 1) : null;
  } else if (spec.type === "REWARDED") {
    const arcade = arcadeSpec(gameType);

    if (arcade && triggerKey.endsWith("_BOOST")) {
      // 런 진행 중 보상 — 한도는 "1런당 N회" 라서 세션 기준으로 셉니다.
      // 실제 효과(목숨 +1 / 시간 +15초 / 오답 면제 / 한 쌍 공개)는 게임 spec 이 정합니다.
      reward = await applyBoost(env, userId, arcade, body.session_id);
    } else if (arcade && triggerKey.endsWith("_ATTEMPT")) {
      const cfg = ARCADE[gameType];
      const viewed = await countAdViews(env, userId, gameType, triggerKey);
      // 하루 단위 한도는 테스트 모드에서 풀립니다 (src/lib/testmode.js)
      if (!isTestMode(env) && viewed >= cfg.adAttemptsPerDay) {
        throw new ApiError(
          "AD_LIMIT",
          `오늘 이 보상은 ${cfg.adAttemptsPerDay}회까지만 받을 수 있습니다. 내일 다시 시도해 주세요.`,
          429,
        );
      }
      await grantAttempts(env, userId, gameType, 1);
      reward = {
        kind: "ATTEMPTS",
        amount: 1,
        attempts: await getAttemptState(env, userId, gameType, cfg.baseAttempts),
        remaining_today: Math.max(0, cfg.adAttemptsPerDay - viewed - 1),
      };
    } else if (triggerKey === "BASEBALL_ATTEMPT") {
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
      // 하루 단위 한도는 테스트 모드에서 풀립니다 (src/lib/testmode.js)
      if (!isTestMode(env) && spec.perDay != null && viewed >= spec.perDay) {
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
