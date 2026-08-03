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
 * ── 영역은 공용 모듈이 그린다 ────────────────────────────────────────────
 * 「전체」 화면(`/`)과 허브가 같은 것을 보여 준다. 그래서 영역 자체는
 * `shared/todaysection.js` 한 벌이고, 이 파일은 그것을 붙이고 포인트 두 칸만 더한다.
 */

import { $, renderHeader, toast } from "../shared/ui.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { renderTodaySection } from "../shared/todaysection.js";

// 서비스 화면(타로·기운·마음·페어)에서도 이 탭이 켜진다 — 원안의
// `activeView = inSuite ? 'hub' : v` 와 같다
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "✦", title: "오늘의 나" });

boot();

async function boot() {
  // 영역 자체는 「전체」 화면과 **같은 모듈**이 그린다. 허브가 더 보여 주는 것은
  // 포인트 두 칸뿐이다 — 그것 때문에 영역을 두 벌 만들 이유는 없다.
  const data = await renderTodaySection($("#todayArea"));
  if (!data) {
    toast("오늘을 불러오지 못했습니다.", "error");
    return;
  }

  $("#ptToday").textContent = `${data.points.today}P`;
  $("#ptTotal").textContent = `${data.points.total}P`;
}
