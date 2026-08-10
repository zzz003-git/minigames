#!/usr/bin/env node
/**
 * ✍ 너의스토리 — 초대코드 발급 (운영자용)
 *
 * 0단계 파일럿의 계정 발급 도구다. 코드 하나가 한 사람이고, 티켓은 그 코드에
 * 붙는다 — 사이트가 무로그인이라 쿠키를 지우면 새 사람이 되기 때문이다
 * (services/yourstory.js 머리말).
 *
 *   node scripts/ys-invite.mjs --label "운영자" --tickets 5 --credits 16
 *   node scripts/ys-invite.mjs --label "테스터A" --local
 *   node scripts/ys-invite.mjs --list
 *
 * `--local` 은 `wrangler dev` 의 로컬 D1, 없으면 **실서비스 D1** 이다.
 * 스테이징은 `--env staging`.
 *
 * 티켓 지급도 원장에 넣는다(`reason='grant'`). 잔액의 진실은 언제나 원장 집계이고
 * `ys_invite.tickets` 는 조회용 사본이라, 한쪽만 고치면 둘이 어긋난다.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const DB = has("staging") ? "minigames-staging-db" : "minigames-db";
const target = has("local") ? "--local" : "--remote";
const envArgs = has("staging") ? ["--env", "staging"] : [];

/**
 * `execFileSync` 에 `shell: true` 를 주면 Windows 의 Node 24 에서 libuv 가 죽는다
 * (`UV_HANDLE_CLOSING` 어서션). 명령을 통째로 문자열로 넘긴다.
 */
function sql(statement) {
  // 줄바꿈이 든 채로 넘기면 셸이 명령을 거기서 끊는다 ("incomplete input")
  const one = statement.replace(/\s+/g, " ").trim();
  const args = [target, ...envArgs, "--json", "--command", `"${one.replaceAll('"', '\\"')}"`];
  return execSync(`npx wrangler d1 execute ${DB} ${args.join(" ")}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * 사람이 불러 줄 수 있는 코드를 만든다.
 *
 * 헷갈리는 글자(0/O, 1/I/L)를 뺀다 — 전화로 불러 주다 틀리면 「확인되지 않는
 * 코드」가 되고, 받은 사람은 우리를 의심하지 자기 받아쓰기를 의심하지 않는다.
 */
function makeCode() {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `YS-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

if (has("list")) {
  console.log(
    sql(
      `SELECT i.code, i.label, i.user_id IS NOT NULL AS bound,
              COALESCE(SUM(l.delta_ticket), 0) AS tickets,
              COALESCE(SUM(l.delta_credit), 0) AS credits
         FROM ys_invite i LEFT JOIN ys_ledger l ON l.invite_code = i.code
        GROUP BY i.code ORDER BY i.created_at DESC LIMIT 50`,
    ),
  );
  process.exit(0);
}

const code = flag("code", makeCode());
const label = (flag("label", "") ?? "").replace(/'/g, "''");
const tickets = Number(flag("tickets", "1"));
const credits = Number(flag("credits", "0"));

if (!Number.isInteger(tickets) || tickets < 0 || !Number.isInteger(credits) || credits < 0) {
  console.error("tickets·credits 는 0 이상의 정수여야 합니다.");
  process.exit(1);
}

const at = Date.now();
sql(
  `INSERT INTO ys_invite (code, label, tickets, credits, created_at)
   VALUES ('${code}', '${label}', ${tickets}, ${credits}, ${at})`,
);
// 지급도 원장에 남긴다. 잔액의 진실은 언제나 원장 집계다
sql(
  `INSERT INTO ys_ledger (invite_code, delta_ticket, delta_credit, reason, at)
   VALUES ('${code}', ${tickets}, ${credits}, 'grant', ${at})`,
);

console.log(`\n  초대코드  ${code}`);
console.log(`  티켓 ${tickets}장 · 크레딧 ${credits}개 · ${DB}${has("local") ? " (로컬)" : ""}`);
console.log(`\n  받는 사람은 /webtoon/yourstory/ 에서 이 코드를 넣습니다.\n`);
