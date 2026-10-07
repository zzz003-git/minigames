/**
 * 허브 v2 판정 — 서비스 순서 · 14세 미만 기억 · +15P 약속 규칙 (REQ-63 묶음 5)
 *   node scripts/test-hub.mjs        (서버 불필요)
 */
let store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null };
const { normalize, triplePromiseOk, homeHeadLine, arrivalInfo } = await import("../public/shared/todaysection.js");

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
check("「전체」 머리 — 14세 미만이면 0/3 에도 약속 없음", homeHeadLine({ ...n, progress: 0, triple: false, points: { today: 0 } }) === null);
store = {};

// ── 「전체」 축소판 머리 한 줄 (REQ-65 묶음 3 · home 최종 수정 #1·#4) ──
const H = (done, today, extra) => homeHeadLine({ ...normalize(D(done, extra)), progress: done.length, triple: done.length === 3, points: { today } });
check("0/3 → 「셋 다 하면 +15P」", JSON.stringify(H([], 0)) === '{"kind":"promise","value":15}', H([], 0));
check("1/3 · 8P → 오늘 받은 포인트", JSON.stringify(H(["tarot"], 8)) === '{"kind":"points","value":8}', H(["tarot"], 8));
check("2/3 남은 사주 · 미등록 · 0P → 아무 줄도 없음(사주 지목 +15P 금지)", H(["tarot", "mind"], 0) === null, H(["tarot", "mind"], 0));
check("3/3 → 포인트만(약속 없음)", H(["tarot", "mind", "saju"], 39).kind === "points");

// ── 결과 도착 한 줄 (REQ-65 F2) ──
check("도착 없음 → null", arrivalInfo({ pair_unseen: 0, pair_latest: null }) === null);
const a1 = arrivalInfo({ pair_unseen: 1, pair_latest: { token: "aB3", relation: "friend", pct: 67 } });
check("도착 1건 → 「친구가 답했어요 · 서로 알기 67%」 · view 링크", a1.line === "친구가 답했어요 · 서로 알기 67%" && a1.href === "/pair/?view=aB3", a1);
const a2 = arrivalInfo({ pair_unseen: 2, pair_latest: { token: "x", relation: "lover", pct: 33 } });
check("도착 여러 건 → 최근 1건 문구 · 목록 링크", a2.line.startsWith("연인이 ") && a2.href === "/pair/", a2);

console.log(fail ? `\n${fail} 실패` : "\n전부 통과");
process.exit(fail ? 1 : 0);
