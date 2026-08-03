/**
 * 공용 상단 내비 — 「게임」과 「오늘의 나」를 한 제품으로 묶는다
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html
 *
 * 이 파일이 있는 이유는 **두 영역이 서로를 모르면 한 제품이 아니기 때문**이다.
 * 지금까지 미니게임 허브와 스위트 허브는 각자 따로 있었고, 오갈 방법이 서로를
 * 가리키는 링크 하나뿐이었다. 디자인은 그것을 상단 탭으로 바꾼다.
 *
 * 내비는 **두 허브에만** 단다. 게임 화면·서비스 화면은 이미 뒤로가기가 있는
 * 한 판 안이고, 거기까지 탭을 달면 판을 도중에 벗어나게 만든다.
 */

import { el, clear } from "./ui.js";

const TABS = [
  { key: "games", label: "게임", href: "/" },
  { key: "today", label: "오늘의 나", href: "/today/" },
];

/**
 * @param {HTMLElement} host
 * @param {'games'|'today'} active
 */
export function renderSiteNav(host, active) {
  if (!host) return;
  clear(host);
  host.className = "sitebar";

  const brand = el(
    "a",
    { class: "sitebar__brand", href: "/", "aria-label": "인스턴트 콘텐츠 홈" },
    el("span", { class: "sitebar__mark", "aria-hidden": "true" }, "Z"),
    el("span", { class: "sitebar__name" }, "인스턴트 콘텐츠"),
  );

  const nav = el("nav", { class: "sitebar__tabs", "aria-label": "영역" });
  for (const t of TABS) {
    const on = t.key === active;
    nav.append(
      el(
        "a",
        {
          class: `sitetab ${on ? "is-on" : ""}`,
          href: t.href,
          ...(on ? { "aria-current": "page" } : {}),
        },
        t.label,
      ),
    );
  }

  host.append(el("div", { class: "sitebar__inner" }, brand, nav));
}
