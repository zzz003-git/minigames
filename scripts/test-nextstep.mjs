/**
 * 다음 안내 바 문구 판정 — NEXTBAR.md 상태표 6행 (REQ-63 묶음 1)
 *   node scripts/test-nextstep.mjs        (서버 불필요)
 */
import { decide } from "../public/shared/nextstep.js";

let fail = 0;
const check = (name, cond, got) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "  " + JSON.stringify(got)}`);
};
const S = (done, extra = {}) => ({
  tarot: { done: done.includes("tarot") },
  mind: { done: done.includes("mind") },
  saju: { done: done.includes("saju") },
  triple_points: 15,
  saju_registered: true,
  ready: { tarot: true, mind: true, saju: true },
  ...extra,
});

let d = decide(S(["tarot"]), false);
check("남은 2 → 다음은 선택 · +15P", d.b === "2개 남았어요 · 다음은 오늘의 선택" && d.s === "심리테스트 4문항 · 셋 다 하면 +15P" && d.href === "/mind/", d);
d = decide(S(["saju"]), false);
check("순서를 어겨도 남은 것 중 추천순 첫째(타로)", d.href === "/tarot/", d);
d = decide(S(["tarot", "saju"]), false);
check("남은 1(선택) → +15P", d.b === "하나만 더! 다음은 오늘의 선택" && d.s === "셋 다 하면 +15P", d);
d = decide(S(["tarot", "mind"], { saju_registered: false }), false);
check("남은 1 = 사주 · 미등록 → 포인트 문구 없음", d.b === "하나만 더! 다음은 오늘의 사주" && d.s === "생일로 보는 오늘 운세" && !/P/.test(d.s), d);
d = decide(S(["tarot", "mind"]), false);
check("남은 1 = 사주 · 등록자 → +15P", d.s === "셋 다 하면 +15P" && d.href === "/saju/", d);
d = decide(S(["tarot", "mind", "saju"]), true);
check("방금 3/3", d.b === "셋 다 했어요! +15P 받았어요" && d.href === "/today/?from=triple", d);
d = decide(S(["tarot", "mind", "saju"]), false);
check("이미 3/3", d.b === "오늘의 나 카드 보기" && d.href === "/today/", d);
d = decide(S(["tarot", "mind"], { ready: { tarot: true, mind: true, saju: false } }), false);
check("남은 것이 준비 중뿐", d.b === "오늘 할 수 있는 건 다 했어요" && d.href === "/today/", d);
d = decide(S(["tarot"], { triple_points: 20 }), false);
check("금액은 서버 값", d.s.endsWith("+20P"), d);

console.log(fail ? `\n${fail} 실패` : "\n전부 통과");
process.exit(fail ? 1 : 0);
