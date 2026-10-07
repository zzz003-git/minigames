/**
 * 🔬 오늘의 선택 — 화면
 *
 * 기획: MIND-SPEC-01 · 인터랙션 1차 사양은 프로토
 * (`../reward-minigame-research/mind/prototype/MIND-PROTO-01_마음연구소.html`
 *  — 파일명은 개명 전 이름 그대로다)
 *
 * ── 유형은 서버가 다시 센다 ──────────────────────────────────────────────
 * 여기서도 계산하지만 그것은 **연출을 미리 준비하기 위한 것**이고, 도감에 들어가는
 * 값은 서버가 정한 것이다(기획서 M-02). 두 계산이 어긋나면 화면이 보여 준 유형과
 * 저장된 유형이 달라지므로, 규칙은 `src/services/mind.js` 의 judge 와 같아야 한다.
 *
 * ── 전국 추측은 없앴다 (REQ-62 ⑮ · E1) ──────────────────────────────────
 * 그날 최다 유형은 모두에게 같은 답이라 공유되면 분포 광고를 우회했다(정답 있는 게임 금지).
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, currentScreen, toast, renderHeader } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { expOfDay } from "./mind-pick.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { renderNextStep, hideNextStep } from "../shared/nextstep.js";
import { bindPairIntro } from "../shared/pairintro.js";

const ARM_DELAY_MS = 400;

/**
 * 축의 쉬운 이름 (REQ-63 · INTEGRATED v4) — 증분 +1 통일로 축이 「방향」이 아니라 「주제」를 세므로
 * 양끝을 아우르는 말로 부른다. 순서는 COMMON.axes(energy·decide·warmth·adventure·having·express·recover·tempo).
 * 콘텐츠 DB(mind-common.js 생성물)는 손대지 않는다.
 */
const AXIS_EASY = ["힘을 얻는 법", "정하는 법", "사람 사이 온도", "익숙함과 새로움", "쓰기와 아끼기", "마음 표현", "쉬는 법", "계획과 즉흥"];
const axisName = (i) => AXIS_EASY[i] ?? COMMON.axes[i]?.name ?? "";

/** 상단바 아이콘 — 작은 나침반 원판 (봉투 폐기) */
const COMPASS_ICON =
  '<svg class="topbar__icon" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="11.5" fill="#2A8F80"/><circle r="8.4" fill="#FFF8E7"/><path d="M0-7.2 L2.1 0 L0 7.2 L-2.1 0Z" fill="#FFD24A" stroke="#E2572B" stroke-width=".9" stroke-linejoin="round"/><circle r="1.5" fill="#0E2B28"/></svg>';

/**
 * 콘텐츠는 셋으로 나뉘어 있다 (REQ-47 · scripts/gen-mind-db.mjs).
 *   COMMON  축·축 메아리 등 공통        — boot 에서 받는다
 *   INDEX   도감용 목록(id·제목·유형 이름) — boot 에서 받는다. 고르기·도감·분포 이름이 쓴다
 *   exp/<id>.json  실험 하나의 본문 + typeMeet — 필요한 실험만 받는다
 * 182개를 통째로 받던 때(gzip 146KB) 대신 그날 실험 하나(약 1KB)만 받는다.
 *
 * 정적 import 로 두지 않은 이유: 정적 import 가 실패하면 모듈이 통째로 안 떠서 화면에
 * 아무 안내도 못 한다. 동적으로 받아 실패하면 「다시 시도」를 보여 준다.
 */
let COMMON = null;
let INDEX = null;
const expCache = new Map();

const state = {
  st: null, // 서버 상태
  exp: null, // 지금 하는 실험(본문 포함) — 오늘의 실험 또는 지난 선택
  today: null, // 오늘의 실험(본문 포함)
  archiveDay: null, // 지난 선택을 하는 중이면 그날 (M-04)
  answers: [],
  step: 0,
  busy: false,
  waiting: false, // 고른 직후 220ms — 이 동안 「이전」을 막는다
  lastGain: null, // 방금 제출한 결과의 축 증분 — 이달의 마음 「오늘 생긴 점」 고리 (재열람엔 없음)
  qHistory: false, // 문항 단계를 history 에 쌓았는가 (뒤로 키 → 확인 시트)
};

/** 실험 하나의 본문을 받는다. 실패하면 던진다 — **다른 실험으로 대신하지 않는다** */
async function loadExp(id) {
  if (expCache.has(id)) return expCache.get(id);
  const res = await fetch(`/mind/exp/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`선택을 불러오지 못했어요 (${res.status})`);
  const exp = await res.json();
  expCache.set(id, exp);
  return exp;
}

const indexOf = (id) => INDEX?.experiments.find((e) => e.id === id) ?? null;

// 원안의 `activeView = inSuite ? 'hub' : v` — 서비스 화면에서도 「오늘의 나」 탭이
// 켜진 채 남는다. 게임 화면과 달리 여기는 판 중이 아니라 결과를 보는 자리다.
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { title: "오늘의 선택", back: "/today/" });
// 나침반 아이콘 + 「심리테스트」 칩 — 헤더 배지(#headerBadge)와는 별개 요소 (IMPL v3 JS-11)
$("#header .topbar__back").insertAdjacentHTML("afterend", COMPASS_ICON);
$("#header").append(el("span", { class: "topbar__chip", id: "kindChip" }, "심리테스트"));
// 문항 중 헤더 ‹ — 고른 답이 사라지므로 한 번 묻는다
$("#header .topbar__back").addEventListener("click", (e) => {
  if (currentScreen() !== "quiz") return;
  e.preventDefault();
  confirmQuit();
});

$("#envelope").addEventListener("click", openEnvelope);
$("#envelope").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEnvelope();
  }
});
$("#envOpenBtn").addEventListener("click", openEnvelope);
$("#sceneStartBtn").addEventListener("click", () => renderQuestion(0));
$("#qPrev").addEventListener("click", () => {
  if (state.waiting || state.step === 0) return;
  renderQuestion(state.step - 1); // 고른 답은 남겨 둔다
});
// 지도·카드 모음은 결과에서만 들어간다 — 돌아가면 직전 결과(지난 선택이면 그 결과)로
$("#mapLink").addEventListener("click", (e) => {
  e.preventDefault();
  showMap();
});
$("#collLink").addEventListener("click", (e) => {
  e.preventDefault();
  showCollection();
});
$("#mapBackBtn").addEventListener("click", () => showScreen("result"));
$("#collBackBtn").addEventListener("click", () => showScreen("result"));
$("#mindRetryBtn").addEventListener("click", () => boot());
// 「너를 맞혀볼게」 첫 탭에만 소개 시트 B (REQ-63 공용)
bindPairIntro($("#pairCta"));
// 지난 선택 결과 → 오늘 결과
$("#todayResultBtn").addEventListener("click", () => {
  state.archiveDay = null;
  state.exp = state.today;
  renderResult({ exp: state.today, typeIdx: state.st.type_idx, replay: true });
});
// 뒤로 키(웹뷰 포함) — 문항 중이면 나가기 전에 확인 시트
window.addEventListener("popstate", () => {
  if (currentScreen() !== "quiz") return;
  history.pushState({ mind: "q" }, "");
  confirmQuit();
});

boot();

// ══════════════════════════════════════════════════════════════
// 판정 — 서버(src/services/mind.js judge)와 같은 규칙
// ══════════════════════════════════════════════════════════════

function judge(questions, answers) {
  const votes = [0, 0, 0, 0];
  const gain = new Array(COMMON.axes.length).fill(0);

  questions.forEach((q, i) => {
    const pick = q.opts[answers[i]];
    if (!pick) return;
    votes[pick.ty] += 1;
    // 축은 「드러난 횟수」 — 부호와 무관하게 +1 (REQ-62 ⑬ · D5)
    const [ax] = pick.ax ?? [];
    if (Number.isInteger(ax)) gain[ax] += 1;
  });

  let best = 0;
  for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
  return { typeIdx: best, gain };
}

/**
 * 그날의 실험 — 요일로 정한다. 같은 날이면 모두가 같은 실험을 한다(기획서 M-01).
 *
 * 같은 요일에 실험이 **여럿**이면 주 단위로 돌아가며 나온다. `find()` 로 첫 개만
 * 집으면 두 번째 실험은 **영원히 안 나온다** — 실험을 늘려도 이용자는 모른다.
 * 계절 항목(`months`)은 그달에만, 그달의 같은 요일 앞자리부터 나온다 — 규칙은 mind-pick.js.
 */
const expOfDow = (dow, day) => expOfDay(INDEX.experiments, dow, day);

// ══════════════════════════════════════════════════════════════
// 진입
// ══════════════════════════════════════════════════════════════

/**
 * 받는 동안 봉투를 잠근다 — 본문이 오기 전에 열면 빈 장면이 뜬다.
 * 실패하면 오류 + 「다시 시도」. **저장된 실험을 못 받았을 때 오늘 실험으로 대신하지 않는다**
 * (REQ-47 영향 점검 4) — 아침에 한 것과 다른 결과를 보여 주게 된다.
 */
function setLoading(on, errMsg = null) {
  $("#envelope").classList.toggle("is-loading", on);
  $("#envelope").setAttribute("aria-disabled", on || errMsg ? "true" : "false");
  $("#envOpenBtn").disabled = on || Boolean(errMsg);
  $("#mindError").hidden = !errMsg;
  if (errMsg) $("#mindErrorText").textContent = errMsg;
}

async function boot() {
  setLoading(true);
  try {
    let common, index;
    [state.st, common, index] = await Promise.all([
      apiGet("/api/mind/state"),
      COMMON ? { MIND_COMMON: COMMON } : import("./mind-common.js"),
      INDEX ? { MIND_INDEX: INDEX } : import("./mind-index.js"),
    ]);
    COMMON = common.MIND_COMMON;
    INDEX = index.MIND_INDEX;

    // 이미 마쳤으면 **저장된 exp_id** 가 오늘의 실험이다. 실험 풀이 바뀐 날(배포 직후 등)엔
    // 회전 결과가 아침에 한 실험과 다를 수 있어서, 봉투·결과 모두 저장된 쪽을 따른다 (REQ-43)
    const id =
      state.st.done && state.st.exp_id ? state.st.exp_id : expOfDow(state.st.dow, state.st.day).id;
    state.today = await loadExp(id);
    state.exp = state.today;
  } catch (err) {
    setLoading(false, err?.message ?? "오늘의 선택을 불러오지 못했어요.");
    toast(err?.message ?? "오늘의 선택을 불러오지 못했습니다.", "error");
    return;
  }
  setLoading(false);
  renderHome();

  // 이미 마쳤으면 결과 재열람으로 (봉투 = 결과 다시 보기)
  if (state.st.done && state.st.type_idx != null) {
    renderResult({ exp: state.exp, typeIdx: state.st.type_idx, replay: true });
  }
}

/** 「10.06 화」 — 원판 둘레·장면 태그 */
const shortDate = (d) => {
  const [, m, dd] = d.split("-");
  return `${m}.${dd} ${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]}`;
};

/** 「심리테스트 4문항 · +5P부터」 — 금액은 서버 상수(core_points). 지난 선택은 「적립 없음」 */
function metaLine(host, archive) {
  const n = state.exp?.q?.length ?? 4;
  clear(host).append(
    `심리테스트 ${n}문항`,
    el("span", { class: "sep" }, "·"),
    archive ? "적립 없음" : el("span", { class: "pt" }, `+${state.st.core_points}P부터`),
  );
}

function renderHome() {
  const st = state.st;
  const axSum = st.axes.reduce((a, n) => a + Math.max(0, n), 0);
  const first = !st.done && st.collection.length === 0 && axSum === 0;

  $("#introStrip").hidden = !first;
  $("#discRim").textContent = `${shortDate(st.day)} · 오늘의 장면`;
  $("#envGlyph").textContent = state.exp.glyph;
  $("#envTitle").textContent = state.exp.title;
  $("#envelope").classList.toggle("is-done", st.done);
  $("#envelope").setAttribute("aria-label", st.done ? "오늘 결과 다시 보기" : "오늘의 장면 열기");
  if (st.done) clear($("#envSub")).append("오늘의 선택을 마쳤어요");
  else metaLine($("#envSub"), false);
  $("#envSubNote").hidden = !first;
  // 재방문 요약 — 「칸」 대신 점·장 (v4)
  $("#homeSummary").hidden = first;
  $("#homeSummary").textContent = `이달의 마음 점 ${axSum}개 · 유형 카드 ${st.collection.length}장`;
  $("#envOpenBtn").textContent = st.done ? "결과 다시 보기" : "장면 열기";

  showScreen("home");
}

function openEnvelope() {
  if (!state.today || $("#envelope").classList.contains("is-loading")) return; // 받는 중·실패 — 열지 않는다
  state.archiveDay = null;
  state.exp = state.today;
  if (state.st.done) {
    showScreen("result");
    return;
  }
  openScene(state.exp);
}

/** 장면 화면 — 오늘의 선택과 지난 선택이 같이 쓴다 (v5 H1: data-screen="scene" 유지) */
function openScene(exp) {
  const archive = Boolean(state.archiveDay);
  $("#sceneGlyph").textContent = exp.glyph;
  $("#sceneTitle").textContent = exp.title;
  $("#sceneText").textContent = exp.scene;
  $("#sceneTag").textContent = archive ? `${dayLabel(state.archiveDay)}의 지난 선택` : `${shortDate(state.st.day)} · 오늘의 장면`;
  metaLine($("#sceneMeta"), archive);
  state.answers = [];
  showScreen("scene");
}

/** 문항 중 나가기 확인 — 공용 소개 시트(.pairsheet) 모양을 빌린다 */
function confirmQuit() {
  if (document.querySelector(".pairsheet")) return;
  const close = () => sheet.remove();
  const sheet = el(
    "div",
    { class: "pairsheet", role: "dialog", "aria-modal": "true", "aria-label": "나가기 확인", onclick: (e) => e.target === sheet && close() },
    el(
      "div",
      { class: "pairsheet__box" },
      el("p", { class: "pairsheet__title" }, "지금 나가면 고른 답이 사라져요"),
      el(
        "div",
        { class: "pairsheet__btns" },
        el("button", { class: "pairsheet__go", type: "button", onclick: close }, "계속하기"),
        el("button", { class: "pairsheet__later", type: "button", onclick: () => (location.href = "/today/") }, "나가기"),
      ),
    ),
  );
  document.body.append(sheet);
}

// ══════════════════════════════════════════════════════════════
// 문항 — 5지선다 4문항
// ══════════════════════════════════════════════════════════════

function renderQuestion(step) {
  state.step = step;
  const q = state.exp.q[step];
  const total = state.exp.q.length;

  setDial(step + 1);
  $("#qStep").textContent = `${step + 1}/${total}`;
  $("#qStepText").textContent = `${total}문항 중 ${step + 1}번째`;
  $("#qScene").textContent = `${state.exp.glyph} ${state.exp.title}`;
  $("#qText").textContent = q.t;
  $("#qPrev").hidden = step === 0; // 「이전」은 2번째 문항부터
  $("#qPrev").disabled = false;

  const host = clear($("#opts"));
  q.opts.forEach((o, i) => {
    const node = el(
      "button",
      { class: `pill ${state.answers[step] === i ? "is-sel" : ""}`, type: "button", role: "listitem" },
      o.t,
      el("i", { class: "pill__mark", "aria-hidden": "true" }),
    );
    node.addEventListener("click", () => pick(i));
    host.append(node);
  });

  // 뒤로 키가 화면 밖으로 나가지 않게 문항 단계를 한 번 쌓는다 → popstate 에서 확인 시트
  if (!state.qHistory) {
    history.pushState({ mind: "q" }, "");
    state.qHistory = true;
  }
  showScreen("quiz");
}

/** 원판 진행 눈금 — 사분원 n칸 켜기 (#qbarFill 대체) */
function setDial(n) {
  [...$("#qDial").querySelectorAll("path")].forEach((p, i) => p.classList.toggle("is-on", i < n));
}

async function pick(optIdx) {
  if (state.busy) return;
  state.answers[state.step] = optIdx;

  const nodes = [...$("#opts").children];
  nodes.forEach((n, i) => {
    n.classList.toggle("is-sel", i === optIdx);
    n.disabled = true;
  });
  navigator.vibrate?.(10);

  state.waiting = true;
  $("#qPrev").disabled = true;
  await new Promise((r) => setTimeout(r, 220));
  state.waiting = false;

  if (state.step + 1 < state.exp.q.length) {
    renderQuestion(state.step + 1);
    return;
  }
  await sendResult();
}

async function sendResult() {
  state.busy = true;
  const exp = state.exp;

  // 화면도 계산해 두지만 **표시에 쓰는 값은 서버가 준 것**이다
  const local = judge(exp.q, state.answers);

  const archiveDay = state.archiveDay;
  let res;
  try {
    res = await apiPost("/api/mind/submit", {
      exp_id: exp.id,
      // 채점표를 함께 보낸다 — 콘텐츠 DB 가 화면에만 있기 때문이다.
      // 무엇을 막고 무엇을 못 막는지는 서버 파일 주석에 적어 두었다.
      questions: exp.q.map((q) => ({ opts: q.opts.map((o) => ({ ty: o.ty, ax: o.ax })) })),
      answers: state.answers,
      // 지난 선택이면 그날을 붙인다 — 서버가 「그날 회전 = 이 실험 · 열어 둠 · 6일 안」을 본다
      ...(archiveDay ? { archive_day: archiveDay } : {}),
    });
  } catch (err) {
    state.busy = false;
    if (archiveDay) {
      toast(err.message ?? "지난 선택을 저장하지 못했습니다.", "error");
      state.st = await apiGet("/api/mind/state");
      state.archiveDay = null;
      state.exp = state.today;
      renderResult({ exp: state.today, typeIdx: state.st.type_idx, replay: true });
      return;
    }
    if (err instanceof ApiFail && err.code === "ALREADY_DONE") {
      state.st = await apiGet("/api/mind/state");
      renderResult({ exp, typeIdx: state.st.type_idx, replay: true });
      return;
    }
    if (err instanceof ApiFail && err.code === "DAY_CHANGED") {
      await reopenExpected(err.data);
      return;
    }
    toast(err.message ?? "결과를 저장하지 못했습니다.", "error");
    renderQuestion(state.step); // 고른 답은 그대로 — 마지막 문항을 다시 눌러 보낼 수 있게
    return;
  }

  if (res.type_idx !== local.typeIdx) {
    // 규칙이 어긋났다는 뜻이다. 서버 값을 따르고 조용히 넘어가지 않는다.
    console.warn("[mind] 유형 계산 불일치 — 서버", res.type_idx, "화면", local.typeIdx);
  }

  state.st = await apiGet("/api/mind/state");
  state.lastGain = res.axes_gain ?? null;
  history.replaceState(null, "");
  state.qHistory = false;
  renderResult({ exp, typeIdx: res.type_idx, res, archiveDay });
  state.busy = false;
}

/**
 * 제출한 장면이 오늘 회전이 아니었다 (REQ-62 ⑨) — 자정을 넘겼거나 배포로 회전이 바뀌었다.
 * 메모리의 목록으로 다시 고르지 않고 **서버가 준 id** 로 연다(답은 버린다). 같은 세션에서
 * 두 번째면 새로고침 — 옛 목록·옛 화면이 남아 반복되는 것을 끊는다.
 */
async function reopenExpected(data) {
  if (state.dayChanged || !data?.expected_exp_id) {
    location.reload();
    return;
  }
  state.dayChanged = true;
  const sameDay = data.day === state.st.day;
  toast(
    sameDay
      ? "오늘의 선택이 바뀌었어요. 새 장면으로 다시 열어 드릴게요."
      : "날이 바뀌었어요. 오늘의 선택을 새로 보여 드릴게요.",
    "good",
  );
  try {
    if (!sameDay) state.st = await apiGet("/api/mind/state");
    state.today = await loadExp(data.expected_exp_id);
  } catch {
    location.reload();
    return;
  }
  state.exp = state.today;
  renderHome();
  openScene(state.exp);
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function renderResult({ exp, typeIdx, res, replay, archiveDay }) {
  const type = exp.types[typeIdx];
  const isArchive = Boolean(archiveDay);
  $("#medalKicker").textContent = isArchive ? `${dayLabel(archiveDay)}의 나는` : "오늘의 나는";
  $("#typeGlyph").textContent = type.g;
  $("#typeName").textContent = type.n;
  $("#typeDesc").textContent = type.d;
  // 유형별 대응 팁 — 해설 바로 아래 한 줄(작은 글씨, 접기 없음 · REQ-47)
  const meet = exp.typeMeet?.[typeIdx];
  $("#typeMeet").hidden = !meet;
  if (meet) clear($("#typeMeet")).append(el("span", { class: "meet__label" }, "나랑 지낼 땐 ·"), ` ${meet}`);

  renderGain({ res, replay, archiveDay });

  // 지난 선택 결과 — 오늘의 적립·분포·페어·다음 안내 바와 무관하므로 그 자리들을 감추고 「오늘 결과 보기」
  for (const id of ["#statsHead", "#statsBox", "#nextBlock", "#pairBox"]) $(id).hidden = isArchive;
  $("#todayResultBtn").hidden = !isArchive;

  // D6 — 셋 다 하기 전 페어 = 테두리형 보조(다음 안내 바가 주 행동), 셋 다 한 뒤 = 채워진 주 버튼
  const s = state.st.suite ?? {};
  const allDone = Boolean(s.tarot?.done && s.saju?.done && s.mind?.done);
  $("#pairCta").className = `${allDone ? "m-btn-main" : "m-btn-line"} pair__btn`;
  $("#moreHint").hidden = isArchive || !allDone;

  // 이달의 마음 줄 — 축 문장(axisEcho) 대신 고정 문구 (v2 · REQ-62 ⑩)
  $("#mapLinkSub").textContent = isArchive
    ? "이날 고른 답 4개가 이달의 마음에 더해졌어요"
    : "오늘 고른 답 4개가 이달의 마음에 더해졌어요";
  $("#collLinkGlyph").textContent = type.g;
  $("#collLinkTitle").textContent = `유형 카드 모음 · ${state.st.collection.length}장`;

  renderArchiveBox();

  // 서비스 사이 이동 = 공용 다음 안내 바 (REQ-63 · 크로스 칩 대체). 지난 선택 결과에는 두지 않는다.
  // 셋 다 한 뒤에는 「너를 맞혀볼게」 가 이 화면의 주 버튼이라 고정 바를 띄우지 않는다(NEXTBAR v4)
  if (isArchive) hideNextStep();
  else {
    const ctx = { svc: "mind", suite: s, justCompleted: (res?.triple_gained ?? 0) > 0, hasPrimaryAction: allDone };
    renderNextStep(ctx);
    renderStatsAd();
    checkPairsLeft(ctx);
  }

  $("#resNote").textContent = state.st.map_complete
    ? "이달의 마음 여덟 방향을 다 채웠어요"
    : "내일은 다른 장면이 와요";

  showScreen("result");
  armScreen("result");
}

/**
 * 받은 것 — 합계 크게 + 내역 한 줄. 금액은 서버 `gain_detail` 그대로(상수 없음, D1·v4).
 * 재열람은 서버 `today_points`(오늘 선택 몫), 지난 선택은 「적립은 없어요」.
 */
const GAIN_LABEL = { daily: "오늘", new: "새 유형 카드", bonus: "여덟 방향 완성", triple: "셋 다" };
function renderGain({ res, replay, archiveDay }) {
  let sum;
  let parts = "";
  if (archiveDay) {
    sum = `${dayLabel(archiveDay)}의 지난 선택`;
    parts = res?.is_new ? "적립은 없어요 · 새 유형 카드가 모였어요" : "적립은 없어요";
  } else if (replay || !res) {
    sum = "오늘의 선택을 마쳤어요";
    const p = state.st.today_points ?? 0;
    parts = p > 0 ? `오늘 선택으로 받은 포인트 +${p}P` : "";
  } else {
    const detail = res.gain_detail ?? [];
    const total = detail.length ? detail.reduce((a, d) => a + d.p, 0) : res.gained;
    sum = `+${total}P 받았어요`;
    const items = detail.map((d) => `${GAIN_LABEL[d.kind] ?? ""} ${d.p}`.trim());
    parts = items.length > 1 ? items.join(" + ") : "";
    if (!res.is_new) parts = parts ? `${parts} · 이미 모은 유형이에요` : "이미 모은 유형이에요";
  }
  $("#resGainSum").textContent = sum;
  $("#resGainParts").textContent = parts;
}

/** 오늘 보낼 수 있는 링크가 없으면 버튼 대신 한 줄 (v3 · /api/mind/pairs) */
async function checkPairsLeft(ctx) {
  $("#pairCta").hidden = false;
  $("#pairDone").hidden = true;
  try {
    const p = await apiGet("/api/mind/pairs");
    if ((p.remaining_today ?? 1) > 0) return;
    $("#pairCta").hidden = true;
    $("#pairDone").hidden = false;
    $("#pairDone").textContent = `오늘 링크 ${p.max_per_day}개를 다 보냈어요`;
    $("#moreHint").hidden = true;
    // 채워진 주 버튼이 없어졌다 — 셋 다 한 날이면 고정 바를 다시 띄운다
    if (ctx.hasPrimaryAction) renderNextStep({ ...ctx, hasPrimaryAction: false });
  } catch {
    /* 못 받아도 버튼은 그대로 — /pair/ 가 상한을 다시 본다 */
  }
}

function armScreen(name, ms = ARM_DELAY_MS) {
  const screen = document.querySelector(`[data-screen="${name}"]`);
  if (!screen) return;
  screen.style.pointerEvents = "none";
  setTimeout(() => {
    screen.style.pointerEvents = "";
  }, ms);
}

// ══════════════════════════════════════════════════════════════
// 광고
// ══════════════════════════════════════════════════════════════

/**
 * 「지난 선택 열기」 (M-04) — 광고 1회 = 직전 6일 중 안 한 날 하나(가장 최근 날)를 연다.
 * 적립은 없다(코어 1회 원칙). 상한을 다 썼거나 **열 날이 없으면 카드 자체를 숨긴다** —
 * 광고를 보고 아무것도 없는 일을 만들지 않는다.
 */
function renderArchiveBox() {
  const host = $("#adbarArchive");
  clearRewardCard(host);
  const canAd =
    (state.st.ad_archive_used ?? 0) < (state.st.ad_archive_max ?? 2) && (state.st.archive?.available ?? 0) > 0;
  if (canAd) {
    renderRewardCard(host, {
      icon: "🗄️",
      title: "광고 보고 지난 선택 열기",
      note: "오늘 결과와 적립은 그대로예요",
      cta: "열기",
      onClick: async () => {
        const r = await watchAdForReward("MIND_ARCHIVE");
        if (!r) return;
        state.st = await apiGet("/api/mind/state");
        const d = r.reward?.opened?.day ?? r.opened?.day;
        toast(d ? `${dayLabel(d)}의 선택을 열었어요` : "지난 선택을 열었어요", "good");
        // 돌아가는 곳 = 이 결과 화면의 목록(홈이 아님) — 새로 연 날로 내려 준다 (v3)
        renderArchiveBox();
        $("#archiveList").scrollIntoView({ block: "center" });
      },
    });
  }
  const opened = renderArchiveList();
  // 열 날도 열어 둔 것도 없으면 덩이째 숨긴다
  $("#archiveHead").hidden = $("#archiveBox").hidden = !canAd && opened === 0;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (d) => {
  const [, m, dd] = d.split("-").map(Number);
  return `${m}월 ${dd}일(${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
};

/** 열어 두고 아직 안 한 지난 선택 — 누르면 그날 선택을 받아 장면으로. 줄 수를 돌려준다 */
function renderArchiveList() {
  const host = clear($("#archiveList"));
  const opened = state.st.archive?.opened ?? [];
  host.hidden = opened.length === 0;
  for (const o of opened) {
    const meta = indexOf(o.exp_id);
    // 직전 6일 창 — 그날로부터 6일째까지 할 수 있다
    const [y, m, d] = o.day.split("-").map(Number);
    const until = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10);
    const b = el(
      "button",
      { class: "m-btn-line", type: "button" },
      `🗄️ ${dayLabel(o.day)} · ${meta?.title ?? "지난 선택"}`,
      el("small", {}, `${dayLabel(until)}까지 할 수 있어요`),
    );
    b.addEventListener("click", () => openArchive(o));
    host.append(b);
  }
  return opened.length;
}

async function openArchive(o) {
  try {
    const exp = await loadExp(o.exp_id);
    state.archiveDay = o.day;
    state.exp = exp;
    openScene(exp);
  } catch (err) {
    toast(err?.message ?? "지난 선택을 불러오지 못했어요. 다시 눌러 주세요.", "error");
  }
}

function renderStatsAd() {
  const host = $("#adbarStats");
  clearRewardCard(host);
  if (state.st.ad_stats_seen) {
    loadStats();
    return;
  }
  // 분포가 아직 닫혀 있으면 광고 카드를 내지 않는다 — 봐도 받을 것이 없다 (REQ-62 ⑭ · D2)
  if (!state.st.dist_open) {
    setDist(...DIST_SOON);
    return;
  }
  $("#resDist").hidden = true; // 공개 뒤 · 광고 전 = 카드 하나만
  renderRewardCard(host, {
    icon: "🗺️",
    title: "오늘 사람들의 유형 분포 보기",
    note: "봐도 오늘 결과와 적립은 그대로예요",
    cta: "보기",
    onClick: async () => {
      const r = await watchAdForReward("MIND_STATS");
      if (!r) return;
      state.st = await apiGet("/api/mind/state");
      renderStatsAd();
    },
  });
}

/** 분포가 아직 닫혀 있을 때 — 인원 수를 적지 않는다 (REQ-62 ⑭) */
const DIST_SOON = ["오늘 분포는 사람이 더 모이면 열려요", "그때 오늘 사람들의 유형 분포를 볼 수 있어요"];

function setDist(main, sub = "") {
  $("#resDist").hidden = false;
  $("#resDistMain").textContent = main;
  $("#resDistSub").textContent = sub;
}

async function loadStats() {
  try {
    const s = await apiGet("/api/mind/stats");
    if (!s.open) {
      setDist(...DIST_SOON);
      return;
    }
    // 최다 유형 한 줄은 빼고 「나와 같은 유형」만 — 그날 답이 하나로 공유되는 것을 막는다 (v4 · E1)
    const mine = s.items.find((i) => i.key === s.mine);
    setDist(mine ? `나와 같은 유형 ${mine.pct}%` : "오늘 사람들의 유형 분포가 열렸어요");
  } catch {
    /* 광고 전이면 잠겨 있는 것이 정상이다 */
  }
}

// ══════════════════════════════════════════════════════════════
// 지도 · 도감
// ══════════════════════════════════════════════════════════════

/**
 * 이달의 마음 — 8방위 나침반 (m6). 살마다 점 5개(안→밖), 켜진 점 = 이달 그 마음이 드러난 횟수.
 * 점수 다각형·선 잇기는 쓰지 않는다(강도로 읽히지 않게). 축 순서 = COMMON.axes, 위에서 시계 방향.
 * 「오늘 생긴 점」 고리는 방금 제출한 결과에서만(재열람엔 증분이 없다 — 열 추가 없음, REQ-62 ⑩).
 */
const DOT_R = [28, 46, 64, 82, 100];
function compassSvg(axes, goal, gain) {
  const f = (n) => n.toFixed(1);
  const parts = ['<circle r="172" fill="#FFF8E7"/><circle r="169" fill="none" stroke="#0E2B28" stroke-opacity=".12"/>',
    '<circle r="112" fill="none" stroke="#0E2B28" stroke-opacity=".10" stroke-dasharray="2 4"/>'];
  const said = [];
  axes.forEach((raw, i) => {
    const n = Math.max(0, raw);
    const a = (i * Math.PI) / 4;
    const [sx, sy] = [Math.sin(a), -Math.cos(a)];
    const lit = Math.min(n, DOT_R.length);
    const today = Math.min(gain?.[i] ?? 0, lit);
    parts.push(`<line x1="${f(sx * 14)}" y1="${f(sy * 14)}" x2="${f(sx * 108)}" y2="${f(sy * 108)}" stroke="#0E2B28" stroke-opacity=".16" stroke-width="1.2"/>`);
    if (i % 2 === 0) parts.push(`<line x1="${f(sx * 160)}" y1="${f(sy * 160)}" x2="${f(sx * 168)}" y2="${f(sy * 168)}" stroke="#E2572B" stroke-width="2.2" stroke-linecap="round"/>`);
    DOT_R.forEach((r, k) => {
      const [x, y] = [f(sx * r), f(sy * r)];
      parts.push(k < lit
        ? `<circle cx="${x}" cy="${y}" r="7.5" fill="#FFD24A" stroke="#E2572B" stroke-width="1.6"/>`
        : `<circle cx="${x}" cy="${y}" r="6.5" fill="#FFF8E7" stroke="#4A6461" stroke-opacity=".55" stroke-width="1.4"/>`);
      if (k >= lit - today && k < lit) parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#E2572B" stroke-width="1.6" stroke-dasharray="3 2.4"/>`);
    });
    // 이름 — 좌우(동·서) 살은 자리가 좁아 두 줄로
    const name = axisName(i);
    const lines = i % 4 === 2 && name.includes(" ") ? [name.slice(0, name.lastIndexOf(" ")), name.slice(name.lastIndexOf(" ") + 1)] : [name];
    const r = i % 4 === 2 ? 138 : i === 0 ? 142 : i === 4 ? 134 : 132;
    const [lx, ly] = [sx * r, sy * r - (lines.length - 1) * 7.5];
    const count = n >= goal ? `${n}번 · 꽉 참` : `${n}번`;
    lines.forEach((t, k) => parts.push(`<text x="${f(lx)}" y="${f(ly + k * 15)}" text-anchor="middle" font-family="Noto Sans KR" font-size="13" font-weight="700" fill="#0E2B28">${t}</text>`));
    parts.push(`<text x="${f(lx)}" y="${f(ly + lines.length * 15)}" text-anchor="middle" font-family="Noto Sans KR" font-size="11.5" font-weight="700" fill="#4A6461">${count}</text>`);
    said.push(`${name} ${count}`);
  });
  parts.push('<circle r="10" fill="#2A8F80"/><circle r="4" fill="#FFD24A" stroke="#E2572B" stroke-width="1.2"/>');
  const ringed = gain ? gain.reduce((a, g) => a + g, 0) : 0;
  const label = `이달의 마음 — ${said.join(", ")}${ringed ? `. 오늘 생긴 점 ${ringed}개` : ""}`;
  return `<svg class="compass" viewBox="-176 -176 352 352" width="352" height="352" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

function showMap() {
  const st = state.st;
  const month = Number(st.month.slice(5, 7));
  const gain = state.archiveDay ? null : state.lastGain;
  $("#mapBars").innerHTML = compassSvg(st.axes, st.axes_goal, gain);
  $("#lgToday").hidden = !gain;
  $("#mapTitle").textContent = `이달의 마음 · ${month}월`;
  $("#mapGoalLine").textContent = `한 방향에 점 ${st.axes_goal}개면 꽉 차요.`;
  const next = `${(month % 12) + 1}월 1일에 새로 시작해요`;
  clear($("#mapNote")).append(
    el(
      "span",
      {},
      st.map_complete ? el("b", {}, "여덟 방향을 다 채웠어요") : el("b", {}, `여덟 방향이 다 차면 +${st.portrait_points}P`),
      ` · ${next}`,
    ),
  );
  showScreen("map");
}

/**
 * 유형 카드 모음 — **만난 장면(1장 이상)만** 행으로(REQ-43). 분모·「못 만난 장면 n개」는 쓰지 않는다(v2).
 * 행 순서 = 장면 목록(INDEX) 순서. 날짜는 없다(collection 에 날짜가 없음 — v3).
 */
function showCollection() {
  const have = new Set(state.st.collection ?? []);
  const host = clear($("#collRows"));

  for (const exp of INDEX.experiments) {
    if (!exp.types.some((_, i) => have.has(`${exp.id}:${i}`))) continue;
    const slots = el("span", { class: "crow__slots" });
    exp.types.forEach((t, i) => {
      const got = have.has(`${exp.id}:${i}`);
      const slot = el(
        got ? "i" : "button",
        got
          ? { class: "slot is-met", title: t.n, "aria-label": t.n }
          : { class: "slot", type: "button", "aria-label": "다르게 고르면 나오는 유형" },
        got ? t.g : "",
      );
      if (!got) slot.addEventListener("click", () => toast("이 장면에서 다르게 고르면 나오는 유형이에요", "", 1800));
      slots.append(slot);
    });
    host.append(
      el(
        "li",
        { class: "crow" },
        el("b", { class: "crow__title" }, el("i", { class: "crow__g", "aria-hidden": "true" }, exp.glyph), exp.title),
        slots,
      ),
    );
  }
  if (!host.children.length) host.append(el("li", { class: "crow" }, "아직 모은 유형 카드가 없어요"));

  $("#collTitle").textContent = `유형 카드 모음 · ${have.size}장`;
  showScreen("coll");
}
