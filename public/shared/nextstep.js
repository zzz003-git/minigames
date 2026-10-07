/**
 * 「오늘의 나」 다음 안내 바 — 세 서비스 결과 화면 공용 (REQ-63 · NEXTBAR.md v5)
 *
 * 결과 화면의 `#nextBlock` 자리에 본문 끝 블록(.nextblock)을, body 에 고정 바(.nextbar) 하나를 그린다.
 * 문구·이동은 서버 `dailyState`(= 응답의 `suite`) 값으로만 정한다 — 금액도 상수로 쓰지 않는다.
 *
 * 보이는 조건(고정 바): 그 결과 화면이 열려 있고 · 결과 렌더 뒤 0.4초가 지났고 ·
 * 본문 끝 블록이 화면에 들어오지 않았고 · (셋 다 한 뒤 서비스 주 버튼이 있는 화면이 아님).
 * 화면 전환은 `[data-screen]` 의 class 변화를 지켜본다 — 공용 showScreen(게임 30종도 씀)을 고치지 않으려고.
 */

import { apiGet } from "./api.js";
import { el, clear } from "./ui.js";

/** 추천 순서 — 입력 없는 것부터, 생일 입력은 마지막 (K2). 허브도 이 상수를 쓴다 */
export const SUITE_ORDER = ["tarot", "mind", "saju"];

const META = {
  tarot: { name: "오늘의 타로", href: "/tarot/", line: "고민 하나에 카드 한 장" },
  mind: { name: "오늘의 선택", href: "/mind/", line: "심리테스트 4문항" },
  saju: { name: "오늘의 사주", href: "/saju/", line: "생일로 보는 오늘 운세" },
};

const ARM_MS = 400; // 서비스 armScreen 과 같은 입력 잠금

/** 사주 화면이 TOO_YOUNG 을 받으면 남기는 기기 기억(saju.js) — 편의 기억이라 실패하면 「아님」 */
const tooYoung = () => {
  try {
    return localStorage.getItem("mg_saju_too_young") === "1";
  } catch {
    return false;
  }
};

/** NEXTBAR 상태표 6행 */
export function decide(suite, justCompleted) {
  const tp = suite.triple_points;
  if (SUITE_ORDER.every((k) => suite[k]?.done)) {
    return justCompleted
      ? { b: `셋 다 했어요! +${tp}P 받았어요`, s: "타로·선택·사주 · 오늘의 나 카드 보기", href: "/today/?from=triple" }
      : { b: "오늘의 나 카드 보기", s: "셋 다 했어요 · 내일 0시에 새로 열려요", href: "/today/" };
  }
  const left = SUITE_ORDER.filter((k) => !suite[k]?.done && suite.ready?.[k] !== false);
  if (left.length === 0) return { b: "오늘 할 수 있는 건 다 했어요", s: "오늘의 나로 가기", href: "/today/" };
  const next = META[left[0]];
  if (left.length >= 2) {
    return { b: `${left.length}개 남았어요 · 다음은 ${next.name}`, s: `${next.line} · 셋 다 하면 +${tp}P`, href: next.href };
  }
  // 사주를 지목하는 줄에는 포인트를 쓰지 않는다 — 미등록자(14세 판정 전)에게 +15P 약속 금지
  if (left[0] === "saju" && !suite.saju_registered) {
    return { b: "하나만 더! 다음은 오늘의 사주", s: next.line, href: next.href };
  }
  return { b: `하나만 더! 다음은 ${next.name}`, s: `셋 다 하면 +${tp}P`, href: next.href };
}

function fill(node, d, suite) {
  const n = SUITE_ORDER.filter((k) => suite[k]?.done).length;
  clear(node).append(
    el(
      "span",
      { class: "nextbar__dots" },
      el(
        "span",
        { class: "nextbar__dotrow", "aria-hidden": "true" },
        SUITE_ORDER.map((k) => el("i", { class: `nextbar__dot nextbar__dot--${k}${suite[k]?.done ? " is-on" : ""}` })),
      ),
      el("span", { class: "nextbar__step" }, `오늘의 나 ${n}/3`),
    ),
    el("span", { class: "nextbar__text" }, el("b", {}, d.b), el("span", {}, d.s)),
    el("span", { class: "nextbar__go", "aria-hidden": "true" }, "›"),
  );
  node.href = d.href;
}

/** 자정을 넘겼으면 이동하지 않고 새로 받는다 — 어제 상태로 「다음」 을 고르지 않게 */
async function dayChanged(day) {
  try {
    return (await apiGet("/api/today")).day !== day;
  } catch {
    return false; // 확인 못 하면 막지 않는다
  }
}

async function go(e) {
  e.preventDefault();
  if (await dayChanged(cur.day)) location.reload();
  else location.href = e.currentTarget.href;
}

let bar = null;
let cur = null; // { screen, day, wantBar, armed, blockVisible }
let io = null;
let mo = null;

function update() {
  if (!bar || !cur) return;
  const show = cur.wantBar && cur.armed && !cur.blockVisible && cur.screen.classList.contains("is-active");
  const wasHidden = bar.classList.contains("is-hidden");
  bar.classList.toggle("is-hidden", !show);
  document.body.classList.toggle("has-nextbar", show);
  if (show && wasHidden) {
    // 바에도 같은 0.4초 잠금 — 결과가 뜨자마자 손가락이 바를 누르지 않게
    bar.style.pointerEvents = "none";
    setTimeout(() => (bar.style.pointerEvents = ""), ARM_MS);
  }
}

function ensureBar() {
  if (bar) return;
  bar = el("a", { class: "nextbar is-hidden", href: "/today/", onclick: go });
  document.body.append(bar);
  new ResizeObserver(() =>
    document.documentElement.style.setProperty("--nextbar-h", `${bar.offsetHeight}px`),
  ).observe(bar);
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !cur?.screen.classList.contains("is-active")) return;
    if (await dayChanged(cur.day)) location.reload();
  });
}

/**
 * @param {{ svc:string, suite:object, justCompleted?:boolean, hasPrimaryAction?:boolean }} ctx
 *   suite = 서버 dailyState(`day`·`triple_points`·`saju_registered`·`ready` 포함)
 *   justCompleted = 이번 결과 응답의 triple_gained > 0
 *   hasPrimaryAction = 결과 화면에 그 서비스의 채워진 주 버튼이 있는가(셋 다 한 뒤면 고정 바를 띄우지 않는다)
 */
export function renderNextStep({ suite, justCompleted = false, hasPrimaryAction = false }) {
  const host = document.getElementById("nextBlock");
  if (!host || !suite) return;
  // 이 기기에서 사주가 만 14세 미만으로 거절됐으면 사주는 「이용 불가」 — 남은 서비스에서 뺀다(hub IMPL 15)
  if (tooYoung()) suite = { ...suite, ready: { ...suite.ready, saju: false } };
  const screen = host.closest("[data-screen]");
  const d = decide(suite, justCompleted);
  const allDone = SUITE_ORDER.every((k) => suite[k]?.done);

  const block = el("a", { class: "nextblock", onclick: go });
  fill(block, d, suite);
  clear(host).append(block);
  host.hidden = false;

  ensureBar();
  fill(bar, d, suite);

  let spacer = screen.querySelector(":scope > .nextbar-spacer");
  if (!spacer) spacer = el("div", { class: "nextbar-spacer", "aria-hidden": "true" });
  screen.append(spacer); // 늘 마지막 자식
  cur = { screen, day: suite.day, wantBar: !(allDone && hasPrimaryAction), armed: false, blockVisible: false };
  spacer.hidden = !cur.wantBar;
  bar.classList.add("is-hidden");

  io?.disconnect();
  io = new IntersectionObserver(
    ([e]) => {
      cur.blockVisible = e.isIntersecting;
      update();
    },
    { threshold: 0.3 },
  );
  io.observe(block);
  mo?.disconnect();
  mo = new MutationObserver(update);
  mo.observe(screen, { attributes: true, attributeFilter: ["class"] });

  const mine = cur;
  setTimeout(() => {
    mine.armed = true;
    update();
  }, ARM_MS);
}

/** 바를 쓰지 않는 결과(선택의 지난 선택 등) — 블록·바·여백을 모두 거둔다 */
export function hideNextStep() {
  const host = document.getElementById("nextBlock");
  if (host) host.hidden = true;
  if (!cur) return;
  cur.wantBar = false;
  cur.screen.querySelector(":scope > .nextbar-spacer")?.setAttribute("hidden", "");
  update();
}
