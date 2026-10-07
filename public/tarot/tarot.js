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
import { $, el, clear, showScreen, toast, renderHeader } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { TAROT_DB } from "./tarot-db.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { startRitual } from "./tarot-ritual.js";
import { renderNextStep } from "../shared/nextstep.js";

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

/** 카드 모음 수트 탭 — 쉬운 이름 (REQ-63 E19). id 범위는 SPEC-02 0절 */
const SUITS = [
  { k: "all", label: "전체", from: 0, to: 77 },
  { k: "major", label: "큰 카드", from: 0, to: 21 },
  { k: "wands", label: "완드·열정", from: 22, to: 35 },
  { k: "cups", label: "컵·마음", from: 36, to: 49 },
  { k: "swords", label: "소드·생각", from: 50, to: 63 },
  { k: "pentacles", label: "펜타클·돈", from: 64, to: 77 },
];

/** 카드 모음의 별가루 규칙·수트 탭·전체 마일스톤은 10장 이상 또는 별가루 1개 이상부터 (#11) */
const COLL_RULES_FROM = 10;

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
  // 보여 주는 것은 **첫 장** — 서버·허브·달력·분포의 「오늘의 카드」와 같다 (REQ-62 ⑧)
  if (state.today.draws.length > 0) {
    const first = state.today.draws[0];
    renderResult(first.c, first.f, { gained: 0, replay: true, idx: 0 });
    return;
  }
  enterDeck();
}

// ══════════════════════════════════════════════════════════════
// 덱 · 포커스
// ══════════════════════════════════════════════════════════════

/**
 * 덱(시작) 화면 — REQ-63 v2.
 *
 * 노출 조건(IMPL v4-3 · v5 R1). 「첫 방문」 = 서버 `first_tarot_day`(처음 뽑은 날이 오늘이거나 아직 없음).
 *   약속 띠·「골라 뒀어요」  첫 방문 && 오늘 첫 장 전 && 특별 카드 모드 아님
 *   「+5P부터」 줄           재방문 && 오늘 첫 장 전 && 특별 카드 모드 아님
 *   이달의 질문·특별 카드 줄·카드 모음 줄   재방문만
 * 같은 날 두 번째 장부터는 금액 예고가 없다(하루 코어는 첫 장에만 주므로).
 */
function enterDeck() {
  state.mode = null;
  state.shuffles = 0;
  state.needShuffles = state.today.shuffles ?? 3;
  // 고민은 아직 안 고른 첫 칩을 미리 골라 둔다 — 첫 터치가 거절되지 않게 (E2)
  const used = state.today.used_focuses ?? [];
  state.focus = FOCUS.find((f) => !used.includes(f.k))?.k ?? null;

  const t = state.today;
  const first = Boolean(t.first_tarot_day);
  const beforeFirst = (t.draws?.length ?? 0) === 0;
  $("#deckIntro").hidden = !(first && beforeFirst);
  $("#todayPt").hidden = !(!first && beforeFirst);
  $("#deckIntroPt").textContent = `+${t.core_points}P부터`;
  $("#todayPtVal").textContent = `+${t.core_points}P부터`;

  renderFocusRow();
  renderFocusNote();
  renderSpecialRow();
  renderYesterday();
  renderDeckChip();
  renderDots();
  $("#deck").classList.add("breathe");
  $("#deck").classList.toggle("deck--sm", !first); // 재방문은 줄이 늘어 덱을 줄인다 (t6)
  $("#deckHint").textContent = "무엇이 궁금하세요?";
  showScreen("deck");
}

function renderFocusRow() {
  const host = clear($("#focusRow"));
  const used = state.today.used_focuses ?? [];
  const grid = el("div", { class: "focusgrid" });
  host.append(grid);

  const chip = (f, cls = "") => {
    const isUsed = used.includes(f.k);
    const node = el(
      "button",
      {
        class: `chip-focus ${cls} ${isUsed ? "is-used" : ""} ${state.focus === f.k ? "is-sel" : ""}`,
        type: "button",
        "aria-pressed": state.focus === f.k ? "true" : "false",
        ...(isUsed ? { disabled: "", "aria-label": `${f.label} — 오늘 이미 뽑았어요` } : {}),
      },
      f.label,
    );
    if (!isUsed) node.addEventListener("click", () => pickFocus(f.k));
    return node;
  };
  for (const f of FOCUS) grid.append(chip(f));

  // 그달 첫째 주 월요일에만 「이달의 질문」 (SPEC-04 §2) — 첫 방문에는 숨긴다
  const mq = state.today.question?.open && !state.today.first_tarot_day ? monthQuestion(state.today.day) : null;
  if (mq) {
    host.append(
      chip({ k: "q", label: `✦ 이달의 질문: ${mq.q}` }, "chip-q"),
      el("p", { class: "qnote" }, "이달의 질문 · 오늘만 열려요"),
    );
  }
}

/** 「고민은 「오늘 하루」로 골라 뒀어요」 — 첫 방문 · 오늘 첫 장 전 · 특별 카드 모드 아님 */
function renderFocusNote() {
  const t = state.today;
  const show = t.first_tarot_day && (t.draws?.length ?? 0) === 0 && !state.mode && state.focus;
  const note = $("#focusNote");
  note.hidden = !show;
  if (show) note.textContent = `고민은 「${FOCUS.find((f) => f.k === state.focus)?.label}」로 골라 뒀어요 · 바꿔도 돼요`;
}

function pickFocus(k) {
  state.focus = k;
  renderFocusRow();
  renderFocusNote();
}

/** 어제의 카드 줄 — 누르면 그 카드 상세 (N6) */
function renderYesterday() {
  const y = state.today.yesterday;
  const row = $("#ydayRow");
  row.hidden = !y || state.mode != null;
  if (row.hidden) return;
  const name = TAROT_DB.cards[y.card_id]?.name ?? "—";
  const fl = y.focus === "q" ? "이달의 질문" : (FOCUS.find((f) => f.k === y.focus)?.label ?? "오늘 하루");
  row.setAttribute("aria-label", `어제의 카드 ${name} 다시 보기`);
  clear(row).append(
    el("img", { class: "rowlink__thumb", src: THUMB_IMG(y.card_id), alt: "", loading: "lazy", decoding: "async", draggable: "false" }),
    el(
      "span",
      { class: "rowlink__text" },
      el("span", { class: "rowlink__t" }, `어제의 카드 · ${name}`),
      el("span", { class: "rowlink__s" }, `어제 「${fl}」로 뽑았어요 · 눌러서 다시 보기`),
    ),
    el("span", { class: "rowlink__go", "aria-hidden": "true" }, "›"),
  );
}

/** 카드 모음 줄 — 재방문만. 완성 뒤엔 금빛 바퀴라는 것을 덱 앞에서부터 알 수 있게 (SPEC-03 §1-1 ③) */
function renderDeckChip() {
  const chip = $("#deckChip");
  chip.hidden = Boolean(state.today.first_tarot_day) || state.mode != null;
  if (chip.hidden) return;
  const coll = state.today.collection_count ?? 0;
  const gold = coll >= TOTAL;
  chip.classList.toggle("is-goldround", gold);
  clear(chip).append(
    el(
      "span",
      { class: "rowlink__t" },
      gold ? "✦ 금빛 " : "카드 모음 ",
      el("span", { class: "t-mono" }, `${gold ? (state.today.gold_count ?? 0) : coll}/${TOTAL}`),
      gold ? "장 · 은색 카드를 금빛으로" : "장 · 뽑은 카드가 모이는 곳",
    ),
    el("span", { class: "rowlink__go", "aria-hidden": "true" }, "›"),
  );
}

const ORDINAL = ["첫", "두", "세", "네", "다섯"];

/** 섞기 점 · 버튼 표지 · 안내 줄 — state.needShuffles 로 만든다 (#16) */
function renderDots() {
  const host = clear($("#shDots"));
  for (let i = 0; i < state.needShuffles; i++) {
    host.append(el("i", { class: i < state.shuffles ? "is-on" : "" }));
  }
  const need = state.needShuffles;
  const done = state.shuffles >= need;
  $("#shuffleBtn").hidden = done;
  $("#shuffleCount").textContent = need > 1 ? `${need}번 중 ${ORDINAL[state.shuffles] ?? state.shuffles + 1} 번째` : "";
  $("#deckSub").textContent = done
    ? "펼쳐집니다…"
    : need === 1
      ? "한 번 섞으면 펼쳐져요"
      : `카드를 좌우로 쓸어도 돼요 · ${need}번 섞으면 카드가 펼쳐져요`;
}

const deck = $("#deck");

/** 좌우로 쓸면 한 번 섞인다. 탭·「카드 섞기」 버튼도 같게 취급한다 — 접근성(기획서 1절) */
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

  if (state.shuffles >= state.needShuffles) setTimeout(openFan, 420);
}

$("#shuffleBtn").addEventListener("click", shuffleOnce);
$("#ydayRow").addEventListener("click", () => {
  const y = state.today.yesterday;
  if (!y) return;
  showCollection();
  showCardDetail(y.card_id);
});
$("#deckChip").addEventListener("click", (e) => {
  e.preventDefault();
  showCollection();
});

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
  // 고른 순간부터 열리기까지 「문양 의식」(REQ-48) — 응답이 빨라도 4초, 늦으면 받는 즉시
  const ritual = beginRitual(node);

  // 올해·이달의 카드 — 일일 뽑기와 다른 길로 (SPEC-04 §3·§4)
  if (state.mode) return chooseSpecial(node, ritual);

  let res;
  try {
    res = await apiPost("/api/tarot/draw", { focus: state.focus });
  } catch (err) {
    state.busy = false;
    endRitual(ritual, node, { reset: true });
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

  // 카드가 정해졌다 — 의식이 그 계열 색으로 물들고, 앞면 그림을 지금 붙여 그려질 준비를 한다.
  // 결과 화면에 쓸 오늘 상태도 **동시에** 부른다 — 열린 뒤 머무는 1.2초 안에 끝나 있게 (REQ-49)
  ritual.answer(res.card_id, prepareFace(res.card_id));
  const todayP = apiGet("/api/tarot/today").catch(() => null);
  await ritual.reveal();
  state.today = (await todayP) ?? (await apiGet("/api/tarot/today"));
  // 다음 화면으로 바꾸는 같은 순간에 걷는다 — 사이에 부채가 비치지 않게
  endRitual(ritual, node);
  // 이 뽑기로 78장이 됐으면(교환으로 채운 경우 포함) **결과보다 먼저** 완성 화면 (SPEC-03 §1-1 ①)
  if (state.today.gold_intro_pending) await showComplete();
  renderResult(res.card_id, state.focus, res);
  state.busy = false;
}

// ══════════════════════════════════════════════════════════════
// 고른 뒤 열리기까지 — 「문양 의식」 (REQ-48 · 연출은 tarot-ritual.js)
// ══════════════════════════════════════════════════════════════

const FAN_HINT = "마음이 가는 카드를 한 장 고르세요";

function beginRitual(node) {
  $("#fanSub").hidden = true;
  return startRitual({ stage: $("#fanStage"), node, hint: $("#fanHint"), reduced: reducedMotion() });
}

/**
 * 의식을 걷는다. `reset` 이면 고른 카드도 제자리로 — 오류·FOCUS_USED·NO_DRAWS 로 부채에
 * 머물 때 들린 카드·흐린 부채·바뀐 문구가 남지 않게 한다.
 */
function endRitual(ritual, node, { reset = false } = {}) {
  ritual?.cancel();
  $("#fanHint").textContent = FAN_HINT;
  $("#fanSub").hidden = false;
  if (reset && node) {
    node.classList.remove("is-chosen");
    node.style.removeProperty("--lift");
  }
}

/**
 * 의식 카드의 앞면 — **이 요소 하나**를 받아 decode 까지 끝내면 「준비 완료」(REQ-49).
 *
 * 예전엔 별도 `Image` 로 받아 두고 열 때 새 `<img>` 를 붙였다. 같은 그림을 두 번 다루는 데다,
 * 새 요소가 그려지기 전에 뒤집혀 폰에서 빈 앞면이 보였다. 이제 의식이 이 요소를 보이지 않는
 * 면에 미리 붙이고, 준비가 끝나야 연다.
 *
 * 탭이 백그라운드면 decode 가 끝나지 않는다(전에 겪음) — 받기를 마쳤으면 1.5초 안에 준비로 친다.
 * 8초 상한·실패 → 이모지+이름(기존 폴백).
 */
function prepareFace(cardId) {
  const node = el("img", { class: "cardimg", src: CARD_IMG(cardId), alt: TAROT_DB.cards[cardId].name, draggable: "false" });
  const ready = new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    setTimeout(() => finish(false), PRELOAD_MAX_MS);
    node.addEventListener("error", () => finish(false), { once: true });
    node.addEventListener("load", () => setTimeout(() => finish(true), 1500), { once: true });
    node.decode?.().then(() => finish(true), () => {});
  });
  return { node, ready, fallback: () => cardFace(cardId, false) };
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
  renderDrawTabs(res.idx ?? state.today.draws.length - 1);
  // 2층 접힘은 결과를 새로 그릴 때마다 닫아 둔다
  setFold($("#resLuckyFold"), false);
  setFold($("#wordFold"), false);
  // 한 마디 — 해석을 읽은 뒤 아래에서 키워드 하나 (SPEC-04 §1). 다시 들어와도 고른 것이 보인다
  renderWord(cardId);
  // 뽑기 직후면 플립 전에 받아 둔 그림이 캐시에서 나온다. 다시 들어온 경우엔 받는 동안
  // 잠깐 빈칸일 수 있지만, 실패하면 이모지로 바뀐다
  const hero = clear($("#resGlyph"));
  hero.append(cardFace(cardId, true));
  // 금빛 바퀴(78장 완성 뒤)에서는 카드 테두리가 은색·금빛으로 갈린다
  hero.className = `t-frame ${tierClass(cardId)}`;
  hero.onclick = () => openZoom(cardId);
  $("#resName").textContent = r.card.name;

  // 숨은 이야기 — 이 뽑기로 금빛이 된 순간에만 번짐 → 한 글자씩 (SPEC-03 §2)
  const storyNode = $("#resStory");
  storyNode.hidden = true;
  // 다시 들어왔어도 **오늘 금빛이 된 카드**면 이야기를 연출 없이 그대로 보인다 (REQ-66 ①)
  const goldToday = Boolean(res.replay && state.today.gold_today?.includes(cardId));
  if (!res.replay && res.gold_new) {
    hero.classList.add("is-blooming");
    showStory(storyNode, cardId, GOLD_BLOOM_MS);
  } else if (goldToday) {
    showStory(storyNode, cardId, 0, { instant: true });
  }

  // 「작년 오늘」 — 1년 전 같은 날 기록이 있을 때만
  const ly = state.today.last_year;
  $("#resLastYear").hidden = !ly;
  if (ly) $("#resLastYear").textContent = `작년 오늘의 카드 · ${TAROT_DB.cards[ly.card_id]?.name ?? "—"}`;

  // 금빛 단계 표기 — 적립 줄을 안 읽고 넘겨도 보이게 카드 바로 아래 (SPEC-03 §1-1 ④)
  const tier = $("#resTier");
  const alreadyGold = !res.replay && !res.is_new && !res.gold_new && state.today.gold?.includes(cardId);
  tier.hidden = !(res.gold_new || alreadyGold || goldToday);
  tier.textContent = res.gold_new || goldToday ? "✦ 금빛이 됐어요 · 숨은 이야기" : "✦ 이미 금빛 · 별가루 +1";
  tier.classList.toggle("is-new", Boolean(res.gold_new || goldToday));

  $("#resInterp").textContent = r.interp;
  $("#resAdvice").textContent = r.advice;

  clear($("#resLucky")).append(
    stat("행운의 색", r.card.lucky.color),
    stat("행운의 숫자", String(r.card.lucky.number)),
    stat("행운의 물건", r.item),
  );

  renderGain(res);

  if (res.replay) renderExchange(null);
  else if (res.gold_exchanged_card_id != null) renderExchange(res.gold_exchanged_card_id, { gold: true });
  else renderExchange(res.exchanged_card_id);

  // 서비스 사이 이동 = 공용 다음 안내 바 (REQ-63 · 크로스 칩 대체)
  renderNextStep({ svc: "tarot", suite: state.today.suite, justCompleted: (res.triple_gained ?? 0) > 0 });
  renderResultAds();

  $("#resNote").textContent =
    state.today.remaining > 0 ? `오늘 ${state.today.remaining}장 남음` : "내일 자정에 새 카드가 기다립니다";

  showScreen("result");
  armScreen("result");
}

/**
 * 받기 상자 (IMPL v4-2) — 큰 숫자 = 서버 `gained`, 내역 = 서버 `gain_detail`. 금액 상수를 쓰지 않는다.
 * 셋 다 보너스(triple)는 여기 쓰지 않는다 — 다음 안내 바가 말한다(같은 돈 두 번 금지).
 */
function renderGain(res) {
  const t = state.today;
  const main = clear($("#resGain"));
  const sub = clear($("#resGainSub"));
  const bonus = $("#resGainBonus");
  const mono = (v) => el("span", { class: "t-mono" }, String(v));
  $("#resCollHelp").hidden = !t.first_tarot_day;
  bonus.hidden = true;

  // 다시 들어온 경우 · 「오늘의 카드」 탭 — 장별 금액은 쓰지 않는다 (N3)
  if (res.replay) {
    main.hidden = false;
    main.append("오늘 뽑은 카드예요");
    sub.append("오늘 타로로 받은 포인트 ", mono(`+${t.today_points ?? 0}`), "P");
    return;
  }

  main.hidden = !(res.gained > 0); // 두 번째 장 이후 0P 면 금액 줄 없이 내역만
  if (res.gained > 0) main.append(el("span", { class: "gain__pt" }, `+${res.gained}P`), "받았어요");

  const detail = res.gain_detail ?? [];
  const sum = (pred) => detail.filter(pred).reduce((a, d) => a + d.p, 0);
  const daily = sum((d) => d.kind === "daily");
  const fresh = sum((d) => d.kind === "new" && !d.src);
  const viaDust = sum((d) => d.kind === "new" && d.src === "exchange");
  const dustMax = t.dust_max ?? 4;
  const goldRound = (t.collection_count ?? 0) >= TOTAL;

  if (res.is_new) {
    const parts = [];
    if (daily) parts.push(["오늘 ", mono(daily)]);
    if (fresh) parts.push(["새 카드 ", mono(fresh)]);
    parts.forEach((p, i) => sub.append(...(i ? [" + "] : []), ...p));
    sub.append(`${parts.length ? " · " : ""}카드 모음에 1장 들어갔어요`);
  } else if (res.gold_new) {
    sub.append("이 카드가 금빛이 되었어요");
  } else if (res.gold_exchanged_card_id != null) {
    sub.append("별가루 4개가 모여 은색 카드 1장이 금빛이 되었어요");
  } else if (res.exchanged_card_id != null) {
    sub.append("별가루 4개가 모여 못 만난 카드 1장이 왔어요");
    if (viaDust) sub.append(" · 별가루로 온 카드 ", mono(viaDust));
  } else if (goldRound) {
    sub.append("이미 금빛인 카드예요 · 별가루 +1 ", mono(`(${res.dust}/${dustMax})`), " · 4개 모이면 은색 카드 1장이 금빛으로");
  } else {
    sub.append("같은 카드가 또 나와 별가루 +1 ", mono(`(${res.dust}/${dustMax})`), " · 4개 모이면 못 만난 카드 1장");
  }

  // 마일스톤(일반·금빛) — 둘째 줄
  const ms = sum((d) => d.kind === "bonus");
  if (ms > 0) {
    bonus.hidden = false;
    clear(bonus).append(
      goldRound ? `금빛 ${t.gold_count ?? 0}장 ` : `카드 ${t.collection_count ?? 0}장 모았어요 `,
      mono(`+${ms}P`),
    );
  }
}

/** 오늘 2장 이상 뽑았으면 결과 위에 장 고르기 (E17) — 첫 장이 「오늘의 카드」 */
function renderDrawTabs(idx) {
  const draws = state.today.draws ?? [];
  const host = clear($("#drawTabs"));
  host.hidden = draws.length < 2;
  if (host.hidden) return;
  draws.forEach((d, i) => {
    const b = el(
      "button",
      { type: "button", role: "tab", class: `chip-focus ${i === idx ? "is-sel" : ""}`, "aria-selected": i === idx ? "true" : "false" },
      i === 0 ? "오늘의 카드" : `${i + 1}번째 장`,
    );
    if (i !== idx) b.addEventListener("click", () => renderResult(d.c, d.f, { gained: 0, replay: true, idx: i }));
    host.append(b);
  });
}

/** 2층 접힘 줄 — 누르면 바로 아래 칸이 열린다 */
function setFold(btn, open) {
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.classList.toggle("is-open", open);
  $(`#${btn.getAttribute("aria-controls")}`).hidden = !open;
}
for (const id of ["#resLuckyFold", "#wordFold"]) {
  $(id).addEventListener("click", (e) => setFold(e.currentTarget, e.currentTarget.getAttribute("aria-expanded") !== "true"));
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
async function showStory(node, cardId, delayMs = 0, { instant = false } = {}) {
  const text = (await loadStories())[cardId] ?? "";
  node.hidden = false;
  node.textContent = "";
  if (instant || reducedMotion()) {
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

/**
 * 카드 크게 보기 (REQ-66 ②) — 어두운 막 위에 원본 그림 1장. 닫기 = ✕ · 막 탭 · 뒤로 키 · Esc.
 * 뒤로 키로 닫히게 기록을 한 칸 쌓고, 닫을 때는 그 칸을 되돌린다(닫는 길이 하나라 상태가 꼬이지 않게).
 */
function openZoom(cardId) {
  if ($(".t-zoom")) return;
  const opener = document.activeElement;
  const close = () => history.back(); // → popstate 에서 걷는다
  const closeBtn = el("button", { class: "t-zoom__close", type: "button", "aria-label": "닫기", onclick: close }, "✕");
  const ov = el(
    "div",
    { class: "t-zoom", role: "dialog", "aria-modal": "true", "aria-label": `${TAROT_DB.cards[cardId].name} 크게 보기`, onclick: (e) => e.target === ov && close() },
    el("img", { class: "t-zoom__img", src: CARD_IMG(cardId), alt: TAROT_DB.cards[cardId].name, draggable: "false" }),
    closeBtn,
  );
  const onKey = (e) => e.key === "Escape" && close();
  const onPop = () => {
    ov.remove();
    removeEventListener("popstate", onPop);
    removeEventListener("keydown", onKey);
    opener?.focus?.();
  };
  history.pushState({ tarotZoom: true }, "");
  addEventListener("popstate", onPop);
  addEventListener("keydown", onKey);
  document.body.append(ov);
  closeBtn.focus();
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

function renderResultAds() {
  clearRewardCard($("#adbarMore"));
  clearRewardCard($("#adbarStats"));

  // 이미 받아 둔 장수가 남았으면(첫 방문 보너스 · 광고 보고 안 뽑은 장) **광고 없이** 덱으로.
  //
  // 처음엔 덱으로 돌아가는 길이 광고 카드뿐이었다. 그래서 광고 2회를 다 쓰면 「오늘 1장 더
  // 뽑을 수 있어요」라고 적혀 있는데 누를 것이 없었고, 남은 장이 있는데도 광고를 또 보게
  // 했다. 폰 실기에서 「뽑아도 진행이 안 된다」로 드러났다(REQ-40 스테이징 확인 2026-10-05).
  // 웰컴 장이 남은 경우의 부제 (#7 — 「처음 오신 선물」 금지, 재방문에도 나온다)
  $("#moreNote").hidden = !((state.today.remaining ?? 0) > 0 && state.today.welcome_available && state.today.draws.length >= 1);
  if ((state.today.remaining ?? 0) > 0) {
    // 이 화면의 주 행동 — 채운 금 버튼 1개
    const btn = el("button", { class: "t-btn mainbtn", type: "button" }, "다른 고민으로 한 장 더");
    btn.addEventListener("click", () => enterDeck());
    $("#adbarMore").append(btn);
  } else if ((state.today.ad_more_used ?? 0) < (state.today.ad_more_max ?? 2)) {
    // 「한 장 더」 광고 — 상한을 다 쓰면 **버튼을 숨긴다**(비활성화가 아니라 제거)
    const card = renderRewardCard($("#adbarMore"), {
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
    card.classList.add("adcard");
  }

  // 분포가 아직 닫혀 있으면 광고 카드도 % 줄도 없이 한 줄만 — 봐도 받을 것이 없다 (REQ-62 ⑭ · D2 · N11)
  $("#resDist").hidden = true;
  $("#distWait").hidden = true;
  if (state.today.ad_stats_seen) {
    loadStats();
  } else if (!state.today.dist_open) {
    $("#distWait").hidden = false;
  } else {
    const card = renderRewardCard($("#adbarStats"), {
      icon: "🗺️",
      title: "광고 보고 전국 분포 보기",
      desc: "오늘 사람들이 뽑은 카드",
      note: "봐도 오늘의 카드와 적립은 그대로예요",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("TAROT_STATS");
        if (!r) return;
        state.today = await apiGet("/api/tarot/today");
        clearRewardCard($("#adbarStats"));
        loadStats();
      },
    });
    // 주 행동이 아닌 자리 — CTA 를 테두리형으로 낮춰 채운 버튼이 화면에 1개가 되게
    card.classList.add("adcard", "adcard--sub");
    card.querySelector(".reward__icon")?.classList.add("reward__icon--map");
  }
}

async function loadStats() {
  try {
    const s = await apiGet("/api/tarot/stats");
    const line = $("#resDist");
    if (!s.open) {
      // 표본이 적을 때 %를 보여 주면 그 값이 사람 한두 명을 뜻한다 (SUITE 1.5) — 인원 수도 싣지 않는다
      $("#distWait").hidden = false;
      return;
    }
    line.hidden = false;
    const mine = s.items.find((i) => String(i.key) === String(s.my_card));
    const top = s.items[0];
    // 카드 이름을 적는다 — 두 번째 장을 보고 있어도 `my_card`(첫 장)에 대한 사실이 되게 (REQ-62 ⑧)
    line.textContent = mine
      ? `오늘 「${TAROT_DB.cards[s.my_card]?.name ?? "—"}」 카드를 뽑은 사람 ${mine.pct}% · 가장 많이 나온 카드는 ${TAROT_DB.cards[top.key]?.name ?? "—"}(${top.pct}%)`
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

  const dust = state.today.dust ?? 0;
  // 처음 몇 장 동안은 규칙 두 줄만 — 별가루·수트·전체 마일스톤은 10장 또는 별가루 1개부터 (#11)
  const full = goldRound || have.size >= COLL_RULES_FROM || dust >= 1;
  const next = ms.find((m) => n < m.n);
  const mono = (v) => el("span", { class: "t-mono" }, String(v));

  clear($("#collTitle")).append(goldRound ? "금빛 " : "카드 모음 ", mono(n), "장");
  $("#collTotal").textContent = `모두 ${total}장`;
  $("#collDust").hidden = dust < 1;
  $("#collDust").textContent = `✦ 별가루 ${dust}/${state.today.dust_max ?? 4}`;
  $("#collBar").classList.toggle("collbar--gold", goldRound);
  $("#collDetail").hidden = true;

  // 진척 바 — 마일스톤 자리에 ◆, 넘은 점은 채운다. 처음엔 다음 목표 하나만
  const bar = clear($("#collBar"));
  bar.append(el("div", { class: "collbar__fill", style: `width:${((n / total) * 100).toFixed(1)}%` }));
  for (const m of full ? ms : next ? [next] : []) {
    bar.append(
      el("div", {
        class: `collbar__tick ${n >= m.n ? "is-on" : ""}`,
        style: `left:${((m.n / total) * 100).toFixed(1)}%`,
        title: `${m.n}장 +${m.p}P`,
      }),
    );
  }
  clear($("#collBarLeg")).append(
    el("span", {}, `지금 ${n}장`),
    el("span", {}, next ? `${next.n - n}장 더 모으면 +${next.p}P` : goldRound ? "모두 금빛" : "모두 모았어요"),
  );

  // 규칙 상자
  const goal = next
    ? el("p", { class: "rulebox__goal" }, el("b", {}, `${next.n}장`), goldRound ? " 금빛이면 " : " 모으면 ", el("b", {}, `+${next.p}P`))
    : null;
  const rules = goldRound
    ? ["은색 카드를 뽑으면 금빛이 돼요", "금빛 카드가 겹치면 별가루 +1 · 4개 = 은색 카드 1장이 금빛으로", "카드를 누르면 숨은 이야기를 볼 수 있어요"]
    : full
      ? ["같은 카드가 또 나오면 별가루 +1", "별가루 4개 = 아직 못 만난 카드 1장", "◆ = 포인트 받는 지점"]
      : [];
  clear($("#collNote")).append(
    el(
      "h2",
      { class: "rulebox__t" },
      goldRound ? (next ? "은색 카드를 금빛으로 물들여요" : "78장이 모두 금빛이 되었어요") : next ? "뽑은 카드가 여기 모여요" : "카드를 모두 모았어요",
    ),
    goal,
    rules.length ? el("ul", {}, rules.map((r) => el("li", {}, r))) : null,
  );

  if (!full) state.collTab = "all";
  $("#collTabs").hidden = !full;
  renderCollTabs(have);
  renderCollGrid(have);
  setCollView(state.collView ?? "grid");
  showScreen("coll");
}

/** 「카드 모음 | 달력」 (SPEC-03 §5) — 달력 탭은 뽑은 날이 2일 이상일 때만 (#13) */
function setCollView(v) {
  const calOk = (state.today.draw_days ?? 0) >= 2;
  $("#collViewTabs").hidden = !calOk;
  if (!calOk) v = "grid";
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
  // 완성 전에는 「다시 만나면 열려요」가 거짓이다 — 78장 뒤 금빛 바퀴에서만 열린다 (N9)
  const locked = (state.today.collection_count ?? 0) < TOTAL ? "78장을 모두 모으면 열리는 이야기가 있어요" : "금빛이 되면 이야기가 열려요";
  const story = el("p", { class: isGold ? "story" : "story story--locked" }, isGold ? "…" : locked);
  const close = el("button", { class: "detail__close", type: "button", "aria-label": "닫기" }, "✕");
  close.addEventListener("click", () => (box.hidden = true));
  box.append(thumb, el("div", { class: "detail__text" }, el("div", { class: "exchange__name" }, c.name), story), close);
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  if (isGold) story.textContent = (await loadStories())[cardId] ?? "";
}

function renderCollTabs(have) {
  const host = clear($("#collTabs"));
  // 탭 옆 n/22 분수는 쓰지 않는다 (E19) — 진척은 위 막대가 말한다
  for (const s of SUITS) {
    const node = el(
      "button",
      { class: `chip-focus ${state.collTab === s.k ? "is-sel" : ""}`, type: "button" },
      s.label,
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

  const todayIds = new Set((state.today.draws ?? []).map((d) => d.c));

  for (let i = s.from; i <= s.to; i++) {
    const c = TAROT_DB.cards[i];
    const got = have.has(i);
    // 가진 칸은 눌러서 상세(숨은 이야기)를 연다 — 버튼으로 둬야 키보드로도 열린다
    const cell = el(got ? "button" : "div", {
      class: `collcell ${got ? `is-have ${tierClass(i)}` : "is-miss"}`,
      title: got ? c.name : "아직 만나지 않은 카드",
      ...(got ? { type: "button", "aria-label": todayIds.has(i) ? `${c.name} · 오늘 뽑음` : c.name } : {}),
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
      if (todayIds.has(i)) cell.append(el("span", { class: "todaytag" }, "오늘"));
    } else {
      cell.append(el("span", { class: "q", "aria-hidden": "true" }, "?"));
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
      el("p", { class: "reading--sm" }, r.interp),
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
  // 칸은 2층 접힘 줄(#wordFold)이 연다 — 여기서는 줄을 보일지만 정한다
  const kws = S3?.KEYWORDS?.[cardId];
  $("#wordFold").hidden = !kws;
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
// 올해의 카드 · 이달의 카드 (SPEC-04 §3·§4) — 일일 뽑기와 별개, 광고 없음, 적립은 새 카드 +3P 만 (REQ-62 ⑯)
// ══════════════════════════════════════════════════════════════

const specialTitle = (kind, period) =>
  kind === "year" ? `${period}년의 카드` : `${Number(period.slice(5, 7))}월의 카드`;

/**
 * 덱 아래 「✦ 11월의 카드 뽑기」 줄 — 아직 안 뽑은 것만, 첫 방문엔 숨김(v4-3).
 * 「작년의 올해 카드」 상자도 여기서 그린다. 금액 「새 카드면 +3P」는 서버 `new_points`.
 */
function renderSpecialRow() {
  const host = clear($("#specialRow"));
  const sp = state.today.special ?? {};
  const add = (kind, period) => {
    const b = el(
      "button",
      { type: "button", class: "rowlink rowlink--bonus" },
      el("span", { class: "rowlink__star", "aria-hidden": "true" }, kind === "year" ? period : `${Number(period.slice(5, 7))}월`),
      el(
        "span",
        { class: "rowlink__text" },
        el("span", { class: "rowlink__t" }, `✦ ${specialTitle(kind, period)} 뽑기`),
        el(
          "span",
          { class: "rowlink__s" },
          `${kind === "year" ? "올해의 카드 · 1년에 한 번" : "이달의 카드 · 한 달에 한 번"} · 새 카드면 +${state.today.new_points}P`,
        ),
      ),
      el("span", { class: "rowlink__go", "aria-hidden": "true" }, "›"),
    );
    b.addEventListener("click", () => enterSpecial(kind, period));
    host.append(b);
  };
  renderLastYearBox(sp.year); // 특별 카드를 뽑는 중이면 스스로 숨는다
  if (state.mode || state.today.first_tarot_day) return; // 뽑는 중 · 첫 방문에는 띄우지 않는다
  if (sp.year && sp.year.card_id == null) add("year", sp.year.period);
  if (sp.month && sp.month.card_id == null) add("month", sp.month.period);
}

/**
 * 「작년의 올해 카드」 작은 카드 상자 (SPEC-04 §3 · REQ-46).
 *
 * 1년 만에 다시 만나는 장면이라 글 한 줄로는 눈에 띄지 않았다(Master 폰 확인). 그래도 덱이
 * 이 화면의 주인공이라 칩 줄 아래 작은 상자로만 둔다. 작년 기록이 없으면 **아예 그리지 않는다**
 * (빈 상자 금지). 올해의 카드를 이미 뽑았어도 기간 동안 계속 보인다. 누르면 그때 결과를 다시 본다.
 */
function renderLastYearBox(year) {
  const host = clear($("#lastYearBox"));
  const id = year?.last;
  host.hidden = id == null || state.mode != null;
  if (host.hidden) return;
  const period = String(Number(year.period) - 1);
  const thumb = el("div", { class: `collcell lastbox__thumb ${tierClass(id)}` });
  thumb.append(cardFace(id, true, THUMB_IMG(id)));
  const box = el(
    "button",
    { type: "button", class: "lastbox", "aria-label": `작년의 올해 카드 ${TAROT_DB.cards[id]?.name ?? ""} 다시 보기` },
    thumb,
    el(
      "span",
      { class: "lastbox__text" },
      el("span", { class: "lastbox__label" }, `✦ 작년의 올해 카드 · ${period}년`),
      el("b", { class: "lastbox__name" }, TAROT_DB.cards[id]?.name ?? "—"),
      el("span", { class: "lastbox__line" }, S3?.YEAR?.[id] ?? ""),
    ),
  );
  box.addEventListener("click", () => renderSpecialResult({ kind: "year", period, card_id: id, view: true }));
  host.append(box);
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
  // 특별 카드 모드에서는 금액 예고·약속 띠·「골라 뒀어요」·어제·카드 모음 줄을 숨긴다 (v5 R1)
  $("#deckIntro").hidden = true;
  $("#todayPt").hidden = true;
  renderFocusNote();
  renderSpecialRow();
  renderYesterday();
  renderDeckChip();
  renderDots();
  $("#deckHint").textContent =
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

  // 다시 보기(작년의 올해 카드) — 읽기만. 도감·별가루 줄과 교환 연출은 없다 (REQ-46)
  state.spView = Boolean(res.view);
  $("#spCollect").hidden = state.spView;
  $("#spSaved").hidden = state.spView;
  if (state.spView) {
    $("#spStory").hidden = true;
    renderExchange(null, { host: $("#spExchange") });
    showScreen("special");
    armScreen("special");
    return;
  }

  const dustMax = state.today.dust_max ?? 4;
  const exchanged = res.exchanged_card_id != null || res.gold_exchanged_card_id != null;
  // 처음 만난 카드는 일일 뽑기와 같은 +3P (REQ-62 ⑯ · E2) — 금액은 서버가 준 값
  // 받기 = 「+3P 받았어요 · 카드 모음에 1장」, 겹치면 금액 줄 없음 (E2 · v4 #20). 교환 카드 +3P 는 앞에 붙인다
  const got = res.gained > 0 ? `+${res.gained}P 받았어요 · ` : "";
  $("#spCollect").textContent = res.is_new
    ? `${got}카드 모음에 1장`
    : res.gold_new
      ? "✦ 금빛이 됐어요 · 숨은 이야기"
      : `${got}별가루 +1 (${exchanged ? dustMax : res.dust}/${dustMax})`;

  const story = $("#spStory");
  story.hidden = true;
  if (res.gold_new) showStory(story, cardId, GOLD_BLOOM_MS);

  if (res.gold_exchanged_card_id != null) renderExchange(res.gold_exchanged_card_id, { gold: true, host: $("#spExchange") });
  else renderExchange(res.exchanged_card_id, { host: $("#spExchange") });

  showScreen("special");
  armScreen("special");
}

async function chooseSpecial(node, ritual) {
  const { kind } = state.mode;
  let res;
  try {
    res = await apiPost("/api/tarot/special", { kind });
  } catch (err) {
    state.busy = false;
    state.mode = null;
    endRitual(ritual, node, { reset: true });
    $("#fanStage").classList.remove("is-locked");
    toast(err.message ?? "카드를 뽑지 못했습니다.", "error");
    state.today = await apiGet("/api/tarot/today");
    enterDeck();
    return;
  }
  ritual.answer(res.card_id, prepareFace(res.card_id));
  const todayP = apiGet("/api/tarot/today").catch(() => null);
  await ritual.reveal();
  state.today = (await todayP) ?? (await apiGet("/api/tarot/today"));
  endRitual(ritual, node);
  if (state.today.gold_intro_pending) await showComplete();
  renderSpecialResult(res);
  state.busy = false;
}

/** 특별 카드 결과에서 나가기 — 오늘 이미 뽑았으면 오늘의 카드로, 아니면 덱으로 */
function leaveSpecial() {
  state.mode = null;
  // 다시 보기에서 닫으면 덱으로 — 거기서 열었다 (REQ-46)
  if (state.spView) {
    state.spView = false;
    enterDeck();
    return;
  }
  if (state.today.draws.length > 0) {
    const first = state.today.draws[0]; // 오늘의 카드 = 첫 장 (REQ-62 ⑧)
    renderResult(first.c, first.f, { gained: 0, replay: true, idx: 0 });
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
      el("p", { class: "reading--sm" }, (kind === "year" ? S3?.YEAR : S3?.MONTH)?.[id] ?? ""),
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
