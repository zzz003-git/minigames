/**
 * 익명 사용자 식별
 *
 * 기획서에는 로그인 절차가 없고 user_id 만 존재하므로, 브라우저마다 익명 ID를 발급합니다.
 * 쿠키 값은 HMAC으로 서명되어 있어 임의의 user_id 로 위조할 수 없습니다.
 * (다른 사람의 기록을 덮어쓰거나 남의 도전 기회를 소진시키는 것을 막는 목적)
 */

import { randomId, sign, verify } from "./crypto.js";

const COOKIE = "mg_uid";
const MAX_AGE_SEC = 60 * 60 * 24 * 365;

function readCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/**
 * @returns {{ userId: string, setCookie: string | null }}
 *   setCookie 가 있으면 응답 헤더에 반드시 실어 보내야 합니다.
 */
export async function resolveUser(request, env) {
  const raw = readCookie(request, COOKIE);

  if (raw) {
    const idx = raw.lastIndexOf(".");
    if (idx > 0) {
      const id = raw.slice(0, idx);
      const sig = raw.slice(idx + 1);
      if (/^[0-9a-f-]{36}$/.test(id) && (await verify(env, id, sig))) {
        return { userId: id, setCookie: null };
      }
    }
    // 서명이 깨졌거나 형식이 다르면 새로 발급합니다.
  }

  const id = randomId();
  const sig = await sign(env, id);

  // Secure 는 https 일 때만 붙입니다. 로컬 개발(http://localhost)에서도 쿠키가 유지되어야
  // 세션 소유자 검증이 정상 동작하기 때문입니다. 운영은 항상 https 이므로 그대로 적용됩니다.
  const isHttps = new URL(request.url).protocol === "https:";

  const cookie = [
    `${COOKIE}=${id}.${sig}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SEC}`,
    "HttpOnly",
    isHttps ? "Secure" : null,
    "SameSite=Lax",
  ]
    .filter(Boolean)
    .join("; ");

  return { userId: id, setCookie: cookie };
}
