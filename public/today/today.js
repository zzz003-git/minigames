/**
 * ✦ 허브 「오늘의 나」 — 화면
 *
 * 기획: SUITE-SPEC-01 §2
 *
 * ── 허브는 목표 구배만 만든다 ────────────────────────────────────────────
 * 세 칸 중 몇 개를 채웠는지 보여 주는 것이 전부다. 여기서 무언가를 하게 만들지
 * 않는다 — 각 서비스가 이미 완결되어 있고, 허브는 **다음 한 칸이 있다는 사실**만
 * 알려 준다(기획서 2.4 목표 구배).
 *
 * ── 사주 칸을 지우지 않는다 ──────────────────────────────────────────────
 * 만세력이 없어 아직 못 여는 서비스지만 칸은 남긴다. 세 칸이 있다는 것 자체가 이
 * 제품의 약속이고, 칸을 지웠다가 다시 넣으면 이용자는 새 서비스가 생긴 줄 안다.
 * 대신 **왜 3이 안 되는지 화면이 정직하게 적는다.**
 */

import { apiGet } from "../shared/api.js";
import { $, el, clear, renderHeader, toast } from "../shared/ui.js";
import { HUB_INDEX } from "./hub-index.js";

const TINT = { tarot: "#e8c46a", saju: "#9ab6f0", mind: "#7fd8c0" };

renderHeader($("#header"), { icon: "✦", title: "오늘의 나" });

boot();

async function boot() {
  let data;
  try {
    data = await apiGet("/api/today");
  } catch (err) {
    toast(err.message ?? "오늘을 불러오지 못했습니다.", "error");
    return;
  }

  renderGreeting(data);
  renderTriple(data);
  renderTiles(data);

  $("#ptToday").textContent = `${data.points.today}P`;
  $("#ptTotal").textContent = `${data.points.total}P`;
}

function renderGreeting(data) {
  const [y, m, d] = data.day.split("-");
  const dow = "일월화수목금토"[new Date(`${data.day}T00:00:00Z`).getUTCDay()];
  $("#greetDay").textContent = `${y}. ${m}. ${d} (${dow})`;

  const doneCount = data.progress;
  $("#greetLine").textContent =
    doneCount === 0
      ? "오늘의 나를 세 조각으로 만나요"
      : doneCount >= data.reachable
        ? "오늘 열 수 있는 건 다 열었어요"
        : "한 조각 더 남았어요";
}

function renderTriple(data) {
  const dots = clear($("#tripDots"));
  for (const s of data.services) {
    dots.append(
      el("i", { class: s.done ? "is-on" : s.ready ? "" : "is-locked" }),
    );
  }

  $("#tripCount").textContent = `${data.progress} / ${data.total}`;

  // **왜 3이 안 되는지 적는다.** 사주가 열리기 전에는 트리플이 원리적으로 완성되지
  // 않으므로, 진행도만 보여 주고 보상을 기대하게 두면 안 된다.
  const missing = data.total - data.reachable;
  $("#tripNote").textContent =
    missing > 0
      ? `오늘의 기운이 준비 중이라 지금은 ${data.reachable}칸까지예요`
      : data.triple
        ? `세 조각을 다 모았어요 · +${data.triple_points}P`
        : `세 조각을 모두 모으면 +${data.triple_points}P`;
}

function renderTiles(data) {
  const host = clear($("#hubtiles"));

  for (const s of data.services) {
    const cls = !s.ready ? "is-locked" : s.done ? "is-done" : "is-todo";
    const meta = !s.ready ? "곧 열려요" : s.done ? summarize(s) : "아직 봉인돼 있어요";

    const body = el(
      "div",
      { class: "hubtile__body" },
      el("div", { class: "hubtile__name" }, s.name),
      el("div", { class: "hubtile__meta" }, meta),
    );
    const icon = el("div", { class: "hubtile__icon", "aria-hidden": "true" }, s.icon);
    const go = el("div", { class: "hubtile__go", "aria-hidden": "true" }, s.ready ? "›" : "");

    // 준비 중인 칸은 **링크가 아니다.** 눌러서 빈 화면에 도착하는 것보다 안 눌리는
    // 편이 낫다(기획서 2.4 「완료 서비스 재유도 금지」와 같은 이유).
    const node = s.ready
      ? el("a", { class: `hubtile ${cls}`, href: s.href, style: `--t:${TINT[s.key]}` }, icon, body, go)
      : el("div", { class: `hubtile ${cls}`, style: `--t:${TINT[s.key]}` }, icon, body, go);

    host.append(node);
  }
}

/** 완료한 칸의 미니 결과 — 이름 하나면 충분하다. 해석은 각 서비스가 보여 준다 */
function summarize(s) {
  if (s.key === "tarot") {
    const card = HUB_INDEX.tarot[Number(s.key_value)];
    return card ? `${card.g} ${card.n}` : "오늘 뽑았어요";
  }
  if (s.key === "mind") {
    const [expId, ti] = String(s.key_value ?? "").split(":");
    const type = HUB_INDEX.mind[expId]?.[Number(ti)];
    return type ? `${type.g} ${type.n}` : "오늘 마쳤어요";
  }
  return "오늘 완료했어요";
}
