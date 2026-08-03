/**
 * 아케이드 밴드 접기 — 처음에는 8종만 보여 준다
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html (`band.onToggle` · `band.toggleLabel`)
 *
 * ── 왜 접는가 ────────────────────────────────────────────────────────────
 * 아케이드가 26종이라 다 펼치면 「전체」 화면에서 게임만 스크롤 세 판이 되고,
 * 그 아래 오늘의 나 영역까지 못 내려간다. 원안이 상위 몇 종만 노출하고 나머지를
 * 접어 둔 이유가 그것이다.
 *
 * ── 순위는 어제 것을 쓴다 ────────────────────────────────────────────────
 * 원안이 카드마다 다는 순위(`c.rank`)다. 집계 경로가 없어 미뤄 뒀다가
 * `GET /api/games/popular` 로 붙였다 — **어제** 플레이 수다.
 *
 * 오늘 것을 쓰면 아침에 표본이 거의 없어 먼저 들어온 몇 사람이 그날 순서를 정해
 * 버린다. 어제는 닫힌 표본이라 하루 종일 안정적이다.
 *
 * **집계가 없으면 원래 순서를 그대로 쓴다.** 어제 아무도 안 했거나 API 가 실패해도
 * 목록은 멀쩡해야 한다 — 순위는 덤이지 전제가 아니다.
 */

/** 접기 전에 보여 줄 최소 개수. 실제로는 줄이 딱 떨어지도록 올림한다 */
const MIN_VISIBLE = 8;

/** 격자가 지금 몇 칸인지 — auto-fill 이라 화면 폭마다 달라진다 */
const columnsOf = (grid) =>
  getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;

export function initGameArea(root = document) {
  const bands = [];

  // 순위는 **비동기로 나중에** 얹는다. 이것을 기다리느라 목록이 늦게 뜨면
  // 순위 때문에 화면이 느려지는 셈이라 얻는 것보다 잃는 것이 크다.
  applyRanks(root).catch(() => {});

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

/**
 * 어제 플레이 수로 카드를 다시 세우고 상위에 순위를 단다.
 *
 * 순서를 바꾸는 것이 핵심이다 — 밴드를 8종에서 접으므로, 정렬해야 「접힌 채로도
 * 많이 하는 게임이 보인다」가 성립한다. 순위 숫자는 그 근거를 밝히는 표시다.
 */
async function applyRanks(root) {
  const res = await fetch("/api/games/popular");
  if (!res.ok) return;
  const data = await res.json();

  const plays = new Map((data.games ?? []).map((g) => [g.game_type, g.plays]));
  if (!plays.size) return; // 어제 아무도 안 했다 — 원래 순서를 그대로 둔다

  for (const grid of root.querySelectorAll(".arcade-grid")) {
    const cards = [...grid.querySelectorAll(".arcade-card")];

    // 카드가 어떤 게임인지는 링크 주소로 안다(`/games/<폴더>/`).
    // 폴더명과 GAME_TYPE 이 같은 규칙이라 대문자로 맞춘다.
    const keyOf = (c) => (c.getAttribute("href") ?? "").split("/").filter(Boolean).pop()?.toUpperCase();

    const scored = cards.map((c, i) => ({ c, i, n: plays.get(keyOf(c)) ?? -1 }));
    // 기록이 없는 게임은 뒤로 보내되 **원래 순서를 지킨다**(안정 정렬).
    scored.sort((a, b) => (b.n - a.n) || (a.i - b.i));

    scored.forEach(({ c, n }, idx) => {
      grid.append(c); // 정렬 순서대로 다시 붙인다
      const old = c.querySelector(".arcade-card__rank");
      if (old) old.remove();
      // 순위는 **실제로 기록이 있는 상위 3종에만** 단다. 전부에 달면 숫자가 배경이 된다
      if (n > 0 && idx < 3) {
        const tag = document.createElement("span");
        tag.className = "arcade-card__rank";
        tag.textContent = `#${idx + 1}`;
        c.prepend(tag);
      }
    });
  }

  // 순서가 바뀌었으니 접는 지점을 다시 잡는다
  dispatchEvent(new Event("resize"));
}
