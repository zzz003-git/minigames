/**
 * 허브 v2 판정 — 서비스 순서 · 14세 미만 기억 · +15P 약속 규칙 (REQ-63 묶음 5)
 *   node scripts/test-hub.mjs        (서버 불필요)
 */
let store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null };
const { normalize, triplePromiseOk } = await import("../public/shared/todaysection.js");

let fail = 0;
const check = (name, cond, got) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "  " + JSON.stringify(got)}`);
};
const D = (done, extra = {}) => ({
  day: "2026-10-07",
  services: ["tarot", "saju", "mind"].map((key) => ({ key, ready: true, done: done.includes(key) })), // 서버 순서
  saju_registered: false,
  triple_points: 15,
  ...extra,
});

let n = normalize(D([]));
check("화면 순서 = 타로 · 선택 · 사주", n.services.map((s) => s.key).join() === "tarot,mind,saju", n.services);
check("0/3 → +15P 약속 가능", triplePromiseOk(n));
check("남은 하나 = 사주 · 미등록 → +15P 숨김", !triplePromiseOk(normalize(D(["tarot", "mind"]))));
check("남은 하나 = 사주 · 등록자 → +15P", triplePromiseOk(normalize(D(["tarot", "mind"], { saju_registered: true }))));
check("남은 하나 = 선택 → +15P", triplePromiseOk(normalize(D(["tarot", "saju"]))));
store.mg_saju_too_young = "1";
n = normalize(D(["tarot"]));
const saju = n.services.find((s) => s.key === "saju");
check("14세 미만 기억 → 사주 이용 불가 · 도달 2칸", saju.ready === false && saju.too_young && n.reachable === 2, n);
check("14세 미만 기억 → +15P 약속 없음", !triplePromiseOk(n));

console.log(fail ? `\n${fail} 실패` : "\n전부 통과");
process.exit(fail ? 1 : 0);
