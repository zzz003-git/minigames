/**
 * 🔬 오늘의 선택 DB → 화면용 분할 산출물 + 허브 인덱스 (REQ-43 · REQ-47)
 *
 *   node scripts/gen-mind-db.mjs [원본 JSON 경로]
 *
 * 원본(단일 출처)은 기획 폴더의 `오늘의나/mind/data/mind_db_v2.json`(기획 소유 · 린트 완료본).
 * 산출물은 **손으로 고치지 않는다** — 원본을 고치고 이 스크립트를 다시 돌린다.
 *
 * ── 무엇을 만드나 ────────────────────────────────────────────────────────
 *   public/mind/mind-common.js   축·축 메아리·페어 문항·근거·마음 읽기·케미·다름 문구
 *                                (페어 화면은 이것만 받는다)
 *   public/mind/mind-index.js    도감용 목록 — id·요일·months·제목·그림·유형 이름/그림만.
 *                                그날의 선택 고르기·도감·분포 이름이 여기서 읽는다. 서버도 읽는다
 *   public/mind/exp/<id>.json    실험 하나의 본문(장면·문항) + 그 실험의 typeMeet.
 *                                화면은 그날(또는 저장된 · 지난) 실험만 받는다
 *   public/shared/hub-index.js   허브 카드의 mind 칸(실험 전체 · 이름·그림)
 *
 * 182개를 통짜로 받으면 gzip 146KB 인데, 그날 실험은 하나뿐이다.
 *
 * ── 멈추는 경우 ──────────────────────────────────────────────────────────
 * 원본 구조 오류, 그리고 **직전 산출물과 기존 실험의 id·순서·본문이 어긋날 때.** 이미 나간
 * 실험의 문구가 바뀌면 이용자의 지난 기록과 도감이 다른 글을 가리키게 된다. 수작업 대조
 * 대신 여기서 자동으로 막는다(REQ-47 영향 점검 7).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? resolve(here, "../../오늘의나/mind/data/mind_db_v2.json"));
const pub = resolve(here, "../public/mind");
const expDir = join(pub, "exp");
const hub = resolve(here, "../public/shared/hub-index.js");

const db = JSON.parse(readFileSync(src, "utf8"));
const errs = [];
const ex = db.experiments ?? [];
const ids = new Set();
const perDow = new Array(7).fill(0);
for (const e of ex) {
  if (!/^[a-z0-9_]+$/.test(e.id ?? "")) errs.push(`id 형식 ${e.id}`);
  if (ids.has(e.id)) errs.push(`id 중복 ${e.id}`);
  ids.add(e.id);
  if (!(e.dow >= 0 && e.dow <= 6)) errs.push(`${e.id} dow ${e.dow}`);
  else perDow[e.dow]++;
  if (e.types?.length !== 4) errs.push(`${e.id} 유형 ${e.types?.length}개`);
  if (e.q?.length !== 4) errs.push(`${e.id} 문항 ${e.q?.length}개`);
  for (const q of e.q ?? []) if (q.opts?.length !== 5) errs.push(`${e.id} 선택지 ${q.opts?.length}개`);
  if (e.months && !(Array.isArray(e.months) && e.months.every((m) => m >= 1 && m <= 12))) errs.push(`${e.id} months ${e.months}`);
  const meet = db.typeMeet?.[e.id];
  if (!Array.isArray(meet) || meet.length !== 4) errs.push(`${e.id} typeMeet ${meet?.length}`);
}
// 계절 항목만 있는 요일이 되면 그 요일 평소엔 고를 게 없다
for (let d = 0; d < 7; d++) {
  if (!ex.some((e) => e.dow === d && !e.months?.length)) errs.push(`요일 ${d} 에 평소 항목이 없음`);
}

// ── 직전 산출물과 대조 ──
// 실험별 파일이 있으면 그것을, 없으면(첫 분할) 예전 통짜 mind-db.js 를 직전 상태로 본다
const prev = await loadPrevious();
prev.forEach((p, i) => {
  const n = ex[i];
  if (!n || n.id !== p.id) {
    errs.push(`기존 실험 순서·id 가 어긋남: ${i}번 ${p.id} → ${n?.id ?? "(없음)"}`);
    return;
  }
  const { typeMeet: prevMeet, ...prevBody } = p;
  if (JSON.stringify(prevBody) !== JSON.stringify(n)) errs.push(`기존 실험 본문이 바뀜: ${p.id}`);
  if (prevMeet && JSON.stringify(prevMeet) !== JSON.stringify(db.typeMeet[n.id])) errs.push(`기존 typeMeet 이 바뀜: ${p.id}`);
});

if (errs.length) {
  console.error(`오류 ${errs.length}건 — 쓰지 않았습니다\n  ` + errs.join("\n  "));
  process.exit(1);
}

const head = (what) => `/**
 * 🔬 오늘의 선택 — ${what} · 콘텐츠 DB v${db.version} (${db.date})
 *
 * 원본: ../오늘의나/mind/data/mind_db_v2.json (기획 소유 · 린트 완료본)
 * **손으로 고치지 않는다** — 원본을 고치고 \`node scripts/gen-mind-db.mjs\` 로 다시 뽑는다.
 */
`;

const { experiments, typeMeet, ...common } = db;

writeFileSync(
  join(pub, "mind-common.js"),
  head("공통(축·페어·마음 읽기·케미·다름 문구)") + `\nexport const MIND_COMMON = ${JSON.stringify(common)};\n`,
);

const index = experiments.map((e) => ({
  id: e.id,
  dow: e.dow,
  ...(e.months?.length ? { months: e.months } : {}),
  title: e.title,
  glyph: e.glyph,
  types: e.types.map((t) => ({ n: t.n, g: t.g })),
}));
const seasonal = index.filter((e) => e.months).length;
writeFileSync(
  join(pub, "mind-index.js"),
  head(`도감용 목록 ${index.length}개(요일별 ${perDow.join("·")} · 계절 ${seasonal})`) +
    `\nexport const MIND_INDEX = ${JSON.stringify({ version: db.version, experiments: index })};\n`,
);

mkdirSync(expDir, { recursive: true });
for (const e of experiments) {
  writeFileSync(join(expDir, `${e.id}.json`), JSON.stringify({ ...e, typeMeet: typeMeet[e.id] }));
}

// 예전 통짜 파일(mind-db.js)은 옛 화면 캐시 호환용으로 한 배포 주기(2026-10-05 운영 bb13c76)만
// 두었다가 그다음 배포에서 지웠다 — 더 만들지 않는다

// 허브 인덱스의 mind 칸 — HUB_INDEX 객체의 마지막 칸이다: `"mind":{…}};` 로 파일 끝까지
const hubSrc = readFileSync(hub, "utf8");
const m = hubSrc.match(/"mind":\{.*\}\};\s*$/s);
if (!m) {
  console.error("hub-index.js 에서 mind 칸을 못 찾았습니다 — 허브는 쓰지 않았습니다");
  process.exit(1);
}
const mindIdx = Object.fromEntries(index.map((e) => [e.id, e.types]));
writeFileSync(hub, hubSrc.replace(m[0], `"mind":${JSON.stringify(mindIdx)}};\n`));

console.log(`선택 ${experiments.length}개 (기존 ${prev.length}개 대조 일치) · 실험 파일 ${experiments.length}개 · 허브 mind ${Object.keys(mindIdx).length}개`);

async function loadPrevious() {
  if (existsSync(join(pub, "mind-index.js")) && existsSync(expDir) && readdirSync(expDir).length) {
    const { MIND_INDEX } = await import(pathToFileURL(join(pub, "mind-index.js")).href);
    return MIND_INDEX.experiments.map((e) => JSON.parse(readFileSync(join(expDir, `${e.id}.json`), "utf8")));
  }
  if (existsSync(join(pub, "mind-db.js"))) {
    const { MIND_DB } = await import(pathToFileURL(join(pub, "mind-db.js")).href);
    return MIND_DB.experiments.map((e) => ({ ...e, typeMeet: MIND_DB.typeMeet?.[e.id] }));
  }
  return [];
}
