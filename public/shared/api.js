/** 서버 API 호출 래퍼 — 모든 게임이 공용으로 씁니다. */

export class ApiFail extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, { body, params } = {}) {
  const url = new URL(path, location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiFail("NETWORK", "네트워크 연결을 확인해 주세요.", 0);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiFail("BAD_RESPONSE", "서버 응답을 해석할 수 없습니다.", res.status);
  }

  if (!res.ok || data.ok === false) {
    throw new ApiFail(data.code ?? "UNKNOWN", data.message ?? "요청을 처리할 수 없습니다.", res.status);
  }

  return data;
}

export const apiGet = (path, params) => request("GET", path, { params });
export const apiPost = (path, body) => request("POST", path, { body });
