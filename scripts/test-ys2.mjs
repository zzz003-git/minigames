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
import { YS_ORDER_ID_RE, YS_ACTORS } from "../src/lib/config.js";
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
// ✍✍ **개수를 세지 않는다** (09-03 등재 규칙 · 지시서 14 §3-4). 배우가 한 명
// 늘 때마다 깨지는 시험은 무엇을 지키는지 말해 주지 않는다. 지켜야 하는 규칙은
// 「YS2 목록에 기존 방식이 섞이지 않는다」 하나다 — 그 문은 이제 허브 타일이다
ok(!actors?.cards?.some((c) => c.id === "custom" || c.kind === "custom"),
   "YS2 목록에 `custom`(이야기 맞춤 인물) 카드가 없다",
   cut(actors?.cards?.map((c) => c.id)));
ok(actors?.cards?.[0].id === "auto", "AI 추천이 첫 카드");
ok(actors?.cards?.filter((c) => c.kind === "actor").length === YS_ACTORS.length,
   "배우 카드는 정본 목록과 같은 수", `실제 ${actors?.cards?.filter((c) => c.kind === "actor").length}`);
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
  { body: { text: TEXT, cuts: 8, track: "ys2", actor_choice: "C06", title: "옮긴 자리" } });
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
// ✍✍ **개수를 세지 않는다** (09-03 등재 규칙). 이 자리가 지키는 규칙은
// 「작품이 하나뿐이어도 선반이 선다」— 최소 개수 문턱이 없다는 것이지,
// 정확히 한 건이라는 뜻이 아니다. 개수로 재면 같은 지갑으로 두 번만 돌려도
// 깨지고, 그러면 시연이 결함이 아닌 것을 결함이라 부른다
ok((shelf?.works?.length ?? 0) >= 1 && shelf.works.some((w) => w.id === id),
   "작품이 하나여도 선반은 보인다 (문턱 없음 · 방금 만든 작품이 그 선반에 있다)",
   `${shelf?.works?.length}건`);
ok(shelf?.can_reorder === true, "「이 배우와 또 만들기」가 열린다");

// ── ⑥ YS1 회귀 — 맞춤 인물은 기존 방식 그대로 ────────────────────────
console.log("\n⑥ YS1 회귀 — 기존 방식은 자기 문으로 들어온다");
const ys1 = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, track: "ys1", style: "S5", title: "맞춤" } });
ok(ys1.data?.track === "ys1", "YS1 문으로 들어오면 ys1 이다", cut(ys1.data));
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

ok(ys1view?.actor_choice == null,
   "YS1 주문의 actor_choice 는 비어 있다 (「고른 적 없음」이 보존된다)",
   cut(ys1view?.actor_choice));

const bad = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, track: "ys2", actor_choice: "C99" } });
ok(bad.status === 400, "모르는 배우 id 는 반려한다", `status ${bad.status}`);

// ✍✍ **트랙은 문이 정하고, 문이 없으면 반려다** (트랙 정본 §2 — 빈 값은 잇지 않는다).
// 여기가 무너지면 「어느 서비스에 왔는가」를 다시 카드로 추측하게 된다
const noTrack = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, actor_choice: "C06" } });
ok(noTrack.status === 400, "track 이 없으면 반려한다", `status ${noTrack.status}`);
const badTrack = await call("POST", "/api/ys/orders",
  { body: { text: TEXT, cuts: 8, track: "YS1" } });
ok(badTrack.status === 400, "모르는 track 은 반려한다", `status ${badTrack.status}`);

console.log("\n⑦ 두 문 — 문안·가격 자리는 서버가 준다");
const st2 = (await call("GET", "/api/ys/state")).data;
const e1 = st2?.entries?.find((e) => e.track === "ys1");
const e2 = st2?.entries?.find((e) => e.track === "ys2");
ok(st2?.entries?.length === 2, "두 문이 다 온다", cut(st2?.entries?.map((e) => e.track)));
ok(Boolean(e1?.name && e2?.name && e1.name !== e2.name), "이름이 각각이다",
   `${e1?.name} / ${e2?.name}`);
ok(Boolean(e1?.pick_question && e2?.pick_question),
   "두 번째 화면의 질문 문안도 서버가 준다");
ok("price_krw" in (e1 ?? {}) && e1?.price_krw === e2?.price_krw,
   "가격 자리가 두 트랙에 다 있고 값은 같다 (결정 19)", `${e1?.price_krw} / ${e2?.price_krw}`);

// ── 정리 ─────────────────────────────────────────────────────────────
// ✍✍ ⑧ 두 문 안 — 공통 화면이 트랙을 안다 (지시서 15)
console.log("\n⑧ 문 안 — 공통 화면이 트랙을 안다");

const s1 = (await call("GET", "/api/ys/state?t=ys1")).data;
const s2 = (await call("GET", "/api/ys/state?t=ys2")).data;
const en = (d, t) => d?.entries?.find((e) => e.track === t);
const m1 = en(s1, "ys1");
const m2 = en(s2, "ys2");

ok(Boolean(m1?.next_label && m2?.next_label) && m1.next_label !== m2.next_label,
   "다음 단계 문구가 두 트랙에서 다르다", `${m1?.next_label} / ${m2?.next_label}`);
// **어휘가 트랙과 맞는가** — 서로 다르기만 보면 뒤바뀐 것도 통과한다
ok(!/배우|캐스팅|연기/.test(`${m1?.next_label} ${m1?.next_note}`),
   "YS1 문구에 YS2 어휘가 없다", `${m1?.next_label} · ${m1?.next_note}`);
ok(!/화풍|그림체/.test(`${m2?.next_label} ${m2?.next_note}`),
   "YS2 문구에 YS1 어휘가 없다", `${m2?.next_label} · ${m2?.next_note}`);
ok(Boolean(m1?.name && m2?.name) && m1.name !== m2.name && m1.icon !== m2.icon,
   "홈 헤더 이름·아이콘이 트랙별로 다르다", `${m1?.icon}${m1?.name} / ${m2?.icon}${m2?.name}`);
ok(m1?.shelf_label == null && Boolean(m2?.shelf_label),
   "선반 버튼 문안은 YS2 에만 있다 (YS1 문에서는 버튼이 서지 않는다)",
   `${m1?.shelf_label} / ${m2?.shelf_label}`);

// **서랍은 서버가 거른다.** 화면에서 숨긴 것은 여전히 내려온 것이다
const trOf = (d) => [...new Set((d?.orders ?? []).map((o) => o.track))];
ok((s1.orders ?? []).length > 0 && trOf(s1).every((t) => t === "ys1"),
   "YS1 문의 서랍에 ys2 주문이 섞이지 않는다", `트랙 ${cut(trOf(s1))} · ${s1.orders?.length}건`);
ok((s2.orders ?? []).length > 0 && trOf(s2).every((t) => t === "ys2"),
   "YS2 문의 서랍에 ys1 주문이 섞이지 않는다", `트랙 ${cut(trOf(s2))} · ${s2.orders?.length}건`);
// 문 밖(허브)은 두 트랙을 다 봐야 타일마다 「만드는 중」을 띄운다
const sAll = (await call("GET", "/api/ys/state")).data;
ok((sAll.orders ?? []).length >= (s1.orders ?? []).length + (s2.orders ?? []).length,
   "문 밖(허브)에서는 두 트랙이 다 보인다", `${sAll.orders?.length}건`);

// ✍✍ ⑨ ★ 기계 게이트 — 공통 화면에 트랙 어휘가 박혀 있으면 실패 (지시서 15 §1-6)
//
// 오늘 네 자리가 사람 셋(개발·기획·시연)을 모두 통과했다. 사람의 기억으로는 못
// 막는다. 새 문구를 공통 화면에 박는 순간 여기서 걸린다.
//
// **검사 대상은 `index.html` 원문**이다 — 화면이 「지어낸」 문자열은 거기 있다.
// API 가 내려보내는 문안은 트랙별이라 이 검사의 대상이 아니다.
console.log("\n⑨ 공통 화면에 트랙 어휘가 박혀 있지 않다 (기계 게이트)");
{
  const html = readFileSync(join(process.cwd(), "public/webtoon/yourstory/index.html"), "utf8");
  const SHARED = ["home", "write", "viewer", "making", "notice"];
  const VOCAB = /배우|캐스팅|연기|화풍|그림체/;
  const secRe = /<section[^>]*data-screen="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/section>/g;
  const bad = [];
  let sec;
  while ((sec = secRe.exec(html))) {
    const [, name, inner] = sec;
    if (!SHARED.includes(name)) continue; // ys2·style 전용 절은 대상이 아니다
    for (const line of inner.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
      if (VOCAB.test(line)) bad.push(`[${name}] ${line.trim().slice(0, 60)}`);
    }
  }
  ok(bad.length === 0,
     "공통 화면(home·write·viewer·making·notice)에 트랙 어휘가 없다", cut(bad));
}

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
