/**
 * ✍✍ 너의스토리2 — **한 바퀴 실물 시연** (0원 · 로컬)
 * ==========================================================================
 *
 *   npm run dev        (다른 터미널)
 *   npm run test:ys2
 *
 * 지시요청 `yourstory2_devrequest_20260828.md` §2 의 완료 판정 —
 * 「접수 → 캐스팅 보드 → 열람 → 선반의 한 바퀴」를 로컬에서 실제로 돈다.
 *
 * ── 왜 PC 워커를 부르지 않는가 ──────────────────────────────────────────
 * 진짜 주문 한 건은 그림값만 798원이고, 그 돈은 **이 구간이 검증하는 것과 무관한
 * 자리**(LLM·이미지 생성)에서 나간다. 여기서 봐야 하는 것은 클라우드 쪽 왕복이라,
 * PC 워커가 하는 보고(`/ys/w/*`)를 이 스크립트가 **대신 친다**. 워커가 실제로
 * 보내는 것과 같은 모양이고, 조판본도 2차 파일럿의 **실물 한 장**을 올린다.
 *
 * **못 보는 것도 적어 둔다** — 이 시연은 PC 파이프라인이 캐스팅 결과를 실제로
 * 이 모양으로 보내는지까지는 보증하지 못한다(그쪽은 별도 지시서의 몫이다).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { YS_ORDER_ID_RE } from "../src/lib/config.js";
import { trackForJob } from "../src/routes/ys-worker.js";

const BASE = process.env.TEST_BASE ?? "http://127.0.0.1:8787";
const WORKER_SECRET = process.env.YS_WORKER_SECRET ?? "local-ys2-e2e";
const PART = join(process.cwd(), "..", "yourstory", "_scratch", "ys2_pilot2",
                  "orders", "YS2-20260828-0002", "final", "part01.jpg");

let cookie = "";
let pass = 0;
const fails = [];

const ok = (cond, what, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${what}`);
  } else {
    fails.push(`${what}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${what}  ${detail}`);
  }
};

async function call(method, path, { body, headers, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body && !raw ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : null;
  return { status: res.status, data };
}

const asWorker = (extra = {}) => ({ "x-ys-worker": WORKER_SECRET, ...extra });
const cut = (v) => JSON.stringify(v ?? null).slice(0, 140);

// ── ⓪ 0원 단위 검사 — 서버를 안 띄우고도 도는 것부터 ──────────────────
console.log("\n⓪ 트랙 판정 (`trackForJob`) · 주문 ID 규칙");
ok(trackForJob({ id: "YS2-20260831-0001", track: "ys2" }).track === "ys2",
   "track 값이 있으면 그대로 쓴다");
ok(trackForJob({ id: "YS-20260831-0001", track: null }).track === "ys1",
   "빈 값은 ID 접두로 잇는다 (TRACK_STRICT=false)");
ok(trackForJob({ id: "YS2-20260831-0001", track: null }).track === "ys2",
   "빈 값 + YS2 접두 → ys2");
ok(trackForJob({ id: "YS-20260831-0001", track: "YS1" }).track === null,
   "값이 있는데 모르는 것은 반려한다");
ok(trackForJob({ id: "YS-20260831-0001", track: null }).warn !== null,
   "이어 붙인 트랙은 경고를 남긴다 (조용하지 않게)");
ok(YS_ORDER_ID_RE.test("YS2-20260831-0001") && YS_ORDER_ID_RE.test("YS-20260831-0001"),
   "주문 ID 정규식이 두 접두를 다 받는다");

// ── ① 배우 카드 ──────────────────────────────────────────────────────
console.log("\n① 배우 카드 목록");
const actors = (await call("GET", "/api/ys/actors")).data;
ok(actors?.cards?.length === 12, "카드 12장 (AI 추천 + 배우 10 + 맞춤 인물)",
   `실제 ${actors?.cards?.length}`);
ok(actors?.cards?.[0].id === "auto" && actors?.cards?.at(-1).id === "custom",
   "AI 추천이 첫 카드 · 맞춤 인물이 마지막");
ok(actors?.cards?.filter((c) => c.kind === "actor" && c.approved).length === 2,
   "표본 승인은 두 명뿐 (나머지 여덟은 와이어)");
ok(actors?.cards?.every((c) => c.kind !== "actor" || (c.name && c.personality_line && c.quirk_line)),
   "배우 카드에 4요소가 다 있다");
ok(Boolean(actors?.texts?.fallback && actors?.texts?.gate_replaced && actors?.texts?.board_tail),
   "고지 문안 정본이 서버에서 온다");

// ── ② 접수 (초대코드 → YS2 주문) ─────────────────────────────────────
console.log("\n② 접수 — 배우 C06(다온)을 골랐다");
await call("GET", "/api/ys/state");
const code = process.env.YS_TEST_CODE ?? seedInvite();
const inv = await call("POST", "/api/ys/invite", { body: { code } });
ok(inv.status === 200, "초대코드 등록", cut(inv.data));

const TEXT = "지난달에 팀을 옮겼다. 짐은 상자 하나였고 인사는 짧았다. ".repeat(6);
const made = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, actor_choice: "C06", title: "옮긴 자리" } });
ok(made.status === 200, "YS2 주문 접수", cut(made.data));
const id = made.data?.id;
ok(String(id).startsWith("YS2-"), "주문 ID 가 `YS2-` 접두", String(id));
ok(made.data?.track === "ys2", "트랙이 ys2");

// ── ③ 워커 — 캐스팅 보고까지 (PC 워커 대역) ──────────────────────────
console.log("\n③ 워커 왕복");
// 로컬 D1 에는 지난 개발분이 `queued_brain` 으로 남아 있을 수 있다. 대기열은
// **가장 오래 기다린 것부터** 나가므로, 우리 주문이 나올 때까지 앞의 것을 치운다
// (실서비스에서는 하지 않는 짓이라 로컬 시연 스크립트 안에만 둔다)
let claimed = null;
for (let i = 0; i < 30; i++) {
  claimed = await call("POST", "/ys/w/claim", { headers: asWorker() });
  const got = claimed.data?.order?.id;
  if (!got || got === id) break;
  await call("POST", "/ys/w/fail",
    { headers: asWorker(), body: { id: got, kind: "failed", reason: "로컬 시연 정리" } });
}
ok(claimed?.data?.order?.id === id, "워커가 그 주문을 집어간다", cut(claimed?.data?.order?.id));
ok(claimed?.data?.order?.track === "ys2", "워커가 받는 꾸러미에 track 이 실린다");
ok(claimed?.data?.order?.actor_choice === "C06", "배우 선택도 함께 실린다");

const castStep = await call("POST", "/ys/w/progress",
  { headers: asWorker(), body: { id, step: "cast", cuts_done: 0 } });
ok(castStep.status === 200, "YS2 전용 「캐스팅」 도장이 통과한다", cut(castStep.data));

// ✍✍ **배역 행은 PC 실코드가 만든 것을 쓴다** (지시서 10 #1).
// 여기 손으로 적어 두면 `ys_casting.board_rows()` 가 바뀌어도 이 시연은 그대로
// 통과한다 — 그러면 「보고가 맞는가」를 아무것도 보증하지 않는다.
// 파일은 `_scratch/ys2_task10/t10_cast_payload.py` 가 만든다(0원).
// 표본은 **게이트 대체가 걸린 판**이다: 고객은 C06(다온)을 골랐는데 화자에 C08(미란)이 섰다
const CAST_PAYLOAD = join(process.cwd(), "..", "yourstory", "_scratch", "ys2_task10",
                          "cast_payload.json");
if (!existsSync(CAST_PAYLOAD)) {
  console.error(`  배역 행 파일이 없습니다: ${CAST_PAYLOAD}`);
  console.error("  먼저 `python _scratch/ys2_task10/t10_cast_payload.py` 를 돌리세요 (0원).");
  process.exit(2);
}
const castRows = JSON.parse(readFileSync(CAST_PAYLOAD, "utf8")).gate_sample;
ok(Array.isArray(castRows) && castRows.length >= 3,
   "배역 행을 PC 실코드 산출에서 읽었다", `${castRows?.length}행`);
const cast = await call("POST", "/ys/w/cast", {
  headers: asWorker(),
  body: { id, rows: castRows },
});
ok(cast.status === 200 && cast.data?.narrator_actor_id === "C08",
   "캐스팅 보고 · 화자 배우가 선반 키로 박힌다", cut(cast.data));

await call("POST", "/ys/w/charge", { headers: asWorker(), body: { id } });
const bytes = existsSync(PART) ? readFileSync(PART) : Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const up = await call("POST", `/ys/w/asset?id=${id}&name=part01.jpg`,
  { headers: asWorker({ "content-type": "image/jpeg" }), raw: bytes });
ok(up.status === 200, "조판본 업로드 — `YS2-` ID 가 400 이 되지 않는다", cut(up.data));
const fin = await call("POST", "/ys/w/done", {
  headers: asWorker(),
  body: { id, final_cuts: 8, parts: [{ name: "part01.jpg", w: 1080, h: 6480 }] },
});
ok(fin.status === 200, "완성 보고", cut(fin.data));

// ── ④ 캐스팅 보드 · 열람 ─────────────────────────────────────────────
console.log("\n④ 캐스팅 보드 · 결과 열람");
const view = (await call("GET", `/api/ys/order?id=${id}`)).data;
ok(view?.status === "done", "완성 상태로 열린다", cut(view?.status));
ok(view?.casting?.rows?.length === castRows.length, "배역 행이 보고한 수만큼 실린다",
   cut(view?.casting?.rows?.length));
ok(view?.casting?.rows?.[0].is_narrator === true, "첫 행이 화자다");
ok(view?.casting?.rows?.some((r) => r.is_fallback), "폴백 행이 새 얼굴로 선다");
ok(typeof view?.casting?.gate_notice === "string"
   && view.casting.gate_notice.includes("다온") && view.casting.gate_notice.includes("미란"),
   "게이트 고지가 정본 문안으로 조립된다", view?.casting?.gate_notice ?? "(없음)");
ok(view?.parts?.[0]?.url === `/ys/a/${id}/part01.jpg`, "조판본 주소가 실린다", cut(view?.parts));

const img = await fetch(`${BASE}/ys/a/${id}/part01.jpg`, { headers: { cookie } });
ok(img.status === 200, "결과 그림이 열린다 — `YS2-` 가 404 가 되지 않는다", `status ${img.status}`);

// ── ⑤ 나의 기록들 ────────────────────────────────────────────────────
console.log("\n⑤ 나의 기록들 (선반 = 배우)");
const sh = (await call("GET", "/api/ys/shelves")).data;
const shelf = sh?.shelves?.find((s) => s.actor_id === "C08");
ok(Boolean(shelf), "화자 배우의 선반이 생긴다", cut(sh?.shelves?.map((s) => s.actor_id)));
ok(shelf?.works?.length === 1, "작품이 하나여도 선반은 보인다");
ok(shelf?.can_reorder === true, "「이 배우와 또 만들기」가 열린다");

// ── ⑥ YS1 회귀 — 맞춤 인물은 기존 방식 그대로 ────────────────────────
console.log("\n⑥ YS1 회귀 — 「이야기 맞춤 인물」");
const ys1 = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, actor_choice: "custom", style: "S5", title: "맞춤" } });
ok(ys1.data?.track === "ys1", "맞춤 인물 카드는 ys1 로 간다", cut(ys1.data));
ok(String(ys1.data?.id).startsWith("YS-"), "ID 접두는 `YS-` 그대로", String(ys1.data?.id));
// **일련번호가 이어지는 것이 「두 트랙 합산」의 증거다** — 세는 질의가 YS2 주문을
// 못 세면 방금 만든 YS2 번호를 다시 내주고, 그 자리에서 번호가 겹친다
const seq = (v) => Number(String(v).slice(-4));
ok(seq(ys1.data?.id) === seq(id) + 1,
   "일일 접수 상한이 두 트랙을 합산한다 (번호가 이어진다)",
   `${id} → ${ys1.data?.id}`);
const ys1view = (await call("GET", `/api/ys/order?id=${ys1.data?.id}`)).data;
ok(ys1view?.casting === undefined, "YS1 주문에는 캐스팅이 실리지 않는다", cut(ys1view?.casting));
ok(ys1view?.style_choice === "S5", "YS1 은 화풍 선택이 그대로 산다", cut(ys1view?.style_choice));

const bad = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, actor_choice: "C99" } });
ok(bad.status === 400, "모르는 배우 id 는 반려한다", `status ${bad.status}`);

// ── 정리 ─────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(62)}`);
console.log(`통과 ${pass} · 실패 ${fails.length}`);
for (const f of fails) console.log(`  x ${f}`);
process.exit(fails.length ? 1 : 0);

/** 로컬 D1 에 초대코드를 하나 만들어 코드 문자열만 돌려준다 */
function seedInvite() {
  const out = execSync(
    'node scripts/ys-invite.mjs --label "ys2-e2e" --tickets 5 --credits 16 --local',
    { encoding: "utf8" },
  );
  const m = out.match(/(YS-[A-Z0-9]{4}-[A-Z0-9]{4})/);
  if (!m) throw new Error(`초대코드를 만들지 못했습니다:\n${out}`);
  return m[1];
}
