/**
 * 🌤️ 오늘의 기운 — 화면
 *
 * 기획: SAJU-SPEC-01 · 만세력: docs/saju-calendar.md
 *
 * ── 계산은 전부 서버가 한다 ──────────────────────────────────────────────
 * 명식·일진·십신·지지관계·오행은 서버가 정해 내려준다. 화면이 정할 수 있으면
 * 도장판을 원하는 간지로 채울 수 있고 그건 순 완성 +20P·대완성 +100P 에 닿는다.
 * 여기서 하는 것은 **그 파라미터로 문장을 고르는 것**뿐이다(보상과 무관).
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { SAJU_DB } from "./saju-db.js";
import { renderSiteNav } from "../shared/sitenav.js";

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
const EL_NAME = ["나무", "불", "흙", "쇠", "물"];
const HOURS = [
  "자시 23~01", "축시 01~03", "인시 03~05", "묘시 05~07", "진시 07~09", "사시 09~11",
  "오시 11~13", "미시 13~15", "신시 15~17", "유시 17~19", "술시 19~21", "해시 21~23",
];

const ARM_DELAY_MS = 400;
const state = { st: null, last: null };

// 원안의 `activeView = inSuite ? 'hub' : v` — 서비스 화면에서도 「오늘의 나」 탭이
// 켜진 채 남는다. 게임 화면과 달리 여기는 판 중이 아니라 결과를 보는 자리다.
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "🌤️", title: "오늘의 기운", back: "/today/" });

// 시간 선택 — 12지시 + 「몰라요」 (기획서 1절)
{
  const sel = $("#hour");
  sel.append(el("option", { value: "" }, "몰라요 (세 기둥으로 봐요)"));
  HOURS.forEach((label, i) => {
    // 각 지시의 대표 시각을 값으로 준다 — 서버가 보정해 시지를 다시 정한다
    sel.append(el("option", { value: String((i * 2 + 23) % 24) }, label));
  });
}

$("#regBtn").addEventListener("click", register);
$("#orb").addEventListener("click", stampToday);
$("#stampBtn").addEventListener("click", showStamps);
$("#stampBtn2").addEventListener("click", showStamps);
$("#stampBackBtn").addEventListener("click", () => showScreen(state.st?.done ? "reading" : "chart"));

boot();

/** 같은 입력이면 언제나 같은 문장 — 날짜가 바뀔 때만 바뀐다 */
function seeded(str) {
  let h = 2166136261;
  for (const c of String(str)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
const pick = (arr, seed) => arr[seeded(seed) % arr.length];

async function boot() {
  try {
    state.st = await apiGet("/api/saju/state");
  } catch (err) {
    toast(err.message ?? "불러오지 못했습니다.", "error");
    return;
  }

  if (!state.st.registered) {
    showScreen("reg");
    return;
  }
  renderChart();
  if (state.st.done) renderReading(null);
}

// ══════════════════════════════════════════════════════════════
// 등록
// ══════════════════════════════════════════════════════════════

async function register() {
  const birth = $("#birth").value;
  const h = $("#hour").value;
  if (!birth) {
    toast("생년월일을 골라 주세요", "error");
    return;
  }

  $("#regBtn").disabled = true;
  try {
    await apiPost("/api/saju/profile", { birth, hour: h === "" ? null : Number(h) });
    state.st = await apiGet("/api/saju/state");
    renderChart();
    toast("명식을 세웠어요", "good");
  } catch (err) {
    const msg =
      err instanceof ApiFail && err.code === "OUT_OF_RANGE"
        ? "1930~2050년 사이만 지원해요"
        : err.message;
    toast(msg ?? "등록하지 못했습니다.", "error");
  } finally {
    $("#regBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 명식
// ══════════════════════════════════════════════════════════════

function renderChart() {
  const c = state.st.chart;
  const host = clear($("#pillars"));

  const col = (label, p) =>
    el(
      "div",
      { class: `pillar ${p ? "" : "pillar--empty"}` },
      el("div", { class: "pillar__label" }, label),
      el("div", { class: `pillar__stem ${p ? `el${STEM_EL[p.stem]}` : ""}` }, p ? STEMS[p.stem] : "?"),
      el("div", { class: `pillar__branch ${p ? `el${BRANCH_EL[p.branch]}` : ""}` }, p ? BRANCHES[p.branch] : "?"),
    );

  host.append(col("연주", c.year), col("월주", c.month), col("일주", c.day), col("시주", c.hour));

  $("#orbName").textContent = state.st.today.name;
  $("#orb").disabled = state.st.done;
  $("#orbHint").textContent = state.st.done
    ? "오늘은 이미 꽂았어요"
    : "구슬을 눌러 오늘을 꽂아 보세요";

  const dm = SAJU_DB.dayMaster[c.day_master.stem];
  setHeaderBadge(`${c.day_master.name} 일간`);
  $("#chartNote").textContent = `${pick(dm.intro, state.st.day + "dm")} · 도장 ${state.st.stamp_count}/60`;

  renderCross($("#crossChips"));
  showScreen("chart");
}

// ══════════════════════════════════════════════════════════════
// 꽂기 · 리딩
// ══════════════════════════════════════════════════════════════

async function stampToday() {
  $("#orb").disabled = true;
  try {
    const res = await apiPost("/api/saju/today", {});
    state.st = await apiGet("/api/saju/state");
    renderReading(res);
  } catch (err) {
    if (err instanceof ApiFail && err.code === "ALREADY_DONE") {
      state.st = await apiGet("/api/saju/state");
      renderReading(null);
      return;
    }
    toast(err.message ?? "꽂지 못했습니다.", "error");
    $("#orb").disabled = false;
  }
}

function renderReading(res) {
  const day = state.st.day;
  const gz = state.st.today.ganzhi;
  const c = state.st.chart;

  // 리딩 파라미터는 서버가 준 것을 쓴다. 재열람이면 명식과 오늘 간지로 다시 세운다.
  const stem = gz % 10;
  const branch = gz % 12;
  const god = res?.reading?.ten_god ?? tenGodLocal(c.day.stem, stem);
  const rel = res?.reading?.relation ?? null;
  const myEl = STEM_EL[c.day.stem];
  const todayEl = STEM_EL[stem];

  const tg = SAJU_DB.tenGod[god];
  $("#rdGanzhi").textContent = `${state.st.today.name} · ${tg.name}`;
  $("#rdTheme").textContent = pick(tg.theme, `${day}|theme|${god}`);
  $("#rdIljin").textContent = SAJU_DB.iljin60[gz];
  $("#rdAdvice").textContent = pick(tg.advice, `${day}|adv|${god}`);

  const rl = rel ? SAJU_DB.branchRel.find((r) => r.key === rel) : null;
  $("#rdRelation").textContent = rl ? pick(rl.lines, `${day}|rel|${rel}`) : "오늘은 평온한 날이에요.";
  $("#rdElement").textContent = SAJU_DB.elementMatrix[myEl][todayEl];

  clear($("#rdLucky")).append(
    stat("내 기운", EL_NAME[myEl]),
    stat("오늘 기운", EL_NAME[todayEl]),
    stat("행운의 물건", pick(SAJU_DB.luckyItems, `${day}|item|${gz}`)),
  );

  $("#rdGain").textContent = res
    ? `+${res.gained}P 적립 · 도장 ${state.st.stamp_count}/60${res.is_new ? " (새 칸!)" : ""}`
    : `오늘의 기운을 꽂았어요 · 도장 ${state.st.stamp_count}/60`;

  const soon = Math.floor(gz / 10);
  $("#rdNote").textContent = `이번 순 ${state.st.soon_done[soon]}/10`;

  renderCross($("#crossChips2"));
  renderAds();
  showScreen("reading");
  armScreen("reading");
}

/** 서버와 같은 규칙 — 재열람 때만 쓴다(꽂을 때는 서버 값이 온다) */
function tenGodLocal(me, other) {
  const GEN = [1, 2, 3, 4, 0];
  const CTRL = [2, 3, 4, 0, 1];
  const em = STEM_EL[me];
  const eo = STEM_EL[other];
  const same = me % 2 === other % 2;
  if (em === eo) return same ? 0 : 1;
  if (GEN[em] === eo) return same ? 2 : 3;
  if (CTRL[em] === eo) return same ? 4 : 5;
  if (CTRL[eo] === em) return same ? 6 : 7;
  return same ? 8 : 9;
}

const stat = (label, value) =>
  el("div", { class: "stat" },
    el("div", { class: "stat__label" }, label),
    el("div", { class: "stat__value" }, value));

function armScreen(name, ms = ARM_DELAY_MS) {
  const s = document.querySelector(`[data-screen="${name}"]`);
  if (!s) return;
  s.style.pointerEvents = "none";
  setTimeout(() => { s.style.pointerEvents = ""; }, ms);
}

function renderCross(host) {
  clear(host);
  const s = state.st.suite ?? {};
  for (const c of [
    { key: "tarot", href: "/tarot/", icon: "🔮", name: "오늘의 타로" },
    { key: "mind", href: "/mind/", icon: "🔬", name: "마음연구소" },
  ]) {
    const done = s[c.key]?.done;
    host.append(
      el("a", { class: `crosschip ${done ? "is-done" : ""}`, href: c.href },
        el("b", {}, `${c.icon} ${c.name}`),
        done ? "오늘 완료했어요" : "아직 봉인돼 있어요 →"),
    );
  }
}

// ══════════════════════════════════════════════════════════════
// 광고
// ══════════════════════════════════════════════════════════════

function renderAds() {
  clearRewardCard($("#adbarTomorrow"));
  clearRewardCard($("#adbarStats"));

  if (!state.st.ad_tomorrow) {
    renderRewardCard($("#adbarTomorrow"), {
      icon: "🌅",
      title: "광고 보고 내일 미리보기",
      desc: "미리 봐도 오늘의 운세와 적립은 그대로예요",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("SAJU_TOMORROW");
        if (!r) return;
        state.st = await apiGet("/api/saju/state");
        toast(`내일은 ${r.reward?.name ?? "—"}이에요`, "good", 2400);
        renderAds();
      },
    });
  }

  if (!state.st.ad_stats_seen) {
    renderRewardCard($("#adbarStats"), {
      icon: "🗺️",
      title: "광고 보고 전국 분포 보기",
      desc: "오늘 같은 기운을 받은 사람들",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("SAJU_STATS");
        if (!r) return;
        state.st = await apiGet("/api/saju/state");
        loadStats();
      },
    });
  } else {
    loadStats();
  }
}

async function loadStats() {
  try {
    const s = await apiGet("/api/saju/stats");
    const line = $("#rdDist");
    if (!s.open) {
      line.textContent = `오늘 ${s.total}명이 꽂았어요 — 집계 중입니다`;
      return;
    }
    const mine = s.items.find((i) => String(i.key) === String(s.mine));
    const top = SAJU_DB.tenGod[Number(s.items[0].key)]?.name ?? "—";
    line.textContent = mine
      ? `나와 같은 십신 ${mine.pct}% · 오늘 가장 많은 기운은 ${top}(${s.items[0].pct}%)`
      : `오늘 가장 많은 기운은 ${top}(${s.items[0].pct}%)`;
  } catch {
    /* 광고 전이면 잠겨 있는 것이 정상이다 */
  }
}

// ══════════════════════════════════════════════════════════════
// 도장판
// ══════════════════════════════════════════════════════════════

function showStamps() {
  const got = new Set(state.st.stamps ?? []);
  const today = state.st.today.ganzhi;
  const host = clear($("#stampGrid"));

  for (let i = 0; i < 60; i++) {
    const name = STEMS[i % 10] + BRANCHES[i % 12];
    host.append(
      el("div", {
        class: `stampcell ${got.has(i) ? "is-got" : ""} ${i === today ? "is-today" : ""}`,
        title: name,
      }, got.has(i) ? name : ""),
    );
  }

  $("#stampTitle").textContent = `도장판 ${got.size} / 60`;
  showScreen("stamp");
}
