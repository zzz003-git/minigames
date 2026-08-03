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
 * ── 원안에서 빼 둔 것 ────────────────────────────────────────────────────
 * - **「오늘의 나 한 장」(교차 리딩)** — 220문장 DB(`cross_db_v1.json`)가 아직 없다.
 *   문장 없이 틀만 띄우면 빈 카드가 남는다. 트리플 안내 줄로 대신해 둔다.
 * - **아카이브 달력** — 월 단위 조회 API 가 없다. `daily_agg` 에 데이터는 쌓이고
 *   있으므로 API 하나만 붙이면 되는데, 그건 이 단계(외형)의 일이 아니다.
 */

import { el, clear } from "./ui.js";
import { apiGet } from "./api.js";
import { HUB_INDEX } from "./hub-index.js";

/** 서비스별 색. 원안이 세 칸을 색으로 갈라 놓았다 */
const TINT = { tarot: "#e8c46a", saju: "#9ab6f0", mind: "#7fd8c0" };

/** 카드 두 번째 줄 — 그 서비스가 무엇을 시키는지 동사로 */
const VERBS = {
  tarot: "뽑기 · 모으기",
  saju: "보기 · 채우기",
  mind: "고르기 · 알기",
};

/** 아직 안 한 사람에게 보여 줄 한 줄 */
const INVITE = {
  tarot: "오늘의 카드가 아직 뒤집혀 있어요",
  saju: "오늘의 기운이 아직 잠겨 있어요",
  mind: "오늘의 실험이 기다리고 있어요",
};

export async function renderTodaySection(host, { heading = true } = {}) {
  if (!host) return null;

  let data;
  try {
    data = await apiGet("/api/today");
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
  for (const s of data.services) grid.append(serviceCard(s));
  host.append(grid);

  host.append(footRow(data));
  host.append(el("div", { class: "archive", hidden: true, id: "archiveBox" }));
  return data;
}

/** 🌙 + 인사 + 트리플 도트 + TRIPLE n/3 */
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
    el("span", { class: "hubarea__triple" }, `TRIPLE ${data.progress}/${data.total}`),
  );
}

/** 진행에 따라 말이 달라진다 — 같은 문장을 하루 종일 보여 주지 않는다 */
function greeting(data) {
  if (data.triple) return "세 조각을 다 모았어요";
  if (data.progress === 0) return "순위 없이 보는 하루";
  return `${data.total - data.progress}조각 남았어요`;
}

function serviceCard(s) {
  const state = !s.ready ? "곧" : s.done ? "완료" : "대기";
  const line = !s.ready ? "준비하고 있어요" : s.done ? summarize(s) : INVITE[s.key];

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
      el("span", { class: "hubcard__meta" }, `모은 ${unit} ${got} / ${total}`),
    );
  }

  const attrs = { class: `hubcard ${s.done ? "is-done" : ""}`, style: `--t:${TINT[s.key]}` };
  return s.ready ? el("a", { ...attrs, href: s.href }, ...kids) : el("span", { ...attrs, "aria-disabled": "true" }, ...kids);
}

/** 아래 줄 — 페어 · 트리플 안내 · 고지 */
function footRow(data) {
  const note = data.triple
    ? `세 조각을 다 모았어요 · +${data.triple_points}P`
    : data.reachable < data.total
      ? `지금은 ${data.reachable}칸까지 열려 있어요`
      : `세 조각을 모두 모으면 +${data.triple_points}P`;

  return el(
    "div",
    { class: "hubarea__foot" },
    // 원안의 「우리 페어」 화면은 아직 없다. 서버(`/api/mind/pair/*`)와 수신자
    // 화면(`/p/`)은 있는데 **발급 화면**이 없어서, 링크를 걸면 404 로 간다.
    // 눌러서 없는 데로 가는 것보다 안 눌리는 편이 낫다(상단 「웹툰 준비중」과 같다).
    el("span", { class: "hubarea__btn is-soon", "aria-disabled": "true" }, "우리 · 너를 맞혀볼게 (준비 중)"),
    archiveToggle(),
    el("span", { class: "hubarea__note" }, note),
    el("span", { class: "hubarea__legal" }, "순위 없음 · 무광고로 완결 · 오락용입니다"),
  );
}

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
function archiveToggle() {
  const btn = el("button", { type: "button", class: "hubarea__btn is-ghost" }, "지난 기록");
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
      await renderArchive(box, new Date().toISOString().slice(0, 7));
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
  if (d.done.saju) bits.push("🌤️ 기운");
  if (d.done.mind) {
    const [expId, ti] = String(d.key.mind ?? "").split(":");
    const t = HUB_INDEX.mind[expId]?.[Number(ti)];
    bits.push(t ? `${t.g} ${t.n}` : "선택");
  }
  return bits.join(" · ");
}

async function renderArchive(box, month) {
  const data = await apiGet(`/api/today/archive?month=${month}`);
  const byDay = new Map(data.days.map((d) => [d.day, d]));

  clear(box);
  box.append(
    el(
      "div",
      { class: "archive__head" },
      el("b", {}, `${month.replace("-", ". ")} 기록`),
      el("span", {}, `세 조각을 다 모은 날 ${data.triple_days}일`),
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
    for (const k of ["tarot", "saju", "mind"]) {
      dots.append(el("i", { class: rec?.done[k] ? "is-on" : "", style: `--t:${TINT[k]}` }));
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
