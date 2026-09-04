/**
 * ✍ 너의스토리 — 홈 · 에디터 · 제작 중 · 뷰어
 *
 * 기획: `yourstory_plan.md` §5 · 사양: `yourstory_dev_spec.md` §7 (F2~F5)
 *
 * ── 주소가 화면을 정한다 ─────────────────────────────────────────────────
 * `#/`, `#/write`, `#/o/YS-…` 셋이다. 읽기 축과 같은 이유로 해시를 쓴다 — 제작
 * 중 화면에서 뒤로 누르면 서랍으로 돌아가야 하고, **완성 알림을 받고 다시 열 때
 * 주소 하나로 그 이야기에 도착**해야 한다.
 *
 * ── 제작 중과 결과는 같은 주소다 ────────────────────────────────────────
 * `#/o/YS-…` 하나가 상태에 따라 대기 화면이 되기도 하고 뷰어가 되기도 한다.
 * 완성되는 순간 화면이 바뀌어야 하는데, 주소가 다르면 그 전환이 「이동」이 되어
 * 뒤로가기 계단에 대기 화면이 남는다.
 *
 * ── 폴링은 5초다 ────────────────────────────────────────────────────────
 * 8컷이 12~20분이라 더 자주 물어도 알아낼 것이 없다. 대신 **탭이 숨으면 멈춘다** —
 * 창을 열어 둔 채 40분을 두는 것이 이 서비스의 정상 사용이라, 안 보이는 화면이
 * 계속 서버를 두드리게 두면 사람 수만큼 헛돈다.
 */

import { $, el, clear, showScreen, toast } from "../../shared/ui.js";
import { apiGet, apiPost, fallbackDay } from "../../shared/api.js";
import { renderSiteNav } from "../../shared/sitenav.js";
import { SEEDS, SAMPLES } from "./seeds.js";

const POLL_MS = 5000;

const state = {
  wallet: null,
  service: "ok",
  styles: [],
  steps: [],
  limits: { min_chars: 100, max_chars: 6000, chars_per_cut: 26, tiers: [8, 12, 16], free_tier: 8 },
  orders: [],
  day: null,
  // ✍✍ 배우 카드 12장과 화면 문안. **화면이 문구를 짓지 않는다** — 서버의 정본
  // 사본이고(설계서 §2·§4), 못 받으면 배우 화면을 열지 않는다
  actors: null,
  steps_ys2: [],
  // 에디터 입력값 — 화면을 옮겨도 살아 있어야 한다. 빈 입력창이 이 서비스의
  // 최대 이탈 지점인데(plan §5-2), 잘못 눌러 날리는 것만큼 확실한 이탈은 없다
  draft: { cuts: 8, style: "auto", byline: "anon", actor: "auto" },
};

let timer = null;
// 「코드 변경」을 눌러 입력란을 연 상태인가. **renderHome 이 읽으므로 여기서 선언한다** —
// 쓰는 자리(아래 초대코드 절) 옆에 두면 첫 렌더가 TDZ 에 걸린다
let codeSwapOpen = false;

renderSiteNav($("#siteNav"), "webtoon");
boot();
addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else route();
});

async function boot() {
  bindEditor();
  await Promise.all([refresh(), loadActors()]);
  route();
}

/**
 * 배우 카드와 화면 문안을 받아 둔다 (설계서 §2·§4).
 *
 * **못 받으면 배우 화면을 열지 않는다.** 문구를 화면이 지어내면 「무엇을
 * 약속했는가」가 배포본마다 달라지는데, 그건 정직 고지에서 사고다 — 차라리
 * 한 화면을 못 여는 편이 낫다.
 */
async function loadActors() {
  try {
    state.actors = await apiGet("/api/ys/actors");
  } catch {
    state.actors = null;
  }
}

async function refresh() {
  try {
    const d = await apiGet("/api/ys/state");
    Object.assign(state, {
      wallet: d.wallet,
      service: d.service,
      styles: d.styles ?? [],
      steps: d.steps ?? [],
      steps_ys2: d.steps_ys2 ?? [],
      limits: d.limits ?? state.limits,
      orders: d.orders ?? [],
      day: d.day,
    });
  } catch {
    // 상태를 못 읽어도 화면은 떠야 한다. 초대코드 입력까지는 가능하다
    state.day ??= fallbackDay();
  }
}

// ══════════════════════════════════════════════════════════════
// 라우팅
// ══════════════════════════════════════════════════════════════

function route() {
  stopPolling();
  // ✍✍ **접두 두 가지를 다 읽는다** — `YS2-…` 를 못 읽으면 YS2 주문은 주소로
  // 도착할 수 없고, 그러면 완성 화면에 영영 못 들어간다 (트랙 정본 §1)
  const m = location.hash.match(/^#\/o\/(YS2?-\d{8}-\d{4})/);
  if (m) return openOrder(m[1]);
  if (location.hash === "#/write") return renderWrite();
  if (location.hash === "#/actors") return renderActors();
  if (location.hash === "#/shelves") return renderShelves();
  renderHome();
}

const go = (hash) => { location.hash = hash; };

function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
}

// ══════════════════════════════════════════════════════════════
// ① 홈
// ══════════════════════════════════════════════════════════════

function renderHome() {
  showScreen("home");
  $("#homeDate").textContent = state.day ?? "";

  const w = state.wallet;
  // 전에는 **지갑이 있기만 하면** 입력란을 숨겼다. 그러면 코드를 넣을 길이 통째로
  // 사라진다 — 티켓을 다 쓴 사람은 「티켓이 없어요」만 보고 빠져나갈 수 없고,
  // 기기를 바꾼 사람은 서랍을 되찾을 수 없다. 코드가 곧 계정인데(로그인이 없다)
  // 그 계정을 넣는 자리가 첫 등록 때 한 번만 열리는 구조였다.
  //   ① 티켓이 0 이면 스스로 열린다 (막다른 길 방지)
  //   ② 그 외에는 「코드 변경」으로 언제든 열 수 있다
  const empty = w && w.tickets < 1;
  $("#inviteBox").hidden = Boolean(w) && !empty && !codeSwapOpen;
  $("#inviteLead").textContent = empty
    ? "티켓을 다 쓰셨어요. 새 초대코드가 있으면 넣어 주세요."
    : w
      ? "다른 초대코드를 넣으면 그 코드의 티켓과 서랍으로 바뀝니다."
      : "지금은 초대받은 분만 이용할 수 있어요.";
  $("#codeSwapBtn").hidden = !w || empty || codeSwapOpen;
  $("#walletBadge").textContent = w ? `TICKET ${w.tickets} · CREDIT ${w.credits}` : "";

  // 오늘의 문장은 **날짜로 정해진다.** 무작위로 뽑으면 새로고침마다 바뀌어
  // 「오늘의」가 아니게 된다 (읽기 축이 회차 메타를 화면에 두는 것과 같은 규칙 —
  // 문장 자체는 콘텐츠라 서버가 아니라 seeds.js 가 가진다)
  $("#seedText").textContent = SEEDS[dayIndex(state.day) % SEEDS.length];

  // 제작이 멈춰 있어도 **쓰기는 열어 둔다 — 예약으로 받는다**(Y9 §2, 2026-08-12 개정).
  // 문구가 약속할 수 있는 것은 "순서대로 만든다"까지다. 이 서비스에는 로그인도
  // 알림 경로도 없으므로 **「완성되면 알려 드릴게요」는 지킬 수 없는 약속**이다 —
  // 완성은 고객이 서랍에 다시 들러 확인한다
  const reserve = state.service === "reserve";
  const full = state.service === "full";
  $("#writeBtn").disabled = !w || full;
  $("#seedNote").textContent = reserve
    ? "지금은 만들기가 멈춰 있어요. 예약해 두면 다시 열릴 때 순서대로 만들어 드려요."
    : full
      ? "지금은 만드는 이야기가 많아요. 잠시 후에 다시 와 주세요."
      : `3분 입력 · ${state.limits.tiers[0]}~${state.limits.tiers.at(-1)}컷 · 티켓 1장`;

  const live = state.orders.filter((o) => o.status !== "deleted");
  $("#drawerSlot").hidden = live.length === 0;
  $("#drawerNote").textContent = live.length ? `YOURS ${live.filter((o) => o.status === "done").length}` : "";

  const grid = clear($("#drawerGrid"));
  live.forEach((o, i) => grid.append(orderCard(o, live.length - i)));

  // 선반은 **배우와 만든 작품이 있을 때만** 보인다. 빈 선반을 만들지 않는다
  // (설계서 §1-[7]) — 링크부터 없으면 빈 화면에 도착할 일이 없다
  $("#shelvesBtn").hidden = !live.some((o) => o.track === "ys2" && o.status === "done");
}

/** 날짜 문자열을 정수로 — 같은 날이면 같은 문장이 나오게 하는 것이 전부다 */
function dayIndex(day) {
  return Number((day ?? "").replaceAll("-", "")) || 0;
}

const STATE_TEXT = {
  queued_brain: ["만드는 중", "making"],
  brain_running: ["만드는 중", "making"],
  needs_input: ["확인이 필요해요", "stop"],
  queued_image: ["만드는 중", "making"],
  image_running: ["만드는 중", "making"],
  composing: ["마무리 중", "making"],
  done: ["완성", "done"],
  rejected: ["안내", "stop"],
  conti_failed: ["보류", "stop"],
  budget_stop: ["보류", "stop"],
  failed: ["다시 만들어야 해요", "stop"],
};

function orderCard(o, no) {
  const [label, kind] = STATE_TEXT[o.status] ?? ["—", "done"];
  const sub =
    o.status === "done"
      ? [o.tone_label, `${o.cuts}컷`].filter(Boolean).join(" · ")
      : o.status === "image_running" && o.cuts_done
        ? `그림 ${o.cuts_done}/${o.cuts}`
        : o.status === "queued_brain" && state.service === "reserve"
          ? "예약됨 · 열리면 시작해요"
          : o.tone_label ?? "순서를 기다리는 중";

  return el(
    "button",
    { class: "ys__card", type: "button", onclick: () => go(`#/o/${o.id}`) },
    el("span", { class: "ys__my mono" }, `MY.${no}`),
    el(
      "span",
      { class: "ys__cardbody" },
      el("span", { class: "ys__cardtitle" }, o.title || "제목 없는 이야기"),
      el("span", { class: "ys__cardsub" }, sub),
    ),
    el("span", { class: `ys__badge ys__badge--${kind}` }, label),
  );
}

// 초대코드 (`codeSwapOpen` 은 위 상태 선언부에 있다)
$("#codeSwapBtn").addEventListener("click", () => {
  codeSwapOpen = true;
  renderHome();
  $("#inviteInput").focus();
});

$("#inviteBtn").addEventListener("click", async () => {
  const code = $("#inviteInput").value.trim();
  if (!code) return;
  try {
    await apiPost("/api/ys/invite", { code });
    $("#inviteInput").value = "";
    codeSwapOpen = false;
    await refresh();
    renderHome();
    toast("초대코드를 확인했어요", "good");
  } catch (err) {
    toast(err.message, "error");
  }
});

$("#writeBtn").addEventListener("click", () => go("#/write"));

// ══════════════════════════════════════════════════════════════
// ② 에디터
// ══════════════════════════════════════════════════════════════

function bindEditor() {
  const text = $("#storyText");
  text.addEventListener("input", updateCounter);

  $("#writeBack").addEventListener("click", () => go("#/"));
  $("#viewerBack").addEventListener("click", () => go("#/"));
  $("#makingBack").addEventListener("click", () => go("#/"));
  $("#noticeBack").addEventListener("click", () => go("#/"));

  $("#sampleBtn").addEventListener("click", () => {
    if (text.value.trim() && !confirm("쓰고 계신 글을 예시로 바꿀까요?")) return;
    text.value = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    updateCounter();
  });

  for (const b of $("#bylineOpts").querySelectorAll("[data-byline]")) {
    b.addEventListener("click", () => {
      state.draft.byline = b.dataset.byline;
      for (const o of $("#bylineOpts").children) o.classList.toggle("is-on", o === b);
      $("#nickInput").hidden = state.draft.byline !== "nick";
    });
  }

  // ✍✍ 에디터의 CTA 는 **접수가 아니라 배우 선택으로** 간다 (설계서 §1 흐름).
  // 글은 화면 사이를 옮겨도 살아 있어야 해서 여기서 남긴다
  $("#submitBtn").addEventListener("click", () => {
    keepText($("#storyText").value.trim());
    go("#/actors");
  });
  $("#actorsBack").addEventListener("click", () => go("#/write"));
  $("#shelvesBack").addEventListener("click", () => go("#/"));
  $("#shelvesBtn").addEventListener("click", () => go("#/shelves"));
  $("#castSubmit").addEventListener("click", submit);
}

function renderWrite() {
  if (!state.wallet) return go("#/");
  showScreen("write");
  $("#writeWallet").textContent = `TICKET ${state.wallet.tickets}`;

  // 컷 수 — 고른 값은 상한이다(Y-5). 크레딧이 모자라면 못 고르게 막고 이유를 적는다
  const opts = clear($("#cutOpts"));
  for (const n of state.limits.tiers) {
    const need = n - state.limits.free_tier;
    const short = state.wallet.credits < need;
    opts.append(
      el(
        "button",
        {
          class: `ys__opt ${state.draft.cuts === n ? "is-on" : ""}`,
          type: "button",
          disabled: short,
          title: short ? `크레딧 ${need}개가 필요해요` : null,
          onclick: () => { state.draft.cuts = n; renderWrite(); },
        },
        `${n}컷`,
      ),
    );
  }

  updateCounter();
}

// ══════════════════════════════════════════════════════════════
// ✍✍ ②-2 배우 선택 (YS2 · 설계서 §1-[2] · §2)
// ══════════════════════════════════════════════════════════════

/**
 * 카드 12장. **1탭이 전부다** — 상세 페이지도, 확인 팝업도, 추가 질문도 없다.
 *
 * 안 고르고 들어와도 첫 카드(AI 추천)가 선택된 상태라 그대로 만들 수 있다.
 * 이 트랙이 파는 것은 「최소 입력 → 감정 증폭」이라, 여기서 입력을 하나라도
 * 더 늘리면 파는 것 자체가 바뀐다.
 */
function renderActors() {
  if (!state.wallet) return go("#/");
  if (!state.actors) {
    // 문안을 못 받았다. **화면이 지어내지 않는다**(설계서 §4) — 글쓰기로 돌린다
    toast("배우 목록을 불러오지 못했어요", "error");
    return go("#/write");
  }
  showScreen("actors");
  const { cards, texts } = state.actors;
  $("#actorQuestion").textContent = texts.pick_question;
  $("#actorNote").textContent = texts.pick_note;
  $("#actorWallet").textContent = `TICKET ${state.wallet.tickets}`;

  const host = clear($("#actorCards"));
  for (const c of cards) host.append(actorCard(c));

  // 「이야기 맞춤 인물」은 기존 방식이라 **화풍을 고른다** — YS2 는 전용 화풍
  // 1종이라 고를 것이 없고, 그 자리에 배우 선택이 들어온 것이다(설계서 §1-[1])
  const custom = state.draft.actor === "custom";
  $("#styleSlot").hidden = !custom;
  if (custom) renderStyleChips();

  const picked = cards.find((c) => c.id === state.draft.actor);
  $("#castSubmit").textContent =
    state.draft.actor === "auto" ? "AI 추천으로 만들기"
      : custom ? "맞춤 인물로 만들기"
        : `${picked?.name ?? "이 배우"}${ro(picked?.name)} 만들기`;
}

/**
 * 「…으로/…로」 — 이름 뒤에 붙는 조사.
 *
 * 배우 이름이 열 개라 **화면이 문장을 만든다.** 규칙 없이 「로」로 고정하면
 * 「다온로 만들기」가 나가고, 그건 배우에게 이름을 붙여 파는 트랙에서 특히 나쁘다.
 * 받침이 없거나 ㄹ 받침이면 「로」, 그 밖에는 「으로」다.
 */
function ro(name) {
  const last = (name ?? "").trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return "로";   // 한글이 아니면 건드리지 않는다
  const jong = code % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 카드 한 장 — 4요소뿐이다. 결점·어울리는 이야기는 싣지 않는다 (설계서 §2) */
function actorCard(c) {
  const on = state.draft.actor === c.id;
  const face = c.card_image
    ? el("img", { class: "ys2__face", src: c.card_image, alt: "", width: 360, height: 360,
                  loading: "lazy", decoding: "async" })
    // 표본 승인 전 캐릭터는 **회색 박스 와이어**다 (F1 §3). 승인되면 그림만 들어온다
    : el("span", { class: `ys2__face ys2__face--wire ${c.kind !== "actor" ? "is-symbol" : ""}` },
         c.symbol ?? "준비 중");

  return el(
    "button",
    {
      class: `ys2__card ${on ? "is-on" : ""}`,
      type: "button",
      role: "radio",
      "aria-checked": on ? "true" : "false",
      onclick: () => { state.draft.actor = c.id; renderActors(); },
    },
    face,
    el("span", { class: "ys2__name" }, c.name),
    el("span", { class: "ys2__line" }, c.personality_line),
    el("span", { class: "ys2__quirk" }, c.quirk_line || ""),
    on ? el("span", { class: "ys2__check", "aria-hidden": "true" }, "✓") : null,
  );
}

function renderStyleChips() {
  const chips = clear($("#styleChips"));
  for (const st of state.styles) {
    chips.append(
      el(
        "button",
        {
          class: `ys__chip ${state.draft.style === st.id ? "is-on" : ""}`,
          type: "button",
          onclick: () => { state.draft.style = st.id; renderActors(); },
        },
        el("span", { class: "ys__chipname" }, `${st.icon} ${st.label}`),
        el("span", { class: "ys__chiphint" }, st.hint),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════
// ✍✍ ⑥ 나의 기록들 — 선반은 배우다 (설계서 §1-[7])
// ══════════════════════════════════════════════════════════════

async function renderShelves() {
  showScreen("shelves");
  const host = clear($("#shelfHost"));
  let d;
  try {
    d = await apiGet("/api/ys/shelves");
  } catch (err) {
    toast(err.message, "error");
    return go("#/");
  }
  const shelves = d.shelves ?? [];
  $("#shelfEmpty").hidden = shelves.length > 0;
  $("#shelfCount").textContent = shelves.length ? `${shelves.length}명` : "";

  for (const sh of shelves) {
    const strip = el("div", { class: "ys2__strip" });
    for (const wk of sh.works) {
      strip.append(
        el(
          "button",
          { class: "ys2__work", type: "button", onclick: () => go(`#/o/${wk.id}`) },
          el("span", { class: "ys2__worktitle" }, wk.title || "제목 없는 이야기"),
          el("span", { class: "ys2__worksub" },
             [wk.tone_label, `${wk.cuts}컷`].filter(Boolean).join(" · ")),
        ),
      );
    }
    host.append(
      el(
        "section",
        { class: "ys2__shelf" },
        el(
          "header",
          { class: "ys2__shelfhead" },
          sh.card_image
            ? el("img", { class: "ys2__shelfface", src: sh.card_image, alt: "",
                          width: 360, height: 360, loading: "lazy" })
            // 그림이 아직 없는 배우와 **새 얼굴 선반**이 같은 자리를 쓴다 —
            // 보드의 폴백 행과 같은 표식으로 둔다(두 화면이 다른 기호를 쓰면
            // 같은 뜻인지 알 수 없다)
            : el("span", { class: "ys2__shelfface ys2__face--wire" }, "◍"),
          el("b", {}, sh.name),
          // **작품이 하나여도 선반은 보인다** — 「다온의 선반 · 1편」
          el("span", { class: "ys2__shelfn mono" }, `${sh.works.length}편`),
        ),
        strip,
        // 재이용 회로의 최단 동선 — 그 배우가 선선택된 에디터로 간다
        sh.can_reorder
          ? el(
              "button",
              {
                class: "ys__link ys2__again",
                type: "button",
                onclick: () => { state.draft.actor = sh.actor_id; go("#/write"); },
              },
              d.texts.cta,
            )
          : null,
      ),
    );
  }
}

/**
 * 글자 수 → 컷 수 어림. 입력하면서 분량 감각이 생기게 하는 장치다(plan §5-2).
 *
 * **어림값이라고 말한다.** 실제 컷 수는 사실의 양이 정하므로(Y-5) 여기 숫자를
 * 약속처럼 보여 주면 줄었을 때 속은 것이 된다.
 */
function updateCounter() {
  const n = $("#storyText").value.trim().length;
  const { min_chars, chars_per_cut } = state.limits;
  const est = Math.min(state.draft.cuts, Math.max(4, Math.round(n / chars_per_cut)));

  clear($("#charCount")).append(
    el("b", {}, `${n}자`),
    n >= min_chars ? ` · ${est}컷 분량` : ` · ${min_chars}자부터 만들 수 있어요`,
  );
  // 예약 접수라 `service` 로는 막지 않는다 — 글자 수만 본다 (Y9 §2, 2026-08-12 개정)
  $("#submitBtn").disabled = n < min_chars;
}

/**
 * 보낸 글을 이 브라우저에 남겨 둔다.
 *
 * 원문은 서버에서 **암호화되어** 보관되고 되돌려 받는 경로가 없다(policy). 그래서
 * 만들기가 중간에 멈추면 **고객이 쓴 글이 통째로 사라진다** — 실제로 겪었다.
 * 티켓은 돌아오지만 글은 안 돌아오고, 그쪽이 더 아깝다.
 * 완성되면 지운다. 남겨 둘 이유가 사라지고, 남의 기기에 남기지 않는 편이 낫다.
 */
const LAST_TEXT = "ys_last_text";
const keepText = (t) => { try { localStorage.setItem(LAST_TEXT, t); } catch {} };
const takeText = () => { try { return localStorage.getItem(LAST_TEXT) || ""; } catch { return ""; } };
const dropText = () => { try { localStorage.removeItem(LAST_TEXT); } catch {} };

async function submit() {
  const btn = $("#castSubmit");
  btn.disabled = true;
  keepText($("#storyText").value.trim());
  try {
    const d = await apiPost("/api/ys/orders", {
      text: $("#storyText").value.trim(),
      cuts: state.draft.cuts,
      style: state.draft.style,
      // ✍✍ 트랙을 가르는 유일한 값 (설계서 §1-0 · §3)
      actor_choice: state.draft.actor,
      byline: state.draft.byline,
      nickname: $("#nickInput").value.trim(),
      title: $("#titleInput").value.trim(),
      relay_allow: $("#relayAllow").checked,
    });

    // 가린 것이 있으면 **그 자리에서** 알린다 (policy §2-1)
    if (d.masked?.length) {
      toast(`${d.masked.join("·")}가 있어서 가렸어요`, "", 4200);
    }
    $("#storyText").value = "";
    $("#titleInput").value = "";
    await refresh();
    go(`#/o/${d.id}`);
  } catch (err) {
    toast(err.message, "error", 5000);
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// ③④ 주문 — 제작 중 / 결과
// ══════════════════════════════════════════════════════════════

async function openOrder(id) {
  let o;
  try {
    o = await apiGet("/api/ys/order", { id });
  } catch (err) {
    toast(err.message, "error");
    return go("#/");
  }

  if (o.status === "done") return renderViewer(o);
  if (["rejected", "failed", "conti_failed", "budget_stop", "needs_input"].includes(o.status)) {
    return renderNotice(o);
  }

  renderMaking(o);
  // 화면이 보이는 동안만 묻는다 (visibilitychange 가 다시 켠다)
  timer = setTimeout(() => { if (!document.hidden) openOrder(id); }, POLL_MS);
}

function renderMaking(o) {
  showScreen("making");
  $("#makingTitle").textContent =
    o.title || (o.worker_ok === false ? "예약해 두었어요" : "이야기를 웹툰으로 만들고 있어요");

  const list = clear($("#stepList"));
  // ✍✍ **도장은 트랙마다 다르다** — YS2 에는 「캐스팅」 한 칸이 더 있다.
  // 같은 다섯 칸을 쓰면 캐스팅이 도는 동안 「분위기」에서 멎은 것으로 보인다
  const steps = (o.track === "ys2" && state.steps_ys2.length) ? state.steps_ys2 : state.steps;
  const now = steps.findIndex((s) => s.key === o.step);
  steps.forEach((s, i) => {
    list.append(
      el(
        "li",
        { class: `ys__step ${i < now ? "is-done" : i === now ? "is-now" : ""}` },
        el("span", { class: "ys__dot", "aria-hidden": "true" }),
        // 색만으로 구분하지 않는다 — 도장 채움 + 글자 라벨 병기 (plan §8)
        el("span", { class: "ys__steplabel" }, s.label),
      ),
    );
  });

  const drawing = o.status === "image_running" && o.cuts > 0;
  $("#progWrap").hidden = !drawing;
  if (drawing) {
    $("#progFill").style.width = `${Math.round((o.cuts_done / o.cuts) * 100)}%`;
    $("#progText").textContent = `그림 ${o.cuts_done}/${o.cuts}`;
  }

  // 톤 진단은 나오는 즉시 보여준다 — 가장 궁금한 정보를 가장 먼저 주는 것이
  // 대기 시간을 대신 채운다 (plan §5-3)
  $("#toneCard").hidden = !o.tone_label;
  if (o.tone_label) {
    $("#toneLabel").textContent = o.tone_label;
    $("#toneWhy").textContent = o.tone_reason ?? "";
  }

  // 예약분에는 **시간을 적지 않는다.** 앞이 줄지 않는 화면에 「곧 시작해요」를
  // 5초마다 다시 그리는 것이 예약 접수가 실패하는 유일한 방식이다 (`worker_ok` 는
  // 대기 중일 때만 실린다 — `undefined` 를 멈춤으로 읽지 않도록 `=== false` 로 본다)
  $("#etaText").textContent =
    o.worker_ok === false
      ? "지금은 만들기가 멈춰 있어요 · 다시 열리면 순서대로 만들어 드려요"
      : o.status === "queued_brain"
        ? o.ahead > 0
          ? `앞에 ${o.ahead}편이 있어요`
          : "곧 시작해요"
        : o.eta_sec
          ? `약 ${Math.max(1, Math.round(o.eta_sec / 60))}분 남았어요`
          : "만드는 중이에요";
}

function renderViewer(o) {
  showScreen("viewer");
  dropText();   // 완성됐으니 남겨 둔 글을 지운다 (남의 기기에 남기지 않는다)
  $("#viewerTitle").textContent = o.title || "제목 없는 이야기";
  $("#viewerMy").textContent = `${o.cuts}컷`;
  $("#viewerBy").textContent = o.byline === "nick" && o.nickname ? o.nickname : "익명";

  $("#viewerDiag").hidden = !o.tone_label;
  if (o.tone_label) {
    $("#diagLabel").textContent = o.tone_label;
    $("#diagWhy").textContent = o.tone_reason ?? "";
  }

  /**
   * 분할본을 순서대로 켠다 — 읽기 축의 뷰어와 같은 구조다.
   *
   * **자리 높이를 미리 잡는다.** 그림이 들어오면서 아래가 밀리면 읽던 자리를
   * 잃는다. `width`·`height` 속성을 주면 브라우저가 종횡비로 자리를 잡아 준다.
   */
  renderBoard(o);

  const host = clear($("#cutHost"));
  for (const [i, p] of (o.parts ?? []).entries()) {
    host.append(
      el("img", {
        class: "ys__part",
        src: p.url,
        width: p.w,
        height: p.h,
        // 첫 장만 즉시, 나머지는 지연 — 8~16컷이면 분할본이 1~2개라 이것으로 충분하다
        loading: i === 0 ? "eager" : "lazy",
        decoding: "async",
        // 스크린 리더와 검색 대응 (plan §8). 대사·캡션이 곧 이 그림의 내용이다
        alt: altOf(o.cuts_detail, i, o.parts.length),
      }),
    );
  }

  // 생략·순화도 숨기지 않는다. 숨기면 발견될 때 신뢰가 무너진다 (plan §5-4)
  const notes = [];
  if (o.omitted_note) notes.push(`이 부분은 컷에 담지 못했어요 — ${o.omitted_note}`);
  if (o.softened) notes.push("표현을 조금 부드럽게 바꾼 곳이 있어요.");
  if (o.requested_cuts > o.cuts) {
    notes.push(
      `이야기에 담긴 사건이 ${o.cuts}컷에 잘 맞아 ${o.cuts}컷으로 만들었어요 · ` +
        `차액 ${o.requested_cuts - o.cuts}컷은 컷 크레딧으로 돌려드렸어요.`,
    );
  }
  $("#viewerNotes").hidden = notes.length === 0;
  $("#viewerNotes").textContent = notes.join("\n");

  const src = $("#srcBox");
  src.hidden = true;
  src.textContent = o.source_text ?? "";
  $("#srcToggle").onclick = () => {
    src.hidden = !src.hidden;
    $("#srcToggle").textContent = src.hidden ? "내가 쓴 글 보기" : "원문 접기";
  };

  $("#deleteBtn").onclick = async () => {
    if (!confirm("이 이야기와 그림을 지울까요? 되돌릴 수 없어요.")) return;
    try {
      await apiPost("/api/ys/order/delete", { id: o.id });
      await refresh();
      go("#/");
      toast("지웠어요", "good");
    } catch (err) {
      toast(err.message, "error");
    }
  };
}

/**
 * ✍✍ 캐스팅 보드 — 결과물 앞 1장 (설계서 §1-[5]).
 *
 * **읽는 데 5초를 넘지 않게** 배역 행을 다섯까지만 편다. 여섯 이상이면 그 자체가
 * 캐스팅 설계를 의심할 신호이므로 **숨기지 않고 「몇 명 더」를 적는다** — 조용히
 * 자르면 그 신호가 사라진다.
 *
 * 폴백·게이트 대체 문안은 **서버가 준 정본 그대로** 쓴다. 화면이 상황에 맞춰
 * 고쳐 쓰면 「무엇을 약속했는가」가 배포본마다 달라진다(설계서 §4).
 */
function renderBoard(o) {
  const box = $("#castBoard");
  const board = o.casting;
  box.hidden = !board?.rows?.length;
  if (box.hidden) return;

  const texts = state.actors?.texts ?? {};
  const max = state.actors?.board_max_rows ?? 5;
  const shown = board.rows.slice(0, max);
  const rest = board.rows.length - shown.length;

  // ⚠ **`null` 을 그대로 `append` 하지 않는다.** `el()` 은 null 자식을 건너뛰지만
  // `Node.append()` 는 「null」이라는 **글자를 찍는다** — 화면에 실제로 그렇게 나왔다
  const parts = [
    el("div", { class: "ys2__boardkey mono" }, texts.board_label ?? "오늘의 캐스팅"),
    ...shown.map((r) =>
      el(
        "div",
        { class: `ys2__row ${r.is_fallback ? "is-fallback" : ""}` },
        r.card_image
          ? el("img", { class: "ys2__rowface", src: r.card_image, alt: "",
                        width: 360, height: 360, loading: "lazy" })
          // 폴백은 **회색 실루엣 + 정본 한 줄**이다. 다른 설명을 붙이지 않는다
          : el("span", { class: "ys2__rowface ys2__face--wire" }, "◍"),
        el(
          "span",
          { class: "ys2__rowbody" },
          el("span", { class: "ys2__role" }, r.role_label),
          el("span", { class: "ys2__actor" },
             r.is_fallback ? (texts.fallback ?? "") : (r.actor_name ?? "")),
        ),
        r.is_customer_pick
          ? el("span", { class: "ys2__pick" }, texts.customer_pick ?? "내가 고른 배우")
          : null,
      ),
    ),
    rest > 0 ? el("p", { class: "ys2__boardmore" }, `그 밖에 ${rest}명이 더 나와요`) : null,
    // 게이트가 고객 선택을 대체했으면 **조용히 넘어가지 않는다** (F1 원칙 6)
    board.gate_notice ? el("p", { class: "ys2__gate" }, board.gate_notice) : null,
    el("p", { class: "ys2__boardtail" }, texts.board_tail ?? ""),
  ];
  clear(box).append(...parts.filter(Boolean));
}

/** 분할본 한 장의 대체 텍스트 — 그 장에 들어간 컷들의 대사·캡션을 잇는다 */
function altOf(cuts, index, total) {
  if (!cuts?.length) return `웹툰 ${index + 1}번째 장면`;
  const per = Math.ceil(cuts.length / total);
  return (
    cuts
      .slice(index * per, (index + 1) * per)
      .map((c) => c.dialogue || c.caption)
      .filter(Boolean)
      .join(" / ") || `웹툰 ${index + 1}번째 장면`
  );
}

const NOTICE = {
  rejected: "이 이야기는 웹툰으로 만들지 않았어요.",
  failed: "만드는 중에 문제가 있었어요. 티켓은 돌려드렸어요.",
  // 「확인하고 알려드릴게요」라고 적어 두었으나 **알려 줄 경로가 없다**(무로그인이라
  // 연락처가 없다). 지키지 못할 약속 대신 지금 할 수 있는 일을 말한다
  conti_failed: "이야기를 컷으로 나누다가 멈췄어요. 다시 보내면 대개 잘 만들어져요.",
  budget_stop: "만드는 데 예상보다 많은 그림이 필요해 멈췄어요. 티켓은 돌려드렸어요.",
  needs_input: "확인하고 싶은 것이 있어요.",
};

/**
 * 멈춘 주문 화면.
 *
 * 전에는 문구 한 줄과 「돌아가기」뿐이었다. 그러면 고객은 **무엇을 해야 하는지 알 수
 * 없다** — 티켓이 나갔는지, 다시 보내도 되는지, 쓴 글은 어떻게 되는지 아무것도
 * 알려 주지 않았다. 실제로 그 화면 앞에서 막혔다는 이야기를 들었다.
 * 세 가지를 분명히 말한다: **돈 · 글 · 다음 할 일.**
 */
const REDO_OK = ["conti_failed", "failed", "budget_stop"];

function renderNotice(o) {
  showScreen("notice");
  $("#noticeText").textContent = o.fail_reason || NOTICE[o.status] || "확인이 필요해요.";

  // 반려(rejected)만 티켓을 쓰지 않은 것이 아니라, 멈춘 주문은 전부 티켓이 살아 있다.
  // 과금은 그림을 그리기 시작할 때 한 번 들고, 그 뒤 실패는 되돌려준다
  const back = REDO_OK.includes(o.status) || o.status === "rejected";
  const saved = takeText();
  $("#noticeTicket").hidden = !back;
  // **없는 것을 있다고 말하지 않는다.** 남겨 둔 글이 실제로 있을 때만 그렇게 적는다 —
  // 이 화면을 처음 배포했을 때 저장 전에 보낸 주문에도 「글도 남겨 두었어요」가
  // 떴다. 티켓은 사실이지만 글은 아니었고, 그건 그냥 거짓말이다
  $("#noticeTicket").textContent = saved
    ? "티켓은 그대로 있어요. 쓰신 글도 남겨 두었으니 다시 보내실 수 있어요."
    : "티켓은 그대로 있어요. 다시 보내실 수 있어요.";

  const redo = $("#noticeRedo");
  redo.hidden = !(REDO_OK.includes(o.status) && saved);
  redo.onclick = () => {
    $("#storyText").value = saved;
    go("#/write");
  };
}
