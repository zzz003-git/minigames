/**
 * 🔮 오늘의 타로 — 화면
 *
 * 기획: TAROT-SPEC-02(78장 · 별가루 · 카드 그림) · 1.0 인터랙션 1차 사양은 프로토
 * (`../reward-minigame-research/tarot/prototype/TAROT-PROTO-01_오늘의타로.html`)
 *
 * ── 화면이 정하는 것과 정하지 못하는 것 ──────────────────────────────────
 * **어떤 카드가 나오는지는 서버가 정한다.** 화면이 정할 수 있으면 도감 마일스톤을
 * 원하는 카드로 채울 수 있고 그건 원가에 직접 닿는다(기획서 T-01).
 *
 * 반대로 **해석 문장의 회전은 화면이 한다.** 같은 카드라도 날짜·포커스에 따라 문장이
 * 바뀌지만 보상과 무관하므로 서버가 알 필요가 없다(기획서 T-07). 그래서 해석 DB가
 * 이쪽에만 있다.
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { TAROT_DB } from "./tarot-db.js";
import { renderSiteNav } from "../shared/sitenav.js";

const FOCUS = [
  { k: "day", label: "오늘 하루" },
  { k: "work", label: "일 · 공부" },
  { k: "love", label: "사랑 · 관계" },
  { k: "money", label: "돈 · 재물" },
];

/** 화면이 바뀐 직후 그 화면의 버튼을 못 누르게 두는 시간 (기획서 0-H) */
const ARM_DELAY_MS = 400;
/** 3D 플립 (tarot.css 의 transition 과 같은 값) */
const FLIP_MS = 900;

/**
 * 카드 그림 (SPEC-02 5.5). 78장이 4.5MB 라 묶어 싣지 않는다 — **뽑힌 한 장만** 받는다.
 * 경로의 `s2` 가 덱 이름이고 1년 캐시가 걸려 있다(`public/_headers`).
 */
const CARD_IMG = (id) => `/assets/tarot/deck/s2/${id}.webp`;
const THUMB_IMG = (id) => `/assets/tarot/thumb/s2/${id}.webp`;
/**
 * 플립 전에 그림을 기다리는 상한. 넘으면 이모지로 뒤집는다 — 뒷면인 채 멈춰 있는
 * 것보다 낫다. 3G(약 400kbps)에서 최대 124KB 가 약 2.5초라 그 세 배쯤 둔다.
 */
const PRELOAD_MAX_MS = 8000;

/** 3단계 콘텐츠 모듈 (tarot-stage3.js) — boot 에서 받는다. 못 받으면 null 이고 3단계 부분만 빠진다 */
let S3 = null;

/**
 * 그날의 이달의 질문 {q, focus} — 시작 월부터 한 달에 하나씩, 36개 뒤 처음으로 (SPEC-04 §2).
 * 서버(`questionNo`)와 같은 식이다. 지난날 달력도 날짜만으로 다시 계산한다.
 */
function monthQuestion(day) {
  if (!S3) return null;
  const [y, m] = day.split("-").map(Number);
  const [sy, sm] = (state.today?.question_start_month ?? "2026-10").split("-").map(Number);
  const n = S3.QUESTIONS.length;
  const k = (y - sy) * 12 + (m - sm);
  return S3.QUESTIONS[((k % n) + n) % n];
}

/** 전체 장수 (SPEC-02) — 이만큼 모으면 금빛 바퀴가 열린다(SPEC-03) */
const TOTAL = 78;
/** 금빛 번짐 연출 길이 (tarot.css 의 t-bloom 과 같은 값) */
const GOLD_BLOOM_MS = 800;
/** 숨은 이야기가 한 글자씩 다 나타나기까지 (SPEC-03 §2 「약 1.5초」) */
const STORY_TYPE_MS = 1500;

/** 도감 수트 탭. id 범위는 SPEC-02 0절 */
const SUITS = [
  { k: "all", label: "전체", from: 0, to: 77 },
  { k: "major", label: "메이저", from: 0, to: 21 },
  { k: "wands", label: "완드", from: 22, to: 35 },
  { k: "cups", label: "컵", from: 36, to: 49 },
  { k: "swords", label: "소드", from: 50, to: 63 },
  { k: "pentacles", label: "펜타클", from: 64, to: 77 },
];

const state = {
  today: null,
  focus: null,
  shuffles: 0,
  needShuffles: 3,
  dragX: null,
  busy: false,
  collTab: "all",
};

// 원안의 `activeView = inSuite ? 'hub' : v` — 서비스 화면에서도 「오늘의 나」 탭이
// 켜진 채 남는다. 게임 화면과 달리 여기는 판 중이 아니라 결과를 보는 자리다.
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "🔮", title: "오늘의 타로", back: "/today/" });

$("#collBtn").addEventListener("click", showCollection);
$("#collBackBtn").addEventListener("click", () => {
  showScreen(state.today?.draws?.length ? "result" : "deck");
});
// 도감 | 달력 (SPEC-03 §5)
for (const b of document.querySelectorAll("#collViewTabs button")) {
  b.addEventListener("click", () => setCollView(b.dataset.view));
}
$("#spBack").addEventListener("click", () => leaveSpecial());
$("#calPrev").addEventListener("click", () => renderCalendar(shiftMonth(state.calMonth, -1)));
$("#calNext").addEventListener("click", () => renderCalendar(shiftMonth(state.calMonth, 1)));

// 손가락 선택은 무대 하나에만 건다 — 카드마다 걸면 재배치할 때마다 다시 걸어야 한다
bindFanPicker();

boot();

// ══════════════════════════════════════════════════════════════
// 해석 회전 — 프로토 사양 그대로
// ══════════════════════════════════════════════════════════════

/** FNV-1a. 같은 입력이면 언제나 같은 값이라 날짜가 바뀔 때만 문장이 바뀐다 */
function seeded(str) {
  let h = 2166136261;
  for (const c of String(str)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * 한 장의 읽을거리를 만든다.
 *
 *   해석 변형  hash(day + card + focus)   같은 카드라도 고민에 따라 다르게 읽힌다
 *   조언       hash(day + card)           카드 고유 2개 + 공용 풀 60개
 *   행운 아이템 hash(day + item + card)
 */
function reading(day, cardId, focus) {
  const card = TAROT_DB.cards[cardId];
  // 이달의 질문(`q`)은 그 질문에 지정된 포커스의 문장을 쓴다 (SPEC-04 §2)
  if (focus === "q") focus = monthQuestion(day)?.focus ?? "day";
  const variants = card.interp[focus] ?? card.interp.day;
  const advicePool = [...card.advice, ...TAROT_DB.advicePool];

  return {
    card,
    interp: variants[seeded(`${day}|${cardId}|${focus}`) % variants.length],
    advice: advicePool[seeded(`${day}|${cardId}`) % advicePool.length],
    item: TAROT_DB.luckyItems[seeded(`${day}|item|${cardId}`) % TAROT_DB.luckyItems.length],
  };
}

// ══════════════════════════════════════════════════════════════
// 진입
// ══════════════════════════════════════════════════════════════

async function boot() {
  try {
    // 3단계 콘텐츠(키워드·질문 은행 등)는 해석 DB 와 떼어 두었다 — 오늘 상태와 같이 받는다
    // 못 받아도 오늘의 카드는 뽑을 수 있어야 한다 — 3단계 부분만 빠진다
    [state.today, S3] = await Promise.all([
      apiGet("/api/tarot/today"),
      import("./tarot-stage3.js").catch(() => null),
    ]);
  } catch (err) {
    toast(err.message ?? "오늘의 카드를 불러오지 못했습니다.", "error");
    return;
  }

  renderTestClock();

  // 78장을 다 모았는데 완성 화면을 끝까지 못 봤다 — 이번 방문 첫 화면에 다시 (SPEC-03 §1-1 ②)
  if (state.today.gold_intro_pending) await showComplete();

  // 이미 뽑았으면 덱을 건너뛰고 결과로 간다 — 「오늘의 카드」는 하루 한 장이고
  // 다시 들어왔을 때 또 뽑게 하면 그 전제가 깨진다(기획서 1절 엣지).
  if (state.today.draws.length > 0) {
    const last = state.today.draws[state.today.draws.length - 1];
    renderResult(last.c, last.f, { gained: 0, replay: true });
    return;
  }
  enterDeck();
}

// ══════════════════════════════════════════════════════════════
// 덱 · 포커스
// ══════════════════════════════════════════════════════════════

function enterDeck() {
  state.mode = null;
  state.focus = null;
  state.shuffles = 0;
  state.needShuffles = state.today.shuffles ?? 3;

  renderFocusRow();
  renderSpecialRow();
  renderDots();
  $("#deck").classList.add("breathe");
  $("#deckHint").textContent = "무엇이 궁금하세요?";
  $("#deckSub").textContent = "고민을 고르면 덱이 열려요";
  // 진척 칩 — 완성 뒤엔 금빛 바퀴라는 것을 덱 앞에서부터 알 수 있게 (SPEC-03 §1-1 ③)
  const coll = state.today.collection_count ?? 0;
  $("#deckChip").textContent =
    coll >= TOTAL ? `✦ 금빛 ${state.today.gold_count ?? 0}/${TOTAL}` : `도감 ${coll}/${TOTAL}`;
  $("#deckChip").classList.toggle("is-goldround", coll >= TOTAL);
  setHeaderBadge(`오늘 ${state.today.remaining}장`);
  showScreen("deck");
}

function renderFocusRow() {
  const host = clear($("#focusRow"));
  const used = state.today.used_focuses ?? [];
  // 그달 첫째 주 월요일에만 5번째 칩 「이달의 질문」 (SPEC-04 §2)
  const mq = state.today.question?.open ? monthQuestion(state.today.day) : null;
  const chips = mq ? [...FOCUS, { k: "q", label: `✦ ${mq.q}` }] : FOCUS;

  for (const f of chips) {
    const isUsed = used.includes(f.k);
    const node = el(
      "button",
      {
        class: `chip-focus ${isUsed ? "is-used" : ""} ${state.focus === f.k ? "is-sel" : ""}`,
        type: "button",
        ...(isUsed ? { disabled: "", "aria-label": `${f.label} — 오늘 이미 뽑았어요` } : {}),
      },
      f.label,
    );
    if (!isUsed) node.addEventListener("click", () => pickFocus(f.k));
    host.append(node);
  }
}

function pickFocus(k) {
  state.focus = k;
  renderFocusRow();
  $("#deckHint").textContent = "덱을 좌우로 쓸어 섞어 주세요";
  $("#deckSub").textContent = `${state.needShuffles}번 섞으면 카드가 펼쳐져요`;
}

function renderDots() {
  const host = clear($("#shDots"));
  for (let i = 0; i < state.needShuffles; i++) {
    host.append(el("i", { class: i < state.shuffles ? "is-on" : "" }));
  }
}

const deck = $("#deck");

/** 좌우로 쓸면 한 번 섞인다. 탭도 같게 취급한다 — 접근성(기획서 1절) */
function shuffleOnce() {
  if (state.busy || !state.focus || state.shuffles >= state.needShuffles) {
    if (!state.focus) toast("먼저 궁금한 것을 골라 주세요", "error", 1400);
    return;
  }
  state.shuffles += 1;
  deck.classList.remove("breathe");
  deck.classList.remove("is-shuffling");
  void deck.offsetWidth;
  deck.classList.add("is-shuffling");
  navigator.vibrate?.(12);
  renderDots();

  if (state.shuffles >= state.needShuffles) {
    $("#deckSub").textContent = "펼쳐집니다…";
    setTimeout(openFan, 420);
  }
}

deck.addEventListener("pointerdown", (e) => {
  state.dragX = e.clientX;
});
deck.addEventListener("pointerup", (e) => {
  if (state.dragX == null) return;
  const moved = Math.abs(e.clientX - state.dragX);
  state.dragX = null;
  shuffleOnce(); // 쓸기든 탭이든 한 번은 한 번 (moved 는 연출 세기에만 쓸 수 있다)
  void moved;
});
deck.addEventListener("pointercancel", () => {
  state.dragX = null;
});
deck.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    shuffleOnce();
  }
});

// ══════════════════════════════════════════════════════════════
// 부채꼴
// ══════════════════════════════════════════════════════════════

/**
 * 22장을 부채로 펼친다 — 78장 중 22장만(SPEC-02 1절). 전부 뒷면이라 체감은 같고,
 * 서버 추첨은 펼친 22장과 무관하다.
 *
 * 배치 순서는 `hash(day + 회차)` 로 섞는다. 카드에 정보가 없으므로(전부 뒷면) 이것은
 * 결과에 영향을 주지 않고, **매번 같은 자리에 펼쳐지지 않게** 하기 위한 것뿐이다.
 * 실제 카드는 서버가 정한다.
 */
/**
 * 카드를 들어올리는 높이(px).
 *
 * 무대는 `overflow: hidden` 이라 **이만큼을 무대 위쪽에 미리 비워 둬야** 한다.
 * 비워 두지 않으면 들린 카드가 무대 경계를 넘어 잘리고, 위의 안내 문구와도 겹친다
 * (폰에서 실제로 그랬다). 그래서 배치의 머리 공간과 같은 상수를 쓴다 — 둘이 따로
 * 놀면 값을 하나만 고쳤을 때 다시 잘린다.
 */
const LIFT = { PICK: 20, CHOSEN: 26 };
const LIFT_MAX = Math.max(LIFT.PICK, LIFT.CHOSEN);

function openFan() {
  const stage = clear($("#fanStage"));
  stage.classList.remove("is-locked");

  const n = state.today.fan ?? 22;
  const seed = seeded(`${state.today.day}|${state.today.draws.length}`);
  const fan = [];

  // 좌표를 CSS 회전축(transform-origin)에 맡기지 않고 여기서 직접 계산한다.
  //
  // 축을 고정 픽셀로 두면 화면 크기에 따라 카드가 무대 밖으로 나간다 —
  // 처음 그렇게 짰더니 **22장이 전부 뷰포트 밖**이었다(기획서 6절이 실기 확인
  // 항목으로 못박은 바로 그 결함이다). 반지름을 무대 폭에서 역산하면 어떤 화면에서도
  // 부채가 무대 안에 들어온다.
  // **재기 전에 화면을 띄운다.** 감춰진 화면(`display:none`)은 폭이 0 이라 아래의
  // 반지름 역산이 통째로 무너진다 — R 이 하한 160 으로 고정되고 무대 중심이 0 이
  // 되면서 22장이 전부 **왼쪽 끝에 뭉친다.** 폰에서 실제로 그렇게 나왔다.
  // 무대 밖으로 나가는 것을 막으려고 만든 역산이, 재는 순서 때문에 오히려 깨졌다.
  showScreen("fan");

  const rect = stage.getBoundingClientRect();
  // 그래도 0 이면(글꼴 로딩 등으로 배치가 늦는 경우) 부모나 뷰포트로 대신한다.
  // 폭을 모른 채 그리면 어차피 화면 밖으로 나간다.
  const stageW =
    rect.width || stage.parentElement?.getBoundingClientRect().width || window.innerWidth;

  const cardW = stageW < 380 ? 64 : 74;
  const cardH = stageW < 380 ? 98 : 112;
  const spread = 34; // 부채의 반각(도) — 프로토 사양
  const rad = (spread * Math.PI) / 180;
  // 가로로 벌어지는 폭이 무대 폭을 넘지 않는 반지름.
  //
  // 여백으로 `cardW` 를 빼면 **모자란다.** 양 끝 카드는 34° 기울어 있어서 실제로
  // 차지하는 가로 폭이 카드 폭보다 훨씬 넓다(74×112 카드가 34° 돌면 약 124px).
  // 그 차이만큼 부채가 무대를 넘고, 무대는 `overflow: hidden` 이라 **끝 카드가
  // 잘린다.** 회전 후의 외접 폭으로 빼야 맞다.
  const spanW = cardW * Math.cos(rad) + cardH * Math.sin(rad);
  const R = Math.max(160, (stageW - spanW - 8) / (2 * Math.sin(rad)));
  // 회전 중심은 무대 위쪽 기준 이만큼 아래.
  // `LIFT_MAX` 를 더해 **들어올릴 자리를 미리 비운다** (없으면 들린 카드가 잘린다).
  const pivotY = R + cardH * 0.5 + LIFT_MAX + 8;

  for (let i = 0; i < n; i++) {
    const deg = -spread + ((spread * 2) / (n - 1)) * i;
    const th = (deg * Math.PI) / 180;
    const x = stageW / 2 + R * Math.sin(th);
    const y = pivotY - R * Math.cos(th);

    const node = el("button", {
      class: "fcard",
      type: "button",
      style:
        `left:${x.toFixed(1)}px; top:${y.toFixed(1)}px; width:${cardW}px; height:${cardH}px;` +
        // 들어올림을 **회전 뒤에** 곱한다 — 카드 자기 축을 따라 바깥으로 나간다.
        // CSS 변수로 두어야 클래스가 인라인 transform 을 덮어쓰지 않고 끼어들 수 있다.
        `transform: translate(-50%, -50%) rotate(${deg.toFixed(2)}deg) translateY(var(--lift, 0px));` +
        `z-index:${i}`,
      "aria-label": `${i + 1}번째 카드`,
    });
    // 배치만 섞는다 — 어떤 카드인지는 화면이 모른다
    node.dataset.slot = String((seed + i) % n);
    // 키보드·보조기기용. 손가락 선택은 무대 전체에서 받는다(아래 bindFanPicker).
    // `detail === 0` 이 키보드로 활성화한 경우다 — 탭으로 두 번 뽑히는 것을 막는다.
    node.addEventListener("click", (e) => { if (e.detail === 0) choose(node); });
    stage.append(node);

    fan.push({ node, cx: x });
  }

  state.fan = fan;
}

/**
 * 손가락으로 카드를 고른다 — **끌어서 고르고 떼면 뽑힌다.**
 *
 * ── 왜 탭이 아니라 끌기인가 ──────────────────────────────────────────────
 * 22장을 390px 에 펼치면 한 장이 드러내는 폭이 **12px** 다. 손가락은 44px 이라
 * 조준이 안 된다. 게다가 카드는 74×112 짜리 온전한 상자라, 위에 놓인 카드(z-index 가
 * 큰 쪽)가 아래 카드의 보이는 조각까지 덮는다 — **눈으로 겨눈 카드와 탭이 닿는 카드가
 * 다르다.** 폰에서 「원하는 카드를 고를 수 없다」고 느낀 것이 이것이다.
 *
 * 그래서 좁은 표적을 맞히게 하지 않는다. 무대 아무 데나 짚고 **좌우로 끌면** 손가락
 * 아래 카드가 들려 올라오고, 원하는 카드가 들렸을 때 떼면 그 카드가 뽑힌다. 표적
 * 크기가 문제되지 않고, 떼기 전까지 무엇이 선택될지 눈에 보인다.
 *
 * 뽑히는 카드는 어차피 **서버가 정한다**(배치는 섞기용일 뿐이다). 그래서 잘못 고를
 * 위험은 없고, 필요한 것은 「내가 골랐다」는 감각뿐이다.
 */
function bindFanPicker() {
  const stage = $("#fanStage");
  let picked = null;

  const lift = (item) => {
    if (picked === item) return;
    picked?.node.style.removeProperty("--lift");
    picked?.node.classList.remove("is-picking");
    picked = item;
    if (!item) return;
    item.node.style.setProperty("--lift", `-${LIFT.PICK}px`);
    item.node.classList.add("is-picking");
    navigator.vibrate?.(6);
  };

  /** 손가락 x 에 가장 가까운 카드. 조각 폭이 아니라 **거리**로 고른다 */
  const nearest = (clientX) => {
    const list = state.fan;
    if (!list?.length) return null;
    const r = stage.getBoundingClientRect();
    if (r.width < 1) return null; // 숨은 무대는 재지 않는다
    const x = clientX - r.left;
    let best = list[0];
    for (const it of list) {
      if (Math.abs(it.cx - x) < Math.abs(best.cx - x)) best = it;
    }
    return best;
  };

  stage.addEventListener("pointerdown", (e) => {
    if (state.busy) return;
    // 캡처는 **되면 좋은 것**이지 선택의 전제가 아니다. 여기서 예외가 나면(포인터가
    // 이미 놓였거나 합성 이벤트인 경우) 그 뒤가 통째로 죽어서 카드가 안 들린다.
    try {
      stage.setPointerCapture?.(e.pointerId);
    } catch {
      // 캡처 없이도 고를 수 있다 — 무대 밖으로 나가면 pointercancel 로 되돌린다
    }
    lift(nearest(e.clientX));
    e.preventDefault();
  });

  stage.addEventListener("pointermove", (e) => {
    if (state.busy || !picked) return;
    lift(nearest(e.clientX));
    e.preventDefault();
  });

  const release = () => {
    if (state.busy || !picked) return;
    const node = picked.node;
    picked.node.classList.remove("is-picking");
    picked = null;
    choose(node);
  };

  stage.addEventListener("pointerup", release);
  // 손가락이 무대 밖으로 나가 취소되면 **뽑지 않고** 되돌린다
  stage.addEventListener("pointercancel", () => lift(null));
}

async function choose(node) {
  if (state.busy) return;
  state.busy = true;
  $("#fanStage").classList.add("is-locked");
  node.style.setProperty("--lift", `-${LIFT.CHOSEN}px`);
  node.classList.add("is-chosen");
  navigator.vibrate?.(18);

  // 올해·이달의 카드 — 일일 뽑기와 다른 길로 (SPEC-04 §3·§4)
  if (state.mode) return chooseSpecial();

  let res;
  try {
    res = await apiPost("/api/tarot/draw", { focus: state.focus });
  } catch (err) {
    state.busy = false;
    $("#fanStage").classList.remove("is-locked");
    if (err instanceof ApiFail && err.code === "FOCUS_USED") {
      toast(err.message, "error");
      enterDeck();
      return;
    }
    if (err instanceof ApiFail && err.code === "NO_DRAWS") {
      toast(err.message, "error");
      return;
    }
    toast(err.message ?? "카드를 뽑지 못했습니다.", "error");
    return;
  }

  // 그림을 다 받은 뒤에 뒤집는다 — 뒤집힌 앞면이 비어 있다가 늦게 차면 연출이 깨진다
  const hasImg = await preload(CARD_IMG(res.card_id), PRELOAD_MAX_MS);
  await flipTo(res.card_id, hasImg);
  state.today = await apiGet("/api/tarot/today");
  // 이 뽑기로 78장이 됐으면(교환으로 채운 경우 포함) **결과보다 먼저** 완성 화면 (SPEC-03 §1-1 ①)
  if (state.today.gold_intro_pending) await showComplete();
  renderResult(res.card_id, state.focus, res);
  state.busy = false;
}

/**
 * 그림 한 장을 받아 디코드까지 끝낸다. 실패·시간 초과면 false — 이모지로 대신한다.
 * 결과 화면이 같은 주소를 다시 쓰므로 두 번째부터는 캐시에서 나온다.
 */
function preload(src, maxMs) {
  return new Promise((resolve) => {
    const img = new Image();
    let loaded = false;
    // 상한은 decode 까지 덮는다. **탭이 백그라운드면 decode 가 끝나지 않는다** — 받아
    // 놓고도 뒷면인 채 멈췄다(브라우저 확인에서 그대로 걸렸다). 받았으면 그림으로 간다.
    const timer = setTimeout(() => resolve(loaded), maxMs);
    img.onload = () => {
      loaded = true;
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      if (!img.decode) return done();
      img.decode().then(done, done);
      // decode 가 묶여도 오래 기다리지 않는다
      setTimeout(done, 600);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = src;
  });
}

/**
 * 카드 앞면. 그림이 없으면 이모지 + 이름(SPEC-02 5.5 폴백) — 이모지만 두면 마이너
 * 56장은 무슨 카드인지 알 수 없다.
 */
function cardFace(cardId, hasImg, src = CARD_IMG(cardId)) {
  const card = TAROT_DB.cards[cardId];
  if (hasImg) {
    const img = el("img", { class: "cardimg", src, alt: card.name, draggable: "false" });
    // 받았다고 판단한 뒤에 깨지는 경우(캐시 축출 등)도 같은 폴백으로
    img.addEventListener("error", () => img.replaceWith(cardFace(cardId, false)), { once: true });
    return img;
  }
  return el(
    "div",
    { class: "cardfb" },
    el("span", { class: "cardfb__glyph" }, card.glyph),
    el("span", { class: "cardfb__name" }, card.name),
  );
}

/** 3D 플립. 연출이 끝날 때까지 입력을 받지 않는다(기획서 1절) */
function flipTo(cardId, hasImg) {
  clear($("#flipFront")).append(cardFace(cardId, hasImg));
  const fc = $("#flipCard");
  fc.classList.remove("is-flipped");
  showScreen("flip");

  // 전환을 걸기 전에 리플로를 강제한다. rAF 로 미루면 **탭이 백그라운드일 때
  // 콜백이 아예 오지 않아** 결과 화면으로 넘어가지 못하고 뒷면인 채로 멈춘다
  // (브라우저 확인에서 그대로 걸렸다). setTimeout 은 배경에서도 발화한다.
  void fc.offsetWidth;
  fc.classList.add("is-flipped");
  navigator.vibrate?.([12, 60, 22]);
  return new Promise((resolve) => setTimeout(resolve, FLIP_MS + 260));
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function renderResult(cardId, focus, res) {
  const day = state.today.day;
  const r = reading(day, cardId, focus);
  const focusLabel =
    focus === "q"
      ? `이달의 질문 · ${monthQuestion(day)?.q ?? ""}`
      : (FOCUS.find((f) => f.k === focus)?.label ?? "오늘 하루");

  $("#resFocus").textContent = focusLabel;
  // 한 마디 — 해석을 읽은 뒤 아래에서 키워드 하나 (SPEC-04 §1). 다시 들어와도 고른 것이 보인다
  renderWord(cardId);
  // 뽑기 직후면 플립 전에 받아 둔 그림이 캐시에서 나온다. 다시 들어온 경우엔 받는 동안
  // 잠깐 빈칸일 수 있지만, 실패하면 이모지로 바뀐다
  const hero = clear($("#resGlyph"));
  hero.append(cardFace(cardId, true));
  // 금빛 바퀴(78장 완성 뒤)에서는 카드 테두리가 은색·금빛으로 갈린다
  hero.className = `tcard ${tierClass(cardId)}`;
  $("#resName").textContent = r.card.name;

  // 숨은 이야기 — 이 뽑기로 금빛이 된 순간에만 번짐 → 한 글자씩 (SPEC-03 §2)
  const storyNode = $("#resStory");
  storyNode.hidden = true;
  if (!res.replay && res.gold_new) {
    hero.classList.add("is-blooming");
    showStory(storyNode, cardId, GOLD_BLOOM_MS);
  }

  // 「작년 오늘」 — 1년 전 같은 날 기록이 있을 때만
  const ly = state.today.last_year;
  $("#resLastYear").hidden = !ly;
  if (ly) $("#resLastYear").textContent = `작년 오늘의 카드 · ${TAROT_DB.cards[ly.card_id]?.name ?? "—"}`;

  // 금빛 단계 표기 — 적립 줄을 안 읽고 넘겨도 보이게 카드 바로 아래 (SPEC-03 §1-1 ④)
  const tier = $("#resTier");
  const alreadyGold = !res.replay && !res.is_new && !res.gold_new && state.today.gold?.includes(cardId);
  tier.hidden = !(res.gold_new || alreadyGold) || res.replay;
  tier.textContent = res.gold_new ? "✦ 금빛이 됐어요 · 숨은 이야기" : "✦ 이미 금빛 · 별가루 +1";
  tier.classList.toggle("is-new", Boolean(res.gold_new));

  $("#resInterp").textContent = r.interp;
  $("#resAdvice").textContent = r.advice;

  clear($("#resLucky")).append(
    stat("행운의 색", r.card.lucky.color),
    stat("행운의 숫자", String(r.card.lucky.number)),
    stat("행운의 물건", r.item),
  );

  const coll = state.today.collection?.length ?? 0;
  const total = TAROT_DB.cards.length;
  const dustMax = state.today.dust_max ?? 4;
  // 중복이어도 해석·적립은 그대로 — 꽝이 없다. 달라지는 것은 별가루 한 줄뿐이다
  const exchanged = res.exchanged_card_id ?? res.gold_exchanged_card_id;
  const pick = res.replay
    ? ""
    : res.is_new
      ? " · 새 카드가 도감에 들어왔어요"
      : res.gold_new
        ? " · 이 카드가 금빛이 되었어요"
        : exchanged != null
          ? ` · 별가루 +1 (${dustMax}/${dustMax})`
          : ` · 별가루 +1 (${res.dust ?? state.today.dust}/${dustMax})`;
  // 완성 뒤에는 「도감」 대신 「금빛」 진척을 적는다
  const progress = coll >= total ? `금빛 ${state.today.gold_count ?? 0}/${total}장` : `도감 ${coll}/${total}장`;
  $("#resGain").textContent = res.replay
    ? `오늘 뽑은 카드예요 · ${progress}`
    : `+${res.gained}P 적립 · ${progress}${pick}`;
  $("#resDust").textContent = `✦ 별가루 ${state.today.dust ?? 0}/${dustMax}`;

  if (res.replay) renderExchange(null);
  else if (res.gold_exchanged_card_id != null) renderExchange(res.gold_exchanged_card_id, { gold: true });
  else renderExchange(res.exchanged_card_id);

  setHeaderBadge(`도감 ${coll}/${total}`);
  renderCrossChips();
  renderResultAds();

  const note = $("#resNote");
  note.textContent =
    state.today.remaining > 0
      ? `오늘 ${state.today.remaining}장 더 뽑을 수 있어요`
      : "내일 자정에 새 카드가 기다립니다";

  showScreen("result");
  armScreen("result");
}

/** 교환 카드가 스스로 뒤집히기까지의 뜸 — 결과 화면을 먼저 한 번 보게 한다 */
const EXCHANGE_DELAY_MS = 700;

/**
 * 별가루 교환 연출 (SPEC-02 1절) — 결과 직후 **두 번째 카드가 스스로 뒤집힌다.**
 *
 * 이 카드는 오늘의 카드가 아니다. 그래서 오늘의 해석 대신 카드 조언 한 줄만 보인다.
 * 누를 것이 없다 — 손을 대지 않아도 뒤집히므로, 마지막 탭이 이 자리에 떨어져도
 * 아무것도 열리지 않는다.
 */
function renderExchange(cardId, { gold = false, host: target = $("#exchange") } = {}) {
  const host = clear(target);
  host.hidden = cardId == null;
  if (cardId == null) return;

  const card = TAROT_DB.cards[cardId];
  const advice = card.advice[seeded(`${state.today.day}|ex|${cardId}`) % card.advice.length];
  const flip = el(
    "div",
    { class: `flipcard flipcard--mini ${gold ? "is-gold" : ""}` },
    el("div", { class: "flipcard__face flipcard__face--back" }),
    el("div", { class: "flipcard__face flipcard__face--front" }),
  );
  // 금빛 교환이면 조언 대신 숨은 이야기가 열린다(SPEC-03 §2 「교환으로 금빛이 된 카드도 같은 연출」)
  const line = el("p", { class: gold ? "story" : "advice" }, gold ? "" : advice);
  const caption = el(
    "div",
    { class: "exchange__text" },
    el(
      "div",
      { class: "exchange__title" },
      gold ? "별가루 4개가 모여 은색 카드 하나가 금빛이 되었어요" : "별가루 4개가 모여 아직 못 만난 카드가 왔어요",
    ),
    el("div", { class: "exchange__name" }, card.name),
    line,
  );
  host.append(el("div", { class: "flipwrap flipwrap--mini" }, flip), caption);

  preload(CARD_IMG(cardId), PRELOAD_MAX_MS).then((ok) => {
    flip.lastChild.append(cardFace(cardId, ok));
    setTimeout(() => {
      void flip.offsetWidth;
      flip.classList.add("is-flipped");
      caption.classList.add("is-shown");
      navigator.vibrate?.([10, 50, 18]);
      if (gold) {
        flip.classList.add("is-blooming");
        showStory(line, cardId, FLIP_MS + GOLD_BLOOM_MS);
      }
    }, EXCHANGE_DELAY_MS);
  });
}

// ══════════════════════════════════════════════════════════════
// 금빛 · 숨은 이야기 (SPEC-03 §1~3)
// ══════════════════════════════════════════════════════════════

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * 은색·금빛 구분. 78장을 다 모으기 전에는 둘 다 아니다 — 금빛 바퀴는 완성 뒤에만 있다.
 */
function tierClass(cardId) {
  if ((state.today?.collection_count ?? 0) < TOTAL) return "";
  return state.today.gold?.includes(cardId) ? "is-gold" : "is-silver";
}

/** 이야기는 금빛이 생긴 사람만 보므로 그때 처음 받는다(gzip 약 4KB) */
let storiesP = null;
const loadStories = () => (storiesP ??= import("./tarot-story.js").then((m) => m.STORIES));

/**
 * 이야기 한 줄을 한 글자씩 보여 준다. **탭하면 즉시 전부.** 움직임 줄이기 설정이면
 * 처음부터 전부 보인다 — 글자가 하나씩 나오는 것도 움직임이다.
 */
async function showStory(node, cardId, delayMs = 0) {
  const text = (await loadStories())[cardId] ?? "";
  node.hidden = false;
  node.textContent = "";
  if (reducedMotion()) {
    node.textContent = text;
    return;
  }
  let i = 0;
  let timer = null;
  let done = false;
  const finish = () => {
    done = true;
    clearInterval(timer);
    node.textContent = text;
  };
  node.addEventListener("click", finish, { once: true });
  setTimeout(() => {
    if (done) return; // 번짐 도중에 탭했다 — 이미 다 보인다
    const step = Math.max(16, STORY_TYPE_MS / Math.max(1, text.length));
    timer = setInterval(() => {
      i += 1;
      node.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(timer);
    }, step);
  }, reducedMotion() ? 0 : delayMs);
}

const stat = (label, value) =>
  el(
    "div",
    { class: "stat" },
    el("div", { class: "stat__label" }, label),
    el("div", { class: "stat__value" }, value),
  );

/**
 * 화면을 바꾼 직후 그 화면의 버튼을 잠깐 못 누르게 한다 (기획서 0-H).
 *
 * 마지막 탭이 부채꼴 카드였고 결과 화면이 그 자리에 광고 버튼을 올린다 — 연타의
 * 두 번째 탭이 광고를 열면 「광고는 선택형」이 그 자리에서 깨진다(㉑ 에서 겪은 일).
 */
function armScreen(name, ms = ARM_DELAY_MS) {
  const screen = document.querySelector(`[data-screen="${name}"]`);
  if (!screen) return;
  screen.style.pointerEvents = "none";
  setTimeout(() => {
    screen.style.pointerEvents = "";
  }, ms);
}

/** 크로스 칩 — 광고가 아니라 **무료 이동**이다. 완료한 서비스로는 다시 유도하지 않는다 */
function renderCrossChips() {
  const host = clear($("#crossChips"));
  const s = state.today.suite ?? {};
  const chips = [
    { key: "saju", href: "/saju/", icon: "🌤️", name: "오늘의 기운" },
    { key: "mind", href: "/mind/", icon: "🔬", name: "오늘의 선택" },
  ];

  for (const c of chips) {
    const done = s[c.key]?.done;
    host.append(
      el(
        "a",
        { class: `crosschip ${done ? "is-done" : ""}`, href: c.href },
        el("b", {}, `${c.icon} ${c.name}`),
        done ? "오늘 완료했어요" : "아직 봉인돼 있어요 →",
      ),
    );
  }
}

function renderResultAds() {
  clearRewardCard($("#adbarMore"));
  clearRewardCard($("#adbarStats"));

  // 이미 받아 둔 장수가 남았으면(첫 방문 보너스 · 광고 보고 안 뽑은 장) **광고 없이** 덱으로.
  //
  // 처음엔 덱으로 돌아가는 길이 광고 카드뿐이었다. 그래서 광고 2회를 다 쓰면 「오늘 1장 더
  // 뽑을 수 있어요」라고 적혀 있는데 누를 것이 없었고, 남은 장이 있는데도 광고를 또 보게
  // 했다. 폰 실기에서 「뽑아도 진행이 안 된다」로 드러났다(REQ-40 스테이징 확인 2026-10-05).
  if ((state.today.remaining ?? 0) > 0) {
    const btn = el("button", { class: "btn", type: "button" }, `한 장 더 뽑기 (${state.today.remaining}장 남음)`);
    btn.addEventListener("click", () => enterDeck());
    $("#adbarMore").append(btn);
  } else if ((state.today.ad_more_used ?? 0) < (state.today.ad_more_max ?? 2)) {
    // 「한 장 더」 광고 — 상한을 다 쓰면 **버튼을 숨긴다**(비활성화가 아니라 제거)
    renderRewardCard($("#adbarMore"), {
      icon: "🔮",
      title: "광고 보고 한 장 더",
      // 손해 없음을 문자로 적는다 (기획서 T-03)
      desc: "한 장 더 뽑아도 오늘의 카드와 적립은 그대로예요",
      cta: "뽑기",
      onClick: async () => {
        const r = await watchAdForReward("TAROT_ATTEMPT");
        if (!r) return;
        state.today = await apiGet("/api/tarot/today");
        toast("다른 고민으로 한 장 더 뽑아 보세요", "good");
        enterDeck();
      },
    });
  }

  if (!state.today.ad_stats_seen) {
    renderRewardCard($("#adbarStats"), {
      icon: "🗺️",
      title: "광고 보고 전국 분포 보기",
      desc: "오늘 사람들이 뽑은 카드",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("TAROT_STATS");
        if (!r) return;
        state.today = await apiGet("/api/tarot/today");
        loadStats();
      },
    });
  } else {
    loadStats();
  }
}

async function loadStats() {
  try {
    const s = await apiGet("/api/tarot/stats");
    const line = $("#resDist");
    if (!s.open) {
      // 표본이 적을 때 %를 보여 주면 그 값이 사람 한두 명을 뜻한다 (SUITE 1.5)
      line.textContent = `오늘 ${s.total}명이 뽑았어요 — 집계 중입니다`;
      return;
    }
    const mine = s.items.find((i) => String(i.key) === String(s.my_card));
    const top = s.items[0];
    line.textContent = mine
      ? `오늘 이 카드를 뽑은 사람 ${mine.pct}% · 가장 많이 나온 카드는 ${TAROT_DB.cards[top.key]?.name ?? "—"}(${top.pct}%)`
      : `가장 많이 나온 카드는 ${TAROT_DB.cards[top.key]?.name ?? "—"}(${top.pct}%)`;
  } catch {
    /* 광고 전이면 잠겨 있는 것이 정상이다 */
  }
}

// ══════════════════════════════════════════════════════════════
// 도감
// ══════════════════════════════════════════════════════════════

/**
 * 도감 78칸 (SPEC-02 1절) — 수트 탭 · 진척 바와 마일스톤 4점 · 별가루.
 *
 * 칸에는 **썸네일**(240×360, 평균 10KB)을 쓰고 `loading="lazy"` 로 화면에 들어올 때만
 * 받는다. 78장을 한 번에 받으면 1MB 가까이 되는데, 대부분은 아직 없는 칸이다.
 */
function showCollection() {
  const have = new Set(state.today.collection ?? []);
  const total = TAROT_DB.cards.length;
  // 78장을 다 모으면 진척 바가 「금빛」 바퀴로 바뀐다 (SPEC-03 §1·§4)
  const goldRound = have.size >= total;
  const n = goldRound ? (state.today.gold_count ?? 0) : have.size;
  const ms = (goldRound ? state.today.gold_milestones : state.today.milestones) ?? [];

  $("#collTitle").textContent = goldRound ? `금빛 ${n} / ${total}` : `도감 ${n} / ${total}`;
  $("#collDust").textContent = `✦ 별가루 ${state.today.dust ?? 0}/${state.today.dust_max ?? 4}`;
  $("#collBar").classList.toggle("collbar--gold", goldRound);
  $("#collDetail").hidden = true;

  // 진척 바 — 마일스톤 자리에 점을 찍고, 넘은 점은 채운다
  const bar = clear($("#collBar"));
  bar.append(el("div", { class: "collbar__fill", style: `width:${((n / total) * 100).toFixed(1)}%` }));
  for (const m of ms) {
    bar.append(
      el(
        "div",
        {
          class: `collbar__tick ${n >= m.n ? "is-on" : ""}`,
          style: `left:${((m.n / total) * 100).toFixed(1)}%`,
          title: `${m.n}장 +${m.p}P`,
        },
        el("span", {}, String(m.n)),
      ),
    );
  }

  const next = ms.find((m) => n < m.n);
  $("#collNote").textContent = goldRound
    ? next
      ? `금빛 ${next.n}장이면 +${next.p}P (${next.n - n}장 남음) · 은색 카드를 뽑으면 금빛이 되고, 금빛 카드가 겹치면 별가루가 돼요. 카드를 누르면 숨은 이야기를 볼 수 있어요`
      : "78장이 모두 금빛이 되었어요."
    : next
      ? `${next.n}장을 모으면 +${next.p}P (${next.n - n}장 남음) · 겹친 카드는 별가루가 되고, 4개면 아직 못 만난 카드로 바뀌어요`
      : "도감을 모두 채웠어요.";

  renderCollTabs(have);
  renderCollGrid(have);
  setCollView(state.collView ?? "grid");
  showScreen("coll");
}

/** 「도감 | 달력」 (SPEC-03 §5) */
function setCollView(v) {
  state.collView = v;
  for (const b of document.querySelectorAll("#collViewTabs button")) {
    b.classList.toggle("is-sel", b.dataset.view === v);
  }
  $("#collGridView").hidden = v !== "grid";
  $("#calView").hidden = v !== "cal";
  if (v === "cal") renderCalendar(state.calMonth ?? state.today.day.slice(0, 7));
}

/**
 * 카드 상세 — 금빛이면 숨은 이야기, 아니면 잠금 문구 (SPEC-03 §2).
 * 이야기는 여기서 처음 불러온다.
 */
async function showCardDetail(cardId) {
  const c = TAROT_DB.cards[cardId];
  const isGold = state.today.gold?.includes(cardId);
  const box = clear($("#collDetail"));
  const thumb = el("div", { class: `collcell collcell--detail ${tierClass(cardId)}` });
  thumb.append(cardFace(cardId, true, THUMB_IMG(cardId)));
  const story = el("p", { class: isGold ? "story" : "story story--locked" }, isGold ? "…" : "금빛이 되면 이야기가 열려요");
  const close = el("button", { class: "detail__close", type: "button", "aria-label": "닫기" }, "✕");
  close.addEventListener("click", () => (box.hidden = true));
  box.append(thumb, el("div", { class: "detail__text" }, el("div", { class: "exchange__name" }, c.name), story), close);
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  if (isGold) story.textContent = (await loadStories())[cardId] ?? "";
}

function renderCollTabs(have) {
  const host = clear($("#collTabs"));
  // 금빛 바퀴에선 탭 숫자도 금빛 장수 — 다 모은 뒤엔 「78/78」이 아무것도 말해 주지 않는다
  const goldRound = have.size >= TOTAL;
  const gold = new Set(state.today.gold ?? []);
  for (const s of SUITS) {
    let got = 0;
    for (let i = s.from; i <= s.to; i++) if (goldRound ? gold.has(i) : have.has(i)) got++;
    const node = el(
      "button",
      { class: `chip-focus ${state.collTab === s.k ? "is-sel" : ""}`, type: "button" },
      `${s.label} ${got}/${s.to - s.from + 1}`,
    );
    node.addEventListener("click", () => {
      state.collTab = s.k;
      renderCollTabs(have);
      renderCollGrid(have);
    });
    host.append(node);
  }
}

function renderCollGrid(have) {
  const s = SUITS.find((x) => x.k === state.collTab) ?? SUITS[0];
  const host = clear($("#collGrid"));

  for (let i = s.from; i <= s.to; i++) {
    const c = TAROT_DB.cards[i];
    const got = have.has(i);
    // 가진 칸은 눌러서 상세(숨은 이야기)를 연다 — 버튼으로 둬야 키보드로도 열린다
    const cell = el(got ? "button" : "div", {
      class: `collcell ${got ? `is-have ${tierClass(i)}` : "is-miss"}`,
      title: got ? c.name : "아직 만나지 않은 카드",
      ...(got ? { type: "button" } : {}),
    });
    if (got) {
      cell.addEventListener("click", () => showCardDetail(i));
      const img = el("img", {
        class: "collcell__img",
        src: THUMB_IMG(i),
        alt: c.name,
        loading: "lazy",
        decoding: "async",
        draggable: "false",
      });
      img.addEventListener("error", () => img.replaceWith(c.glyph), { once: true });
      cell.append(img);
    } else {
      cell.append("?");
    }
    host.append(cell);
  }
}

// ══════════════════════════════════════════════════════════════
// 나의 카드 달력 (SPEC-03 §5)
// ══════════════════════════════════════════════════════════════

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const shiftMonth = (month, d) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** 카드 id → 수트 탭 (메이저·완드·컵·소드·펜타클) */
const suitOf = (id) => SUITS.slice(1).find((s) => id >= s.from && id <= s.to);

/**
 * 달력 한 달. 날마다 **그날 첫 카드**의 썸네일만 — 뽑지 않은 날은 그냥 빈칸이다.
 * 「며칠 빠졌다」·연속 기록 같은 표시는 두지 않는다(손실로 느끼지 않게 · SPEC-03 §5).
 */
async function renderCalendar(month) {
  state.calMonth = month;
  const token = (state.calToken = (state.calToken ?? 0) + 1);
  const [y, m] = month.split("-").map(Number);
  $("#calTitle").textContent = `${y}년 ${m}월`;
  // 앞으로의 달은 볼 것이 없다
  $("#calNext").disabled = month >= state.today.day.slice(0, 7);
  $("#calDetail").hidden = true;

  let days = [];
  let cal = {};
  try {
    cal = await apiGet(`/api/tarot/calendar?month=${month}`);
    days = cal.days ?? [];
  } catch (err) {
    toast(err.message ?? "달력을 불러오지 못했습니다.", "error");
  }
  if (token !== state.calToken) return; // 그사이 다른 달로 넘어갔다

  // 올해의 카드는 그 해 달력 위 고정 띠, 이달의 카드는 그달 위에 (SPEC-04 §3·§4)
  const band = clear($("#calBand"));
  const bandItem = (kind, period, id) => {
    const b = el(
      "button",
      { type: "button", class: `calband__item calband__item--${kind}` },
      el("img", { src: THUMB_IMG(id), alt: "", loading: "lazy", decoding: "async", draggable: "false" }),
      el("span", {}, el("b", {}, `✦ ${specialTitle(kind, period)}`), TAROT_DB.cards[id]?.name ?? "—"),
    );
    b.addEventListener("click", () => showSpecialDetail(kind, period, id));
    band.append(b);
  };
  if (cal.year_card != null) bandItem("year", month.slice(0, 4), cal.year_card);
  if (cal.month_card != null) bandItem("month", month, cal.month_card);
  band.hidden = band.childElementCount === 0;

  const byDay = new Map(days.map((d) => [d.day, d]));
  const grid = clear($("#calGrid"));
  for (const w of WEEK) grid.append(el("div", { class: "cal__wk" }, w));

  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let i = 0; i < first; i++) grid.append(el("div", { class: "cal__cell is-pad" }));

  for (let d = 1; d <= last; d++) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    const rec = byDay.get(key);
    if (!rec) {
      grid.append(el("div", { class: `cal__cell ${key === state.today.day ? "is-today" : ""}` }, el("span", {}, String(d))));
      continue;
    }
    const cell = el(
      "button",
      { class: `cal__cell has-card ${key === state.today.day ? "is-today" : ""}`, type: "button", title: TAROT_DB.cards[rec.card_id]?.name },
      el("img", { src: THUMB_IMG(rec.card_id), alt: "", loading: "lazy", decoding: "async", draggable: "false" }),
      el("span", {}, String(d)),
    );
    cell.addEventListener("click", () => showCalDay(rec));
    grid.append(cell);
  }

  // 이번 달 수트 비율 — 오늘의 카드(첫 카드) 기준
  const bar = clear($("#calSuits"));
  const legend = clear($("#calSuitLegend"));
  $("#calSuitWrap").hidden = days.length === 0;
  for (const s of SUITS.slice(1)) {
    const n = days.filter((d) => suitOf(d.card_id)?.k === s.k).length;
    if (!n) continue;
    bar.append(el("div", { class: `calsuit calsuit--${s.k}`, style: `flex:${n}`, title: `${s.label} ${n}일` }));
    legend.append(el("span", { class: `calsuit-key calsuit-key--${s.k}` }, `${s.label} ${n}`));
  }
  $("#calEmpty").hidden = days.length > 0;
}

/** 날짜를 누르면 — 그날 카드 · 고민 · 해석 한 줄(회전 규칙 그대로 다시 계산) */
function showCalDay(rec) {
  const r = reading(rec.day, rec.card_id, rec.focus);
  const focusLabel =
    rec.focus === "q"
      ? `이달의 질문 · ${monthQuestion(rec.day)?.q ?? ""}`
      : (FOCUS.find((f) => f.k === rec.focus)?.label ?? "오늘 하루");
  const [, mm, dd] = rec.day.split("-").map(Number);
  const box = clear($("#calDetail"));
  const thumb = el("div", { class: "collcell collcell--detail" });
  thumb.append(cardFace(rec.card_id, true, THUMB_IMG(rec.card_id)));
  box.append(
    thumb,
    el(
      "div",
      { class: "detail__text" },
      el("div", { class: "exchange__title" }, `${mm}월 ${dd}일 · ${focusLabel}`),
      el("div", { class: "exchange__name" }, r.card.name),
      el("p", { class: "reading reading--sm" }, r.interp),
    ),
  );
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}

// ══════════════════════════════════════════════════════════════
// 78장 완성 화면 (SPEC-03 §1-1 ①②)
// ══════════════════════════════════════════════════════════════

/** 이보다 이른 탭은 무시한다 — 결과를 넘기던 손가락이 그대로 이 화면을 닫지 않게 */
/**
 * 완성 화면 탭 잠금 (SPEC-03 §1-1 ① · REQ-44).
 *
 * **안내 글 2줄이 다 나타난 뒤부터** 탭을 받는다. 습관적으로 누르는 사람도 글을 보게 하려는
 * 화면이라, 고정 초가 아니라 두 번째 줄(`.complete__sub`)의 등장 연출이 끝나는 순간에 묶는다 —
 * 연출 시간을 고쳐도 잠금이 따라간다. 처음엔 1초였는데 글이 3초쯤 뒤에 나와서 읽기 전에
 * 넘길 수 있었다.
 *
 * 움직임 줄이기면 글이 처음부터 보이므로 1초만 잠근다. 연출 끝 이벤트가 끝내 안 오는 경우
 * (브라우저가 애니메이션을 건너뜀 등)를 위해 상한을 둔다 — 화면에 갇히는 것보다 낫다.
 */
const COMPLETE_TAP_GUARD_REDUCED_MS = 1000;
const COMPLETE_TAP_GUARD_MAX_MS = 6000;

/**
 * 결과보다 먼저 띄우는 전체 화면. 도감 78칸이 채워짐 → 은색 물결 → 한 장이 금빛으로 반짝 →
 * 큰 글씨 두 줄. **탭해야 넘어간다.** 탭으로 닫은 순간 서버에 「봤음」을 남긴다 — 그 전에
 * 나가면 다음 방문 첫 화면에 다시 나온다.
 *
 * 칸은 그림이 아니라 코드로 그린 상자다(그림 추가 없음 · 썸네일 78장을 받으면 1MB 가깝다).
 * 움직임 줄이기면 tarot.css 가 연출을 끄고 다 채워진 정지 화면만 남긴다.
 */
function showComplete() {
  const grid = clear($("#completeGrid"));
  const shine = randomShineCell();
  for (let i = 0; i < TOTAL; i++) {
    grid.append(el("i", { class: i === shine ? "is-shine" : "", style: `--i:${i}` }));
  }
  const box = $("#complete");
  box.classList.remove("is-ready");
  showScreen("complete");
  box.focus?.({ preventScroll: true });

  let ready = false;
  const arm = () => {
    if (ready) return;
    ready = true;
    box.classList.add("is-ready");
  };
  if (reducedMotion()) {
    setTimeout(arm, COMPLETE_TAP_GUARD_REDUCED_MS);
  } else {
    const sub = box.querySelector(".complete__sub");
    sub.addEventListener("animationend", arm, { once: true });
    setTimeout(arm, COMPLETE_TAP_GUARD_MAX_MS);
  }

  return new Promise((resolve) => {
    const done = (e) => {
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      if (!ready) return; // 글 2줄이 다 나오기 전의 탭은 무시
      e.preventDefault?.();
      box.removeEventListener("click", done);
      box.removeEventListener("keydown", done);
      // 「봤음」 기록이 실패해도 막지 않는다 — 다음 방문에 한 번 더 보일 뿐이다
      apiPost("/api/tarot/gold-intro", {}).catch(() => {});
      state.today.gold_intro_pending = false;
      resolve();
    };
    box.addEventListener("click", done);
    box.addEventListener("keydown", done);
  });
}

/** 금빛으로 반짝일 한 칸 — 배치 연출일 뿐이라 하루 단위로 고정한다 */
const randomShineCell = () => seeded(`${state.today.day}|complete`) % TOTAL;

// ══════════════════════════════════════════════════════════════
// 한 마디 (SPEC-04 §1) — 키워드 6개 중 하나. 자유 입력은 없다
// ══════════════════════════════════════════════════════════════

/** 그 카드의 한 마디 칸을 그린다. 고른 적 있으면 서버 상태(내 선택·남은 바꾸기·비율)를 받아 온다 */
async function renderWord(cardId) {
  const host = $("#word");
  const kws = S3?.KEYWORDS?.[cardId];
  host.hidden = !kws;
  if (!kws) return;
  drawWord(cardId, { kw: null, changes_left: 1, dist: null });
  try {
    const st = await apiGet(`/api/tarot/word?card_id=${cardId}`);
    if (st.kw != null) drawWord(cardId, st);
  } catch {
    /* 고르기 전 상태 그대로 둔다 */
  }
}

function drawWord(cardId, st) {
  const kws = S3.KEYWORDS[cardId];
  const chips = clear($("#wordChips"));
  // 이미 골랐고 바꾸기도 다 썼으면 칩을 잠근다 — 고른 칩만 강조해 남긴다
  const locked = st.kw != null && st.changes_left <= 0;
  kws.forEach((k, i) => {
    const b = el(
      "button",
      {
        type: "button",
        class: `chip-focus ${st.kw === i ? "is-sel" : ""}`,
        ...(locked && st.kw !== i ? { disabled: "" } : {}),
      },
      k,
    );
    b.addEventListener("click", () => pickWord(cardId, i, st));
    chips.append(b);
  });

  const out = clear($("#wordDist"));
  $("#wordNote").textContent =
    st.kw == null
      ? "하나를 고르면 오늘 같은 카드를 뽑은 사람들이 고른 것을 보여 드려요"
      : st.changes_left > 0
        ? "한 번 바꿀 수 있어요"
        : "";
  if (!st.dist) return;
  if (!st.dist.open) {
    // 소수일 때 비율을 보이면 그 값이 사람 한두 명을 뜻한다 (SUITE 공개 유예와 같은 취지)
    // 몇 명인지도 적지 않는다 — 규모를 드러내지 않는다(REQ-45). 서버도 숫자를 안 보낸다
    out.append(el("p", { class: "footnote--dim" }, "아직 고른 사람이 적어요"));
    return;
  }
  // 막대 3개 — 많이 고른 순. 내 선택이 3위 밖이면 세 번째 자리에 내 것을 둔다
  const order = kws.map((_, i) => i).sort((a, b) => st.dist.pct[b] - st.dist.pct[a]);
  let top = order.slice(0, 3);
  if (st.kw != null && !top.includes(st.kw)) top = [top[0], top[1], st.kw];
  for (const i of top) {
    out.append(
      el(
        "div",
        { class: `wordbar ${i === st.kw ? "is-mine" : ""}` },
        el("span", { class: "wordbar__label" }, kws[i]),
        el("span", { class: "wordbar__track" }, el("i", { style: `--w:${st.dist.pct[i]}%` })),
        el("span", { class: "wordbar__pct" }, `${st.dist.pct[i]}%`),
      ),
    );
  }
}

async function pickWord(cardId, kw, prev) {
  if (prev.kw === kw) return;
  try {
    const st = await apiPost("/api/tarot/word", { card_id: cardId, kw });
    navigator.vibrate?.(8);
    drawWord(cardId, st);
  } catch (err) {
    toast(err.message ?? "고르지 못했어요.", "error");
  }
}

// ══════════════════════════════════════════════════════════════
// 올해의 카드 · 이달의 카드 (SPEC-04 §3·§4) — 일일 뽑기와 별개, 광고 없음, 적립 없음
// ══════════════════════════════════════════════════════════════

const specialTitle = (kind, period) =>
  kind === "year" ? `${period}년의 카드` : `${Number(period.slice(5, 7))}월의 카드`;

/** 덱 화면의 특별 카드 칩 — 아직 안 뽑은 것만. 「작년의 올해 카드」 한 줄도 여기 */
function renderSpecialRow() {
  const host = clear($("#specialRow"));
  const sp = state.today.special ?? {};
  const add = (kind, period) => {
    const b = el("button", { type: "button", class: "chip-focus chip-special" }, `✦ ${specialTitle(kind, period)} 뽑기`);
    b.addEventListener("click", () => enterSpecial(kind, period));
    host.append(b);
  };
  if (state.mode) return; // 특별 카드를 뽑는 중에는 띄우지 않는다
  if (sp.year && sp.year.card_id == null) add("year", sp.year.period);
  if (sp.month && sp.month.card_id == null) add("month", sp.month.period);
  const last = sp.year?.last;
  if (last != null) {
    host.append(el("p", { class: "lastyear" }, `작년의 올해 카드 · ${TAROT_DB.cards[last]?.name ?? "—"}`));
  }
}

/** 특별 카드 모드로 덱을 연다 — 고민은 고르지 않고, 한 번 섞으면 펼쳐진다 */
function enterSpecial(kind, period) {
  state.mode = { kind, period };
  state.focus = "__special";
  state.shuffles = 0;
  state.needShuffles = 1;
  clear($("#focusRow")).append(
    el("span", { class: "special-label" }, `✦ ${specialTitle(kind, period)}`),
    (() => {
      const b = el("button", { type: "button", class: "chip-focus" }, "취소");
      b.addEventListener("click", () => {
        state.mode = null;
        enterDeck();
      });
      return b;
    })(),
  );
  renderSpecialRow();
  renderDots();
  $("#deckHint").textContent = "덱을 한 번 쓸어 섞어 주세요";
  $("#deckSub").textContent =
    kind === "year" ? "올해를 비춰 줄 카드 한 장이에요" : "이번 달을 비춰 줄 카드 한 장이에요";
}

/** 특별 카드 결과 — 카드 · 한 줄 · 「달력에 남겨 둘게요」 */
function renderSpecialResult(res) {
  const { kind, period } = res;
  const cardId = res.card_id;
  const hero = clear($("#spGlyph"));
  hero.append(cardFace(cardId, true));
  hero.className = `tcard ${tierClass(cardId)}`;
  if (res.gold_new) hero.classList.add("is-blooming");
  $("#spTitle").textContent = specialTitle(kind, period);
  $("#spName").textContent = TAROT_DB.cards[cardId].name;
  $("#spLine").textContent = (kind === "year" ? S3?.YEAR : S3?.MONTH)?.[cardId] ?? "";

  const dustMax = state.today.dust_max ?? 4;
  const exchanged = res.exchanged_card_id != null || res.gold_exchanged_card_id != null;
  $("#spCollect").textContent = res.is_new
    ? "새 카드가 도감에 들어왔어요"
    : res.gold_new
      ? "✦ 금빛이 됐어요 · 숨은 이야기"
      : `별가루 +1 (${exchanged ? dustMax : res.dust}/${dustMax})`;

  const story = $("#spStory");
  story.hidden = true;
  if (res.gold_new) showStory(story, cardId, GOLD_BLOOM_MS);

  if (res.gold_exchanged_card_id != null) renderExchange(res.gold_exchanged_card_id, { gold: true, host: $("#spExchange") });
  else renderExchange(res.exchanged_card_id, { host: $("#spExchange") });

  showScreen("special");
  armScreen("special");
}

async function chooseSpecial() {
  const { kind } = state.mode;
  let res;
  try {
    res = await apiPost("/api/tarot/special", { kind });
  } catch (err) {
    state.busy = false;
    state.mode = null;
    $("#fanStage").classList.remove("is-locked");
    toast(err.message ?? "카드를 뽑지 못했습니다.", "error");
    state.today = await apiGet("/api/tarot/today");
    enterDeck();
    return;
  }
  const hasImg = await preload(CARD_IMG(res.card_id), PRELOAD_MAX_MS);
  await flipTo(res.card_id, hasImg);
  state.today = await apiGet("/api/tarot/today");
  if (state.today.gold_intro_pending) await showComplete();
  renderSpecialResult(res);
  state.busy = false;
}

/** 특별 카드 결과에서 나가기 — 오늘 이미 뽑았으면 오늘의 카드로, 아니면 덱으로 */
function leaveSpecial() {
  state.mode = null;
  if (state.today.draws.length > 0) {
    const last = state.today.draws[state.today.draws.length - 1];
    renderResult(last.c, last.f, { gained: 0, replay: true });
  } else {
    enterDeck();
  }
}

/** 달력 띠의 올해·이달의 카드를 누르면 — 카드 · 그 한 줄 */
function showSpecialDetail(kind, period, id) {
  const box = clear($("#calDetail"));
  const thumb = el("div", { class: "collcell collcell--detail" });
  thumb.append(cardFace(id, true, THUMB_IMG(id)));
  box.append(
    thumb,
    el(
      "div",
      { class: "detail__text" },
      el("div", { class: "exchange__title" }, `✦ ${specialTitle(kind, period)}`),
      el("div", { class: "exchange__name" }, TAROT_DB.cards[id]?.name ?? "—"),
      el("p", { class: "reading reading--sm" }, (kind === "year" ? S3?.YEAR : S3?.MONTH)?.[id] ?? ""),
    ),
  );
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}

// ══════════════════════════════════════════════════════════════
// 🧪 날짜 바꾸기 시험 장치 — 스테이징 전용 (REQ-45)
// ══════════════════════════════════════════════════════════════

/**
 * 올해의 카드(11/1~1/31)·작년의 올해 카드·이달의 질문(첫째 주 월요일)은 그날이 와야 보인다.
 * 스테이징에서 그 날짜로 가 보게 하는 띠다.
 *
 * 서버가 `test_clock` 을 줄 때만 그린다 — 운영 서버는 이 키를 아예 보내지 않고, 쿠키가
 * 붙어 와도 읽지 않는다(services/tarot.js `tarotDay`). 날짜는 **이 기기 쿠키**에만 담긴다.
 */
const TEST_DAY_COOKIE = "mg_testday";

function renderTestClock() {
  const host = $("#testClock");
  const tc = state.today.test_clock;
  host.hidden = !tc;
  if (!tc) return;

  const shifted = tc.day !== tc.real;
  const input = el("input", { type: "date", value: tc.day, class: "testclock__date", "aria-label": "시험 날짜" });
  const apply = el("button", { type: "button", class: "testclock__btn" }, "이 날짜로");
  const reset = el("button", { type: "button", class: "testclock__btn" }, "오늘로");
  const secure = location.protocol === "https:" ? "; Secure" : "";

  apply.addEventListener("click", () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return toast("날짜를 골라 주세요", "error");
    document.cookie = `${TEST_DAY_COOKIE}=${input.value}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
    location.reload();
  });
  reset.addEventListener("click", () => {
    document.cookie = `${TEST_DAY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    location.reload();
  });

  clear(host).append(
    el("span", { class: "testclock__label" }, shifted ? `🧪 시험 날짜 ${tc.day} (실제 ${tc.real})` : "🧪 시험 날짜 — 실제 오늘"),
    input,
    apply,
    ...(shifted ? [reset] : []),
  );
  host.classList.toggle("is-shifted", shifted);
}
