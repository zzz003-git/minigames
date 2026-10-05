/**
 * 🔮 3단계 콘텐츠 → `public/tarot/tarot-stage3.js` (TAROT-SPEC-04)
 *
 *   node scripts/gen-tarot-stage3.mjs [stage3 JSON] [질문 JSON]
 *
 * 원본은 기획 폴더(`오늘의나/tarot/data/`)의 `tarot_stage3_v1.json`(키워드 78×6 · 올해의 카드 ·
 * 이달의 카드)과 `tarot_month_questions_v1.json`(질문 36). **문구를 여기서 고치지 않는다.**
 *
 * 따로 떼는 이유: 해석 DB 첫 화면을 무겁게 하지 않으려고. 화면은 결과를 그릴 때 동적으로 받는다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const data = resolve(here, "../../오늘의나/tarot/data");
const s3 = JSON.parse(readFileSync(resolve(process.argv[2] ?? `${data}/tarot_stage3_v1.json`), "utf8"));
const qs = JSON.parse(readFileSync(resolve(process.argv[3] ?? `${data}/tarot_month_questions_v1.json`), "utf8"));
const out = resolve(here, "../public/tarot/tarot-stage3.js");

const FOCUS = ["day", "work", "love", "money"];
const errs = [];
if (s3.cards?.length !== 78) errs.push(`카드 ${s3.cards?.length}장 (78 필요)`);
s3.cards?.forEach((c, i) => {
  if (c.id !== i) errs.push(`${i}번 자리의 id 가 ${c.id}`);
  if (c.keywords?.length !== 6) errs.push(`${i} 키워드 ${c.keywords?.length}개`);
  if (!c.year || !c.month) errs.push(`${i} 올해/이달 문장 없음`);
});
if (qs.questions?.length !== 36) errs.push(`질문 ${qs.questions?.length}개 (36 필요)`);
qs.questions?.forEach((q, i) => {
  if (q.n !== i + 1) errs.push(`질문 ${i} 번호 ${q.n}`);
  if (!FOCUS.includes(q.focus)) errs.push(`질문 ${q.n} 포커스 ${q.focus}`);
});
if (errs.length) {
  console.error(`원본 구조 오류 ${errs.length}건 — 쓰지 않았습니다\n  ` + errs.join("\n  "));
  process.exit(1);
}

const body = `/**
 * 🔮 오늘의 타로 3단계 콘텐츠 — v${s3.version} (${s3.date}) · 질문 은행 v${qs.version}
 *
 * 원본: ../오늘의나/tarot/data/tarot_stage3_v1.json · tarot_month_questions_v1.json (기획 소유)
 * **손으로 고치지 않는다** — 원본을 고치고 \`node scripts/gen-tarot-stage3.mjs\` 로 다시 만든다.
 *
 *   KEYWORDS[cardId]  한 마디 키워드 6개 (§1) — 순번이 곧 서버의 kw 값이다
 *   YEAR[cardId]      올해의 카드 문장 (§3)
 *   MONTH[cardId]     이달의 카드 문장 (§4)
 *   QUESTIONS[n-1]    이달의 질문 {q, focus} (§2)
 */

export const KEYWORDS = ${JSON.stringify(s3.cards.map((c) => c.keywords))};
export const YEAR = ${JSON.stringify(s3.cards.map((c) => c.year))};
export const MONTH = ${JSON.stringify(s3.cards.map((c) => c.month))};
export const QUESTIONS = ${JSON.stringify(qs.questions.map((q) => ({ q: q.q, focus: q.focus })))};
`;
writeFileSync(out, body);
console.log(`${out} — ${Buffer.byteLength(body)} bytes`);
