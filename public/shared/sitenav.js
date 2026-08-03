/**
 * 공용 상단 내비 — 전체 / 게임 / 오늘의 나
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html (`tabDefs`)
 *
 * ── 「전체」가 메인이다 ──────────────────────────────────────────────────
 * 원안의 탭은 넷이고 첫 탭이 **전체**다. 그 화면에서는 게임 영역과 오늘의 나 영역이
 * **함께** 보인다 — 원안 스크립트가 `showGames: isHome || isGames`,
 * `showHub: isHome || isHub` 로 그렇게 갈라 놓았다.
 *
 * 처음에 탭을 둘(게임·오늘의 나)로만 만들었는데 그건 원안을 잘못 읽은 것이다.
 * 두 영역을 오가게만 하면 「한 제품」이 아니라 「두 제품 사이의 스위치」가 된다.
 * 전체 화면이 있어야 둘이 한 제품으로 보인다.
 *
 * ── 「웹툰 준비중」은 누를 수 없다 ───────────────────────────────────────
 * 원안이 `view: null` 로 두고 `onClick` 을 빈 함수로 막아 뒀다. 눌러서 빈 화면에
 * 도착하는 것보다 안 눌리는 편이 낫다(허브의 준비 중 칸과 같은 처리).
 */

import { el, clear } from "./ui.js";

/** 원안 `tabDefs` 그대로. `href: null` = 아직 열리지 않은 영역 */
const TABS = [
  { key: "home", label: "전체", href: "/" },
  { key: "games", label: "게임", href: "/games/" },
  { key: "hub", label: "오늘의 나", href: "/today/" },
  { key: "soon", label: "웹툰 준비중", href: null },
];

/**
 * @param {HTMLElement} host
 * @param {'home'|'games'|'hub'} active
 *   서비스 화면(타로·기운·마음·페어)에서는 'hub' 를 넘긴다 —
 *   원안의 `activeView = inSuite ? 'hub' : v` 와 같다.
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

    if (!t.href) {
      nav.append(
        el("span", { class: "sitetab is-soon", "aria-disabled": "true" }, t.label),
      );
      continue;
    }
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
