/**
 * 커밋 이력을 평문 파일로 내보낸다 — `docs/CHANGELOG.md`
 *
 *     node scripts/gen-changelog.mjs          # 쓴다
 *     node scripts/gen-changelog.mjs --check  # 낡았는지만 보고 종료코드로 답한다
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * 이 저장소를 함께 쓰는 세션이 셋인데 셋 다 `git log` 를 볼 수 있는 게 아니다.
 *   · 개발(CLI)  — 볼 수 있다
 *   · 조사(CLI)  — `log`·`show`·`rev-list` 만 허용된다 (2026-08-21 Master 승인 갈래 2).
 *                  마운트된 `.git` 에 `index.lock` 이 쌓이면 못 지워서 남의 커밋을 막는다
 *   · 기획(앱)   — 셸이 없다. **영원히 못 본다**
 * 셋이 같은 것을 보려면 평문 파일밖에 없다. 그래서 로그를 파일로 내보낸다.
 *
 * ── 파생물이라는 약점을 어떻게 막았나 ────────────────────────────────────
 * 내보낸 파일은 원본이 아니라 사본이다. 이 스크립트를 돌리는 걸 잊으면 **조용히 낡고**,
 * 읽는 쪽은 낡았다는 사실 자체를 알 수 없다 — 조사 세션이 정확히 이 점을 지적했다.
 * 그래서 머리글에 **기준 커밋 SHA** 를 박는다. 읽는 쪽은 한 줄로 대조할 수 있고,
 * 셸이 없는 기획 세션은 개발 세션에게 그 값을 물으면 된다.
 * 낡음을 감추지 않고 드러내는 것이 이 파일의 계약이다.
 * (기준이 HEAD 가 아니라 `BASE_ARGS` 인 이유는 그 주석에 적었다.)
 *
 * ── 무엇을 적는가 ────────────────────────────────────────────────────────
 * 커밋 메시지 전문은 넣지 않는다(이 저장소의 메시지는 길다 — 파일이 읽히지 않게 된다).
 * 제목·날짜·SHA 와, **조사 세션의 대조군에 영향을 주는 변경인지**를 적는다.
 * 조사 쪽이 이 파일에서 실제로 찾는 것이 그것이기 때문이다 — 「내 전제가 움직였나」.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const OUT = "docs/CHANGELOG.md";
const CHECK = process.argv.includes("--check");

// core.quotepath=false — 이게 없으면 한글 경로가 `"\354\235\270..."` 로 나온다.
// 이 저장소는 문서 파일명이 대부분 한글이라 그대로 두면 읽을 수 없는 목록이 된다.
const git = (...args) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8" }).trimEnd();

/**
 * 기준 SHA — **이 파일 자신 말고 다른 것을 바꾼 가장 최근 커밋.**
 *
 * 그냥 HEAD 를 박으면 안 된다. CHANGELOG 는 자기를 만든 커밋을 담을 수 없어서,
 * 내보내고 커밋하는 순간 스스로 「낡음」이 된다. 늘 빨간 신호는 신호가 아니다.
 * 이 파일만 고친 커밋은 이력의 내용을 바꾼 것이 아니므로 기준에서 뺀다.
 */
const BASE_ARGS = ["-1", "--format=%h", "--", ":!docs/CHANGELOG.md"];
const head = git("log", ...BASE_ARGS);

/**
 * 대조군(`reward-minigame-research/data/deployed_games.csv`)이 딛고 선 것들.
 * 여기 걸리면 조사 세션이 그 커밋을 봐야 한다는 뜻이다. 순서가 곧 중요도다.
 */
const IMPACT = [
  [/^public\/games\/[^/]+\//, "게임 폴더"],
  [/^src\/games\/arcade\/index\.js$/, "아케이드 레지스트리"],
  [/^src\/lib\/config\.js$/, "게임 설정"],
  [/^src\/games\//, "게임 로직"],
  // 최상위 `docs/*.md` 만이다. `docs/handoff/` 는 협의 기록이라 대조군과 무관한데,
  // `docs/.+\.md` 로 잡으면 그것까지 「게임 문서」로 떠서 표시가 무의미해진다.
  // 조사 쪽 `sync_deployed_games.py` 의 감시 범위(`docs/*.md`, 재귀 아님)와 맞춘다.
  [/^docs\/[^/]+\.md$/, "게임 문서"],
];

function impactOf(files) {
  const hit = [];
  for (const [re, label] of IMPACT) {
    if (files.some((f) => re.test(f)) && !hit.includes(label)) hit.push(label);
  }
  return hit;
}

/** 파일 목록을 그대로 늘어놓으면 길어진다 — 폴더 단위로 접는다 */
function foldPaths(files) {
  const seen = new Map();
  for (const f of files) {
    // `public/games/stack/game.js` → `public/games/stack/`, `docs/x.md` → `docs/x.md`
    const key = /^(public\/games\/[^/]+|src\/games\/[^/]+|public\/[^/]+|src\/[^/]+)\//.test(f)
      ? f.replace(/^((?:public|src)\/[^/]+(?:\/[^/]+)?)\/.*$/, "$1/")
      : f;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].map(([k, n]) => (n > 1 ? `${k} (${n})` : k));
}

// %x00 으로 필드를, %x01 로 커밋을 가른다 — 제목에 어떤 문자가 와도 안 깨진다.
const raw = git("log", "--format=%x01%h%x00%cs%x00%s", "--name-only");

const commits = raw
  .split("\x01")
  .filter(Boolean)
  .map((block) => {
    const [meta, ...rest] = block.split("\n");
    const [sha, date, subject] = meta.split("\x00");
    const files = rest.map((l) => l.trim()).filter(Boolean);
    return { sha, date, subject, files };
  });

const lines = [
  "# 변경 이력 — 자동 생성물",
  "",
  "**이 파일은 손으로 고치지 않습니다.** `node scripts/gen-changelog.mjs` 가 `git log` 에서 만듭니다.",
  "",
  `| 기준 커밋 | \`${head}\` |`,
  "| --- | --- |",
  `| 커밋 수 | ${commits.length}개 |`,
  "",
  "## 이 파일이 낡았는지 확인하는 법",
  "",
  "사본이라 내보내기를 잊으면 **조용히 낡습니다.** 그래서 위에 생성 시점 SHA 를 박아 둡니다.",
  "",
  "- `git log` 를 쓸 수 있는 세션(개발 · 조사) — 아래 한 줄이 위 값과 같은지 봅니다.",
  "",
  "  ```",
  "  git log -1 --format=%h -- ':!docs/CHANGELOG.md'",
  "  ```",
  "",
  "  이 파일 자신만 고친 커밋은 빼고 봅니다 — 넣으면 내보낸 직후에도 늘 「낡음」이 됩니다.",
  "- 셸이 없는 기획(앱) 세션 — 개발 세션에 그 값을 물어 대조합니다.",
  "",
  "다르면 이 파일은 낡은 것이고, 그 아래 내용을 근거로 쓰면 안 됩니다.",
  "",
  "## 「대조군 영향」 칸이 뜻하는 것",
  "",
  "조사 세션의 `data/deployed_games.csv` 가 딛고 선 파일이 그 커밋에서 바뀌었다는 표시입니다.",
  "게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서 다섯 가지를 봅니다.",
  "표시가 있으면 **그 커밋은 조사 쪽 전제를 움직였을 수 있습니다.**",
  "",
  "---",
  "",
];

let lastDate = null;
for (const c of commits) {
  if (c.date !== lastDate) {
    lines.push(`## ${c.date}`, "");
    lastDate = c.date;
  }
  const impact = impactOf(c.files);
  lines.push(`### \`${c.sha}\` ${c.subject}`);
  if (impact.length) lines.push(`> **대조군 영향** — ${impact.join(" · ")}`);
  const folded = foldPaths(c.files);
  if (folded.length) {
    const shown = folded.slice(0, 8);
    lines.push("", ...shown.map((f) => `- \`${f}\``));
    if (folded.length > shown.length) lines.push(`- … 외 ${folded.length - shown.length}곳`);
  }
  lines.push("");
}

const body = lines.join("\n");

if (CHECK) {
  // 낡음 판정은 「지금 다시 만들면 달라지는가」가 아니라 「머리글 SHA 가 HEAD 인가」로 한다.
  // 전자는 파일을 안 고친 커밋에도 반응해 소음이 된다.
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  const stamped = cur.match(/기준 커밋 \| `([0-9a-f]+)`/)?.[1] ?? null;
  if (stamped === head) {
    console.log(`최신입니다 — 기준 커밋 ${head}`);
    process.exit(0);
  }
  console.log(`낡았습니다 — 파일 ${stamped ?? "(없음)"} · 기준 커밋 ${head}`);
  console.log("  → node scripts/gen-changelog.mjs");
  process.exit(1);
}

writeFileSync(OUT, body, "utf8");
console.log(`${OUT} — 커밋 ${commits.length}개 · 기준 ${head}`);
