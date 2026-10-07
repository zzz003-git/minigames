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

/** 서비스별 색 — 「전체」(/) 의 어두운 바탕용. 허브 v2 는 아래 HUB_TINT */
const TINT = { tarot: "#e8c46a", saju: "#9ab6f0", mind: "#7fd8c0" };
/** 허브 v2 서비스 색 — 다음 안내 바 점과 같은 값(nextbar.css) */
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

/** 카드 두 번째 줄 — 그 서비스가 무엇을 시키는지 동사로 */
const VERBS = {
  tarot: "뽑기 · 모으기",
  saju: "보기 · 채우기",
  mind: "고르기 · 알기",
};

/** 아직 안 한 사람에게 보여 줄 한 줄 (hub/IMPL todaysection 40-42 교체) */
const INVITE = {
  tarot: "고민을 하나 고르고 카드 한 장을 뽑아요",
  saju: "생일로 보는 오늘 운세",
  mind: "4문항 고르기",
};
/** 사주 미등록자에게만 붙는 꼬리 */
const SAJU_FIRST = " · 처음 한 번 입력";

/** 페어 링크의 상대 관계 — 대기 문구에 그대로 들어간다 */
const RELATION = { lover: "연인", friend: "친구", family: "가족", coworker: "동료" };

export async function renderTodaySection(host, { heading = true } = {}) {
  if (!host) return null;

  let data;
  try {
    // 「전체」 영역은 허브 전용 필드가 필요 없다(서버가 뺀다)
    data = normalize(await apiGet("/api/today", { compact: 1 }));
  } catch {
    // 오늘의 나가 안 열려도 게임 영역은 멀쩡해야 한다 — 조용히 비운다
    host.hidden = true;
    return null;
  }

  clear(host);
  host.hidden = false;
  host.className = "hubarea";

  if (heading) host.append(areaHead(data));

  const grid = el("nav", { class: "hubarea__grid", "aria-label": "오늘의 나 3종" });
  for (const s of data.services) grid.append(serviceCard(s, data));
  host.append(grid);

  // 페어 스트립은 **3종 카드 바로 아래**다(원안). 잠겨 있을 때는 링크가 있을 수
  // 없으므로 목록을 부르지 않는다 — 대부분의 방문에서 요청 하나가 준다.
  const mindDone = data.services.some((s) => s.key === "mind" && s.done);
  const strip = el("div", { class: "pairstrip-slot" });
  host.append(strip);
  (mindDone ? apiGet("/api/mind/pairs").catch(() => null) : Promise.resolve(null))
    .then((pairs) => strip.replaceWith(pairStrip(pairs, mindDone)));

  // 「오늘의 나 카드」는 셋 다 했을 때만. 못 채운 사람에게 빈 틀을 보여 주지 않는다.
  //
  // **자리를 먼저 잡는다.** 이 함수는 DB 를 동적 import 하느라 비동기라, 그냥
  // `host.append` 하면 아래 줄과 달력이 먼저 붙고 카드가 **맨 끝**에 떨어진다
  // (실제로 그렇게 나왔다). 빈 자리를 순서대로 꽂아 두고 나중에 채운다.
  const oneSlot = data.triple ? el("div", { class: "onecard-slot" }) : null;
  if (oneSlot) host.append(oneSlot);

  host.append(footRow(data));
  host.append(el("div", { class: "archive", hidden: true, id: "archiveBox" }));

  if (oneSlot) renderOneCard(oneSlot, data).catch(() => oneSlot.remove());
  return data;
}

/** 🌙 + 인사 + 진행 도트 + 「오늘 n/3 했어요」 */
function areaHead(data) {
  const dots = el("span", { class: "hubarea__dots", "aria-hidden": "true" });
  for (const s of data.services) {
    dots.append(el("span", { class: `hubarea__dot ${s.done ? "is-on" : ""}` }));
  }

  return el(
    "div",
    { class: "hubarea__head" },
    el("span", { class: "hubarea__icon", "aria-hidden": "true" }, "🌙"),
    el(
      "span",
      { class: "hubarea__text" },
      el("b", {}, "오늘의 나"),
      el("span", {}, greeting(data)),
    ),
    dots,
    el("span", { class: "hubarea__triple" }, `오늘 ${data.progress}/${data.total} 했어요`),
  );
}

/** 진행에 따라 말이 달라진다 — 같은 문장을 하루 종일 보여 주지 않는다 */
function greeting(data) {
  if (data.triple) return "셋 다 했어요";
  if (data.progress === 0) return "순위 없이 보는 하루";
  return `${data.total - data.progress}개 남았어요`;
}

/** 서비스별 모으기 표기 — 서버 `unit` 대신 화면 이름으로 (hub/IMPL v3 #9) */
const COLLECT_LABEL = { tarot: "카드 모음", saju: "열흘 도장", mind: "이달의 마음" };
const COLLECT_UNIT = { tarot: "장", saju: "칸", mind: "" };

function serviceCard(s, data) {
  const state = !s.ready ? (s.too_young ? "이용 불가" : "곧") : s.done ? "완료" : "대기";
  const invite = INVITE[s.key] + (s.key === "saju" && !data.saju_registered ? SAJU_FIRST : "");
  const line = !s.ready ? (s.too_young ? "만 14세부터 이용할 수 있어요" : "준비하고 있어요") : s.done ? summarize(s) : invite;

  const head = el(
    "span",
    { class: "hubcard__head" },
    el("span", { class: "hubcard__icon", "aria-hidden": "true" }, s.icon),
    el(
      "span",
      { class: "hubcard__name" },
      el("b", {}, s.name),
      el("span", {}, VERBS[s.key] ?? ""),
    ),
    el("span", { class: "hubcard__state" }, state),
  );

  const kids = [head, el("span", { class: "hubcard__line" }, line)];

  // 모으기 막대 — 준비 중인 서비스에는 모을 것이 없다
  if (s.ready && s.collect) {
    const { got, total, unit } = s.collect;
    const pct = total ? Math.round((got / total) * 100) : 0;
    kids.push(
      el(
        "span",
        { class: "hubcard__bar" },
        el("span", { class: "hubcard__fill", style: `width:${pct}%` }),
      ),
      el("span", { class: "hubcard__meta" }, `${COLLECT_LABEL[s.key] ?? `모은 ${unit}`} ${got}/${total}${COLLECT_UNIT[s.key] ?? ""}`),
    );
  }

  const attrs = { class: `hubcard ${s.done ? "is-done" : ""}`, style: `--t:${TINT[s.key]}` };
  return s.ready ? el("a", { ...attrs, href: s.href }, ...kids) : el("span", { ...attrs, "aria-disabled": "true" }, ...kids);
}

/** 아래 줄 — 아카이브 · 트리플 안내 · 고지 */
function footRow(data) {
  const note = data.triple
    ? data.triple_paid ? `셋 다 했어요 · +${data.triple_points}P 받았어요` : "셋 다 했어요"
    : data.reachable < data.total
      ? `지금은 ${data.reachable}칸까지 열려 있어요`
      : triplePromiseOk(data)
        ? `셋 다 하면 +${data.triple_points}P`
        : "셋 다 하면 「오늘의 나 카드」";

  return el(
    "div",
    { class: "hubarea__foot" },
    archiveToggle(data),
    el("span", { class: "hubarea__note" }, note),
    el("span", { class: "hubarea__legal" }, LEGAL),
  );
}

/** 고지 줄 — 원문 + AI 고지(카드 그림이 보이는 곳이 있어 상시 · hub/IMPL v3 #5·14) */
const LEGAL =
  "순위 없음 · 광고 없이도 완결 · 본 콘텐츠는 오락용이며 심리학적 진단이 아닙니다 · 카드 이미지는 생성형 AI를 활용해 제작했습니다";

// ══════════════════════════════════════════════════════════════
// 너를 맞혀볼게 — 한 줄 스트립
// ══════════════════════════════════════════════════════════════

/**
 * 「너를 맞혀볼게」 스트립.
 *
 * ── 왜 한 줄인가 ─────────────────────────────────────────────────────────
 * 처음에는 세로로 큰 카드였는데 **3종 카드보다 커져서 주객이 뒤집혔다.**
 * 이 영역의 주인공은 위의 세 칸이고 이것은 그 다음에 여는 것이다. 그래서
 * 본문 문단과 단계 칩을 걷어내고 아이콘·제목·상태·지수·버튼을 한 줄에 넣었다.
 *
 * ── 이 카드만 코랄이다 ───────────────────────────────────────────────────
 * 세 서비스는 각자 색이 있다(민트·파랑·금). 페어는 그 셋 중 하나가 아니라
 * **셋을 마친 뒤에 열리는 다른 층**이라, 서비스 팔레트 밖의 색을 쓴다.
 *
 * ── 지수는 항상 보인다 ───────────────────────────────────────────────────
 * 잠겨 있을 때도 숫자 자리를 비우지 않고 `??%` 를 블러로 깐다. 빈 자리는
 * 「없는 기능」으로 읽히지만 가려진 숫자는 「아직 못 본 것」으로 읽힌다.
 */
function pairStrip(pairs, mindDone) {
  const { state, pct, COPY } = pairInfo(pairs, mindDone);

  // 잠금은 `??`, 아직 결과가 없으면 `?`, 도착이면 실제 값.
  const face = state === "locked" ? "??" : pct == null ? "?" : String(pct);

  const gauge = el(
    "span",
    { class: "pairstrip__gauge" },
    el("span", { class: "pairstrip__pct" }, `${face}%`),
    el("span", { class: "pairstrip__gaugelabel" }, "서로 알기 지수"),
  );

  const strip = el(
    "a",
    { class: `pairstrip is-${state}`, href: COPY.href },
    el("span", { class: "pairstrip__mark", "aria-hidden": "true" }, pairMark()),
    el(
      "span",
      { class: "pairstrip__text" },
      el(
        "span",
        { class: "pairstrip__title" },
        el("b", {}, "너를 맞혀볼게"),
        // READY·WAITING·LOCKED 배지는 지웠다 — 「도착」만 남긴다(hub/IMPL 215-217)
        state === "arrived" ? el("span", { class: "pairstrip__badge" }, "도착") : null,
      ),
      el("span", { class: "pairstrip__line" }, COPY.line),
    ),
    gauge,
    el("span", { class: "pairstrip__cta" }, state === "locked" ? `🔒 ${COPY.cta}` : COPY.cta),
  );
  if (state !== "locked") bindPairIntro(strip); // 첫 탭엔 소개 시트 B
  return strip;
}

/** 페어 띠의 상태·문구 — 「전체」 띠와 허브 띠가 같이 쓴다 */
function pairInfo(pairs, mindDone) {
  const links = pairs?.links ?? [];
  const arrived = links.find((l) => l.status === "answered");
  const waiting = links.find((l) => l.status === "open");
  const state = !mindDone ? "locked" : arrived ? "arrived" : waiting ? "waiting" : "ready";

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
    waiting: { line: `${relation}에게 보낸 링크가 기다리고 있어요`, cta: "링크 다시 보기", href: "/pair/" },
    arrived: { line: "결과가 도착했어요 — 서로 알기 지수 확인", cta: "결과 보기", href: "/pair/" },
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
function archiveToggle(data, { cls = "hubarea__btn is-ghost", tint = TINT } = {}) {
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

/**
 * 원안의 `crossReading` 블록.
 *
 * 축은 **서버가 준 key** 두 개다 — 사주의 십신 idx 와 타로의 카드 id. 화면이
 * 다시 계산하지 않는다(그러면 두 곳이 어긋난다).
 */
async function renderOneCard(slot, data) {
  const one = await oneCardData(data);
  if (!one) return slot.remove();

  const chips = el("div", { class: "onecard__chips" });
  for (const t of [`🔮 ${one.cardName}`, `🌤️ ${one.sajuChip}`, one.mindChip]) {
    chips.append(el("span", { class: "onecard__chip" }, t));
  }

  const box = el(
    "div",
    { class: "onecard" },
    el(
      "div",
      { class: "onecard__head" },
      el("b", {}, "오늘의 나 카드"),
      data.triple_paid ? el("span", { class: "onecard__tag" }, `셋 다 했어요 · +${data.triple_points}P 받았어요`) : null,
    ),
    chips,
    el("p", { class: "onecard__line" }, one.line),
  );

  box.append(
    el(
      "div",
      { class: "onecard__foot" },
      shareButton(one, "onecard__share"),
      el("span", {}, SHARE_NOTE),
    ),
  );

  slot.replaceWith(box);
}

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

  if (by.mind?.done) host.append(await hubPair());
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
async function hubPair() {
  const pairs = await apiGet("/api/mind/pairs").catch(() => null);
  const { state, pct, COPY } = pairInfo(pairs, true);
  const link = el("a", { class: "hub-btn-sub", href: COPY.href, "data-pair-intro": "1" }, COPY.cta);
  bindPairIntro(link);
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
