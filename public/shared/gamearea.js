/**
 * 아케이드 밴드 접기 — 처음에는 8종만 보여 준다
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html (`band.onToggle` · `band.toggleLabel`)
 *
 * ── 왜 접는가 ────────────────────────────────────────────────────────────
 * 아케이드가 26종이라 다 펼치면 「전체」 화면에서 게임만 스크롤 세 판이 되고,
 * 그 아래 심리테스트 영역까지 못 내려간다. 원안이 상위 몇 종만 노출하고 나머지를
 * 접어 둔 이유가 그것이다.
 *
 * ── 원안과 다르게 한 곳 ──────────────────────────────────────────────────
 * 원안은 카드마다 순위(`c.rank`)를 달고 「어제 플레이·방문 상위 8종」이라고 적는다.
 * **그 데이터가 없다.** 플레이 집계를 허브로 내려보내는 경로가 아직 없고, 없는 것을
 * 있는 척 «인기» 라고 적으면 그건 만들어 낸 정보다.
 *
 * 그래서 순위 표시는 넣지 않고 **앞의 8종만 접는 것**까지만 한다. 문구도 「상위」가
 * 아니라 「더 보기」다. 집계가 붙으면 그때 순서를 바꾸고 순위를 단다.
 */

/** 접기 전에 보여 줄 최소 개수. 실제로는 줄이 딱 떨어지도록 올림한다 */
const MIN_VISIBLE = 8;

/** 격자가 지금 몇 칸인지 — auto-fill 이라 화면 폭마다 달라진다 */
const columnsOf = (grid) =>
  getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;

export function initGameArea(root = document) {
  const bands = [];

  for (const grid of root.querySelectorAll(".arcade-grid")) {
    const cards = [...grid.querySelectorAll(".arcade-card")];
    if (cards.length <= MIN_VISIBLE) continue;

    const band = grid.closest(".arcade-band") ?? grid.parentElement;
    let open = false;

    const apply = () => {
      // 줄 중간에서 자르면 마지막 줄이 6칸 중 2칸만 찬 채로 남는다.
      // 열 수의 배수로 올려서 항상 꽉 찬 줄에서 끊는다.
      const cols = columnsOf(grid);
      const visible = Math.ceil(MIN_VISIBLE / cols) * cols;

      const collapsed = !open && cards.length > visible;
      cards.forEach((c, i) => {
        c.hidden = collapsed && i >= visible;
      });

      // 열이 넓어져 한 줄에 다 들어가면 버튼 자체가 필요 없다
      btn.hidden = !collapsed && !open;
      btn.textContent = open ? "접기" : `${cards.length - visible}종 더 보기`;
      btn.setAttribute("aria-expanded", String(open));
    };

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bandmore";
    btn.addEventListener("click", () => {
      open = !open;
      apply();
      // 접을 때는 밴드 머리로 돌려보낸다 — 안 그러면 화면이 허공에 남는다
      if (!open) band.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    grid.after(btn);
    apply();
    bands.push(apply);
  }

  // 폭이 바뀌면 열 수가 바뀌므로 자르는 지점도 다시 잡는다.
  // rAF 로 묶지 않는다 — 백그라운드 탭에서는 rAF 가 멈춰서 재계산이 영영 밀린다
  // (CLAUDE.md 「rAF 는 백그라운드에서 멈춘다」). 밴드 두 개 계산은 그냥 해도 싸다.
  if (bands.length) {
    addEventListener("resize", () => bands.forEach((apply) => apply()));
  }
}
