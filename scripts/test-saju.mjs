/**
 * 🌤️ 오늘의 사주 — 서버 시험 (REQ-62 ①②③⑫⑰⑭)
 * ==========================================================================
 *
 *   npm run dev            (다른 터미널 · 로컬 D1)
 *   node scripts/test-saju.mjs
 *
 * 정정 창(24시간)·30일 간격을 보려면 시각을 되돌려야 하므로 **로컬 D1 에 직접 심는다** — 로컬 전용이다.
 * ==========================================================================
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "../src/lib/crypto.js";
import { dayKey } from "../src/lib/time.js";
import { natalChart, dayGanzhi } from "../src/lib/saju-calendar.js";

const BASE = "http://127.0.0.1:8787";
let pass = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) pass++;
  else failures.push(name);
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
}

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

const SQL_FILE = join(tmpdir(), `test-saju-${process.pid}.sql`);
function sql(command) {
  writeFileSync(SQL_FILE, command);
  const out = execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "d1", "execute", "minigames-db", "--local", "--json", "--file", `"${SQL_FILE}"`],
    { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 1 << 24 },
  );
  return JSON.parse(out).at(-1)?.results ?? [];
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lastUser = () => sql(`SELECT user_id FROM suite_user ORDER BY rowid DESC LIMIT 1`)[0].user_id;

const today = dayKey();
const back = (n, from = today) => {
  const [y, m, d] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};
// 생일 일주 = 오늘 일진 (60일 주기) — 만 14세가 넘게 6000일(≈16.4년) 전
const SAME_DAY_BIRTH = back(6000);

async function freshUser() {
  const c = client();
  await c.get("/api/saju/state");
  return { c, uid: lastUser() };
}
const profileOf = (uid) => JSON.parse(sql(`SELECT saju_profile FROM suite_user WHERE user_id = ${q(uid)}`)[0].saju_profile ?? "null");

console.log("\n[0] 만세력 — 시·분 입력이 보정 규칙대로 (REQ-62 ② 확인 표)");
{
  const hb = (d, h, m) => natalChart(d, h, m).hour.branch;
  const dIdx = (d, h, m) => natalChart(d, h, m).day;
  check("1990-03-14 23:15 → 해시", hb("1990-03-14", 23, 15) === 11);
  check("1990-03-14 23:30 → 자시 · 다음 날 일주", hb("1990-03-14", 23, 30) === 0 && dIdx("1990-03-14", 23, 30).stem === dayGanzhi("1990-03-15") % 10);
  check("01:15 → 자 · 01:30 → 축", hb("1990-03-14", 1, 15) === 0 && hb("1990-03-14", 1, 30) === 1);
  check("00:00 → 자 · 그날 일주", hb("1990-03-14", 0, 0) === 0 && dIdx("1990-03-14", 0, 0).stem === dayGanzhi("1990-03-14") % 10);
  check("1958-06-01 23:00 → 자 (UTC+8:30 시기 보정 없음)", hb("1958-06-01", 23, 0) === 0);
  check("1987-06-01 02:00 → 자 · 03:00 → 축 (서머타임 −90분)", hb("1987-06-01", 2, 0) === 0 && hb("1987-06-01", 3, 0) === 1);
}

console.log("\n[1] 관계 키 = 해석 DB 키 · 재열람 리딩 (①)");
{
  const { c } = await freshUser();
  await c.post("/api/saju/profile", { birth: SAME_DAY_BIRTH, hour: null });
  const t = await c.post("/api/saju/today", {});
  check("일주 = 오늘 일진 → relation 'same'", t.data.reading?.relation === "same", JSON.stringify(t.data.reading));
  const s = await c.get("/api/saju/state");
  check("state.reading 이 꽂을 때와 같다", s.data.reading?.relation === "same" && s.data.reading?.ten_god === t.data.reading.ten_god,
    JSON.stringify(s.data.reading));
  check("state.dist_open = false (표본 미달)", s.data.dist_open === false);
}

console.log("\n[2] 24시간 1회 정정 · 정정해도 오늘 십신 고정 (⑫ ①)");
{
  const { c, uid } = await freshUser();
  const r1 = await c.post("/api/saju/profile", { birth: "1990-03-14", hour: 23, minute: 15 });
  check("첫 등록 200 · minute 저장", r1.status === 200 && profileOf(uid).minute === 15 && profileOf(uid).fix_used === false);
  const s0 = await c.get("/api/saju/state");
  check("state.profile_change.fix_open", s0.data.profile_change?.fix_open === true && s0.data.profile_change.next_day === null);
  const t = await c.post("/api/saju/today", {});
  const god = t.data.reading.ten_god;
  // 일간이 다른 생일로 고친다
  let other = "1990-03-15";
  for (let i = 15; natalChart(other).day.stem === natalChart("1990-03-14", 23, 15).day.stem; i++) other = `1990-03-${i + 1}`;
  const r2 = await c.post("/api/saju/profile", { birth: other, hour: null });
  check("정정 200", r2.status === 200, `status=${r2.status}`);
  const s = await c.get("/api/saju/state");
  check("정정 뒤 reading.ten_god 그대로", s.data.reading?.ten_god === god, `${god} → ${s.data.reading?.ten_god}`);
  check("허브 saju.key 그대로", s.data.suite.saju.key === String(god));
  sql(`UPDATE saju_daily SET ad_stats = 1 WHERE user_id = ${q(uid)}`);
  const st = await c.get("/api/saju/stats");
  check("stats.mine = 꽂을 때 십신", st.data.mine === String(god), `mine=${st.data.mine}`);
  check("닫힌 stats 에 total 없음", st.data.open === false && !("total" in st.data), JSON.stringify(st.data));
  const r3 = await c.post("/api/saju/profile", { birth: "1990-03-14", hour: null });
  const next = back(-30);
  const [, nm, nd] = next.split("-").map(Number);
  check("두 번째 → 429 · 다음 가능일 = 오늘+30", r3.status === 429 && r3.data.message === `${nm}월 ${nd}일부터 바꿀 수 있어요.`, r3.data.message);
  check("state.next_day = 오늘+30", (await c.get("/api/saju/state")).data.profile_change.next_day === next);
}

console.log("\n[3] 없는 날짜 거부 (③)");
{
  const a = await (await freshUser()).c.post("/api/saju/profile", { birth: "1976-02-30" });
  const b = await (await freshUser()).c.post("/api/saju/profile", { birth: "1976-02-29" });
  const d = await (await freshUser()).c.post("/api/saju/profile", { birth: "1977-02-29" });
  check("1976-02-30 → 400 · 1976-02-29 → 200 · 1977-02-29 → 400", a.status === 400 && b.status === 200 && d.status === 400,
    `${a.status} ${b.status} ${d.status}`);
  const { c, uid } = await freshUser();
  sql(`UPDATE suite_user SET saju_profile = '{"birth":"1976-02-30","hour":null}', saju_profile_changed_day = '2000-01-01' WHERE user_id = ${q(uid)}`);
  const s = await c.get("/api/saju/state");
  const t = await c.post("/api/saju/today", {});
  check("이미 저장된 없는 날짜 → state·today 정상", s.status === 200 && t.status === 200, `${s.status} ${t.status}`);
  const e = await c.post("/api/saju/profile", { birth: "1976-02-30" });
  check("같은 날짜로 정정 → 400", e.status === 400);
}

console.log("\n[4] 옛 12칸 저장값 — 읽을 때 가운데 시각으로 (②)");
{
  const { c, uid } = await freshUser();
  sql(`UPDATE suite_user SET saju_profile = '{"birth":"1990-03-14","hour":1}', saju_profile_changed_day = '2000-01-01' WHERE user_id = ${q(uid)}`);
  const s = await c.get("/api/saju/state");
  check("옛 hour 1 → 02:00 · 시주 축", s.data.profile.hour === 2 && s.data.profile.minute === 0 && s.data.chart.hour.branch === 1,
    JSON.stringify(s.data.profile));
  sql(`UPDATE suite_user SET saju_profile = '{"birth":"1990-03-14","hour":23}' WHERE user_id = ${q(uid)}`);
  const s2 = await c.get("/api/saju/state");
  const before = natalChart("1990-03-14", 23, 0).day;
  check("옛 hour 23 → 00:00 · 시주 자 · 일주 불변", s2.data.profile.hour === 0 && s2.data.chart.hour.branch === 0 &&
    s2.data.chart.day.stem === before.stem && s2.data.chart.day.branch === before.branch);
  check("저장값은 그대로", profileOf(uid).hour === 23 && !("minute" in profileOf(uid)));
}

console.log("\n[5] 정정 창 지남 · 30일 경과 · 옛 프로필 (⑫)");
{
  const { c, uid } = await freshUser();
  await c.post("/api/saju/profile", { birth: "1990-03-14", hour: null });
  const p = profileOf(uid);
  sql(`UPDATE suite_user SET saju_profile = ${q(JSON.stringify({ ...p, set_at: p.set_at - 25 * 3600e3 }))} WHERE user_id = ${q(uid)}`);
  check("set_at 25시간 전 → 429", (await c.post("/api/saju/profile", { birth: "1990-03-15" })).status === 429);
  sql(`UPDATE suite_user SET saju_profile_changed_day = ${q(back(30))} WHERE user_id = ${q(uid)}`);
  check("변경일 30일 전 → 200", (await c.post("/api/saju/profile", { birth: "1990-03-15" })).status === 200);

  const o = await freshUser();
  sql(`UPDATE suite_user SET saju_profile = '{"birth":"1990-03-14","hour":null}', saju_profile_changed_day = ${q(today)} WHERE user_id = ${q(o.uid)}`);
  check("옛 프로필(필드 없음) · 오늘 변경 → 429 (30일 규칙만)", (await o.c.post("/api/saju/profile", { birth: "1990-03-15" })).status === 429);
}

console.log("\n[6] 지우기 — 생일만 · 도장 유지 · 바로 재등록 · 재등록엔 정정 창 없음 (⑰)");
{
  const { c, uid } = await freshUser();
  await c.post("/api/saju/profile", { birth: "1990-03-14", hour: 5, minute: 40 });
  await c.post("/api/saju/today", {});
  const stamps = () => sql(`SELECT COUNT(*) AS n FROM saju_stamp WHERE user_id = ${q(uid)}`)[0].n;
  const n0 = stamps();
  const d = await c.post("/api/saju/profile/delete", {});
  check("지우기 200 · deleted", d.status === 200 && d.data.deleted === true);
  const row = sql(`SELECT saju_profile, saju_profile_changed_day FROM suite_user WHERE user_id = ${q(uid)}`)[0];
  check("saju_profile NULL · 변경일 남음 · 도장 그대로", row.saju_profile === null && row.saju_profile_changed_day === today && stamps() === n0 && n0 === 1);
  check("state.registered false", (await c.get("/api/saju/state")).data.registered === false);
  check("미등록에서 다시 지우기 → 200 (멱등)", (await c.post("/api/saju/profile/delete", {})).status === 200);
  const r = await c.post("/api/saju/profile", { birth: "1991-01-01", hour: null });
  check("같은 날 재등록 → 200", r.status === 200, `status=${r.status}`);
  check("재등록엔 정정 창 없음 (fix_used true)", profileOf(uid).fix_used === true);
  check("재등록 직후 정정 → 429", (await c.post("/api/saju/profile", { birth: "1991-01-02" })).status === 429);
  const s = await c.get("/api/saju/state");
  check("재등록 뒤 도장 그대로 · 오늘 done 유지", s.data.stamp_count === 1 && s.data.done === true);
}

console.log("\n[7] v2 서버 필드 — 열흘 지급 여부 · 금액 · 문구 · 나이 (REQ-63 사주)");
{
  const { c, uid } = await freshUser();
  await c.post("/api/saju/profile", { birth: "1990-03-14", hour: null });
  const s0 = await c.get("/api/saju/state");
  check("soon_paid 6칸 false · grand_paid false · 가액·예고 금액은 서버 값",
    s0.data.soon_paid?.length === 6 && s0.data.soon_paid.every((x) => x === false) && s0.data.grand_paid === false &&
      s0.data.soon_bonus === 20 && s0.data.grand_bonus === 100 && s0.data.core_points === 5, JSON.stringify(s0.data.soon_paid));
  const t = await c.post("/api/saju/today", {});
  check("today 응답 gain_detail = daily 5 + new 3",
    t.data.gain_detail?.some((g) => g.kind === "daily" && g.p === 5) && t.data.gain_detail?.some((g) => g.kind === "new" && g.p === 3),
    JSON.stringify(t.data.gain_detail));
  const again = await c.post("/api/saju/today", {});
  check("ALREADY_DONE 문구 「오늘 운세는 이미 열었어요.」", again.status === 409 && again.data.message === "오늘 운세는 이미 열었어요.", again.data.message);
  const soon = Math.floor(dayGanzhi(today) / 10);
  sql(`INSERT OR IGNORE INTO suite_points (user_id, key, reason, amount, day, created_at) VALUES (${q(uid)}, 'MILESTONE_SAJU_SOON:${soon}', 'MILESTONE_SAJU_SOON', 20, ${q(today)}, 0)`);
  const s1 = await c.get("/api/saju/state");
  check("지급된 열흘 → soon_paid[그 칸] true", s1.data.soon_paid[soon] === true && s1.data.soon_paid.filter(Boolean).length === 1);

  // 만 14세 — 생일 당일 통과, 하루 전 거부 · 1930 이전 거부
  const y14 = Number(today.slice(0, 4)) - 14;
  const b14 = `${y14}${today.slice(4)}`;
  const ok14 = await (await freshUser()).c.post("/api/saju/profile", { birth: b14 });
  const tomorrow14 = `${y14}${back(-1).slice(4)}`;
  const ng14 = await (await freshUser()).c.post("/api/saju/profile", { birth: tomorrow14 });
  check("14세 생일 당일 200 · 하루 모자라면 403", ok14.status === 200 && ng14.status === 403 && ng14.data.code === "TOO_YOUNG",
    `${ok14.status} ${ng14.status}`);
  const old = await (await freshUser()).c.post("/api/saju/profile", { birth: "1929-12-31" });
  check("1930 이전 → 400 OUT_OF_RANGE", old.status === 400 && old.data.code === "OUT_OF_RANGE", `${old.status} ${old.data.code}`);
}

console.log(`\n${pass} 통과 · ${failures.length} 실패`);
if (failures.length) {
  console.log("실패:\n  " + failures.join("\n  "));
  process.exit(1);
}
