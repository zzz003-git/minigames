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
 * ── 전국 추측은 아무 데도 보내지 않는다 ──────────────────────────────────
 * 결과 화면의 마지막 질문은 점수도 보상도 저장도 없다(기획서 M-01). 그래서 이 파일
 * 어디에도 그 답을 담아 보내는 요청이 없다 — 없는 것이 곧 구현이다.
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { MIND_DB } from "./mind-db.js";
import { renderSiteNav } from "../shared/sitenav.js";

const ARM_DELAY_MS = 400;

const state = {
  st: null, // 서버 상태
  exp: null, // 오늘의 실험
  answers: [],
  step: 0,
  busy: false,
};

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

boot();

// ══════════════════════════════════════════════════════════════
// 판정 — 서버(src/services/mind.js judge)와 같은 규칙
// ══════════════════════════════════════════════════════════════

function judge(questions, answers) {
  const votes = [0, 0, 0, 0];
  const gain = new Array(MIND_DB.axes.length).fill(0);

  questions.forEach((q, i) => {
    const pick = q.opts[answers[i]];
    if (!pick) return;
    votes[pick.ty] += 1;
    const [ax, d] = pick.ax ?? [];
    if (Number.isInteger(ax)) gain[ax] += d ?? 1;
  });

  let best = 0;
  for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
  return { typeIdx: best, gain };
}

/** 오늘의 실험 — 요일로 정한다. 같은 날이면 모두가 같은 실험을 한다(기획서 M-01) */
/**
 * 그날의 실험.
 *
 * 같은 요일에 실험이 **여럿**이면 주 단위로 돌아가며 나온다. `find()` 로 첫 개만
 * 집으면 두 번째 실험은 **영원히 안 나온다** — 실험을 늘려도 이용자는 모른다.
 * 실험이 늘어날수록 이 회전이 유일한 노출 경로다.
 *
 * 주 번호는 날짜에서 결정적으로 뽑는다. 무작위로 하면 새로고침마다 실험이 바뀌어
 * 「오늘의 실험」이라는 말이 거짓이 된다.
 */
function expOfDow(dow, day) {
  const pool = MIND_DB.experiments.filter((e) => e.dow === dow);
  if (!pool.length) return MIND_DB.experiments[0];
  if (pool.length === 1 || !day) return pool[0];

  // 1970-01-01 기준 주차. 요일이 같으므로 주차만 세면 회전이 고르게 돈다
  const week = Math.floor(Date.parse(`${day}T00:00:00Z`) / (7 * 24 * 60 * 60 * 1000));
  return pool[((week % pool.length) + pool.length) % pool.length];
}

// ══════════════════════════════════════════════════════════════
// 진입
// ══════════════════════════════════════════════════════════════

async function boot() {
  try {
    state.st = await apiGet("/api/mind/state");
  } catch (err) {
    toast(err.message ?? "오늘의 실험을 불러오지 못했습니다.", "error");
    return;
  }

  state.exp = expOfDow(state.st.dow, state.st.day);
  renderHome();

  // 이미 마쳤으면 결과 재열람으로 (봉투 = 결과 다시 보기)
  if (state.st.done && state.st.type_idx != null) {
    const exp = MIND_DB.experiments.find((e) => e.id === state.st.exp_id) ?? state.exp;
    renderResult({ exp, typeIdx: state.st.type_idx, replay: true });
  }
}

function renderHome() {
  const st = state.st;
  const filled = st.axes.filter((n) => n >= st.axes_goal).length;

  $("#envGlyph").textContent = st.done ? state.exp.glyph : "✉️";
  $("#envTitle").textContent = st.done ? "오늘의 실험 완료" : state.exp.title;
  $("#envSub").textContent = st.done ? "결과를 다시 볼 수 있어요" : "봉투를 열어 보세요";
  $("#envelope").classList.toggle("is-done", st.done);

  $("#mapValue").textContent = `${filled} / ${MIND_DB.axes.length}축`;
  $("#collValue").textContent = `${st.collection.length}칸`;
  setHeaderBadge(st.done ? "오늘 완료" : "오늘의 실험");

  renderArchiveAd();
  showScreen("home");
}

function openEnvelope() {
  if (state.st.done) {
    showScreen("result");
    return;
  }
  const exp = state.exp;
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

  let res;
  try {
    res = await apiPost("/api/mind/submit", {
      exp_id: exp.id,
      // 채점표를 함께 보낸다 — 콘텐츠 DB 가 화면에만 있기 때문이다.
      // 무엇을 막고 무엇을 못 막는지는 서버 파일 주석에 적어 두었다.
      questions: exp.q.map((q) => ({ opts: q.opts.map((o) => ({ ty: o.ty, ax: o.ax })) })),
      answers: state.answers,
    });
  } catch (err) {
    state.busy = false;
    if (err instanceof ApiFail && err.code === "ALREADY_DONE") {
      state.st = await apiGet("/api/mind/state");
      renderResult({ exp, typeIdx: state.st.type_idx, replay: true });
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
  renderResult({ exp, typeIdx: res.type_idx, res });
  state.busy = false;
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function renderResult({ exp, typeIdx, res, replay }) {
  const type = exp.types[typeIdx];
  $("#typeGlyph").textContent = type.g;
  $("#typeName").textContent = type.n;
  $("#typeDesc").textContent = type.d;

  // 축 에코 — 이번에 가장 많이 오른 축의 문장. 지도가 또렷해질수록 다른 말이 나온다
  const gain = res?.axes_gain ?? [];
  let topAxis = 0;
  for (let i = 1; i < gain.length; i++) if ((gain[i] ?? 0) > (gain[topAxis] ?? 0)) topAxis = i;
  const axVal = state.st.axes[topAxis] ?? 0;
  const echo = MIND_DB.axisEcho[topAxis] ?? [];
  $("#axisEcho").textContent = axVal >= state.st.axes_goal ? echo[1] ?? "" : echo[0] ?? "";

  renderAxisBars($("#axisBars"), state.st.axes, state.st.axes_goal);

  $("#resGain").textContent = replay
    ? `오늘의 실험을 마쳤어요 · 도감 ${state.st.collection.length}칸`
    : `+${res.gained}P 적립 · 도감 ${state.st.collection.length}칸${res.is_new ? " (새 칸!)" : ""}` +
      (res.portrait_new ? " · 마음 초상 완성!" : "");

  renderGuess(exp);
  renderCrossChips();
  renderStatsAd();

  $("#resNote").textContent = state.st.map_complete
    ? "이달의 마음 지도를 완성했어요"
    : "내일 새 실험이 도착합니다";

  showScreen("result");
  armScreen("result");
}

function renderAxisBars(host, axes, goal) {
  clear(host);
  MIND_DB.axes.forEach((a, i) => {
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

/**
 * 전국 추측 — **어디에도 보내지 않는다.**
 * 고르면 그 자리에서 한 줄 답할 뿐이고 요청도 저장도 없다(기획서 M-01 · 검증 항목).
 */
function renderGuess(exp) {
  const type = exp.types;
  $("#guessQ").textContent = "사람들이 가장 많이 나온 유형은 무엇일까요?";
  const host = clear($("#guessOpts"));

  type.forEach((t, i) => {
    const node = el("button", { class: "opt", type: "button" }, `${t.g} ${t.n}`);
    node.addEventListener("click", () => {
      [...host.children].forEach((n) => {
        n.disabled = true;
        n.classList.remove("is-pick");
      });
      node.classList.add("is-pick");
      toast("기록하지 않았어요 — 재미로만 물어봤습니다", "good", 1800);
      void i;
    });
    host.append(node);
  });
}

function renderCrossChips() {
  const host = clear($("#crossChips"));
  const s = state.st.suite ?? {};
  const chips = [
    { key: "tarot", href: "/tarot/", icon: "🔮", name: "오늘의 타로" },
    { key: "saju", href: "/saju/", icon: "🌤️", name: "오늘의 기운" },
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

/** 「지난 실험 열기」 — 적립은 없다(코어 1회 원칙). 상한을 다 쓰면 버튼을 숨긴다 */
function renderArchiveAd() {
  const host = $("#adbarArchive");
  clearRewardCard(host);
  if ((state.st.ad_archive_used ?? 0) >= (state.st.ad_archive_max ?? 2)) return;

  renderRewardCard(host, {
    icon: "🗄️",
    title: "광고 보고 지난 실험 열기",
    desc: "더 열어도 오늘의 카드와 적립은 그대로예요",
    cta: "열기",
    onClick: async () => {
      const r = await watchAdForReward("MIND_ARCHIVE");
      if (!r) return;
      state.st = await apiGet("/api/mind/state");
      toast(`직전 ${r.reward?.archive_days ?? 6}일 중 못 한 실험을 열었어요`, "good");
      renderHome();
    },
  });
}

function renderStatsAd() {
  const host = $("#adbarStats");
  clearRewardCard(host);
  if (state.st.ad_stats_seen) {
    loadStats();
    return;
  }
  renderRewardCard(host, {
    icon: "🗺️",
    title: "광고 보고 전국 분포 보기",
    desc: "오늘 사람들의 유형",
    cta: "보기",
    onClick: async () => {
      const r = await watchAdForReward("MIND_STATS");
      if (!r) return;
      state.st = await apiGet("/api/mind/state");
      loadStats();
    },
  });
}

async function loadStats() {
  try {
    const s = await apiGet("/api/mind/stats");
    const line = $("#resDist");
    if (!s.open) {
      line.textContent = `오늘 ${s.total}명이 참여했어요 — 집계 중입니다`;
      return;
    }
    const mine = s.items.find((i) => i.key === s.mine);
    const label = (key) => {
      const [expId, ti] = String(key).split(":");
      const e = MIND_DB.experiments.find((x) => x.id === expId);
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
  $("#mapTitle").textContent = `마음 지도 ${filled} / ${MIND_DB.axes.length}축`;
  $("#mapNote").textContent = state.st.map_complete
    ? "이달의 지도를 완성했어요 — 다음 달 1일에 새 지도가 열립니다"
    : `여덟 축을 ${state.st.axes_goal}까지 채우면 「마음 초상」이 열려요. 지도는 매달 1일 새로 시작합니다`;
  showScreen("map");
}

function showCollection() {
  const have = new Set(state.st.collection ?? []);
  const host = clear($("#collRows"));

  for (const exp of MIND_DB.experiments) {
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

  const total = MIND_DB.experiments.length * 4;
  $("#collTitle").textContent = `도감 ${have.size} / ${total}`;
  showScreen("coll");
}
