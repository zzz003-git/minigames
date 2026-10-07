/**
 * 🔬 오늘의 선택 — 「지난 선택 열기」(M-04) 서버 시험 (REQ-47)
 * ==========================================================================
 *
 *   npm run dev            (다른 터미널 · 로컬 D1)
 *   node scripts/test-mind-archive.mjs
 *
 * 지난 날 기록이 필요하므로 **로컬 D1 에 직접 심는다** — 로컬 전용이다.
 * ==========================================================================
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "../src/lib/crypto.js";
import { dayKey } from "../src/lib/time.js";
import { MIND_INDEX } from "../public/mind/mind-index.js";
import { expOfDay } from "../public/mind/mind-pick.js";

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

const SQL_FILE = join(tmpdir(), `test-mind-${process.pid}.sql`);
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
const back = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};
const dowOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
const rot = (day) => expOfDay(MIND_INDEX.experiments, dowOf(day), day).id;

/** 아무 채점표 — 문항 4 · 선택지 5. 유형 0 이 나오게 */
const sheet = () => ({
  questions: Array.from({ length: 4 }, () => ({ opts: Array.from({ length: 5 }, (_, i) => ({ ty: i % 4, ax: [1, 1] })) })),
  answers: [0, 0, 0, 0],
});
const points = (uid) => sql(`SELECT COALESCE(SUM(amount),0) AS p FROM suite_points WHERE user_id = ${q(uid)}`)[0].p;

async function freshUser() {
  const c = client();
  await c.get("/api/mind/state");
  return { c, uid: lastUser() };
}

console.log("\n[1] 광고 → 가장 최근 안 한 날이 열린다 · 열 것 표시");
let shared;
{
  const { c, uid } = await freshUser();
  const s0 = await c.get("/api/mind/state");
  check("처음엔 6일 모두 열 수 있음 · 열어 둔 것 없음", s0.data.archive?.available === 6 && s0.data.archive?.opened?.length === 0, JSON.stringify(s0.data.archive));
  const r = await c.post("/ad/reward", { trigger: "MIND_ARCHIVE" });
  check("광고 보상 200 · 어제가 열림", r.status === 200 && r.data.reward?.opened?.day === back(1), JSON.stringify(r.data.reward?.opened));
  check("열린 실험 = 어제의 회전 결과", r.data.reward?.opened?.exp_id === rot(back(1)));
  const s1 = await c.get("/api/mind/state");
  check("state: 열 수 있음 5 · 열어 둠 1", s1.data.archive.available === 5 && s1.data.archive.opened[0]?.day === back(1));
  shared = { c, uid };
}

console.log("\n[2] 지난 선택 제출 — 적립 0 · 오늘 행 그대로 · 도감·지도 반영");
{
  const { c, uid } = shared;
  const before = points(uid);
  const axBefore = (await c.get("/api/mind/state")).data.axes.reduce((a, b) => a + b, 0);
  const r = await c.post("/api/mind/submit", { exp_id: rot(back(1)), archive_day: back(1), ...sheet() });
  check("제출 200 · gained 0", r.status === 200 && r.data.gained === 0, `status=${r.status} ${r.data.code ?? ""}`);
  check("적립 합계 그대로", points(uid) === before, `${before}→${points(uid)}`);
  const todayRow = sql(`SELECT done FROM mind_daily WHERE user_id = ${q(uid)} AND day = ${q(today)}`)[0];
  check("오늘 행은 done 아님(오늘의 선택은 그대로 남음)", !todayRow?.done);
  const s = await c.get("/api/mind/state");
  check("state.done false 그대로", s.data.done === false);
  check("도감에 반영", s.data.collection.includes(`${rot(back(1))}:${r.data.type_idx}`));
  check("지도 축 반영", s.data.axes.reduce((a, b) => a + b, 0) > axBefore);
  const suite = sql(`SELECT mind_done FROM suite_daily WHERE user_id = ${q(uid)} AND day = ${q(today)}`)[0];
  check("허브(3종) 오늘 완료로 찍히지 않음", !suite?.mind_done);
  const again = await c.post("/api/mind/submit", { exp_id: rot(back(1)), archive_day: back(1), ...sheet() });
  check("같은 날 다시 → 409", again.status === 409, `status=${again.status}`);
  // 그 뒤 오늘의 선택은 여전히 할 수 있고 적립이 붙는다
  const t = await c.post("/api/mind/submit", { exp_id: rot(today), ...sheet() });
  check("오늘의 선택은 그대로 할 수 있음(적립 5+)", t.status === 200 && t.data.gained >= 5, `gained=${t.data.gained}`);
}

console.log("\n[3] 거절 — 7일 전 · 오늘 · 이미 한 날 · 안 연 날 · 다른 실험 · 모르는 실험");
{
  const { c, uid } = await freshUser();
  const r7 = await c.post("/api/mind/submit", { exp_id: rot(back(7)), archive_day: back(7), ...sheet() });
  check("7일 전 → 400 범위 밖", r7.status === 400 && r7.data.code === "ARCHIVE_RANGE", `${r7.status} ${r7.data.code}`);
  const r0 = await c.post("/api/mind/submit", { exp_id: rot(today), archive_day: today, ...sheet() });
  check("오늘 날짜 → 400 범위 밖", r0.status === 400 && r0.data.code === "ARCHIVE_RANGE", `${r0.status} ${r0.data.code}`);
  sql(`INSERT INTO mind_daily (user_id, day, done, exp_id, type_idx) VALUES (${q(uid)}, ${q(back(2))}, 1, ${q(rot(back(2)))}, 1)`);
  const rd = await c.post("/api/mind/submit", { exp_id: rot(back(2)), archive_day: back(2), ...sheet() });
  check("이미 한 날 → 409", rd.status === 409 && rd.data.code === "ALREADY_DONE", `${rd.status} ${rd.data.code}`);
  const rn = await c.post("/api/mind/submit", { exp_id: rot(back(3)), archive_day: back(3), ...sheet() });
  check("광고로 안 연 날 → 409", rn.status === 409 && rn.data.code === "ARCHIVE_NOT_OPENED", `${rn.status} ${rn.data.code}`);
  await c.post("/ad/reward", { trigger: "MIND_ARCHIVE" }); // 어제(1일 전)가 열림 — 2일 전은 이미 함
  const other = MIND_INDEX.experiments.find((e) => e.id !== rot(back(1))).id;
  const rm = await c.post("/api/mind/submit", { exp_id: other, archive_day: back(1), ...sheet() });
  check("그날 회전과 다른 실험 → 400", rm.status === 400 && rm.data.code === "ARCHIVE_MISMATCH", `${rm.status} ${rm.data.code}`);
  const ru = await c.post("/api/mind/submit", { exp_id: "no_such_exp", ...sheet() });
  check("목록에 없는 실험(오늘의 선택) → 400", ru.status === 400);
}

console.log("\n[4] 동시 2건 — 같은 지난 날을 두 번 동시에 내도 한 번만");
{
  let ok = 0;
  for (let k = 0; k < 4; k++) {
    const { c, uid } = await freshUser();
    await c.post("/ad/reward", { trigger: "MIND_ARCHIVE" });
    const body = { exp_id: rot(back(1)), archive_day: back(1), ...sheet() };
    const [a, b] = await Promise.all([c.post("/api/mind/submit", body), c.post("/api/mind/submit", body)]);
    const okCount = [a, b].filter((x) => x.status === 200).length;
    const ax = (await c.get("/api/mind/state")).data.axes.reduce((s, n) => s + n, 0);
    const coll = sql(`SELECT COUNT(*) AS n FROM mind_coll WHERE user_id = ${q(uid)}`)[0].n;
    if (okCount === 1 && ax === 4 && coll === 1 && points(uid) === 0) ok++;
    else console.log(`    #${k} 200=${okCount} 축합=${ax} 도감=${coll} 적립=${points(uid)}`);
  }
  check("4회 모두 한 번만 반영(축 +4 한 번 · 도감 1 · 적립 0)", ok === 4, `${ok}/4`);
}

console.log("\n[5] 열 날이 없으면 광고 보상 거절 · 카드 숨김 조건");
{
  const { c, uid } = await freshUser();
  for (let i = 1; i <= 6; i++) {
    sql(`INSERT INTO mind_daily (user_id, day, done, exp_id, type_idx) VALUES (${q(uid)}, ${q(back(i))}, 1, ${q(rot(back(i)))}, 0)`);
  }
  const s = await c.get("/api/mind/state");
  check("6일 모두 함 → available 0 (화면은 광고 카드를 숨김)", s.data.archive.available === 0);
  const r = await c.post("/ad/reward", { trigger: "MIND_ARCHIVE" });
  check("광고 보상 → 409 ARCHIVE_EMPTY", r.status === 409 && r.data.code === "ARCHIVE_EMPTY", `${r.status} ${r.data.code}`);
  const views = sql(`SELECT COUNT(*) AS n FROM ad_views WHERE user_id = ${q(uid)}`)[0].n;
  check("광고 기록 남지 않음(횟수 안 씀)", views === 0, `views=${views}`);
}

console.log("\n[6] 오늘 회전이 아닌 장면 → 409 DAY_CHANGED · 축 +1 통일 · 분포 닫힘 (REQ-62 ⑨⑬⑭)");
{
  const { c, uid } = await freshUser();
  const other = MIND_INDEX.experiments.find((e) => e.id !== rot(today)).id;
  const r = await c.post("/api/mind/submit", { exp_id: other, ...sheet() });
  // 이 시험의 client 는 응답에 `data` 가 있으면 그것을 꺼내 준다 — 오류 봉투의 `data` 가 곧 r.data 다
  check("409 · data 에 기대 id·day", r.status === 409 &&
    r.data.expected_exp_id === rot(today) && r.data.day === today, JSON.stringify(r.data));
  const rows = sql(`SELECT COUNT(*) AS n FROM mind_daily WHERE user_id = ${q(uid)}`)[0].n;
  check("mind_daily 행 없음 · 적립 없음", rows === 0 && points(uid) === 0);

  // −1 선택지 — 축은 그래도 +1
  const neg = {
    questions: Array.from({ length: 4 }, () => ({ opts: Array.from({ length: 5 }, (_, i) => ({ ty: i % 4, ax: [3, -1] })) })),
    answers: [0, 0, 0, 0],
  };
  const ok = await c.post("/api/mind/submit", { exp_id: rot(today), ...neg });
  check("−1 선택지 4개 → 축 3 이 +4", ok.status === 200 && ok.data.axes_gain?.[3] === 4, JSON.stringify(ok.data.axes_gain));
  const s = await c.get("/api/mind/state");
  check("state.dist_open false", s.data.dist_open === false);
  sql(`UPDATE mind_daily SET ad_stats = 1 WHERE user_id = ${q(uid)}`);
  const st = await c.get("/api/mind/stats");
  check("닫힌 stats 에 total 없음", st.data.open === false && !("total" in st.data), JSON.stringify(st.data));
}

console.log(`\n${pass} 통과 · ${failures.length} 실패`);
if (failures.length) {
  console.log("실패:\n  " + failures.join("\n  "));
  process.exit(1);
}
