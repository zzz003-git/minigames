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

/**
 * 응답 봉투(envelope)가 쓰는 예약 필드.
 * 게임 페이로드가 같은 이름을 쓰면 봉투의 의미가 덮여 써집니다.
 */
const RESERVED_KEYS = ["ok", "code", "message"];

/**
 * 성공 응답.
 *
 * `ok: true` 를 **뒤에** 둡니다. 앞에 두면 페이로드에 같은 이름의 필드가 있을 때
 * 봉투의 성공 여부가 덮여 써집니다 — 클라이언트는 `data.ok === false` 를 요청 실패로
 * 읽으므로, 게임이 "이번 판정은 틀림" 을 `ok` 라는 이름으로 담는 순간 정상 응답이
 * 전부 오류로 처리됩니다. (실제로 겪은 버그입니다 — 라운드 판정 필드를 `correct` 로
 * 이름을 바꾼 이유가 이것입니다)
 *
 * 순서만으로도 봉투는 지켜지지만, 이름이 겹친 페이로드는 그 자체로 설계 실수이므로
 * 관측 로그에 남깁니다. 조용히 지나가면 다음 게임에서 같은 혼동이 반복됩니다.
 */
export const ok = (data = {}, init) => {
  const clash = RESERVED_KEYS.filter((k) => Object.hasOwn(data, k));
  if (clash.length > 0) {
    console.error(
      `RESERVED_FIELD_CLASH: 응답 페이로드가 봉투 예약 필드(${clash.join(", ")})를 사용했습니다. ` +
        `다른 이름으로 바꿔 주세요 (예: ok → correct).`,
    );
  }
  return json({ ...data, ok: true }, init);
};

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
