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
    state.today = await apiGet("/api/tarot/today");
  } catch (err) {
    toast(err.message ?? "오늘의 카드를 불러오지 못했습니다.", "error");
    return;
  }

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
  state.focus = null;
  state.shuffles = 0;
  state.needShuffles = state.today.shuffles ?? 3;

  renderFocusRow();
  renderDots();
  $("#deck").classList.add("breathe");
  $("#deckHint").textContent = "무엇이 궁금하세요?";
  $("#deckSub").textContent = "고민을 고르면 덱이 열려요";
  setHeaderBadge(`오늘 ${state.today.remaining}장`);
  showScreen("deck");
}

function renderFocusRow() {
  const host = clear($("#focusRow"));
  const used = state.today.used_focuses ?? [];

  for (const f of FOCUS) {
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
  const focusLabel = FOCUS.find((f) => f.k === focus)?.label ?? "오늘 하루";

  $("#resFocus").textContent = focusLabel;
  // 뽑기 직후면 플립 전에 받아 둔 그림이 캐시에서 나온다. 다시 들어온 경우엔 받는 동안
  // 잠깐 빈칸일 수 있지만, 실패하면 이모지로 바뀐다
  clear($("#resGlyph")).append(cardFace(cardId, true));
  $("#resName").textContent = r.card.name;
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
  const pick = res.replay
    ? ""
    : res.is_new
      ? " · 새 카드가 도감에 들어왔어요"
      : res.exchanged_card_id != null
        ? ` · 별가루 +1 (${dustMax}/${dustMax})`
        : ` · 별가루 +1 (${res.dust ?? state.today.dust}/${dustMax})`;
  $("#resGain").textContent = res.replay
    ? `오늘 뽑은 카드예요 · 도감 ${coll}/${total}장`
    : `+${res.gained}P 적립 · 도감 ${coll}/${total}장${pick}`;
  $("#resDust").textContent = `✦ 별가루 ${state.today.dust ?? 0}/${dustMax}`;

  renderExchange(res.replay ? null : res.exchanged_card_id);

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
function renderExchange(cardId) {
  const host = clear($("#exchange"));
  host.hidden = cardId == null;
  if (cardId == null) return;

  const card = TAROT_DB.cards[cardId];
  const advice = card.advice[seeded(`${state.today.day}|ex|${cardId}`) % card.advice.length];
  const flip = el(
    "div",
    { class: "flipcard flipcard--mini" },
    el("div", { class: "flipcard__face flipcard__face--back" }),
    el("div", { class: "flipcard__face flipcard__face--front" }),
  );
  const caption = el(
    "div",
    { class: "exchange__text" },
    el("div", { class: "exchange__title" }, "별가루 4개가 모여 아직 못 만난 카드가 왔어요"),
    el("div", { class: "exchange__name" }, card.name),
    el("p", { class: "advice" }, advice),
  );
  host.append(el("div", { class: "flipwrap flipwrap--mini" }, flip), caption);

  preload(CARD_IMG(cardId), PRELOAD_MAX_MS).then((ok) => {
    flip.lastChild.append(cardFace(cardId, ok));
    setTimeout(() => {
      void flip.offsetWidth;
      flip.classList.add("is-flipped");
      caption.classList.add("is-shown");
      navigator.vibrate?.([10, 50, 18]);
    }, EXCHANGE_DELAY_MS);
  });
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

  // 「한 장 더」 — 상한을 다 쓰면 **버튼을 숨긴다**(비활성화가 아니라 제거)
  if ((state.today.ad_more_used ?? 0) < (state.today.ad_more_max ?? 2)) {
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
  const n = have.size;
  const ms = state.today.milestones ?? [];

  $("#collTitle").textContent = `도감 ${n} / ${total}`;
  $("#collDust").textContent = `✦ 별가루 ${state.today.dust ?? 0}/${state.today.dust_max ?? 4}`;

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
  $("#collNote").textContent = next
    ? `${next.n}장을 모으면 +${next.p}P (${next.n - n}장 남음) · 겹친 카드는 별가루가 되고, 4개면 아직 못 만난 카드로 바뀌어요`
    : "도감을 모두 채웠어요.";

  renderCollTabs(have);
  renderCollGrid(have);
  showScreen("coll");
}

function renderCollTabs(have) {
  const host = clear($("#collTabs"));
  for (const s of SUITS) {
    let got = 0;
    for (let i = s.from; i <= s.to; i++) if (have.has(i)) got++;
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
    const cell = el("div", {
      class: `collcell ${got ? "is-have" : "is-miss"}`,
      title: got ? c.name : "아직 만나지 않은 카드",
    });
    if (got) {
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
