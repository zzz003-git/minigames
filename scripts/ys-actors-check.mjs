/**
 * ✍✍ 배우 카드 정본 대조 (0원 · 배포와 무관한 개발 점검)
 *
 * `src/lib/config.js` 의 `YS_ACTORS` 는 PC 저장소에 있는 캐릭터 설계서 §1 표의
 * **사본**이다(클라우드에서 그 파일을 읽을 수 없다). 사본은 반드시 어긋난다 —
 * 이 프로젝트가 「손으로 옮겨 적지 않는다」를 규칙으로 세운 이유가 그것이다.
 * 읽을 수 없다면 **최소한 어긋난 것을 알 수는 있어야** 한다.
 *
 *   node scripts/ys-actors-check.mjs            (기본 경로: ../yourstory)
 *   node scripts/ys-actors-check.mjs <저장소경로>
 *
 * 종료 코드: 0 일치 · 1 불일치 · 2 정본을 찾지 못함(점검 못 함 — 실패는 아니다)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { YS_ACTORS } from "../src/lib/config.js";

const root = process.argv[2] ?? join(process.cwd(), "..", "yourstory");
const doc = join(root, "site_design", "yourstory2_characters_20260820.md");

if (!existsSync(doc)) {
  console.log(`정본을 찾지 못해 점검을 건너뜁니다: ${doc}`);
  process.exit(2);
}

// §1 표에서 「번호 | 이름 | 칸 | 한 줄 성격 | 말투 …」 를 읽는다.
// `ys_casting.py` 의 `load_pool()` 과 같은 규칙이다 — 두 곳이 다른 표를 읽으면
// 화면과 캐스팅이 다른 배우를 말하게 된다
const canon = [];
for (const ln of readFileSync(doc, "utf8").split(/\r?\n/)) {
  const m = ln.trim().match(/^\|\s*(\d+)\s*\|(.+)\|\s*$/);
  if (!m) continue;
  const cols = m[2].split("|").map((c) => c.trim());
  if (cols.length < 8) continue;
  canon.push({
    id: `C${String(Number(m[1])).padStart(2, "0")}`,
    name: cols[0].replaceAll("*", "").trim(),
    slot: cols[1],
    personality_line: cols[2],
    speech: cols[3],
  });
}

const bad = [];
if (canon.length !== YS_ACTORS.length) {
  bad.push(`배우 수가 다릅니다 — 정본 ${canon.length} · 사본 ${YS_ACTORS.length}`);
}
for (const c of canon) {
  const mine = YS_ACTORS.find((a) => a.id === c.id);
  if (!mine) { bad.push(`${c.id} 가 사본에 없습니다`); continue; }
  for (const k of ["name", "slot", "personality_line"]) {
    if (mine[k] !== c[k]) bad.push(`${c.id} ${k}\n    정본: ${c[k]}\n    사본: ${mine[k]}`);
  }
  // 말버릇은 **말투 칸의 대표 인용 1개**라 문장 전체가 같을 수 없다.
  // 대신 사본의 인용이 정본의 말투 칸 안에 그대로 들어 있어야 한다(설계서 §2)
  const quote = mine.quirk_line ?? "";
  if (quote && !c.speech.includes(quote)) {
    bad.push(`${c.id} quirk_line 이 정본 말투 칸에 없습니다\n    정본 말투: ${c.speech}\n    사본 인용: ${quote}`);
  }
}

if (bad.length) {
  console.error(`✗ 정본과 어긋난 곳 ${bad.length}건\n  - ` + bad.join("\n  - "));
  process.exit(1);
}
console.log(`✓ 배우 ${canon.length}명 · 이름·칸·성격 한 줄·말버릇 인용 모두 정본과 일치`);
