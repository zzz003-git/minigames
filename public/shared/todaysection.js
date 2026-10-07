/**
 * 오늘의 나 영역 — 「전체」 화면과 허브가 함께 쓴다
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html (`data-screen-label="오늘의 나 허브"`)
 *
 * 원안에서 **전체 화면은 게임과 오늘의 나를 함께 보여 준다.** 그래서 이 영역이
 * 필요하다 — 두 영역을 오가게만 하면 「한 제품」이 아니라 「두 제품 사이의
 * 스위치」가 된다.
 *
 * ── 한 벌만 만든다 ───────────────────────────────────────────────────────
 * 처음에는 이 파일이 「요약」이고 `/today/` 가 「본체」였다. 원안을 옮기고 보니 둘이
 * 같은 것을 그린다. 두 벌을 두면 카드 한 줄을 고칠 때마다 두 곳을 고쳐야 하고,
 * 실제로 D-1 에서 한 번 어긋났다. 그래서 영역을 이 파일 하나로 두고 허브는 이것을
 * 그대로 쓴다.
 *
 * ── 셋 다 하면 「오늘의 나 카드」가 열린다 ───────────────────────────────
 * 「오늘의 나 카드」는 십신 × 타로 교차 리딩(`cross-db.js` 220문장)이다. 사주와
 * 타로를 각각 읽어서는 나올 수 없는 문장이라, 셋 다 한 사람에게만 준다.
 *
 * ── 두 판 (REQ-63 묶음 5) ────────────────────────────────────────────────
 * `renderTodaySection` = 「전체」(/) 의 어두운 요약 영역(`?compact=1`).
 * `renderHub` = 허브 /today/ 의 밝은 v2 판(약속 띠 · 진행판 · 추천 카드 · 행 · 오늘의 나 카드).
 * 순서는 둘 다 `SUITE_ORDER`(타로 → 선택 → 사주 · shared/nextstep.js) 한 곳을 따른다.
 *
 * DB 는 **필요할 때만 불러온다**(동적 import). 트리플을 못 채운 사람에게는 쓸 일이
 * 없는 10KB 라, 「전체」 화면 첫 로딩에 얹을 이유가 없다.
 */

import { el, svgEl, clear } from "./ui.js";
import { apiGet } from "./api.js";
import { HUB_INDEX } from "./hub-index.js";
import { SUITE_ORDER } from "./nextstep.js";
import { bindPairIntro } from "./pairintro.js";

/** 서비스 색 — 다음 안내 바 점과 같은 값(nextbar.css) */
const HUB_TINT = { tarot: "#141C3F", saju: "#A8281C", mind: "#2A8F80" };

/** 이 기기에서 사주가 만 14세 미만으로 거절됐는가(saju.js 가 남김) — 그러면 사주는 「이용 불가」 */
const tooYoung = () => {
  try {
    return localStorage.getItem("mg_saju_too_young") === "1";
  } catch {
    return false;
  }
};

/** 서버 응답을 화면 순서·기기 사정에 맞춘다 — 두 판이 같은 규칙을 쓰게 한 곳에서 */
export function normalize(data) {
  const by = Object.fromEntries(data.services.map((s) => [s.key, s]));
  const young = tooYoung();
  const services = SUITE_ORDER.filter((k) => by[k]).map((k) =>
    k === "saju" && young ? { ...by[k], ready: false, too_young: true } : by[k],
  );
  return { ...data, services, reachable: services.filter((s) => s.ready).length, too_young: young };
}

/**
 * +15P 를 써도 되는가. 사주를 지목하는 줄과 +15P 를 같이 쓰지 않는다(NEXTBAR) — 남은 것이 사주뿐이고
 * 미등록이면 숨긴다. 사주를 이용할 수 없는 기기면 약속 자체를 하지 않는다.
 */
export function triplePromiseOk(data) {
  if (data.too_young) return false;
  const left = data.services.filter((s) => s.ready && !s.done);
  return !(left.length === 1 && left[0].key === "saju" && !data.saju_registered);
}

/** 사주 미등록자에게만 붙는 꼬리 */
const SAJU_FIRST = " · 처음 한 번 입력";

/** 페어 링크의 상대 관계 — 대기 문구에 그대로 들어간다 */
const RELATION = { lover: "연인", friend: "친구", family: "가족", coworker: "동료" };
/** 「{관계}{이/가}」 — 받침에 따라 (pair IMPL 관계 조사 표) */
const RELATION_SUBJ = { lover: "연인이", friend: "친구가", family: "가족이", coworker: "동료가" };

/** 결과 도착 한 줄 — `/`·`/today/` 같이 쓴다. 안 본 도착이 없으면 null (REQ-65 F2) */
export function arrivalInfo(data) {
  const n = Number(data?.pair_unseen ?? 0);
  const p = data?.pair_latest;
  if (!(n > 0) || !p) return null;
  return {
    line: `${RELATION_SUBJ[p.relation] ?? "그 사람이"} 답했어요` + (p.pct != null ? ` · 서로 알기 ${p.pct}%` : ""),
    // 여러 건이면 목록으로(가장 최근 1건만 한 줄에 쓴다)
    href: n === 1 ? `/pair/?view=${encodeURIComponent(p.token)}` : "/pair/",
  };
}

/**
 * 「전체」 축소판 머리 부제 — 금액은 여기 한 줄에만(home 최종 수정 #1·#4).
 * 시작 전이면 +15P 약속, 그 뒤엔 오늘 받은 포인트(0P 면 약속으로 되돌아감). 약속은 사주를 지목하는
 * 경우(미등록·14세 미만)엔 하지 않는다.
 * @returns {{kind:"promise"|"points", value:number}|null}
 */
export function homeHeadLine(data) {
  const promise = !data.triple && triplePromiseOk(data) ? { kind: "promise", value: data.triple_points } : null;
  if (data.progress === 0) return promise;
  const pt = Number(data.points?.today ?? 0);
  return pt > 0 ? { kind: "points", value: pt } : promise;
}

/** 결과 도착 한 줄 — `/` 는 `td-pair`, `/today/` 는 `hub-arrive`. 소개 시트를 거치지 않는다 */
function arrivalLine(a, cls) {
  return el(
    "a",
    { class: cls, href: a.href },
    el("span", { class: `${cls}__mark`, "aria-hidden": "true" }, pairMark()),
    el("span", { class: `${cls}__txt` }, el("b", {}, "너를 맞혀볼게"), el("span", {}, a.line)),
    el("span", { class: `${cls}__go` }, "결과 보기 ›"),
  );
}

/** 「전체」 축소판 진행판 칸 — 아직 안 했고 다음 차례가 아닌 칸의 말 (home IMPL 신규 문구) */
const HOME_IDLE = { tarot: "카드 한 장", mind: "심리테스트", saju: "생일 운세" };

/**
 * 「전체」(/) 의 오늘의 나 축소판 (REQ-65 묶음 3 · 시안 mock/home hm1~hm3).
 *
 * 게임 목록 **위**에 놓이는 밝은 판(#F4F1EC)이다 — 페이지와 게임 판은 어두운 그대로이고, 이 판의
 * 스타일은 `.td` 루트 아래로만 갇힌다(shared/today-home.css, `/` 만 링크). 진행판 + 추천 하나 +
 * 「오늘의 나 전체 보기 ›」. 금액은 머리 부제 한 줄에만, 페어는 안 본 도착이 있을 때만 한 줄.
 *
 * index.html 이 같은 높이의 스켈레톤(`is-loading`)을 먼저 깔아 둬서 늦게 그려져도 게임 목록이
 * 크게 밀리지 않는다.
 */
export async function renderTodaySection(host) {
  if (!host) return null;
  if (!document.getElementById("hubSprite")) document.body.insertAdjacentHTML("afterbegin", SPRITE);

  let data;
  try {
    data = normalize(await apiGet("/api/today", { compact: 1 }));
  } catch {
    // 같은 높이 판에 다시 시도 — 판이 사라지면 게임 목록이 위로 튄다(home 최종 수정 #11)
    clear(host).append(
      el("p", { class: "td-fail" }, "오늘의 나를 못 불러왔어요"),
      el("button", { class: "td-more", type: "button", onclick: () => renderTodaySection(host) }, "다시 시도"),
    );
    host.classList.replace("is-loading", "is-failed");
    host.removeAttribute("aria-busy");
    return null;
  }

  const kids = [homeHead(data)];
  const arrival = arrivalInfo(data);
  if (arrival) kids.push(arrivalLine(arrival, "td-pair"));
  if (data.triple) kids.push(...(await homeTriple(data)));
  else kids.push(...homeProgress(data));
  kids.push(
    el(
      "div",
      { class: "td-foot" },
      el("a", { class: "td-more", href: "/today/" }, "오늘의 나 전체 보기 ›"),
      el("p", { class: "td-legal" }, "본 콘텐츠는 오락용이며", el("br"), "심리학적 진단이 아닙니다"),
    ),
  );

  clear(host).append(...kids);
  host.hidden = false;
  host.classList.remove("is-loading", "is-failed");
  host.removeAttribute("aria-busy");
  return data;
}

function homeHead(data) {
  const h = homeHeadLine(data);
  const sub = !h
    ? null
    : h.kind === "promise"
      ? el("span", {}, "셋 다 하면 ", el("b", { class: "td-pt" }, "+", el("span", { class: "js-triple-pts" }, String(h.value)), "P"), " 보너스")
      : el("span", {}, "오늘 받은 포인트 ", el("b", { class: "td-num" }, `${h.value}P`));
  return el("div", { class: "td-head" }, ico("one", 32), el("span", { class: "td-head__txt" }, el("b", {}, "오늘의 나"), sub));
}

function homeProgress(data) {
  const left = data.services.filter((s) => s.ready && !s.done);
  const next = left[0] ?? null;

  const cells = el("div", { class: "td-cells" });
  data.services.forEach((s, i) => {
    const isNext = next && s.key === next.key;
    const state = s.done ? doneWord(s) : !s.ready ? (s.too_young ? "이용 불가" : "준비 중") : isNext ? "지금 할 차례" : HOME_IDLE[s.key];
    cells.append(
      el(
        "div",
        { class: `td-cell td-cell--${s.key}${s.done ? " is-done" : ""}${isNext ? " is-next" : ""}` },
        s.done ? el("span", { class: "td-cell__check", "aria-hidden": "true" }, "✓") : el("span", { class: "td-cell__ord" }, String(i + 1)),
        ico(s.key, 24),
        el("b", { class: "td-cell__name" }, HUB[s.key].short),
        el("span", { class: "td-cell__state" }, state),
      ),
    );
  });
  cells.append(
    el("span", { class: "td-arrow", "aria-hidden": "true" }, "›"),
    el("div", { class: "td-cell td-cell--one" }, ico("one", 24), el("b", { class: "td-cell__name" }, "오늘의 나", el("br"), "카드")),
  );

  const board = el(
    "div",
    { class: "td-board", "aria-label": "오늘 진행" },
    el(
      "p",
      { class: "td-board__count" },
      "타로 · 선택 · 사주 중 ",
      el("b", { class: "td-num" }, String(data.progress)),
      "개 했어요",
      left.length === 1 ? el("span", { class: "td-nudge" }, `남은 하나는 ${HUB[left[0].key].left}`) : null,
    ),
    cells,
  );
  return next ? [board, homeReco(next, data, left.length)] : [board];
}

/** 추천 하나 — 「전체」 화면의 유일한 채운 버튼. 금액 문구는 없다(머리 한 줄에만 · home 최종 수정 #1) */
function homeReco(s, data, leftCount) {
  const label = leftCount === 1 ? "남은 하나" : data.progress === 0 ? "먼저 해 보세요" : "다음 차례";
  let pic;
  let line;
  let sub = null;
  if (s.key === "tarot") {
    pic = el("span", { class: "td-reco__pic", "aria-hidden": "true" }, el("i", { style: "left:0;top:6px;transform:rotate(-12deg);opacity:.75" }), el("i", { style: "left:8px;top:2px;transform:rotate(4deg)" }));
    line = HUB.tarot.line;
  } else if (s.key === "saju") {
    pic = ico("saju", 48);
    line = data.saju_registered ? "내 생일로 오늘 운세 한 줄" : "생일만 넣으면 오늘 운세 한 줄";
    if (!data.saju_registered) sub = "처음 한 번만 넣어요 · 이름·성별은 안 받아요";
  } else {
    pic = ico("mind", 48);
    line = HUB.mind.line;
    sub = HUB.mind.sub;
  }
  return el(
    "article",
    { class: `td-reco td-reco--${s.key}`, "data-svc": s.key },
    el(
      "div",
      { class: "td-reco__body" },
      pic,
      el(
        "div",
        {},
        el("span", { class: "td-reco__label" }, label),
        el("h2", { class: "td-reco__title" }, s.name),
        el("p", { class: "td-reco__line" }, line),
        sub ? el("p", { class: "td-reco__sub" }, sub) : null,
      ),
    ),
    el("a", { class: "td-btn", href: `${s.href}?from=home` }, HUB[s.key].cta),
  );
}

/** 3/3 — 카드 한 줄(행 전체가 /today/ · 채운 버튼 없음) + 오늘 한 것 칩 + 내일 안내 */
async function homeTriple(data) {
  const by = Object.fromEntries(data.services.map((s) => [s.key, s]));
  const one = await oneCardData(data).catch(() => null);
  const card = el(
    "a",
    { class: "td-one", href: "/today/", "aria-label": "오늘의 나 카드 보기" },
    el(
      "span",
      { class: "td-one__pic", "aria-hidden": "true" },
      ico("tarot", 30),
      ico("mind", 40),
      el("span", { class: "td-one__seal" }),
    ),
    el(
      "span",
      { class: "td-one__txt" },
      el("b", { class: "td-one__title" }, "오늘의 나 카드"),
      data.triple_paid
        ? el("span", { class: "td-one__tag" }, "셋 다 했어요 · +", el("span", { class: "js-triple-pts" }, String(data.triple_points)), "P 받았어요")
        : null,
      one?.line ? el("p", { class: "td-one__line" }, one.line) : null,
    ),
    el("span", { class: "td-one__go", "aria-hidden": "true" }, "›"),
  );
  const theme = one?.sajuChip && one.sajuChip !== "오늘의 사주" ? one.sajuChip : "오늘 운세를 봤어요";
  const chip = (key, what) => el("span", {}, ico(key, 20), el("em", {}, HUB[key].short), ` · ${what}`);
  const done = el(
    "div",
    { class: "td-done", "aria-label": "오늘 한 것" },
    chip("tarot", doneWord(by.tarot)),
    chip("mind", doneWord(by.mind)),
    chip("saju", theme),
  );
  return [card, done, el("p", { class: "td-tomorrow" }, "내일 0시에 새 세 칸이 열려요")];
}

/** 고지 줄 — 원문 + AI 고지(카드 그림이 보이는 곳이 있어 상시 · hub/IMPL v3 #5·14) */
const LEGAL =
  "순위 없음 · 광고 없이도 완결 · 본 콘텐츠는 오락용이며 심리학적 진단이 아닙니다 · 카드 이미지는 생성형 AI를 활용해 제작했습니다";

// ══════════════════════════════════════════════════════════════
// 너를 맞혀볼게 — 한 줄 스트립
// ══════════════════════════════════════════════════════════════

/** 페어 띠의 상태·문구 — 「전체」 띠와 허브 띠가 같이 쓴다 */
function pairInfo(pairs, mindDone) {
  const links = pairs?.links ?? [];
  // 「도착」 = 답이 왔는데 아직 안 본 것(owner_seen 이 서버 판정 · REQ-65 F2). 잠금보다 먼저 —
  // 오늘의 선택을 안 했어도 도착한 결과는 볼 수 있어야 한다
  const arrived = links.find((l) => l.status === "answered" && !l.owner_seen);
  const waiting = links.find((l) => l.status === "open");
  const state = arrived ? "arrived" : !mindDone ? "locked" : waiting ? "waiting" : "ready";

  const bestPct = Math.max(0, ...Object.values(pairs?.best ?? {}).map(Number).filter(Number.isFinite));
  const pct = arrived ? (arrived.summary?.pct ?? bestPct) : null;
  const left = Math.max(0, Number(pairs?.remaining_today ?? 0));
  const relation = RELATION[waiting?.relation] ?? "상대";

  const COPY = {
    locked: { line: "오늘의 선택을 마치면 열려요", cta: "오늘의 선택 먼저 하기", href: "/mind/" },
    // 다 썼으면 선택 화면과 같은 문구(기획 회신 59-3)
    ready: {
      line: left > 0 ? `오늘 보낼 수 있는 링크 ${left}개` : `오늘 링크 ${pairs?.max_per_day ?? ""}개를 다 보냈어요`,
      cta: "링크 보내기",
      href: "/pair/",
    },
    // 바로 그 링크로 — /pair/ 가 ?resend= · ?view= 를 받는다(pair IMPL 「다른 화면에 걸리는 것」)
    waiting: { line: `${relation}에게 보낸 링크가 기다리고 있어요`, cta: "링크 다시 보기", href: `/pair/?resend=${encodeURIComponent(waiting?.token ?? "")}` },
    arrived: { line: "결과가 도착했어요 — 서로 알기 지수 확인", cta: "결과 보기", href: `/pair/?view=${encodeURIComponent(arrived?.token ?? "")}` },
  }[state];
  return { state, pct, COPY };
}

/** 마주 본 두 장이 겹친 형상 — 「서로를 맞혀 본다」를 손이 아니라 카드로 말한다 */
const pairMark = () =>
  svgEl(
    "svg",
    { width: 34, height: 34, viewBox: "0 0 32 32", fill: "none" },
    svgEl("rect", {
      x: 5.6, y: 7.4, width: 12, height: 17.2, rx: 3,
      fill: "none", stroke: "currentColor", "stroke-opacity": 0.45, "stroke-width": 2,
      transform: "rotate(-15 11.6 16)",
    }),
    svgEl("rect", {
      x: 13.4, y: 7.4, width: 12, height: 17.2, rx: 3,
      fill: "none", stroke: "currentColor", "stroke-width": 2,
      transform: "rotate(15 19.4 16)",
    }),
  );

/** 완료한 칸의 미니 결과 — 이름 하나면 충분하다. 해석은 각 서비스가 보여 준다 */
function summarize(s) {
  if (s.key === "tarot") {
    const card = HUB_INDEX.tarot[Number(s.key_value)];
    return card ? `오늘의 카드는 ${card.g} ${card.n}` : "오늘 뽑았어요";
  }
  if (s.key === "mind") {
    const [expId, ti] = String(s.key_value ?? "").split(":");
    const type = HUB_INDEX.mind[expId]?.[Number(ti)];
    return type ? `오늘의 나는 ${type.g} ${type.n}` : "오늘 마쳤어요";
  }
  return "오늘 몫을 마쳤어요";
}

// ══════════════════════════════════════════════════════════════
// 아카이브 달력
// ══════════════════════════════════════════════════════════════

/**
 * 원안의 `toggleArchive` · `archiveOpen`.
 *
 * 접어 두는 이유는 게임 밴드와 같다 — 한 달치 달력이 늘 펼쳐져 있으면 「오늘」을
 * 보러 온 사람이 매번 그것을 지나쳐야 한다. 지난날은 찾을 때만 열면 된다.
 */
function archiveToggle(data, { cls = "hub-foot__link", tint = HUB_TINT } = {}) {
  const btn = el("button", { type: "button", class: cls }, "지난 기록");
  btn.addEventListener("click", async () => {
    const box = document.getElementById("archiveBox");
    if (!box) return;
    if (!box.hidden) {
      box.hidden = true;
      btn.textContent = "지난 기록";
      return;
    }
    btn.disabled = true;
    try {
      // 달은 서버 day(KST)에서 — toISOString() 은 UTC 라 한국 0~9시에 지난달이 열렸다(hub/IMPL 11)
      await renderArchive(box, data.day.slice(0, 7), tint);
      box.hidden = false;
      btn.textContent = "접기";
    } catch {
      // 달력이 안 열려도 위의 3칸은 멀쩡해야 한다
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

/** 그날 무엇을 했는지 한 줄로 — 콘텐츠 이름은 화면이 붙인다(서버는 key 만 준다) */
function dayLine(d) {
  const bits = [];
  if (d.done.tarot) {
    const c = HUB_INDEX.tarot[Number(d.key.tarot)];
    bits.push(c ? `${c.g} ${c.n}` : "타로");
  }
  if (d.done.mind) {
    const [expId, ti] = String(d.key.mind ?? "").split(":");
    const t = HUB_INDEX.mind[expId]?.[Number(ti)];
    bits.push(t ? `${t.g} ${t.n}` : "선택");
  }
  if (d.done.saju) bits.push("🌤️ 사주");
  return bits.join(" · ");
}

async function renderArchive(box, month, tint) {
  const data = await apiGet(`/api/today/archive?month=${month}`);
  const byDay = new Map(data.days.map((d) => [d.day, d]));

  clear(box);
  box.append(
    el(
      "div",
      { class: "archive__head" },
      el("b", {}, `${month.replace("-", ". ")} 기록`),
      el("span", {}, `셋 다 한 날 ${data.triple_days}일`),
    ),
  );

  const [y, m] = month.split("-").map(Number);
  // 그 달 1일이 무슨 요일인지 — 앞을 빈 칸으로 채워 요일을 맞춘다
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const grid = el("div", { class: "archive__grid" });
  for (const w of ["일", "월", "화", "수", "목", "금", "토"]) {
    grid.append(el("span", { class: "archive__dow" }, w));
  }
  for (let i = 0; i < first; i += 1) grid.append(el("span", { class: "archive__pad" }));

  const note = el("p", { class: "archive__note" }, "날짜를 누르면 그날 무엇을 했는지 보여 줘요");

  for (let d = 1; d <= last; d += 1) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    const rec = byDay.get(key);
    const cnt = rec?.count ?? 0;

    const dots = el("span", { class: "archive__dots", "aria-hidden": "true" });
    for (const k of SUITE_ORDER) {
      dots.append(el("i", { class: rec?.done[k] ? "is-on" : "", style: `--t:${tint[k]}` }));
    }

    const cell = el(
      "button",
      {
        type: "button",
        class: `archive__day ${cnt >= 3 ? "is-full" : cnt > 0 ? "is-some" : ""}`,
        "aria-label": `${d}일 ${cnt}칸 완료`,
      },
      el("span", {}, String(d)),
      dots,
    );
    cell.addEventListener("click", () => {
      note.textContent = cnt ? `${d}일 — ${dayLine(rec)}` : `${d}일 — 기록이 없어요`;
    });
    grid.append(cell);
  }

  box.append(grid, note);
}

// ══════════════════════════════════════════════════════════════
// 오늘의 나 카드 (교차 리딩)
// ══════════════════════════════════════════════════════════════

const SHARE_NOTE = "글과 링크로 공유돼요 · 응답 내용은 담기지 않아요";

/**
 * 오늘의 나 카드 재료 — 「전체」 영역과 허브가 같이 쓴다. 축은 **서버가 준 key**(십신 idx · 카드 id).
 * 셋 다 한 사람에게만 필요한 DB(교차 문장 · 사주 테마) — 여기서 처음 불러온다.
 */
async function oneCardData(data) {
  const svc = Object.fromEntries(data.services.map((s) => [s.key, s]));
  const god = Number(svc.saju?.key_value);
  const card = Number(svc.tarot?.key_value);
  if (!Number.isInteger(god) || !Number.isInteger(card)) return null;

  const [{ crossLine, CARD_NAMES }, theme] = await Promise.all([import("./cross-db.js"), sajuTheme(data.day, god)]);
  const line = crossLine(god, card);
  if (!line) return null;

  const [expId, ti] = String(svc.mind?.key_value ?? "").split(":");
  const type = HUB_INDEX.mind[expId]?.[Number(ti)] ?? null;
  const tarot = HUB_INDEX.tarot[card];
  return {
    card,
    type,
    line,
    cardName: CARD_NAMES[card] ?? tarot?.n ?? "카드",
    tarotChip: tarot ? `${tarot.g} ${tarot.n}` : "🔮 오늘의 카드",
    // 사주 칩은 십신 이름이 아니라 **그날 테마 문장 통째로**(hub/IMPL v3 #7·JS 7)
    sajuChip: theme ?? "오늘의 사주",
    mindChip: type ? `${type.g} ${type.n}` : "🔬 오늘의 선택",
    day: data.day,
  };
}

/** 공유 — 칩을 「 · 」로 묶고 링크 한 줄을 붙인다(hub/IMPL 공유 텍스트 예시) */
function shareButton(one, cls) {
  const share = el("button", { type: "button", class: cls }, "카드 공유하기");
  share.addEventListener("click", async () => {
    // 무엇을 골랐는지는 담지 않는다 — 결과 이름과 교차 문장만(기획서 공유 규격)
    const text = [
      `오늘의 나 · ${one.day.replaceAll("-", ".")}`,
      [one.tarotChip, one.sajuChip, one.mindChip].join(" · "),
      one.line,
      `${location.origin}/tarot/?from=card`,
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "오늘의 나 카드", text });
      else {
        await navigator.clipboard.writeText(text);
        share.textContent = "복사했어요";
        setTimeout(() => { share.textContent = "카드 공유하기"; }, 1600);
      }
    } catch {
      // 취소도 여기로 온다 — 조용히 둔다
    }
  });
  return share;
}

/**
 * 그날 사주 테마 문장 — 사주 화면 #rdTheme 과 **같은 함수·같은 시드**(saju.js seeded/pick).
 * ponytail: saju.js 의 seeded 사본이다. 공용 모듈로 옮기면 이 사본을 지운다(saju.js 는 이 묶음 범위 밖).
 */
async function sajuTheme(day, god) {
  try {
    const { SAJU_DB } = await import("../saju/saju-db.js");
    const arr = SAJU_DB.tenGod[god]?.theme;
    if (!arr?.length) return null;
    let h = 2166136261;
    for (const c of `${day}|theme|${god}`) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return arr[Math.abs(h) % arr.length];
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// 허브 v2 — /today/ (REQ-63 묶음 5 · 시안 mock/hub/h1·h2·h3)
// ══════════════════════════════════════════════════════════════

/** 작은 피부 그림 — 시안 symbol 그대로(타로 카드 · 사주 기둥+인장 · 선택 원판 · 오늘의 나 카드) */
const SPRITE = `<svg id="hubSprite" width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="ic-tarot" viewBox="0 0 32 32"><rect x="8.5" y="2.5" width="15" height="27" rx="2.6" fill="#141C3F" stroke="#E8C46A" stroke-width="1.4"/><rect x="11" y="5" width="10" height="22" rx="1.2" fill="none" stroke="#E8C46A" stroke-opacity=".6" stroke-width=".8"/><path d="M16 11 L17.5 14.5 L21 16 L17.5 17.5 L16 21 L14.5 17.5 L11 16 L14.5 14.5 Z" fill="#E8C46A"/></symbol>
<symbol id="ic-saju" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="4" fill="#EFE6D2" stroke="rgba(30,26,22,.6)"/><rect x="1" y="1" width="30" height="2.4" rx="1" fill="#A8281C"/><g fill="#2B241D"><rect x="4.5" y="6" width="4.2" height="15" rx=".8"/><rect x="10" y="6" width="4.2" height="15" rx=".8"/><rect x="15.5" y="6" width="4.2" height="15" rx=".8"/><rect x="21" y="6" width="4.2" height="15" rx=".8"/></g><circle cx="24" cy="24.5" r="4.6" fill="#A8281C"/><circle cx="24" cy="24.5" r="3.2" fill="none" stroke="#F6F0E2" stroke-width=".7"/></symbol>
<symbol id="ic-mind" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#2A8F80"/><circle cx="16" cy="16" r="11.2" fill="#FFF8E7"/><g stroke="#0E2B28" stroke-opacity=".2" stroke-width=".6"><path d="M16 5.5V26.5M5.5 16H26.5"/></g><polygon points="16,7.5 19.6,12.4 22.5,16 18.6,18.6 16,23.5 14.3,17.6 9.5,16 12.8,12.8" fill="#FFD24A" stroke="#E2572B" stroke-width=".9" stroke-linejoin="round"/><circle cx="16" cy="4.9" r="1.3" fill="#E2572B"/><circle cx="16" cy="16" r="1.6" fill="#0E2B28"/></symbol>
<symbol id="ic-one" viewBox="0 0 32 32"><rect x="4" y="5" width="11.5" height="17.5" rx="2" fill="#141C3F" stroke="#E8C46A" stroke-width="1.1" transform="rotate(-10 10 14)"/><circle cx="21.5" cy="13.5" r="8" fill="#2A8F80"/><circle cx="21.5" cy="13.5" r="5.6" fill="#FFF8E7"/><circle cx="21.5" cy="13.5" r="1.6" fill="#FFD24A"/><circle cx="15" cy="24.5" r="5.2" fill="#A8281C" fill-opacity=".92"/><circle cx="15" cy="24.5" r="3.6" fill="none" stroke="#F6F0E2" stroke-width=".7"/></symbol>
</svg>`;

const ico = (name, size) =>
  svgEl("svg", { class: "ico", width: size, height: size, "aria-hidden": "true" }, svgEl("use", { href: `#ic-${name}` }));

/** 서비스별 허브 문구 — 시안 원문(h1·h2) · 「약 1분」 없음 */
const HUB = {
  tarot: { short: "타로", line: "고민을 하나 고르고 카드 한 장을 뽑아요", row: "고민 하나에 카드 한 장", cta: "카드 한 장 뽑으러 가기", left: "오늘의 타로예요" },
  mind: { short: "선택", line: "4문항 고르기", row: "4문항 고르기", sub: "마치면 「너를 맞혀볼게」가 열려요", cta: "오늘의 장면 열러 가기", tag: "심리테스트", left: "오늘의 선택이에요" },
  saju: { short: "사주", line: "생일로 보는 오늘 운세", row: "생일로 보는 오늘 운세", cta: "오늘 운세 보러 가기", left: "오늘의 사주예요" },
};
const STEM_HAN = "甲乙丙丁戊己庚辛壬癸";
const BRANCH_HAN = "子丑寅卯辰巳午未申酉戌亥";
const STEM_KO = "갑을병정무기경신임계";
const BRANCH_KO = "자축인묘진사오미신유술해";
const thumb = (id) => `/assets/tarot/thumb/s2/${id}.webp`;

/**
 * 허브 /today/ 를 그린다. 판정은 전부 서버 값(+ 이 기기의 14세 미만 기억)으로만.
 * @returns {Promise<object|null>} /api/today 응답(정규화) — 실패면 null
 */
export async function renderHub(host) {
  if (!host) return null;
  if (!document.getElementById("hubSprite")) document.body.insertAdjacentHTML("afterbegin", SPRITE);

  let data;
  try {
    data = normalize(await apiGet("/api/today"));
  } catch {
    return null;
  }
  const by = Object.fromEntries(data.services.map((s) => [s.key, s]));
  const theme = by.saju?.done ? await sajuTheme(data.day, Number(by.saju.key_value)) : null;

  clear(host);
  host.hidden = false;
  host.className = "hubv2";

  // 셋 다 한 직후 다음 안내 바에서 왔다 — 카드를 한 번 띄워 보이고 주소의 표지는 지운다(hub/IMPL 10)
  const fromTriple = new URLSearchParams(location.search).get("from") === "triple";
  // 안 본 결과 도착 — 맨 위 한 줄(오늘의 선택 완료와 무관, 결과를 보면 사라짐 · REQ-65 F2)
  const arrival = arrivalInfo(data);
  if (arrival) host.append(arrivalLine(arrival, "hub-arrive"));
  if (data.triple) await drawTriple(host, data, by, theme, fromTriple);
  else await drawProgress(host, data, by, theme);
  if (fromTriple) history.replaceState(null, "", location.pathname);

  watchDay(host, data);
  return data;
}

/** h1·h2 — 약속 띠 · 진행판 · 추천 카드 · 행 · (마음 마친 뒤) 페어 · (첫 방문) 예시 · 지난 기록 · 고지 */
async function drawProgress(host, data, by, theme) {
  const promiseOk = triplePromiseOk(data);
  const tp = data.triple_points;
  const left = data.services.filter((s) => s.ready && !s.done);
  const next = left[0] ?? null;

  // ① 약속 띠 — 사주를 이용할 수 없는 기기면 「셋 다」 약속 자체를 하지 않는다
  if (!data.too_young) {
    const l2 = promiseOk
      ? el("span", { class: "hub-promise__l2" }, "셋 다 하면 ", el("b", { class: "pt" }, "+", el("span", { class: "js-triple-pts" }, String(tp)), "P"), "와 오늘 결과를 모은 「오늘의 나 카드」")
      : el("span", { class: "hub-promise__l2" }, "셋 다 하면 오늘 결과를 모은 「오늘의 나 카드」를 받아요");
    host.append(
      data.first_visit
        ? el("div", { class: "hub-promise" }, ico("one", 34), el("span", {}, el("b", { class: "hub-promise__l1" }, "하루 한 번, 세 가지로 보는 오늘"), l2))
        : el("div", { class: "hub-promise is-folded" }, ico("one", 26), l2),
    );
  }

  // ② 진행판
  const cells = el("div", { class: "hub-board__cells" });
  data.services.forEach((s, i) => {
    const isNext = next && s.key === next.key;
    const state = s.done ? doneWord(s) : !s.ready ? (s.too_young ? "이용 불가" : "준비 중") : isNext ? "지금 할 차례" : "아직 안 했어요";
    cells.append(
      el(
        "div",
        { class: `hub-cell hub-cell--${s.key}${s.done ? " is-done" : ""}${isNext ? " is-next" : ""}${s.ready ? "" : " is-off"}` },
        s.done ? el("span", { class: "hub-cell__check", "aria-hidden": "true" }, "✓") : el("span", { class: "hub-cell__ord" }, String(i + 1)),
        ico(s.key, 26),
        el("b", { class: "hub-cell__name" }, HUB[s.key].short),
        el("span", { class: "hub-cell__state" }, state),
      ),
    );
  });
  cells.append(
    el("span", { class: "hub-board__arrow", "aria-hidden": "true" }, "›"),
    el(
      "div",
      { class: "hub-cell hub-cell--one" },
      ico("one", 26),
      el("b", { class: "hub-cell__name" }, "오늘의 나", el("br"), "카드"),
      promiseOk ? el("span", { class: "hub-cell__state" }, "+", el("span", { class: "js-triple-pts" }, String(tp)), "P") : null,
    ),
  );
  const nudge =
    left.length === 1
      ? el("p", { class: "hub-board__nudge" }, promiseOk ? `하나만 더 하면 +${tp}P` : `남은 하나는 ${HUB[left[0].key].left}`)
      : null;
  host.append(
    el(
      "div",
      { class: "hub-board", "aria-label": "오늘 진행" },
      el(
        "div",
        { class: "hub-board__head" },
        el("span", { class: "hub-board__count" }, "오늘 ", el("span", { class: "num" }, `${data.progress}/3`), " 했어요"),
        el("span", { class: "hub-board__today" }, "오늘 받은 포인트 ", el("b", {}, `${data.points.today}P`)),
      ),
      nudge,
      cells,
    ),
  );

  // ③ 추천 다음 카드 — 남은 것 중 SUITE_ORDER 첫째. 화면의 유일한 채운 버튼
  if (next) host.append(recoCard(next, data, left.length));

  // ④ 나머지 행
  const rows = el("nav", { class: "hub-rows", "aria-label": "오늘의 나 세 가지" });
  for (const s of data.services) if (!next || s.key !== next.key) rows.append(hubRow(s, data, theme));
  if (rows.children.length) host.append(rows);

  // 도착한 결과가 있으면 오늘의 선택 전이어도 띠를 둔다(REQ-65 F2)
  if (by.mind?.done || data.pair_unseen > 0) host.append(await hubPair(Boolean(by.mind?.done)));
  // 예시는 셋 다 해 본 적이 없을 때만 — 재방문이어도 아직 없으면 남긴다(기획 회신 59-2 · flow/hub C-6)
  if (!data.ever_triple) {
    const ex = await examplePreview(data);
    if (ex) host.append(ex);
  }
  host.append(hubFoot(data), el("p", { class: "hub-legal" }, LEGAL));
}

/** h3 — 오늘의 나 카드 · 페어 · 오늘 한 것 · 내일 안내 · 지난 기록 · 고지 */
async function drawTriple(host, data, by, theme, arrive) {
  const one = await oneCardData(data);
  if (one) {
    const gz = data.today_ganzhi;
    const box = el(
      "article",
      { class: `hub-one${arrive ? " is-arrive" : ""}`, id: "oneCard" },
      el(
        "div",
        { class: "hub-one__head" },
        el("b", { class: "hub-one__title" }, "오늘의 나 카드"),
        data.triple_paid
          ? el("span", { class: "hub-one__tag" }, "셋 다 했어요 · +", el("span", { class: "js-triple-pts" }, String(data.triple_points)), "P 받았어요")
          : null,
      ),
      collage(one.card, one.type, gz, "hub-one__pic", `오늘의 카드 ${one.cardName}, 유형 카드 ${one.type?.n ?? ""}이 겹친 오늘의 나 카드`),
      el(
        "div",
        { class: "hub-one__chips" },
        el("span", { class: "hub-chip" }, ico("tarot", 20), one.cardName),
        el("span", { class: "hub-chip" }, ico("saju", 20), one.sajuChip),
        el("span", { class: "hub-chip" }, ico("mind", 20), one.type?.n ?? "오늘의 선택"),
      ),
      el("p", { class: "hub-one__line" }, one.line),
      shareButton(one, "hub-btn-main"),
      el("p", { class: "hub-one__note" }, SHARE_NOTE),
    );
    host.append(box);
  }

  host.append(await hubPair());
  host.append(
    el(
      "div",
      { class: "hub-done__h" },
      el("h2", {}, "오늘 한 것"),
      el("span", {}, "오늘 받은 포인트 ", el("b", {}, `${data.points.today}P`)),
    ),
  );
  const rows = el("nav", { class: "hub-rows is-compact", "aria-label": "오늘 한 것" });
  for (const s of data.services) rows.append(hubRow(s, data, theme, true));
  host.append(rows, el("p", { class: "hub-next" }, "내일 0시에 새 세 칸이 열려요"), hubFoot(data), el("p", { class: "hub-legal" }, LEGAL));
}

/** 진행판 칸의 결과 한 단어 */
function doneWord(s) {
  if (s.key === "tarot") return HUB_INDEX.tarot[Number(s.key_value)]?.n ?? "뽑았어요";
  if (s.key === "mind") {
    const [expId, ti] = String(s.key_value ?? "").split(":");
    return HUB_INDEX.mind[expId]?.[Number(ti)]?.n ?? "마쳤어요";
  }
  return "봤어요";
}

/** 추천 다음 카드 — 그 서비스의 피부로 크게 */
function recoCard(s, data, leftCount) {
  const label = leftCount === 1 ? "남은 하나" : data.progress === 0 ? "먼저 해 보세요" : "다음 차례";
  // 사주 미등록자에게는 사주 진입 직전 포인트 문구를 두지 않는다(법무 답 전 기본값)
  const pts = s.key !== "saju" || data.saju_registered ? el("span", { class: "hub-reco__pt" }, `+${s.points}P부터`) : null;
  const title = el("h2", { class: "hub-reco__title" }, s.name, pts);
  const go = el("a", { class: "hub-btn-main", href: `${s.href}?from=hub` }, HUB[s.key].cta);

  if (s.key === "saju") {
    const gz = data.today_ganzhi;
    return el(
      "article",
      { class: "hub-reco hub-reco--saju", "data-svc": "saju" },
      el("span", { class: "hub-reco__label" }, label),
      title,
      el(
        "div",
        { class: "hub-sj" },
        el("div", { class: "hub-sj__seal" }, ico("saju", 58), el("b", { class: "hub-sj__day" }, `오늘 ${STEM_KO[gz % 10]}${BRANCH_KO[gz % 12]}일`)),
        el(
          "div",
          {},
          data.saju_registered
            ? el("p", { class: "hub-sj__big" }, "내 생일로", el("br"), "오늘 운세 한 줄")
            : el("p", { class: "hub-sj__big" }, "생일만 넣으면", el("br"), "오늘 운세 한 줄"),
          data.saju_registered ? null : el("p", { class: "hub-sj__sub" }, "처음 한 번만 넣어요 · 이름·성별은 안 받아요"),
        ),
      ),
      go,
    );
  }
  const pic = s.key === "tarot" ? el("span", { class: "hub-reco__back", "aria-hidden": "true" }, "✦") : ico("mind", 52);
  return el(
    "article",
    { class: `hub-reco hub-reco--${s.key}`, "data-svc": s.key },
    el(
      "div",
      { class: "hub-reco__body" },
      pic,
      el(
        "div",
        {},
        el("span", { class: "hub-reco__label" }, label),
        title,
        el("p", { class: "hub-reco__line" }, HUB[s.key].line),
        HUB[s.key].sub ? el("p", { class: "hub-reco__sub" }, HUB[s.key].sub) : null,
      ),
    ),
    go,
  );
}

/** 행 하나 — 마친 것은 결과 + 다시 보기, 남은 것은 무엇을 하는지 + 금액(사주 미등록 제외) */
function hubRow(s, data, theme, compact = false) {
  const meta = HUB[s.key];
  const name = el(
    "b",
    { class: "hub-row__name" },
    s.done && !compact ? el("i", { class: "hub-ok" }, "✓") : null,
    s.name,
    meta.tag ? el("i", { class: "hub-tag" }, meta.tag) : null,
  );
  let what;
  let sub = null;
  if (s.done) {
    what = s.key === "saju" ? theme ?? "오늘 운세를 봤어요" : compact ? summarize(s).replace(/^오늘의 (카드는|나는) /, "") : summarize(s);
  } else if (!s.ready) {
    what = s.too_young ? "만 14세부터 이용할 수 있어요" : "준비하고 있어요";
  } else if (s.key === "saju" && !data.saju_registered) {
    what = `${meta.row}${SAJU_FIRST}`;
  } else {
    what = `${meta.row} · +${s.points}P부터`;
    sub = meta.sub ?? null;
  }
  const kids = [
    ico(s.key, compact ? 30 : 40),
    el("span", { class: "hub-row__txt" }, name, el("span", { class: "hub-row__what" }, what), sub ? el("span", { class: "hub-row__sub" }, sub) : null),
    s.done && !compact
      ? el("span", { class: "hub-row__again" }, "다시 보기 ›")
      : el("span", { class: "hub-row__go", ...(s.done ? { "aria-label": "다시 보기" } : { "aria-hidden": "true" }) }, s.ready ? "›" : ""),
  ];
  const cls = `hub-row hub-row--${s.key}${s.done ? " is-done" : ""}${s.ready ? "" : " is-off"}`;
  return s.ready ? el("a", { class: cls, href: s.href }, ...kids) : el("span", { class: cls, "aria-disabled": "true" }, ...kids);
}

/** 「너를 맞혀볼게」 띠 — 실제 동작 문구(hub/IMPL v3 #12). 배지는 「도착」만 */
async function hubPair(mindDone = true) {
  const pairs = await apiGet("/api/mind/pairs").catch(() => null);
  const { state, pct, COPY } = pairInfo(pairs, mindDone);
  const link = el("a", { class: "hub-btn-sub", href: COPY.href }, COPY.cta);
  // 소개 시트는 처음 보내러 갈 때만 — 도착·대기는 이미 해 본 사람이다(pair IMPL F2·P17)
  if (state === "ready") bindPairIntro(link);
  return el(
    "div",
    { class: "hub-pair", id: "pairStrip" },
    el(
      "div",
      { class: "hub-pair__txt" },
      el("b", {}, "너를 맞혀볼게", state === "arrived" ? el("i", { class: "hub-pair__badge" }, "도착") : null),
      el("span", {}, "그 사람이 뭘 골랐을지 내가 맞혀 보고, 링크로 진짜 답을 받아요"),
      el("small", {}, state === "arrived" && pct != null ? `${COPY.line} · ${pct}%` : COPY.line),
    ),
    link,
  );
}

/** 콜라주 — 타로 카드(AI 그림) + 유형 메달 + 오늘의 글자 인장 */
function collage(card, type, gz, cls, label) {
  return el(
    "div",
    { class: `hub-collage ${cls}`, role: "img", "aria-label": label },
    el("span", { class: "hub-collage__card", style: "left:30px;top:8px;width:64px;height:96px;transform:rotate(-8deg)" }, el("img", { src: thumb(card), alt: "", loading: "lazy" })),
    el(
      "span",
      { class: "hub-medal", style: "right:36px;top:6px;width:100px;height:100px;transform:rotate(4deg)" },
      el("span", { class: "hub-medal__in" }, el("span", { class: "hub-medal__g" }, type?.g ?? "🔬"), el("span", { class: "hub-medal__n" }, type?.n ?? "")),
    ),
    Number.isInteger(gz)
      ? el("span", { class: "hub-stamp", style: "left:80px;top:58px;width:48px;height:48px;transform:rotate(-10deg)" }, el("span", {}, STEM_HAN[gz % 10], el("br"), BRANCH_HAN[gz % 12]))
      : null,
  );
}

/**
 * 첫 방문 예시 — 「셋 다 하면 받는 오늘의 나 카드」. 값은 시안 예시(별 17 · 편인 8 · 🌾)로 고정하고
 * 「예시」를 단다. 문장은 교차 DB 원문(crossLine(8, 17)).
 */
async function examplePreview(data) {
  let quote = "";
  try {
    quote = (await import("./cross-db.js")).crossLine(8, 17) ?? "";
  } catch {
    return null;
  }
  const pic = el(
    "div",
    { class: "hub-collage", "aria-hidden": "true" },
    el("span", { class: "hub-collage__card", style: "left:8px;top:6px;width:42px;height:63px;transform:rotate(-9deg);padding:2px;border-radius:5px" }, el("img", { src: thumb(17), alt: "", loading: "lazy" })),
    el("span", { class: "hub-medal", style: "right:3px;top:5px;width:54px;height:54px" }, el("span", { class: "hub-medal__in", style: "width:45px;height:45px" }, el("span", { class: "hub-medal__g", style: "font-size:18px" }, "🌾"))),
    Number.isInteger(data.today_ganzhi)
      ? el("span", { class: "hub-stamp", style: "left:38px;top:34px;width:32px;height:32px;transform:rotate(-10deg)" }, el("span", { style: "font-size:10px" }, STEM_HAN[data.today_ganzhi % 10], el("br"), BRANCH_HAN[data.today_ganzhi % 12]))
      : null,
  );
  return el(
    "aside",
    { class: "hub-preview", "aria-label": "셋 다 하면 받는 오늘의 나 카드 예시" },
    pic,
    el(
      "div",
      {},
      el("span", { class: "hub-preview__head" }, el("b", {}, "셋 다 하면 받는 오늘의 나 카드"), el("em", {}, "예시")),
      quote ? el("p", { class: "hub-preview__quote" }, `“${quote}”`) : null,
    ),
  );
}

/** 지난 기록 — 공용 달력을 밝은 판으로(today.css) */
function hubFoot(data) {
  return el(
    "div",
    {},
    el("div", { class: "hub-foot" }, archiveToggle(data, { cls: "hub-foot__link", tint: HUB_TINT })),
    el("div", { class: "archive", hidden: true, id: "archiveBox" }),
  );
}

/**
 * 자정 넘김 — 행·카드를 누를 때와 화면으로 돌아올 때 서버 day 를 다시 본다. 바뀌었으면 이동하지
 * 않고 새로 그린다(hub/IMPL JS 9). 페어 소개 시트가 막은 클릭(defaultPrevented)은 건드리지 않는다.
 */
let hubDay = null;
function watchDay(host, data) {
  hubDay = data.day;
  if (host.dataset.watch) return;
  host.dataset.watch = "1";
  const moved = async () => {
    try {
      return (await apiGet("/api/today", { compact: 1 })).day !== hubDay;
    } catch {
      return false; // 확인 못 하면 막지 않는다
    }
  };
  host.addEventListener("click", async (e) => {
    const a = e.target.closest("a[href^='/']");
    if (!a || e.defaultPrevented) return;
    e.preventDefault();
    if (await moved()) renderHub(host);
    else location.href = a.href;
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && (await moved())) renderHub(host);
  });
}
