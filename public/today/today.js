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
import { renderHub } from "../shared/todaysection.js";
import { renderTestBanner } from "../shared/testbanner.js";

// 서비스 화면(타로·사주·마음·페어)에서도 이 탭이 켜진다 — 원안의
// `activeView = inSuite ? 'hub' : v` 와 같다
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "✦", title: "오늘의 나", back: "/" });

boot();

async function boot() {
  renderTestBanner($("#testBanner"));
  // 허브 v2(REQ-63 묶음 5) — 「전체」 영역과 같은 모듈의 허브 판. 오늘 받은 포인트는 진행판이 보인다
  if (!(await renderHub($("#todayArea")))) toast("오늘을 불러오지 못했습니다.", "error");
}
