/**
 * 🔮 숨은 이야기 → `public/tarot/tarot-story.js` (TAROT-SPEC-03 §2)
 *
 *   node scripts/gen-tarot-story.mjs [원본 JSON 경로]
 *
 * 원본은 기획 폴더의 `오늘의나/tarot/data/tarot_stories_v1.json`(기획 소유 · 린트 완료본).
 * **문구를 여기서 고치지 않는다** — 원본을 고치고 다시 돌린다.
 *
 * 따로 떼는 이유: 이야기는 금빛 카드가 생긴 사람만 본다. 해석 DB 에 붙이면 모든 첫 화면이
 * 그만큼 무거워지므로, 화면은 필요할 때 동적으로 불러온다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? resolve(here, "../../오늘의나/tarot/data/tarot_stories_v1.json"));
const out = resolve(here, "../public/tarot/tarot-story.js");

const db = JSON.parse(readFileSync(src, "utf8"));
const list = db.stories ?? [];
const errs = [];
if (list.length !== 78) errs.push(`이야기 ${list.length}줄 (78 필요)`);
list.forEach((s, i) => {
  if (s.id !== i) errs.push(`${i}번 자리의 id 가 ${s.id}`);
  if (!s.story) errs.push(`${i} 이야기 없음`);
});
if (errs.length) {
  console.error(`원본 구조 오류 ${errs.length}건 — 쓰지 않았습니다\n  ` + errs.join("\n  "));
  process.exit(1);
}

const body = `/**
 * 🔮 오늘의 타로 — 숨은 이야기 v${db.version} (${db.date}) · 78줄
 *
 * 원본: ../오늘의나/tarot/data/tarot_stories_v1.json (기획 소유 · 린트 완료본)
 * **손으로 고치지 않는다** — 원본을 고치고 \`node scripts/gen-tarot-story.mjs\` 로 다시 만든다.
 * 금빛 카드가 생긴 사람만 보므로 tarot.js 가 필요할 때 동적으로 불러온다.
 */

export const STORIES = ${JSON.stringify(list.map((s) => s.story))};
`;
writeFileSync(out, body);
console.log(`${out} — ${list.length}줄 · ${Buffer.byteLength(body)} bytes`);
