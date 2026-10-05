/**
 * 🔮 스테이징 타로 시험 계정 심기 (REQ-38) — **스테이징 DB 전용**
 * ==========================================================================
 *
 *   node scripts/seed-tarot-staging.mjs --list          최근 계정 5개 (누가 방금 들어왔나)
 *   node scripts/seed-tarot-staging.mjs <user_id>       그 계정에 상태를 심는다
 *
 * 심는 상태: 도감 77장(미보유 1장 · 무작위) · 별가루 3.
 * 다음 뽑기가 중복이면(77/78) 별가루 4 → 미보유 1장 교환 연출 → 78장 완성 →
 * 마일스톤 20·39·58·78 이 한 번에 들어온다. 미보유 카드를 직접 뽑으면(1/78) 교환 없이
 * 완성만 된다 — 그때는 다시 심으면 된다.
 *
 * ── 왜 계정을 만들어 넘기지 않나 ─────────────────────────────────────────
 * 이용자 식별은 서명된 HttpOnly 쿠키다(`lib/user.js`). 폰 브라우저에 쿠키를 넣을 수
 * 없으므로, **폰이 먼저 스테이징에 들어와 생긴 계정**에 심는다.
 *
 * 심은 카드에는 적립(TAROT_NEW)을 넣지 않는다 — 시험 계정의 포인트는 실제와 다르다.
 * ==========================================================================
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomInt } from "../src/lib/crypto.js";
import { TAROT } from "../src/lib/config.js";

const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const DB = ["d1", "execute", "minigames-staging-db", "--remote", "--env", "staging", "--json"];

/** 원격 D1 은 `--file` 이 가져오기 모드라 결과를 안 돌려준다 — `--command` 로 보낸다 */
function sql(command) {
  // npx 는 윈도에서 셸을 거쳐야 뜨고, 셸은 SQL 의 공백을 인자로 쪼갠다 — wrangler 를 node 로 직접 부른다
  const out = execFileSync(process.execPath, [WRANGLER, ...DB, "--command", command], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  return JSON.parse(out).at(-1)?.results ?? [];
}

const arg = process.argv[2];
if (!arg) {
  console.error("사용: --list | <user_id>");
  process.exit(1);
}

if (arg === "--list") {
  console.table(
    sql(`SELECT rowid, user_id, created_day, last_seen_day FROM suite_user ORDER BY rowid DESC LIMIT 5`),
  );
  process.exit(0);
}

if (!/^[0-9a-f-]{36}$/.test(arg)) {
  console.error("user_id 형식이 아닙니다");
  process.exit(1);
}
const uid = arg;
if (!sql(`SELECT 1 AS ok FROM suite_user WHERE user_id = '${uid}'`).length) {
  console.error("스테이징에 없는 계정입니다 — 폰에서 /tarot/ 를 먼저 한 번 여세요");
  process.exit(1);
}

const missing = randomInt(0, TAROT.CARDS - 1);
const rows = [];
for (let i = 0; i < TAROT.CARDS; i++) if (i !== missing) rows.push(`('${uid}', ${i}, '2000-01-01', 'draw')`);

sql(
  `DELETE FROM tarot_coll WHERE user_id = '${uid}'; ` +
    `INSERT INTO tarot_coll (user_id, card_id, first_day, via) VALUES ${rows.join(",")}; ` +
    `INSERT INTO tarot_meta (user_id, welcome_used, updated_at, dust) VALUES ('${uid}', 0, 0, 3) ` +
    `ON CONFLICT (user_id) DO UPDATE SET dust = 3, ex_pending = 0`,
);

const [meta] = sql(`SELECT dust, (SELECT COUNT(*) FROM tarot_coll WHERE user_id = '${uid}') AS coll FROM tarot_meta WHERE user_id = '${uid}'`);
console.log(`심음: ${uid} · 도감 ${meta.coll}/78 · 별가루 ${meta.dust} · 미보유 카드 id ${missing}`);
