/**
 * 🔬 오늘의 선택 DB → `public/mind/mind-db.js` + 허브 인덱스(`public/shared/hub-index.js` 의 mind 칸)
 *
 *   node scripts/gen-mind-db.mjs [원본 JSON 경로]
 *
 * 원본(단일 출처)은 기획 폴더의 `오늘의나/mind/data/mind_db_v2.json`(기획 소유 · 린트 완료본).
 * 화면 모듈은 **손으로 고치지 않는다** — 원본을 고치고 이 스크립트를 다시 돌린다.
 *
 * 허브도 같이 고치는 이유: 「오늘의 나」 카드는 마음 결과를 `HUB_INDEX.mind[실험id][유형]`
 * 으로 찾는다. 실험을 늘리고 허브를 안 고치면 새 실험을 한 날 허브에 이름이 안 뜬다.
 *
 * 구조가 어긋나면 쓰지 않고 멈춘다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? resolve(here, "../../오늘의나/mind/data/mind_db_v2.json"));
const out = resolve(here, "../public/mind/mind-db.js");
const hub = resolve(here, "../public/shared/hub-index.js");

const db = JSON.parse(readFileSync(src, "utf8"));
const errs = [];
const ex = db.experiments ?? [];
const ids = new Set();
const perDow = new Array(7).fill(0);
for (const e of ex) {
  if (ids.has(e.id)) errs.push(`id 중복 ${e.id}`);
  ids.add(e.id);
  if (!(e.dow >= 0 && e.dow <= 6)) errs.push(`${e.id} dow ${e.dow}`);
  else perDow[e.dow]++;
  if (e.types?.length !== 4) errs.push(`${e.id} 유형 ${e.types?.length}개`);
  if (e.q?.length !== 4) errs.push(`${e.id} 문항 ${e.q?.length}개`);
  for (const q of e.q ?? []) if (q.opts?.length !== 5) errs.push(`${e.id} 선택지 ${q.opts?.length}개`);
  if (e.months && !(Array.isArray(e.months) && e.months.every((m) => m >= 1 && m <= 12))) errs.push(`${e.id} months ${e.months}`);
  if (!db.typeMeet?.[e.id]) errs.push(`${e.id} typeMeet 없음`);
}
// 계절 항목만 있는 요일이 되면 그 요일 평소엔 고를 게 없다
for (let d = 0; d < 7; d++) {
  if (!ex.some((e) => e.dow === d && !e.months?.length)) errs.push(`요일 ${d} 에 평소 항목이 없음`);
}
if (errs.length) {
  console.error(`원본 구조 오류 ${errs.length}건 — 쓰지 않았습니다\n  ` + errs.join("\n  "));
  process.exit(1);
}

const seasonal = ex.filter((e) => e.months?.length).length;
const body = `/**
 * 🔬 오늘의 선택 — 콘텐츠 DB v${db.version} (${db.date})
 *
 * 원본: ../오늘의나/mind/data/mind_db_v2.json (기획 소유 · 린트 완료본)
 * **손으로 고치지 않는다** — 원본을 고치고 \`node scripts/gen-mind-db.mjs\` 로 다시 뽑는다.
 *
 * 선택 ${ex.length}개(요일별 ${perDow.join("·")} · 계절 항목 ${seasonal}) · 축 ${db.axes.length} ·
 * 페어 문항 ${db.pairQ.length} · 문항별 근거 · 마음 읽기. 그날의 선택 고르기는 mind-pick.js.
 */

export const MIND_DB = ${JSON.stringify(db)};
`;
writeFileSync(out, body);

// 허브 인덱스의 mind 칸만 바꾼다 — tarot 칸 등 나머지는 그대로
// mind 칸은 HUB_INDEX 객체의 마지막 칸이다: `"mind":{…}};` 로 파일 끝까지
const hubSrc = readFileSync(hub, "utf8");
const m = hubSrc.match(/"mind":\{.*\}\};\s*$/s);
if (!m) {
  console.error("hub-index.js 에서 mind 칸을 못 찾았습니다 — 쓰지 않았습니다");
  process.exit(1);
}
const mindIdx = Object.fromEntries(ex.map((e) => [e.id, e.types.map((t) => ({ n: t.n, g: t.g }))]));
writeFileSync(hub, hubSrc.replace(m[0], `"mind":${JSON.stringify(mindIdx)}};\n`));

console.log(`${out} — 선택 ${ex.length} · ${Buffer.byteLength(body)} bytes`);
console.log(`${hub} — mind ${Object.keys(mindIdx).length}개`);
