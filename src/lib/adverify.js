/**
 * 광고 시청 검증 — 연동 대기 스텁 (STUB)
 * ==========================================================================
 *
 * 기획서 12장 요구사항:
 *   "광고 시청 완료 콜백(Callback)은 광고 플랫폼 서버에서 직접 자사 서버로 전달
 *    — 클라이언트 우회 불가"
 *
 * 이 요구사항은 광고 플랫폼(AdMob/쿠팡파트너스 등)의 SSV(Server-Side Verification)
 * 스펙과 서명 검증 키가 있어야 구현할 수 있습니다. 스펙을 받기 전까지는
 * 아래 함수들이 "목업 통과" 로 동작하고, 실제 연동 시에는 이 파일만 채우면 됩니다.
 *
 * ── 연동할 때 해야 하는 일 ────────────────────────────────────────────────
 *   1. env.AD_MODE 를 "live" 로 설정 (wrangler.jsonc vars 또는 시크릿)
 *   2. verifyRewardedCallback 안의 TODO 를 실제 검증 로직으로 교체
 *      - 광고 플랫폼이 보내는 서명(보통 ECDSA/RSA) 검증
 *      - transaction_id 중복 사용 차단 (재사용 공격 방지)
 *      - reward_amount / reward_item 이 우리가 기대한 값인지 확인
 *   3. 광고 플랫폼 콜백 수신용 라우트를 추가 (예: POST /ad/callback)
 *      → 클라이언트가 아니라 광고 서버가 호출하는 엔드포인트
 *
 * AD_MODE 가 "live" 인데 구현이 비어 있으면 조용히 통과시키지 않고
 * 명시적으로 실패시킵니다. 미구현 상태로 실서비스에 나가 보상이 무료로
 * 지급되는 상황을 막기 위한 안전장치입니다.
 * ==========================================================================
 */

import { ApiError } from "./http.js";

const isLive = (env) => env.AD_MODE === "live";

/**
 * 보상형(Rewarded) 광고 시청 완료 검증.
 *
 * @param {object} env
 * @param {object} payload  클라이언트가 보낸 값. 목업 모드에서만 신뢰합니다.
 *   실연동 시에는 이 값 대신 광고 플랫폼 콜백으로 받은 데이터를 검증해야 합니다.
 * @returns {Promise<{ verified: boolean, mock: boolean, transactionId: string|null }>}
 */
export async function verifyRewardedCallback(env, payload) {
  if (isLive(env)) {
    // TODO(광고 연동): 광고 플랫폼 SSV 서명 검증으로 교체
    //   const { signature, transaction_id, user_id, reward_amount } = payload;
    //   1) 플랫폼 공개키로 signature 검증
    //   2) transaction_id 를 D1 에 저장하고 이미 있으면 거부 (재사용 차단)
    //   3) user_id 가 현재 세션 사용자와 일치하는지 확인
    throw new ApiError(
      "AD_VERIFY_NOT_IMPLEMENTED",
      "광고 서버 검증이 아직 구현되지 않았습니다. 광고 연동 스펙이 필요합니다.",
      501,
    );
  }

  return { verified: false, mock: true, transactionId: payload?.transaction_id ?? null };
}

/**
 * 전면(Interstitial) 광고 노출 검증.
 * 보상형과 달리 지급되는 재화가 없어 위험도가 낮지만, 통계·랭킹 열람 잠금을
 * 여는 열쇠이므로 같은 형태로 스텁을 둡니다.
 */
export async function verifyInterstitialImpression(env, payload) {
  if (isLive(env)) {
    // TODO(광고 연동): 노출 검증(impression callback) 로직으로 교체
    throw new ApiError(
      "AD_VERIFY_NOT_IMPLEMENTED",
      "광고 서버 검증이 아직 구현되지 않았습니다. 광고 연동 스펙이 필요합니다.",
      501,
    );
  }

  return { verified: false, mock: true, transactionId: payload?.transaction_id ?? null };
}

/** 현재 광고 동작 모드를 클라이언트에 알려 줍니다. (목업 배너 표시 여부 판단용) */
export const adMode = (env) => (isLive(env) ? "live" : "mock");
