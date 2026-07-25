/**
 * 클라이언트 신고 시간의 타당성 검증
 *
 * 설계 배경 (기획 확정 사항):
 *   실제 측정은 브라우저에서 performance.now() 로 합니다. 이 시계는 단조 증가(monotonic)라
 *   사용자가 시스템 시계를 바꿔도 영향을 받지 않고, 네트워크 지연이 기록에 섞이지 않습니다.
 *   서버는 세션 시작/종료 시각을 기록해 "그 시간 안에 물리적으로 가능한 값인가" 를 검증합니다.
 *
 * 검증 논리:
 *   서버 관측 시간창 = (종료 요청 도착 시각) - (시작 응답 시각)
 *   이 시간창은 항상 [네트워크 왕복 + 사용자 대기 + 실제 플레이 시간] 이므로
 *   클라이언트가 신고한 경과 시간보다 반드시 크거나 같아야 합니다.
 *   신고값이 시간창을 넘으면 값을 부풀린 것이므로 거부합니다.
 *
 * 한계 (정직하게 기록):
 *   측정을 클라이언트가 하는 구조에서는 "실제로 3.5초쯤 기다린 뒤 3.470초라고 신고하는"
 *   미세 조작을 서버가 완전히 구분할 수 없습니다. 시간창 검증으로 그 폭을 좁히고,
 *   사람이 도달하기 어려운 정확도는 suspect 로 표시해 통계에서 제외하는 방식으로 대응합니다.
 *   완전 차단이 필요하면 입력 이벤트 타임라인 전송 후 서버 재현 검증이 필요합니다.
 */

import { ApiError, requireInt } from "./http.js";

/**
 * @returns {{ serverWindowMs: number, suspect: boolean, reasons: string[] }}
 */
export function checkElapsed({
  elapsedMs,
  startTs,
  endTs,
  minMs,
  maxMs,
  toleranceMs = 500,
  maxIdleMs = 20000,
}) {
  requireInt(elapsedMs, "elapsed_ms", minMs, maxMs);

  const serverWindowMs = endTs - startTs;
  const reasons = [];

  if (elapsedMs > serverWindowMs + toleranceMs) {
    throw new ApiError(
      "TIME_TAMPERED",
      "기록이 서버가 관측한 시간 범위를 벗어났습니다. 다시 시도해 주세요.",
      400,
    );
  }

  if (serverWindowMs - elapsedMs > maxIdleMs) {
    reasons.push("IDLE_TOO_LONG");
  }

  return { serverWindowMs, suspect: reasons.length > 0, reasons };
}

/** 숫자 문자열인지 확인 (숫자패드 입력값 검증) */
export function requireDigits(value, name, { length, unique = false } = {}) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new ApiError("BAD_PARAM", `${name} 은 숫자로만 이루어져야 합니다.`);
  }
  if (length != null && value.length !== length) {
    throw new ApiError("BAD_PARAM", `${name} 은 ${length}자리여야 합니다.`);
  }
  if (unique && new Set(value).size !== value.length) {
    throw new ApiError("DUPLICATE_DIGIT", "같은 숫자를 중복해서 쓸 수 없습니다.");
  }
  return value;
}
