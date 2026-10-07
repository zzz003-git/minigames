/**
 * 너를 맞혀볼게 v2 화면 조각 — 순수 함수 확인 (REQ-65 묶음 2)
 *   node scripts/test-pair-ui.mjs        (서버 불필요)
 */
import { REL, arcPath, dialInner, chemiLine, diffLine } from "../public/pair/pair-ui.js";
import { MIND_COMMON as DB } from "../public/mind/mind-common.js";

let fail = 0;
const check = (name, cond, got) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "  " + JSON.stringify(got)}`);
};

check("지수 호 67% = 시안 경로", arcPath(67) === "M 0.0 -70.0 A 70 70 0 1 1 -61.3 33.7", arcPath(67));
check("0% 는 호 없음 · 100% 는 원 한 바퀴", arcPath(0) === "" && arcPath(100).split(" A ").length === 3, arcPath(100));
check("진행 원판 1/3 = 첫 칸만 켜짐", (dialInner(0).match(/#FFD24A/g) ?? []).length === 1 && (dialInner(2).match(/#FFD24A/g) ?? []).length === 3);
check("조사 — 연인이·친구가·가족이·동료가", ["lover", "friend", "family", "coworker"].map((k) => REL[k].iga).join() === "연인이,친구가,가족이,동료가");
check("케미 한 줄 = 양쪽 같은 규칙(밴드·pct % 길이)", chemiLine(DB, 67) === DB.chemiComments.high[67 % DB.chemiComments.high.length]);
const used = new Set(Array.from({ length: 12 * 101 }, (_, n) => diffLine(DB, n % 12, Math.floor(n / 12))));
check("다른 답 한 줄 — 「모험가·신중」(15·16) 은 안 나옴", !used.has(DB.diffFlavor[15]) && !used.has(DB.diffFlavor[16]) && used.size > 5, used.size);

console.log(fail ? `\n${fail} 실패` : "\n전부 통과");
process.exit(fail ? 1 : 0);
