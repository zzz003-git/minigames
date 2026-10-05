/**
 * 🔮 오늘의 타로 78장 · 별가루 — TAROT-SPEC-02 6절 체크리스트 (REQ-36)
 * ==========================================================================
 *
 *   npm run dev            (다른 터미널 · 로컬 D1 에 마이그레이션 0026 적용 후)
 *   node scripts/test-tarot.mjs
 *
 * 별가루는 「중복이 4번 쌓인 계정」에서만 움직인다. 하루 3장으로 그 상태를 만들려면
 * 며칠이 걸리므로 **로컬 D1 에 직접 상태를 심는다**(`wrangler d1 execute --local`).
 * 그래서 이 스크립트는 로컬 전용이다 — 스테이징·프로덕션에 돌리지 않는다.
 * ==========================================================================
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "../src/lib/crypto.js";
import { TAROT } from "../src/lib/config.js";
import { dayKey } from "../src/lib/time.js";

const BASE = "http://127.0.0.1:8787";
if (process.env.TEST_BASE && process.env.TEST_BASE !== BASE) {
  console.error("로컬 전용입니다 — TEST_BASE 를 지우고 돌리세요");
  process.exit(1);
}

let pass = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) pass++;
  else failures.push(name);
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
}

/** 계정 하나 = 쿠키 하나. IP 는 광고 한도와 무관하게 넓게 흩는다 */
function client() {
  let cookie = "";
  const ip = `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const j = await res.json();
    return { status: res.status, data: j.data ?? j };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b) };
}

/**
 * SQL 은 파일로 넘긴다. 윈도에서 `npx.cmd` 는 셸을 거쳐야 뜨는데, 셸은 `--command` 의
 * 공백을 인자 경계로 쪼갠다(그대로 걸렸다).
 */
const SQL_FILE = join(tmpdir(), `test-tarot-${process.pid}.sql`);
function sqlAll(command) {
  writeFileSync(SQL_FILE, command);
  const out = execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "d1", "execute", "minigames-db", "--local", "--json", "--file", `"${SQL_FILE}"`],
    { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 1 << 24 },
  );
  return JSON.parse(out);
}
const sql = (command) => sqlAll(command).at(-1)?.results ?? [];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const today = () => dayKey();

/** 방금 만든 계정의 user_id — 가장 최근에 들어온 suite_user */
const lastUser = () => sql(`SELECT user_id FROM suite_user ORDER BY rowid DESC LIMIT 1`)[0].user_id;

/**
 * 계정 상태를 심는다: 미보유 `missing` 을 뺀 카드 전부 보유(어제 · 뽑기로) + 별가루 + 오늘 뽑을 수 있는 장수.
 * 심은 카드에는 적립을 넣지 않는다 — 그래야 이후의 TAROT_NEW 가 교환분만 남는다.
 */
function seed(uid, { missing = [], dust, adMore = 2, gold = [] }) {
  const miss = new Set(missing);
  const g = new Set(gold);
  const rows = [];
  for (let i = 0; i < TAROT.CARDS; i++) {
    if (!miss.has(i)) rows.push(`(${q(uid)}, ${i}, '2000-01-01', 'draw', ${g.has(i) ? 1 : 0}, ${g.has(i) ? "'2000-01-01'" : "NULL"})`);
  }
  sql(
    `DELETE FROM tarot_coll WHERE user_id = ${q(uid)};` +
      `INSERT INTO tarot_coll (user_id, card_id, first_day, via, gold, gold_day) VALUES ${rows.join(",")};` +
      `INSERT INTO tarot_meta (user_id, welcome_used, updated_at, dust) VALUES (${q(uid)}, 1, 0, ${dust})
         ON CONFLICT (user_id) DO UPDATE SET dust = ${dust}, welcome_used = 1;` +
      // 오늘 행이 아직 없을 수 있다(today 만 부른 계정) — UPDATE 로는 아무것도 안 바뀐다
      `INSERT INTO tarot_daily (user_id, day, ad_more_used) VALUES (${q(uid)}, ${q(today())}, ${adMore})
         ON CONFLICT (user_id, day) DO UPDATE SET ad_more_used = ${adMore};`,
  );
}

// ══════════════════════════════════════════════════════════════
console.log("\n[1] 78장 균등성 — 카이제곱 (표본 78,000 · 유의수준 0.01)");
{
  // 서버 draw 가 부르는 바로 그 함수다(services/tarot.js `randomInt(0, TAROT.CARDS - 1)`).
  // API 로는 하루 3장이라 78,000 표본을 못 모은다.
  const N = 78_000;
  const k = TAROT.CARDS;
  const cnt = new Array(k).fill(0);
  for (let i = 0; i < N; i++) cnt[randomInt(0, k - 1)]++;
  const e = N / k;
  const chi = cnt.reduce((a, o) => a + (o - e) ** 2 / e, 0);
  // 자유도 77, 상위 1% 임계값 108.771 (불완전 감마 역산)
  check("χ² < 108.771 (df 77)", chi < 108.771, `χ²=${chi.toFixed(2)} · 최소 ${Math.min(...cnt)} · 최대 ${Math.max(...cnt)}`);
  check("78장 모두 나온다", cnt.every((c) => c > 0));
}

// ══════════════════════════════════════════════════════════════
console.log("\n[2] 새 계정 — today · draw · collection 응답 형태");
{
  const c = client();
  const t = await c.get("/api/tarot/today");
  check("today 200", t.status === 200, `status=${t.status}`);
  check("cards 78 · fan 22", t.data.cards === 78 && t.data.fan === 22);
  check("마일스톤 20·39·58·78 / 20·20·20·50P",
    JSON.stringify(t.data.milestones) === JSON.stringify([{ n: 20, p: 20 }, { n: 39, p: 20 }, { n: 58, p: 20 }, { n: 78, p: 50 }]));
  check("dust 0 / dust_max 4", t.data.dust === 0 && t.data.dust_max === 4);

  const d = await c.post("/api/tarot/draw", { focus: "day" });
  check("draw 200", d.status === 200, `status=${d.status} ${d.data?.code ?? ""}`);
  check("card_id 0~77", Number.isInteger(d.data.card_id) && d.data.card_id >= 0 && d.data.card_id <= 77, `card=${d.data.card_id}`);
  check("첫 카드는 새 카드 · 별가루 0", d.data.is_new === true && d.data.dust_gained === 0 && d.data.dust === 0);
  check("적립 5(코어)+3(신규)", d.data.gained === 8, `gained=${d.data.gained}`);
  check("응답에 exchanged_card_id · collection_count", "exchanged_card_id" in d.data && d.data.collection_count === 1);

  const col = await c.get("/api/tarot/collection");
  check("collection 78칸", col.data.cells?.length === 78);
  const mine = col.data.cells?.find((x) => x.card_id === d.data.card_id);
  check("뽑은 칸만 via=draw", mine?.via === "draw" && col.data.cells.filter((x) => x.via).length === 1);
}

// ══════════════════════════════════════════════════════════════
console.log("\n[3] 별가루 3 + 미보유 1장 → 중복 뽑기 → 교환 → 78장 완성");
{
  // 무작위로 미보유 카드를 뽑아 버리면(1/78) 중복이 안 생긴다 — 될 때까지 새 계정으로
  let done = false;
  for (let attempt = 0; attempt < 5 && !done; attempt++) {
    const c = client();
    await c.get("/api/tarot/today");
    const uid = lastUser();
    const missing = randomInt(0, 77);
    seed(uid, { missing: [missing], dust: 3 });

    const d = await c.post("/api/tarot/draw", { focus: "work" });
    if (d.data.is_new) continue; // 미보유를 직접 뽑았다 — 다시
    done = true;

    check("중복 → 별가루 +1", d.data.dust_gained === 1);
    check("4가 되어 교환 — 교환 카드는 그 미보유 카드", d.data.exchanged_card_id === missing, `ex=${d.data.exchanged_card_id} missing=${missing}`);
    check("교환 뒤 별가루 0", d.data.dust === 0, `dust=${d.data.dust}`);
    check("도감 78", d.data.collection_count === 78);
    // 코어 5 + 교환 카드 신규 3 + 마일스톤 20+20+20+50 (심은 카드엔 적립이 없으므로 여기서 한꺼번에)
    check("적립 = 5 + 3 + 110", d.data.gained === 118, `gained=${d.data.gained}`);

    const pts = sql(`SELECT key FROM suite_points WHERE user_id = ${q(uid)} ORDER BY key`).map((r) => r.key);
    check("TAROT_NEW 는 교환 카드 1건", pts.filter((k) => k.startsWith("TAROT_NEW:")).join() === `TAROT_NEW:${missing}`, pts.join(" "));
    for (const n of [20, 39, 58, 78]) check(`MILESTONE_TAROT_${n} 1건`, pts.filter((k) => k === `MILESTONE_TAROT_${n}`).length === 1);

    const via = sql(`SELECT via FROM tarot_coll WHERE user_id = ${q(uid)} AND card_id = ${missing}`)[0]?.via;
    check("교환 카드 via=dust", via === "dust");

    // 완성 뒤 — 2단계(SPEC-03): 은색 카드를 뽑으면 금빛이 된다. 별가루는 그대로
    const d2 = await c.post("/api/tarot/draw", { focus: "love" });
    check("완성 뒤 중복(은색) → 금빛 · 별가루 그대로 0 · 교환 없음",
      d2.data.gold_new === true && d2.data.dust === 0 && d2.data.exchanged_card_id === null && d2.data.gold_exchanged_card_id === null,
      `gold_new=${d2.data.gold_new} dust=${d2.data.dust}`);
    check("완성 뒤 마일스톤 재지급 없음 (적립 0 — 코어는 이미 받음 · 금빛 카드별 보상 없음)", d2.data.gained === 0, `gained=${d2.data.gained}`);
    const meta = sql(`SELECT dust, dust_total, exchanged, ex_pending FROM tarot_meta WHERE user_id = ${q(uid)}`)[0];
    check("meta: dust_total 1 · exchanged 1 · ex_pending 0", meta.dust_total === 1 && meta.exchanged === 1 && meta.ex_pending === 0, JSON.stringify(meta));

    const t = await c.get("/api/tarot/today");
    check("today 에 dust · collection_count · gold", t.data.dust === 0 && t.data.collection_count === 78 && t.data.gold_count === 1 && t.data.gold[0] === d2.data.card_id);
  }
  check("시나리오가 실제로 돌았다", done);
}

// ══════════════════════════════════════════════════════════════
console.log("\n[4] 별가루 2에서 중복 1장 → 3 (교환 없음)");
{
  const c = client();
  await c.get("/api/tarot/today");
  const uid = lastUser();
  // 미보유 10장 — 그래도 뽑은 카드가 미보유일 확률 10/78. 그러면 is_new 로 넘어간다
  const missing = Array.from({ length: 10 }, (_, i) => i * 7);
  seed(uid, { missing, dust: 2 });
  const d = await c.post("/api/tarot/draw", { focus: "money" });
  if (d.data.is_new) {
    check("미보유를 뽑으면 별가루 그대로", d.data.dust === 2 && d.data.dust_gained === 0);
  } else {
    check("중복 → 3 · 교환 없음", d.data.dust === 3 && d.data.exchanged_card_id === null, `dust=${d.data.dust}`);
  }
}

// ══════════════════════════════════════════════════════════════
console.log("\n[5] 동시 요청 — 별가루 3에서 중복 2장이 동시에 들어와도 교환은 1번");
{
  const ROUNDS = 6;
  let ran = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const c = client();
    await c.get("/api/tarot/today");
    const uid = lastUser();
    const missing = [3, 41]; // 미보유 2장 — 둘 다 교환되면 이중 교환이다
    seed(uid, { missing, dust: 3 });

    const [a, b] = await Promise.all([
      c.post("/api/tarot/draw", { focus: "day" }),
      c.post("/api/tarot/draw", { focus: "work" }),
    ]);
    check(`#${r + 1} 두 요청 모두 200`, a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
    const res = [a, b].filter((x) => x.status === 200);
    const dups = res.filter((x) => !x.data.is_new).length;
    const exch = res.filter((x) => x.data.exchanged_card_id != null);
    const meta = sql(`SELECT dust, dust_total, exchanged FROM tarot_meta WHERE user_id = ${q(uid)}`)[0];
    const viaDust = sql(`SELECT COUNT(*) AS n FROM tarot_coll WHERE user_id = ${q(uid)} AND via = 'dust'`)[0].n;
    const newPts = sql(`SELECT COUNT(*) AS n FROM suite_points WHERE user_id = ${q(uid)} AND key LIKE 'TAROT_NEW:%'`)[0].n;
    const newCards = res.filter((x) => x.data.is_new).length + viaDust;

    if (dups === 0) continue;
    ran++;
    const expectEx = dups >= 1 ? 1 : 0; // 3 + dups ≥ 4 → 정확히 1번
    check(`#${r + 1} 교환 ${expectEx}번 (중복 ${dups}장)`,
      meta.exchanged === expectEx && viaDust === expectEx && exch.length === expectEx,
      `exchanged=${meta.exchanged} via_dust=${viaDust} 응답=${exch.length} dust=${meta.dust}`);
    check(`#${r + 1} 별가루 보존 (3 + ${dups} − 4·${expectEx})`, meta.dust === 3 + dups - 4 * expectEx && meta.dust_total === dups);
    check(`#${r + 1} TAROT_NEW = 새로 얻은 카드 수`, newPts === newCards, `pts=${newPts} cards=${newCards}`);
  }
  check("동시 시나리오가 한 번 이상 돌았다", ran > 0, `${ran}/${ROUNDS}`);
}

// ══════════════════════════════════════════════════════════════
console.log("\n[6] 교환 카드는 미보유 중 균등 — 미보유 3장 · 교환 300회");
{
  // API 왕복 300회 대신 같은 SQL 을 직접 돌린다 — 서비스 코드의 ③과 같은 식이다.
  const c = client();
  await c.get("/api/tarot/today");
  const uid = lastUser();
  const missing = [5, 40, 70];
  seed(uid, { missing, dust: 0 });
  const unowned = `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 77)
    SELECT i FROM n WHERE i NOT IN (SELECT card_id FROM tarot_coll WHERE user_id = ${q(uid)})`;
  const cmds = [];
  for (let i = 0; i < 300; i++) {
    cmds.push(`SELECT i FROM (${unowned}) ORDER BY i LIMIT 1 OFFSET (${randomInt(0, 2 ** 31 - 1)} % MAX(1, (SELECT COUNT(*) FROM (${unowned}))))`);
  }
  const picks = sqlAll(cmds.join(";\n")).map((x) => x.results[0].i);
  const cnt = Object.fromEntries(missing.map((m) => [m, picks.filter((p) => p === m).length]));
  const chi = missing.reduce((a, m) => a + (cnt[m] - 100) ** 2 / 100, 0);
  check("항상 미보유 3장 중 하나", picks.every((p) => missing.includes(p)));
  check("χ² < 9.21 (df 2, 0.01)", chi < 9.21, JSON.stringify(cnt) + ` χ²=${chi.toFixed(2)}`);
}

// ══════════════════════════════════════════════════════════════
// 2단계 — 금빛 도감 · 숨은 이야기 · 기록 달력 (TAROT-SPEC-03 §6)
// ══════════════════════════════════════════════════════════════
const ALL = Array.from({ length: TAROT.CARDS }, (_, i) => i);
const goldExcept = (silver) => ALL.filter((i) => !silver.includes(i));

/** 새 계정 하나 + 상태 심기 */
async function freshUser(st) {
  const c = client();
  await c.get("/api/tarot/today");
  const uid = lastUser();
  seed(uid, st);
  return { c, uid };
}

console.log("\n[7] 78장 완성 전에는 금빛 규칙이 동작하지 않는다");
{
  let ran = false;
  for (let k = 0; k < 5 && !ran; k++) {
    const { c, uid } = await freshUser({ missing: [randomInt(0, 77)], dust: 0 });
    const d = await c.post("/api/tarot/draw", { focus: "day" });
    if (d.data.is_new) continue;
    ran = true;
    const g = sql(`SELECT COUNT(*) AS n FROM tarot_coll WHERE user_id = ${q(uid)} AND gold = 1`)[0].n;
    check("완성 전 중복 → 금빛 0 · 별가루 +1", d.data.gold_new === false && g === 0 && d.data.dust === 1, `gold=${g} dust=${d.data.dust}`);
  }
  check("시나리오가 돌았다", ran);
}

console.log("\n[8] 금빛 카드가 겹치면 별가루 +1 (은색 2장 · 별가루 2)");
{
  let ran = false;
  for (let k = 0; k < 5 && !ran; k++) {
    const silver = [10, 60];
    const { c } = await freshUser({ dust: 2, gold: goldExcept(silver) });
    const d = await c.post("/api/tarot/draw", { focus: "day" });
    if (silver.includes(d.data.card_id)) {
      check("은색을 뽑으면 그 카드가 금빛 · 별가루 그대로", d.data.gold_new === true && d.data.dust === 2);
      continue;
    }
    ran = true;
    check("금빛 중복 → 별가루 3 · 교환 없음", d.data.gold_new === false && d.data.dust === 3 && d.data.gold_exchanged_card_id === null, `dust=${d.data.dust}`);
  }
  check("시나리오가 돌았다", ran);
}

console.log("\n[9] 별가루 3 + 은색 1장 → 금빛 중복 → 그 은색이 금빛 → 금빛 78 · 금빛 마일스톤");
{
  let ran = false;
  for (let k = 0; k < 5 && !ran; k++) {
    const silver = randomInt(0, 77);
    const { c, uid } = await freshUser({ dust: 3, gold: goldExcept([silver]) });
    const d = await c.post("/api/tarot/draw", { focus: "work" });
    if (d.data.card_id === silver) continue;
    ran = true;
    check("교환 카드 = 남은 은색 한 장", d.data.gold_exchanged_card_id === silver, `ex=${d.data.gold_exchanged_card_id} silver=${silver}`);
    check("별가루 0 · 금빛 78", d.data.dust === 0 && d.data.gold_count === 78);
    const pts = sql(`SELECT key FROM suite_points WHERE user_id = ${q(uid)}`).map((r) => r.key);
    for (const n of [20, 39, 58, 78]) check(`MILESTONE_TAROT_GOLD_${n} 1건`, pts.filter((x) => x === `MILESTONE_TAROT_GOLD_${n}`).length === 1);
    check("금빛 카드별 적립 없음 (TAROT_NEW 0건)", pts.filter((x) => x.startsWith("TAROT_NEW:")).length === 0, pts.join(" "));
    const row = sql(`SELECT gold, gold_via, gold_day FROM tarot_coll WHERE user_id = ${q(uid)} AND card_id = ${silver}`)[0];
    check("교환 카드 gold_via=dust · gold_day 오늘", row.gold === 1 && row.gold_via === "dust" && row.gold_day === today());

    const d2 = await c.post("/api/tarot/draw", { focus: "love" });
    check("금빛 78 뒤 → 별가루만 1 · 교환 없음", d2.data.dust === 1 && d2.data.gold_exchanged_card_id === null && d2.data.gold_new === false);
    check("금빛 마일스톤 재지급 없음", d2.data.gained === 0, `gained=${d2.data.gained}`);
    check("ex_pending 0", sql(`SELECT ex_pending FROM tarot_meta WHERE user_id = ${q(uid)}`)[0].ex_pending === 0);
  }
  check("시나리오가 돌았다", ran);
}

console.log("\n[10] 동시 요청 — 별가루 3 · 은색 2장, 금빛 중복 2장이 동시에 들어와도 금빛 교환은 1번");
{
  let ran = 0;
  for (let r = 0; r < 6; r++) {
    const silver = [3, 41];
    const { c, uid } = await freshUser({ dust: 3, gold: goldExcept(silver) });
    const [a, b] = await Promise.all([
      c.post("/api/tarot/draw", { focus: "day" }),
      c.post("/api/tarot/draw", { focus: "work" }),
    ]);
    const res = [a, b].filter((x) => x.status === 200);
    if (res.length < 2 || res.some((x) => x.data.gold_new)) continue; // 은색을 직접 뽑은 회차는 건너뛴다
    ran++;
    const viaDust = sql(`SELECT COUNT(*) AS n FROM tarot_coll WHERE user_id = ${q(uid)} AND gold_via = 'dust'`)[0].n;
    const meta = sql(`SELECT dust FROM tarot_meta WHERE user_id = ${q(uid)}`)[0];
    check(`#${r + 1} 금빛 교환 1번 · 별가루 1`,
      viaDust === 1 && meta.dust === 1 && res.filter((x) => x.data.gold_exchanged_card_id != null).length === 1,
      `via_dust=${viaDust} dust=${meta.dust}`);
  }
  check("동시 시나리오가 한 번 이상 돌았다", ran > 0, `${ran}/6`);
}

console.log("\n[11] 금빛 교환 카드는 은색 중 균등 — 은색 3장 · 300회");
{
  const SIL = [5, 40, 70];
  const { uid } = await freshUser({ dust: 0, gold: goldExcept(SIL) });
  const silver = `SELECT card_id FROM tarot_coll WHERE user_id = ${q(uid)} AND gold = 0`;
  const cmds = [];
  for (let i = 0; i < 300; i++) {
    cmds.push(`${silver} ORDER BY card_id LIMIT 1 OFFSET (${randomInt(0, 2 ** 31 - 1)} % MAX(1, (SELECT COUNT(*) FROM (${silver}))))`);
  }
  const picks = sqlAll(cmds.join(";\n")).map((x) => x.results[0].card_id);
  const cnt = Object.fromEntries(SIL.map((m) => [m, picks.filter((p) => p === m).length]));
  const chi = SIL.reduce((a, m) => a + (cnt[m] - 100) ** 2 / 100, 0);
  check("항상 은색 3장 중 하나", picks.every((p) => SIL.includes(p)));
  check("χ² < 9.21 (df 2, 0.01)", chi < 9.21, JSON.stringify(cnt) + ` χ²=${chi.toFixed(2)}`);
}

console.log("\n[12] 숨은 이야기 78줄");
{
  const { STORIES } = await import("../public/tarot/tarot-story.js");
  check("78줄 · 빈 줄 없음", STORIES.length === 78 && STORIES.every((t) => t && t.length >= 20));
}

console.log("\n[13] 기록 달력 · 작년 오늘");
{
  const c = client();
  await c.get("/api/tarot/today");
  const uid = lastUser();
  const t = today();
  const month = t.slice(0, 7);
  const ly = `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;
  // 이번 달 1일: 두 장(첫 카드만 보여야 한다) · 작년 오늘: 한 장 · 2일: 행은 있지만 뽑지 않음
  sql(
    `INSERT INTO tarot_daily (user_id, day, draws) VALUES
       (${q(uid)}, '${month}-01', '[{"c":5,"f":"love"},{"c":9,"f":"work"}]'),
       (${q(uid)}, '${ly}', '[{"c":17,"f":"day"}]'),
       (${q(uid)}, '${month}-02', '[]')
     ON CONFLICT (user_id, day) DO UPDATE SET draws = excluded.draws`,
  );
  const cal = await c.get(`/api/tarot/calendar?month=${month}`);
  const d1 = cal.data.days?.find((d) => d.day === `${month}-01`);
  check("달력 200", cal.status === 200);
  check("첫 카드만 (5 · love)", d1?.card_id === 5 && d1?.focus === "love");
  check("뽑지 않은 날은 없다", !cal.data.days.some((d) => d.day === `${month}-02`));
  const bad = await c.get(`/api/tarot/calendar?month=2026-13`);
  check("잘못된 month → 400", bad.status === 400);
  const td = await c.get("/api/tarot/today");
  check("작년 오늘 = 17", td.data.last_year?.card_id === 17 && td.data.last_year?.day === ly, JSON.stringify(td.data.last_year));
  const td2 = await client().get("/api/tarot/today");
  check("기록 없으면 작년 오늘 없음", td2.data.last_year === null);
}

console.log(`\n${pass} 통과 · ${failures.length} 실패`);
if (failures.length) {
  console.log("실패:\n  " + failures.join("\n  "));
  process.exit(1);
}
