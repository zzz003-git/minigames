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

/**
 * 서버가 `day` 를 주지 못했을 때 쓰는 오늘 날짜 — **KST 기준** 'YYYY-MM-DD'.
 *
 * 서버(`src/lib/time.js` 의 `dayKey`)와 같은 기준이어야 한다. `toISOString()` 을
 * 그냥 쓰면 UTC 라, 한국 시간 00~09시에는 **전날**이 나온다. 그 시간대에 발행한
 * 회차는 「오늘 올라온 회차」에 뜨지 않고, 어제 것이 대신 오늘로 남는다.
 *
 * 브라우저의 시간대를 쓰지 않는 이유는 **읽는 사람이 어디에 있든 같은 날짜여야**
 * 하기 때문이다. 발행 시각도 순위 리셋도 KST 이므로 해외 독자에게만 하루가
 * 밀리면 안 된다.
 */
export const fallbackDay = () =>
  new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
