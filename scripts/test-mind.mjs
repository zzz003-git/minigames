/**
 * 🔬 오늘의 선택 DB v2 — 그날의 선택 고르기 · 콘텐츠 커버리지 (REQ-43)
 * ==========================================================================
 *
 *   node scripts/test-mind.mjs
 *
 * 서버가 필요 없다 — 화면이 쓰는 `public/mind/mind-pick.js` 와 `mind-db.js` 를 직접 부른다.
 *
 * 커버리지는 「콘텐츠가 다 쓰이는가」를 본다:
 *   · 실험마다 4유형이 모두 **나올 수 있는가**(어느 문항이든 그 유형 선택지가 하나는 있는가)
 *   · 문항마다 4유형이 다 있는가 — 기존 배포분 2개(thu_late · fri_choice)는 원래 그렇지 않아
 *     **경고로만** 센다(REQ-43 「기존 14개 수정 금지」)
 *   · typeMeet 가 실험·유형마다 있는가
 *   · 2년 회전 안에 91개가 모두 나오는가 · 계절 항목은 그달에만 나오는가
 * ==========================================================================
 */

import { readFileSync, readdirSync } from "node:fs";
import { MIND_INDEX } from "../public/mind/mind-index.js";
import { MIND_COMMON } from "../public/mind/mind-common.js";
import { expOfDay } from "../public/mind/mind-pick.js";

// 분할 산출물을 직접 읽는다(REQ-47) — 화면이 받는 바로 그 파일들이다
const EXP_DIR = new URL("../public/mind/exp/", import.meta.url);
const MIND_DB = {
  experiments: MIND_INDEX.experiments.map((e) => JSON.parse(readFileSync(new URL(`${e.id}.json`, EXP_DIR), "utf8"))),
};
MIND_DB.typeMeet = Object.fromEntries(MIND_DB.experiments.map((e) => [e.id, e.typeMeet]));

let pass = 0;
const failures = [];
const warnings = [];
function check(name, cond, extra = "") {
  if (cond) pass++;
  else failures.push(name);
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
}

const dowOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
const pick = (day) => expOfDay(MIND_INDEX.experiments, dowOf(day), day);

console.log("\n[1] 날짜 고정 회전 (요청서 5번)");
for (const [day, want] of [
  ["2026-12-02", "f_first_snow"],
  ["2026-12-06", "f_year_end"],
  ["2027-04-03", "f_cherry_end"],
  ["2027-07-07", "f_rainy_week"],
]) {
  const got = pick(day).id;
  check(`${day} → ${want}`, got === want, `got=${got}`);
}
{
  const e = pick("2026-12-09");
  check("2026-12-09(수) → months 없는 항목", !e.months?.length, `got=${e.id}`);
}

console.log("\n[2] 회전 — 2년(730일) · 도감용 목록으로 고른다(화면과 같음)");
{
  const start = Date.UTC(2026, 10, 1);
  const seen = new Map();
  let wrongMonth = 0;
  let wrongDow = 0;
  for (let i = 0; i < 730; i++) {
    const day = new Date(start + i * 864e5).toISOString().slice(0, 10);
    const e = pick(day);
    seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    const m = Number(day.slice(5, 7));
    if (e.months?.length && !e.months.includes(m)) wrongMonth++;
    if (e.dow !== dowOf(day)) wrongDow++;
  }
  check("182개 모두 등장", seen.size === MIND_INDEX.experiments.length, `${seen.size}/${MIND_INDEX.experiments.length}`);
  check("계절 항목은 그달에만", wrongMonth === 0, `위반 ${wrongMonth}`);
  check("요일 주제와 날짜 요일이 같다", wrongDow === 0, `위반 ${wrongDow}`);
}

console.log("\n[3] 콘텐츠 커버리지");
{
  const ex = MIND_DB.experiments;
  check("선택 182개 · 요일마다 26개", ex.length === 182 && [0, 1, 2, 3, 4, 5, 6].every((d) => ex.filter((e) => e.dow === d).length === 26));
  check("계절 항목 9개", ex.filter((e) => e.months?.length).length === 9);
  check("실험 파일 = 목록 (182)", readdirSync(EXP_DIR).filter((f) => f.endsWith(".json")).length === MIND_INDEX.experiments.length);
  check("목록과 실험 파일의 제목·유형 이름이 같다",
    MIND_INDEX.experiments.every((m, i) => m.title === ex[i].title && m.types.every((t, k) => t.n === ex[i].types[k].n && t.g === ex[i].types[k].g)));
  check("공통 파일에 실험 본문 없음 · 축 8", !("experiments" in MIND_COMMON) && !("typeMeet" in MIND_COMMON) && MIND_COMMON.axes.length === 8);

  let unreachable = 0;
  let missingMeet = 0;
  for (const e of ex) {
    const tys = new Set(e.q.flatMap((q) => q.opts.map((o) => o.ty)));
    for (let t = 0; t < 4; t++) if (!tys.has(t)) { unreachable++; console.log(`    ${e.id} 유형 ${t} 나올 수 없음`); }
    const meet = MIND_DB.typeMeet[e.id];
    if (!Array.isArray(meet) || meet.length !== 4 || meet.some((s) => !s)) { missingMeet++; console.log(`    ${e.id} typeMeet ${meet?.length}`); }
    e.q.forEach((q, qi) => {
      const qt = new Set(q.opts.map((o) => o.ty));
      if (qt.size < 4) warnings.push(`${e.id} Q${qi + 1} 유형 ${[...qt].sort().join(",")}만`);
    });
  }
  check("실험마다 4유형 모두 나올 수 있음", unreachable === 0, `미도달 ${unreachable}`);
  check("typeMeet 182 × 4", missingMeet === 0 && Object.keys(MIND_DB.typeMeet).length === 182, `누락 ${missingMeet}`);
  const legacyOnly = warnings.every((w) => /^(thu_late|fri_choice) /.test(w));
  check("문항별 4유형 미충족은 기존 배포분뿐(경고)", legacyOnly, warnings.join(" / "));
}

if (warnings.length) console.log(`\n경고 ${warnings.length}건 (기존 배포분 — 수정 금지 항목):\n  ` + warnings.join("\n  "));
console.log(`\n${pass} 통과 · ${failures.length} 실패`);
if (failures.length) {
  console.log("실패:\n  " + failures.join("\n  "));
  process.exit(1);
}
