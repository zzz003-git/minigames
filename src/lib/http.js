/** JSON 응답 · 에러 처리 유틸 */

export class ApiError extends Error {
  /**
   * @param {string} code    클라이언트가 분기 처리할 기계용 코드 (예: 'AD_REQUIRED')
   * @param {string} message 사용자에게 보여도 되는 한국어 메시지
   * @param {number} status  HTTP 상태 코드
   */
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export const ok = (data = {}, init) => json({ ok: true, ...data }, init);

export const fail = (code, message, status = 400) =>
  json({ ok: false, code, message }, { status });

/** 본문 JSON 파싱. 비정상적으로 큰 본문은 거부합니다. */
export async function readJson(request, maxBytes = 64 * 1024) {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new ApiError("BODY_TOO_LARGE", "요청 본문이 너무 큽니다.", 413);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError("BAD_JSON", "요청 본문이 올바른 JSON이 아닙니다.");
  }
}

/** 값이 정수이고 지정 범위 안인지 확인합니다. */
export function requireInt(value, name, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ApiError("BAD_PARAM", `${name} 값이 정수가 아닙니다.`);
  }
  if (value < min || value > max) {
    throw new ApiError("BAD_PARAM", `${name} 값이 허용 범위(${min}~${max})를 벗어났습니다.`);
  }
  return value;
}

export function requireOneOf(value, name, allowed) {
  if (!allowed.includes(value)) {
    throw new ApiError("BAD_PARAM", `${name} 값이 올바르지 않습니다. (${allowed.join(", ")})`);
  }
  return value;
}
