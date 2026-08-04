/**
 * 📖 웹툰 회차 업로드 — 제작 저장소 → 서비스
 *
 *   node scripts/sync-webtoon.mjs [--repo <경로>] [--dry-run]
 *
 * 기획서 5-3·7절이 「회차 메타는 production_ledger 와 final/ 폴더에서 자동 생성
 * 가능」이라고 적어 둔 그것이다. 손으로 옮기면 **크기를 빠뜨린다** — 그러면
 * 뷰어가 자리를 예약하지 못해 읽는 도중 화면이 밀린다.
 *
 * ── 무엇을 옮기고 무엇을 안 옮기나 ──────────────────────────────────────
 * 옮기는 것은 `final/` 의 **분할본뿐**이다. 개별 컷(`cuts/`)에는 말풍선·식자가
 * 없어 독자용이 아니다(기획서 5-3). 커버·썸네일은 글자가 없어야 하는 자리라
 * 반대로 컷에서 만든다 — 이미 있으면 다시 만들지 않는다.
 *
 * `ep001_full.jpg`(통짜)도 옮기지 않는다. 분할본과 같은 그림이라 용량만 두 배가
 * 된다 — 뷰어는 분할본만 쓴다.
 *
 * ── 이 스크립트가 하지 않는 것 ──────────────────────────────────────────
 * `webtoon-db.js` 를 **통째로 다시 쓰지 않는다.** 로그라인·태그·장르 대분류는
 * 사람이 정하는 값이고 ledger 에 없다. 회차 배열만 만들어 출력하고, 붙여 넣는
 * 것은 사람이 한다. 자동 생성이 사람의 판단을 덮으면 그게 더 비싸다.
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const REPO = flag("--repo", "../webtoons");
const DRY = args.includes("--dry-run");

const LEDGER = join(REPO, "system", "production_ledger.csv");
if (!existsSync(LEDGER)) {
  console.error(`제작 저장소를 찾지 못했습니다: ${LEDGER}\n  --repo <경로> 로 지정해 주세요.`);
  process.exit(1);
}

/** 아주 작은 CSV 파서 — 따옴표 안의 쉼표만 지켜 주면 된다 */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * JPEG 크기를 헤더에서 읽는다.
 *
 * 이미지 라이브러리를 쓰지 않는 이유는 **이 저장소에 없기 때문**이다. 크기 하나
 * 때문에 의존성을 늘리지 않는다. SOF 마커(0xC0~0xCF, 단 C4·C8·CC 제외)에 높이와
 * 폭이 순서대로 들어 있다.
 */
function jpegSize(file) {
  const b = readFileSync(file);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * 작품 폴더를 찾는다.
 *
 * 폴더 이름이 `W0001` 에서 `W0001_먼저퇴근하겠습니다` 로 바뀐 적이 있다(2026-08-04).
 * 제목이 바뀌면 폴더 이름도 바뀌므로 **앞의 작품 번호로만** 찾는다 — 전체 이름을
 * 맞추면 제목을 고칠 때마다 여기가 깨진다.
 */
const workDirs = new Map();
for (const name of readdirSync(join(REPO, "works"))) {
  const m = name.match(/^(W\d{4})/);
  if (m) workDirs.set(m[1], join(REPO, "works", name));
}

const ledger = parseCsv(readFileSync(LEDGER, "utf8"));
// 회차 0 은 「작품 등록」 행이라 그림이 없다. 완성된 것만 옮긴다.
const done = ledger.filter((r) => r.status === "done" && Number(r.episode) > 0);

if (!done.length) {
  console.log("완성된 회차가 없습니다 (status=done).");
  process.exit(0);
}

const byWork = new Map();
let copied = 0, skipped = 0;

for (const row of done) {
  const workId = row.work_id;
  const ep = Number(row.episode);
  const workDir = workDirs.get(workId);
  const epDir = workDir && join(workDir, "episodes", `ep${String(ep).padStart(3, "0")}`, "final");

  if (!epDir || !existsSync(epDir)) {
    console.log(`  건너뜀  ${workId} EP.${ep} — final/ 이 없습니다`);
    skipped++;
    continue;
  }

  // 분할본만. 통짜(`_full`)는 같은 그림이라 옮기면 용량만 두 배가 된다.
  const parts = readdirSync(epDir)
    .filter((f) => /_part\d+\.jpg$/i.test(f))
    .sort();

  if (!parts.length) {
    console.log(`  건너뜀  ${workId} EP.${ep} — 분할본이 없습니다 (조판 전)`);
    skipped++;
    continue;
  }

  const outDir = join("public", "webtoon", "w", workId, `ep${String(ep).padStart(3, "0")}`);
  if (!DRY) mkdirSync(outDir, { recursive: true });

  const meta = [];
  parts.forEach((f, i) => {
    const src = join(epDir, f);
    const dst = join(outDir, `part${String(i + 1).padStart(2, "0")}.jpg`);
    const size = jpegSize(src);
    if (!size) {
      console.log(`  경고    ${workId} EP.${ep} ${basename(f)} — 크기를 읽지 못했습니다`);
      return;
    }
    meta.push(size);
    if (!DRY) copyFileSync(src, dst);
    copied++;
    console.log(`  복사    ${dst}  ${size.w}×${size.h}  ${(statSync(src).size / 1024 / 1024).toFixed(1)}MB`);
  });

  // ledger 의 `title` 은 **작품 제목**이다(회차마다 같은 값이 들어 있다).
  // 회차 제목은 콘티에만 있으므로 그쪽을 먼저 본다 — 이걸 놓치면 목록의 모든
  // 회차가 작품 이름으로 찍힌다.
  let epTitle = row.title;
  const conti = join(workDir, "episodes", `ep${String(ep).padStart(3, "0")}`, "conti.json");
  if (existsSync(conti)) {
    try {
      const t = JSON.parse(readFileSync(conti, "utf8"))?.title;
      if (typeof t === "string" && t.trim()) epTitle = t.trim();
    } catch {
      console.log(`  경고    ${workId} EP.${ep} — conti.json 을 읽지 못해 작품 제목을 씁니다`);
    }
  }

  if (!byWork.has(workId)) byWork.set(workId, []);
  byWork.get(workId).push({ ep, title: epTitle, day: row.date, cuts: Number(row.cuts) || 0, parts: meta });
}

console.log(`\n분할본 ${copied}장 복사 · ${skipped}개 회차 건너뜀${DRY ? "  (모의 실행)" : ""}`);

console.log("\n── webtoon-db.js 의 episodes 에 넣을 값 ──────────────────────");
console.log("(로그라인·장르·태그는 사람이 정하는 값이라 여기서 만들지 않습니다)\n");
for (const [workId, eps] of byWork) {
  eps.sort((a, b) => a.ep - b.ep);
  console.log(`// ${workId}`);
  console.log("episodes: [");
  for (const e of eps) {
    const parts = e.parts.map((p) => `\n            { w: ${p.w}, h: ${p.h} },`).join("");
    console.log(`  {`);
    console.log(`    ep: ${e.ep}, title: ${JSON.stringify(e.title)}, day: ${JSON.stringify(e.day)}, cuts: ${e.cuts},`);
    console.log(`    parts: [${parts}\n          ],`);
    console.log(`  },`);
  }
  console.log("],\n");
}
