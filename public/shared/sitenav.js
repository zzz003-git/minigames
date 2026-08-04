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

import { el, svgEl, clear } from "./ui.js";

/**
 * 브랜드 마크 — 겹친 두 카드 위에 재생 삼각형.
 *
 * 배경·테두리를 **그림 안에서** 그린다(맨 앞 `rect`). 그래서 `.sitebar__mark` 의
 * CSS 배경을 지웠다 — 두면 둥근 모서리 뒤로 사각형 그라데이션이 비친다.
 *
 * ── 30px 에서 읽히도록 조정한 값들 ──────────────────────────────────────
 * 원안 그대로는 두 카드가 겹친 덩어리로 뭉개졌다. 32 단위로 그려도 실제로는
 * **30px 에 들어가므로** 1 단위가 채 1px 이 안 된다. 세 가지가 원인이었다.
 *
 * 1. 뒤 카드가 앞 카드에 거의 다 가려 삐져나온 폭이 5.7 단위뿐이었다 →
 *    왼쪽으로 밀어 7.5 단위로 넓혔다. 「두 장」이 보이려면 이 틈이 전부다.
 * 2. 뒤 카드 획이 `stroke-opacity .6` 이라 그 좁은 틈마저 흐렸다 → .95.
 * 3. 앞 카드 안쪽(#151827)이 배경(#191428)과 밝기가 거의 같아 카드가 아니라
 *    빈 구멍처럼 보였다 → 더 어둡게(#0e1120) 낮춰 경계를 만들었다.
 *
 * 획 두께와 삼각형도 조금씩 키웠다. 좌표를 바꿀 때는 회전 뒤 꼭짓점이
 * 바깥 라운드 사각(반지름 9.5) 안에 남는지 봐야 한다 — 모서리 쪽으로 나가면
 * 테두리를 뚫고 나온 것처럼 보인다.
 */
const brandMark = () =>
  svgEl(
    "svg",
    {
      class: "sitebar__mark",
      width: 30,
      height: 30,
      viewBox: "0 0 32 32",
      fill: "none",
      role: "img",
      "aria-label": "인스턴트 콘텐츠 로고",
    },
    svgEl("rect", {
      x: 0.6, y: 0.6, width: 30.8, height: 30.8, rx: 9.5,
      fill: "#191428", stroke: "rgba(255,255,255,.2)", "stroke-width": 1.2,
    }),
    svgEl("rect", {
      x: 6, y: 8, width: 11.2, height: 17, rx: 2.8,
      fill: "none", stroke: "#a98be0", "stroke-opacity": 0.95, "stroke-width": 2,
      transform: "rotate(-14 11.6 16.5)",
    }),
    svgEl("rect", {
      x: 12.8, y: 6.6, width: 12.6, height: 18.8, rx: 3.2,
      fill: "#0e1120", stroke: "#7fd8c0", "stroke-width": 2.2,
      transform: "rotate(7 19.1 16)",
    }),
    svgEl("path", {
      d: "M16.6 11.9 L23.3 16 L16.6 20.1 Z",
      fill: "#d6b166", transform: "rotate(7 19.1 16)",
    }),
  );

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
    brandMark(),
    // 락업은 두 줄이다 — 이름 아래 태그라인(원안 logo-4c 브랜드 락업).
    // 「무엇을 하는 곳인가」를 이름만으로는 말하지 못해서 붙였다.
    el(
      "span",
      { class: "sitebar__name" },
      el("b", {}, "인스턴트 콘텐츠"),
      el("span", { class: "sitebar__tag" }, "PLAY & READ"),
    ),
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
