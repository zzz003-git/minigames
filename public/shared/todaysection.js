/**
 * 「전체」 화면의 오늘의 나 영역
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html (`showHub: isHome || isHub`)
 *
 * 원안에서 **전체 화면은 게임과 오늘의 나를 함께 보여 준다.** 그래서 이 영역이
 * 필요하다 — 두 영역을 오가게만 하면 「한 제품」이 아니라 「두 제품 사이의
 * 스위치」가 된다.
 *
 * 여기서 그리는 것은 **요약**이다. 자세한 것은 `/today/` 가 하고, 이 파일은 같은
 * API(`/api/today`)를 읽어 3칸과 진행도만 보여 준다. 허브를 두 벌 만들지 않는다.
 */

import { el, clear } from "./ui.js";
import { apiGet } from "./api.js";

const TINT = { tarot: "#e8c46a", saju: "#9ab6f0", mind: "#7fd8c0" };

export async function renderTodaySection(host) {
  if (!host) return;

  let data;
  try {
    data = await apiGet("/api/today");
  } catch {
    // 오늘의 나가 안 열려도 게임 영역은 멀쩡해야 한다 — 조용히 비운다
    host.hidden = true;
    return;
  }

  clear(host);
  host.hidden = false;

  host.append(
    el(
      "div",
      { class: "hub__section-title" },
      el("b", {}, "오늘의 나"),
      el("span", {}, `순위 없이 보는 하루 · ${data.progress}/${data.total}`),
    ),
  );

  const grid = el("nav", { class: "todaygrid", "aria-label": "오늘의 나 3종" });
  for (const s of data.services) {
    const cls = !s.ready ? "is-locked" : s.done ? "is-done" : "is-todo";
    const meta = !s.ready ? "곧 열려요" : s.done ? "오늘 완료" : "아직 봉인돼 있어요";

    const inner = [
      el("span", { class: "todaycard__icon", "aria-hidden": "true" }, s.icon),
      el("span", { class: "todaycard__title" }, s.name),
      el("span", { class: "todaycard__desc" }, meta),
    ];

    grid.append(
      s.ready
        ? el("a", { class: `todaycard ${cls}`, href: s.href, style: `--t:${TINT[s.key]}` }, ...inner)
        : el("span", { class: `todaycard ${cls}`, style: `--t:${TINT[s.key]}` }, ...inner),
    );
  }
  host.append(grid);

  // 진행도 한 줄 — 목표 구배만 만든다(허브와 같은 원칙)
  const note = data.triple
    ? `세 조각을 다 모았어요 · +${data.triple_points}P`
    : data.reachable < data.total
      ? `오늘의 기운이 준비 중이라 지금은 ${data.reachable}칸까지예요`
      : `세 조각을 모두 모으면 +${data.triple_points}P`;

  host.append(
    el(
      "a",
      { class: "todaymore", href: "/today/" },
      el("span", {}, note),
      el("b", {}, "오늘의 나 열기 ›"),
    ),
  );
}
