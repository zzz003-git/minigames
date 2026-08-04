/**
 * 📖 웹툰 회차 업로드 — 제작 저장소 → 서비스
 *
 *   node scripts/sync-webtoon.mjs [--repo <경로>] [--dry-run]
 *
 * ── 매니페스트가 진입점이다 (2026-08-04 인수인계 B-1) ───────────────────
 * `works/*​/episodes/ep*​/final/*_manifest.json` 을 찾아 **그 안에 적힌 파일만**
 * 올린다. 예전에는 폴더를 훑어 `_partNN.jpg` 꼬리로 찾았는데, 그 방식은 폴더
 * 어디에 있든 걸린다 — 폴더명이 바뀌며 옮겨 둔 **구버전 완성본이 같은 이름**으로
 * 남아 있었고, 스캔 범위가 넓었다면 이미 바로잡은 W0001 의 크기(11210/9912)가
 * 옛 값(11430/9012)으로 되돌아갈 수 있었다.
 *
 * 매니페스트를 진입점으로 두면 그런 파일은 애초에 목록에 없다. 파일명 규칙이
 * 또 바뀌어도 이 스크립트를 고칠 일이 없다.
 *
 * ── 크기를 재지 않는다 ──────────────────────────────────────────────────
 * 분할본의 폭·높이가 매니페스트에 있다. 이미지를 열어 헤더를 읽던 코드를 지웠다
 * (인수인계 A-1). 대신 **분할합과 전체 높이가 맞는지 검산**한다 — 제작 쪽이
 * `warning` 을 달아 주지만, 받는 쪽에서도 한 번 본다.
 *
 * ── 통짜(`full`)는 올리지 않는다 ────────────────────────────────────────
 * 인수인계는 `full.file` 도 올리라고 적었지만 **뷰어가 쓰지 않는다.** 분할본과
 * 같은 그림이고 회차당 4.6MB 라, 올리면 배포 용량이 두 배가 되고 얻는 것이 없다.
 * 통짜가 필요한 쓰임(내려받기·공유 이미지)이 생기면 그때 켠다.
 *
 * ── 이 스크립트가 하지 않는 것 ──────────────────────────────────────────
 * `webtoon-db.js` 를 통째로 다시 쓰지 않는다. 로그라인·태그·장르 대분류는 사람이
 * 정하는 값이고 매니페스트에 없다. 회차 배열만 만들어 출력한다.
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const REPO = flag("--repo", "../webtoons");
const DRY = args.includes("--dry-run");

const WORKS = join(REPO, "works");
if (!existsSync(WORKS)) {
  console.error(`제작 저장소를 찾지 못했습니다: ${WORKS}\n  --repo <경로> 로 지정해 주세요.`);
  process.exit(1);
}

/** `works/<ID>_<제목>/episodes/ep0NN/final/` 만 본다. 작품은 **앞의 ID로만** 식별한다 */
function findManifests() {
  const out = [];
  for (const workName of readdirSync(WORKS)) {
    if (!/^W\d{4}/.test(workName)) continue;
    const epsDir = join(WORKS, workName, "episodes");
    if (!existsSync(epsDir)) continue;

    for (const epName of readdirSync(epsDir)) {
      if (!/^ep\d{3}$/.test(epName)) continue;
      const finalDir = join(epsDir, epName, "final");
      if (!existsSync(finalDir)) continue;

      for (const f of readdirSync(finalDir)) {
        if (f.endsWith("_manifest.json")) out.push({ finalDir, file: join(finalDir, f) });
      }
    }
  }
  return out;
}

const manifests = findManifests();
if (!manifests.length) {
  console.log("매니페스트를 찾지 못했습니다 (조판 전이거나 경로가 다릅니다).");
  process.exit(0);
}

const byWork = new Map();
let copied = 0, skipped = 0;

for (const { finalDir, file } of manifests) {
  let m;
  try {
    m = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`  건너뜀  ${file} — 매니페스트를 읽지 못했습니다 (${e.message})`);
    skipped++;
    continue;
  }

  const workId = String(m.work_id ?? "");
  const ep = Number(m.episode);
  const label = `${workId} EP.${ep}`;

  if (!/^W\d{4}$/.test(workId) || !Number.isInteger(ep) || ep < 1) {
    console.log(`  건너뜀  ${file} — work_id/episode 가 올바르지 않습니다`);
    skipped++;
    continue;
  }

  // 제작 쪽이 붙여 주는 경고. 분할합이 안 맞는다는 뜻이라 올리면 안 된다
  if (m.warning) {
    console.log(`  중단    ${label} — 매니페스트 경고: ${m.warning}`);
    skipped++;
    continue;
  }

  const parts = Array.isArray(m.parts) ? [...m.parts].sort((a, b) => a.index - b.index) : [];
  if (!parts.length) {
    console.log(`  건너뜀  ${label} — 분할본이 없습니다`);
    skipped++;
    continue;
  }

  // 받는 쪽 검산. 어긋난 채로 올리면 뷰어가 자리를 잘못 잡아 읽는 중에 밀린다
  const sum = parts.reduce((n, p) => n + Number(p.height || 0), 0);
  if (Number(m.total_height) && sum !== Number(m.total_height)) {
    console.log(`  중단    ${label} — 분할합 ${sum} ≠ 전체높이 ${m.total_height}`);
    skipped++;
    continue;
  }

  const outDir = join("public", "webtoon", "w", workId, `ep${String(ep).padStart(3, "0")}`);
  if (!DRY) mkdirSync(outDir, { recursive: true });

  const meta = [];
  let ok = true;
  parts.forEach((p, i) => {
    const src = join(finalDir, p.file);
    if (!existsSync(src)) {
      console.log(`  중단    ${label} — 매니페스트가 가리키는 파일이 없습니다: ${p.file}`);
      ok = false;
      return;
    }
    const dst = join(outDir, `part${String(i + 1).padStart(2, "0")}.jpg`);
    meta.push({ w: Number(p.width), h: Number(p.height) });
    if (!DRY) copyFileSync(src, dst);
    copied++;
    console.log(`  복사    ${dst}  ${p.width}×${p.height}  ${(statSync(src).size / 1024 / 1024).toFixed(1)}MB`);
  });

  if (!ok) { skipped++; continue; }

  if (!byWork.has(workId)) byWork.set(workId, []);
  byWork.get(workId).push({
    ep,
    // 회차 제목이 매니페스트에 있다. 예전에는 ledger 를 봤다가 **작품 제목**을
    // 집어서 목록의 모든 회차가 같은 이름으로 찍힐 뻔했다.
    title: String(m.episode_title ?? "").trim() || `${ep}화`,
    cuts: Number(m.cut_count) || 0,
    header: m.has_title_header === true,
    parts: meta,
  });
}

console.log(`\n분할본 ${copied}장 복사 · ${skipped}건 건너뜀${DRY ? "  (모의 실행)" : ""}`);

const headered = [...byWork.values()].flat().filter((e) => e.header).length;
if (headered) {
  console.log(`\n※ ${headered}개 회차의 그림에 제목 헤더가 구워져 있습니다(has_title_header).`);
  console.log("   뷰어가 상단 바의 작품명을 감추도록 `header: true` 를 함께 적어 두었습니다.");
}

console.log("\n── webtoon-db.js 의 episodes 에 넣을 값 ──────────────────────");
console.log("(날짜·로그라인·장르·태그는 사람이 정하는 값이라 여기서 만들지 않습니다)\n");
for (const [workId, eps] of byWork) {
  eps.sort((a, b) => a.ep - b.ep);
  console.log(`// ${workId}`);
  console.log("episodes: [");
  for (const e of eps) {
    const parts = e.parts.map((p) => `\n            { w: ${p.w}, h: ${p.h} },`).join("");
    console.log(`  {`);
    console.log(`    ep: ${e.ep}, title: ${JSON.stringify(e.title)}, day: "____-__-__", cuts: ${e.cuts},`);
    if (e.header) console.log(`    header: true,`);
    console.log(`    parts: [${parts}\n          ],`);
    console.log(`  },`);
  }
  console.log("],\n");
}
