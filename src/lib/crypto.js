/**
 * 암호화 · 서명 · 난수 유틸
 *
 * - 게임 정답/목표값은 AES-256-GCM으로 암호화해서 D1에 저장합니다 (기획서 12장 보안 명세).
 *   DB 덤프가 유출되어도 진행 중인 게임의 정답을 알 수 없습니다.
 * - 익명 user_id 쿠키는 HMAC-SHA256으로 서명해서 위조를 막습니다.
 * - 게임 난수는 Math.random이 아니라 crypto.getRandomValues를 씁니다.
 *   (기획서에는 Math.random으로 적혀 있으나, 예측 가능한 난수는 어뷰징 경로가 되므로 상향 적용)
 */

import { ApiError } from "./http.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── base64 ────────────────────────────────────────────────────
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── 키 관리 ───────────────────────────────────────────────────
function secretOf(env) {
  const s = env.SESSION_SECRET;
  if (!s) {
    // 배포 환경에서는 반드시 설정되어야 합니다:
    //   npx wrangler secret put SESSION_SECRET
    throw new ApiError(
      "CONFIG_MISSING",
      "서버 설정(SESSION_SECRET)이 누락되었습니다. 관리자에게 문의해 주세요.",
      500,
    );
  }
  return s;
}

const aesKeyCache = new WeakMap();

async function aesKey(env) {
  if (aesKeyCache.has(env)) return aesKeyCache.get(env);
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secretOf(env) + ":aes"));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  aesKeyCache.set(env, key);
  return key;
}

const hmacKeyCache = new WeakMap();

async function hmacKey(env) {
  if (hmacKeyCache.has(env)) return hmacKeyCache.get(env);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secretOf(env) + ":hmac"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  hmacKeyCache.set(env, key);
  return key;
}

// ── AES-256-GCM ───────────────────────────────────────────────

/** 객체를 암호화해 문자열 한 덩어리로 만듭니다. (iv 12바이트 + 암호문) */
export async function encryptJSON(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(env);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return bytesToB64(packed);
}

/** encryptJSON 으로 만든 문자열을 원래 객체로 복원합니다. */
export async function decryptJSON(env, packedB64) {
  const packed = b64ToBytes(packedB64);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const key = await aesKey(env);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}

// ── HMAC 서명 ─────────────────────────────────────────────────

export async function sign(env, message) {
  const key = await hmacKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return b64url(bytesToB64(sig));
}

/** 타이밍 공격을 피하려고 문자열 비교 대신 crypto.subtle.verify 를 씁니다. */
export async function verify(env, message, signature) {
  const expected = await sign(env, message);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── 해시 ──────────────────────────────────────────────────────

/**
 * SHA-256 16진 문자열.
 *
 * 너의스토리 원문의 지문입니다. 창작기록서는 원문을 인용하지 않고 **이 해시만**
 * 적습니다 — 삭제 요청 시 원문을 파기해야 하는데 기록서에 전문이 남아 있으면
 * 파기가 성립하지 않기 때문입니다 (검토 B-3).
 *
 * `hashIp` 와 달리 비밀값을 섞지 않습니다. 같은 원문이면 PC 파이프라인이 계산한
 * 값과 같아야 대조가 되기 때문입니다.
 */
export async function sha256Hex(text) {
  const raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** IP는 원문 대신 해시로 저장합니다 (레이트리밋 목적이라 원문이 필요 없음). */
export async function hashIp(env, ip) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secretOf(env) + ":ip:" + (ip ?? "")));
  return b64url(bytesToB64(new Uint8Array(raw))).slice(0, 22);
}

// ── 난수 ──────────────────────────────────────────────────────

export const randomId = () => crypto.randomUUID();

/** min 이상 max 이하 정수. 나머지 편향을 없애려고 거부 표집을 씁니다. */
export function randomInt(min, max) {
  const range = max - min + 1;
  if (range <= 0) throw new Error("randomInt: 범위가 잘못되었습니다.");
  const limit = Math.floor(0xffffffff / range) * range;
  const buf = new Uint32Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return min + (v % range);
}

/** 0~9 중 중복 없는 n자리 숫자 문자열 (숫자야구 정답 생성) */
export function randomUniqueDigits(n) {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).join("");
}

/** 중복 허용 n자리 숫자 문자열 (기억력 게임 문제 생성) */
export function randomDigits(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += randomInt(0, 9);
  return out;
}
