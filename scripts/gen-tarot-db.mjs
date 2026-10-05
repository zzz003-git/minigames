/**
 * 🔮 타로 해석 DB → `public/tarot/tarot-db.js`
 *
 *   node scripts/gen-tarot-db.mjs [원본 JSON 경로]
 *
 * 원본은 기획 폴더의 `오늘의나/tarot/data/tarot_db_v2.json` 이다(기획 소유). 화면 모듈은
 * 손으로 고치지 않는다 — 원본을 고치고 이 스크립트를 다시 돌린다.
 *
 * 구조가 어긋나면 쓰지 않고 멈춘다. 78장 중 한 장이라도 포커스·변형이 빠지면 그 카드를
 * 뽑은 사람의 결과 화면이 빈칸이 되는데, 그건 배포 뒤에야 드러난다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? resolve(here, "../../오늘의나/tarot/data/tarot_db_v2.json"));
const out = resolve(here, "../public/tarot/tarot-db.js");

const db = JSON.parse(readFileSync(src, "utf8"));
const FOCUS = ["day", "work", "love", "money"];
const SUITS = ["wands", "cups", "swords", "pentacles"];
const errs = [];

if (db.cards?.length !== 78) errs.push(`카드 ${db.cards?.length}장 (78 필요)`);
db.cards?.forEach((c, i) => {
  if (c.id !== i) errs.push(`${i}번 자리의 id 가 ${c.id}`);
  if (!c.name || !c.glyph) errs.push(`${i} 이름·글리프 없음`);
  if (c.advice?.length !== 2) errs.push(`${i} 조언 ${c.advice?.length}개`);
  for (const f of FOCUS) if (c.interp?.[f]?.length !== 3) errs.push(`${i} ${f} 변형 ${c.interp?.[f]?.length}개`);
});
const glyphs = new Set(db.cards?.map((c) => c.glyph));
if (glyphs.size !== db.cards?.length) errs.push(`글리프 중복 ${db.cards.length - glyphs.size}건`);
for (const s of SUITS) if (db.crossSuit?.[s]?.length !== 10) errs.push(`crossSuit.${s} ${db.crossSuit?.[s]?.length}줄`);
if (!(db.advicePool?.length > 0) || !(db.luckyItems?.length > 0)) errs.push("조언 풀·행운 아이템 없음");

if (errs.length) {
  console.error(`원본 구조 오류 ${errs.length}건 — 쓰지 않았습니다\n  ` + errs.join("\n  "));
  process.exit(1);
}

// 교차 수트 문장은 허브(`cross-db.js`)가 쓴다 — 타로 화면에는 싣지 않는다
const { crossSuit, ...screen } = db;
void crossSuit;

const body = `/**
 * 🔮 오늘의 타로 — 해석 DB v${db.version} (${db.date})
 *
 * 원본: ../오늘의나/tarot/data/tarot_db_v2.json (기획 소유 · 린트 완료본)
 * **손으로 고치지 않는다** — 원본을 고치고 \`node scripts/gen-tarot-db.mjs\` 로 다시 만든다.
 *
 * 카드 78장(메이저 0~21 · 완드 22~35 · 컵 36~49 · 소드 50~63 · 펜타클 64~77)
 * × 포커스 4 × 변형 3 + 카드 조언 2 + 조언풀 ${db.advicePool.length} + 행운아이템 ${db.luckyItems.length}.
 * 모듈로 두는 이유는 기획서 5절의 「빌드 시 정적 포함(추가 fetch 없음)」 때문이다.
 */

export const TAROT_DB = ${JSON.stringify(screen)};
`;

writeFileSync(out, body);
console.log(`${out} — ${db.cards.length}장 · ${Buffer.byteLength(body)} bytes`);
