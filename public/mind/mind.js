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
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { expOfDay } from "./mind-pick.js";
import { renderSiteNav } from "../shared/sitenav.js";

const ARM_DELAY_MS = 400;
/** 분포가 아직 닫혀 있을 때의 한 줄 — 인원 수를 적지 않는다 (REQ-62 ⑭) */
const DIST_SOON = "사람이 더 모이면 열려요";

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
renderHeader($("#header"), { icon: "🔬", title: "오늘의 선택", back: "/today/" });

$("#envelope").addEventListener("click", openEnvelope);
$("#envelope").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEnvelope();
  }
});
$("#sceneStartBtn").addEventListener("click", () => renderQuestion(0));
$("#mapBtn").addEventListener("click", () => showMap("home"));
$("#mapBackBtn").addEventListener("click", () => showScreen(state.st?.done ? "result" : "home"));
$("#collBtn").addEventListener("click", showCollection);
$("#collBackBtn").addEventListener("click", () => showScreen(state.st?.done ? "result" : "home"));
$("#mindRetryBtn").addEventListener("click", () => boot());
// 결과에서 홈으로 — 지난 선택 중이었으면 오늘의 선택 흐름으로 되돌린다
$("#archiveBackBtn").addEventListener("click", () => {
  state.archiveDay = null;
  state.exp = state.today;
  renderHome();
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

function renderHome() {
  const st = state.st;
  const filled = st.axes.filter((n) => n >= st.axes_goal).length;

  $("#envGlyph").textContent = st.done ? state.exp.glyph : "✉️";
  $("#envTitle").textContent = st.done ? "오늘의 선택 완료" : state.exp.title;
  $("#envSub").textContent = st.done ? "결과를 다시 볼 수 있어요" : "봉투를 열어 보세요";
  $("#envelope").classList.toggle("is-done", st.done);

  $("#mapValue").textContent = `${filled} / ${COMMON.axes.length}축`;
  $("#collValue").textContent = `${st.collection.length}칸`;
  setHeaderBadge(st.done ? "오늘 완료" : "오늘의 선택");

  renderArchiveList();
  renderArchiveAd();
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

/** 장면 화면 — 오늘의 선택과 지난 선택이 같이 쓴다 */
function openScene(exp) {
  $("#sceneGlyph").textContent = exp.glyph;
  $("#sceneTitle").textContent = exp.title;
  $("#sceneText").textContent = exp.scene;
  state.answers = [];
  showScreen("scene");
}

// ══════════════════════════════════════════════════════════════
// 문항 — 5지선다 4문항
// ══════════════════════════════════════════════════════════════

function renderQuestion(step) {
  state.step = step;
  const q = state.exp.q[step];

  $("#qbarFill").style.width = `${((step) / state.exp.q.length) * 100}%`;
  $("#qStep").textContent = `${step + 1} / ${state.exp.q.length}`;
  $("#qText").textContent = q.t;

  const host = clear($("#opts"));
  q.opts.forEach((o, i) => {
    const node = el("button", { class: "opt", type: "button" }, o.t);
    node.addEventListener("click", () => pick(i));
    host.append(node);
  });

  showScreen("quiz");
}

async function pick(optIdx) {
  if (state.busy) return;
  state.answers[state.step] = optIdx;

  const nodes = [...$("#opts").children];
  nodes.forEach((n, i) => {
    n.classList.toggle("is-pick", i === optIdx);
    n.disabled = true;
  });
  navigator.vibrate?.(10);

  await new Promise((r) => setTimeout(r, 220));

  if (state.step + 1 < state.exp.q.length) {
    renderQuestion(state.step + 1);
    return;
  }
  $("#qbarFill").style.width = "100%";
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
      renderHome();
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
    return;
  }

  if (res.type_idx !== local.typeIdx) {
    // 규칙이 어긋났다는 뜻이다. 서버 값을 따르고 조용히 넘어가지 않는다.
    console.warn("[mind] 유형 계산 불일치 — 서버", res.type_idx, "화면", local.typeIdx);
  }

  state.st = await apiGet("/api/mind/state");
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
  $("#typeGlyph").textContent = type.g;
  $("#typeName").textContent = type.n;
  $("#typeDesc").textContent = type.d;
  // 유형별 대응 팁 — 해설 바로 아래 한 줄(작은 글씨, 접기 없음 · REQ-47)
  const meet = exp.typeMeet?.[typeIdx];
  $("#typeMeet").hidden = !meet;
  if (meet) $("#typeMeet").textContent = `이런 사람과 지낼 때 · ${meet}`;

  // 지난 선택 결과 — 오늘의 적립·전국 분포·페어·크로스와 무관하므로 그 자리들을 감춘다
  const isArchive = Boolean(archiveDay);
  for (const id of ["#adbarStats", "#crossChips", "#pairCta", "#resDist"]) $(id).hidden = isArchive;
  // 「← 처음으로」는 늘 보인다 — 홈에 지난 선택 열기·열어 둔 목록이 있는데, 결과에서 갈 길이
  // 없으면 오늘을 마친 뒤(광고를 쓰기 가장 좋은 때) 거기에 닿을 수 없다 (REQ-47)
  $("#archiveBackBtn").hidden = false;

  // 축 에코 — 이번에 가장 많이 오른 축의 문장. 지도가 또렷해질수록 다른 말이 나온다.
  // 재열람에는 이번 증분이 없다 — 늘 0번 축 문장이 나오던 것을 숨긴다 (REQ-62 ⑩ 최종 정정 1)
  const gain = res?.axes_gain ?? [];
  $("#axisEcho").hidden = gain.length === 0;
  let topAxis = 0;
  for (let i = 1; i < gain.length; i++) if ((gain[i] ?? 0) > (gain[topAxis] ?? 0)) topAxis = i;
  const axVal = state.st.axes[topAxis] ?? 0;
  const echo = COMMON.axisEcho[topAxis] ?? [];
  $("#axisEcho").textContent = axVal >= state.st.axes_goal ? echo[1] ?? "" : echo[0] ?? "";

  renderAxisBars($("#axisBars"), state.st.axes, state.st.axes_goal);

  const [, am, ad] = (archiveDay ?? "").split("-").map(Number);
  $("#resGain").textContent = isArchive
    ? `${am}월 ${ad}일의 지난 선택 · 적립은 없어요 · 도감 ${state.st.collection.length}칸${res?.is_new ? " (새 칸!)" : ""}`
    : replay
      ? `오늘의 선택을 마쳤어요 · 도감 ${state.st.collection.length}칸`
      : `+${res.gained}P 적립 · 도감 ${state.st.collection.length}칸${res.is_new ? " (새 칸!)" : ""}` +
        (res.portrait_new ? " · 마음 초상 완성!" : "");

  if (!isArchive) {
    renderCrossChips();
    renderStatsAd();
  }

  $("#resNote").textContent = state.st.map_complete
    ? "이달의 마음 지도를 완성했어요"
    : "내일 새 선택이 도착합니다";

  showScreen("result");
  armScreen("result");
}

function renderAxisBars(host, axes, goal) {
  clear(host);
  COMMON.axes.forEach((a, i) => {
    const n = axes[i] ?? 0;
    const pct = Math.min(100, (n / goal) * 100);
    host.append(
      el(
        "div",
        { class: `axisrow ${n >= goal ? "is-full" : ""}` },
        el("span", { class: "axisrow__name" }, a.name),
        el("span", { class: "axisrow__track" }, el("i", { class: "axisrow__fill", style: `width:${pct}%` })),
        el("span", { class: "axisrow__n" }, `${n}/${goal}`),
      ),
    );
  });
}

function renderCrossChips() {
  const host = clear($("#crossChips"));
  const s = state.st.suite ?? {};
  const chips = [
    { key: "tarot", href: "/tarot/", icon: "🔮", name: "오늘의 타로" },
    { key: "saju", href: "/saju/", icon: "🌤️", name: "오늘의 사주" },
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
function renderArchiveAd() {
  const host = $("#adbarArchive");
  clearRewardCard(host);
  if ((state.st.ad_archive_used ?? 0) >= (state.st.ad_archive_max ?? 2)) return;
  if ((state.st.archive?.available ?? 0) <= 0) return;

  renderRewardCard(host, {
    icon: "🗄️",
    title: "광고 보고 지난 선택 열기",
    desc: "더 열어도 오늘의 카드와 적립은 그대로예요",
    cta: "열기",
    onClick: async () => {
      const r = await watchAdForReward("MIND_ARCHIVE");
      if (!r) return;
      state.st = await apiGet("/api/mind/state");
      const d = r.reward?.opened?.day ?? r.opened?.day;
      toast(d ? `${dayLabel(d)}의 선택을 열었어요` : "지난 선택을 열었어요", "good");
      renderHome();
    },
  });
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (d) => {
  const [, m, dd] = d.split("-").map(Number);
  return `${m}월 ${dd}일(${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
};

/** 열어 두고 아직 안 한 지난 선택 — 누르면 그날 선택을 받아 장면으로 */
function renderArchiveList() {
  const host = clear($("#archiveList"));
  const opened = state.st.archive?.opened ?? [];
  host.hidden = opened.length === 0;
  for (const o of opened) {
    const meta = indexOf(o.exp_id);
    const b = el("button", { class: "btn", type: "button" }, `🗄️ ${dayLabel(o.day)} · ${meta?.title ?? "지난 선택"}`);
    b.addEventListener("click", () => openArchive(o));
    host.append(b);
  }
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
    $("#resDist").textContent = DIST_SOON;
    return;
  }
  $("#resDist").textContent = "전국 분포는 광고를 보면 열려요";
  renderRewardCard(host, {
    icon: "🗺️",
    title: "광고 보고 전국 분포 보기",
    desc: "오늘 사람들의 유형",
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

async function loadStats() {
  try {
    const s = await apiGet("/api/mind/stats");
    const line = $("#resDist");
    if (!s.open) {
      line.textContent = DIST_SOON;
      return;
    }
    const mine = s.items.find((i) => i.key === s.mine);
    const label = (key) => {
      const [expId, ti] = String(key).split(":");
      const e = indexOf(expId); // 분포 이름은 도감용 목록에서 (REQ-47)
      return e?.types?.[Number(ti)]?.n ?? "—";
    };
    line.textContent = mine
      ? `나와 같은 유형 ${mine.pct}% · 가장 많은 유형은 ${label(s.items[0].key)}(${s.items[0].pct}%)`
      : `가장 많은 유형은 ${label(s.items[0].key)}(${s.items[0].pct}%)`;
  } catch {
    /* 광고 전이면 잠겨 있는 것이 정상이다 */
  }
}

// ══════════════════════════════════════════════════════════════
// 지도 · 도감
// ══════════════════════════════════════════════════════════════

function showMap() {
  renderAxisBars($("#mapBars"), state.st.axes, state.st.axes_goal);
  const filled = state.st.axes.filter((n) => n >= state.st.axes_goal).length;
  $("#mapTitle").textContent = `마음 지도 ${filled} / ${COMMON.axes.length}축`;
  $("#mapNote").textContent = state.st.map_complete
    ? "이달의 지도를 완성했어요 — 다음 달 1일에 새 지도가 열립니다"
    : `여덟 축을 ${state.st.axes_goal}까지 채우면 「마음 초상」이 열려요. 지도는 매달 1일 새로 시작합니다`;
  showScreen("map");
}

/**
 * 도감 — **만난 선택(1칸 이상)만** 행으로 보이고, 나머지는 맨 아래 한 줄로 센다 (REQ-43).
 * 선택이 많아(182개 · 728칸) 전부 그리면 대부분이 「?」라, 모은 것이 묻힌다. 목록은 도감용 목록(INDEX)에서 —
 * 실험 본문은 받지 않는다. 칸 수도 목록에 있는 키만 센다(서버도 같은 기준).
 */
function showCollection() {
  const have = new Set(state.st.collection ?? []);
  const host = clear($("#collRows"));
  let unmet = 0;

  for (const exp of INDEX.experiments) {
    if (!exp.types.some((_, i) => have.has(`${exp.id}:${i}`))) {
      unmet++;
      continue;
    }
    const cells = el("div", { class: "collrow__cells" });
    exp.types.forEach((t, i) => {
      const got = have.has(`${exp.id}:${i}`);
      cells.append(
        el(
          "div",
          { class: `collcell ${got ? "is-have" : "is-miss"}`, title: got ? t.n : "아직 나오지 않은 유형" },
          got ? t.g : "?",
        ),
      );
    });
    host.append(
      el("div", { class: "collrow" }, el("span", { class: "collrow__title" }, exp.title), cells),
    );
  }

  if (unmet > 0) host.append(el("p", { class: "footnote--dim collrow__rest" }, `아직 만나지 않은 선택 ${unmet}개`));

  const total = INDEX.experiments.length * 4;
  $("#collTitle").textContent = `도감 ${have.size} / ${total}`;
  showScreen("coll");
}
