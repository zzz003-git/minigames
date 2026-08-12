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
  // 에디터 입력값 — 화면을 옮겨도 살아 있어야 한다. 빈 입력창이 이 서비스의
  // 최대 이탈 지점인데(plan §5-2), 잘못 눌러 날리는 것만큼 확실한 이탈은 없다
  draft: { cuts: 8, style: "auto", byline: "anon" },
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
  await refresh();
  route();
}

async function refresh() {
  try {
    const d = await apiGet("/api/ys/state");
    Object.assign(state, {
      wallet: d.wallet,
      service: d.service,
      styles: d.styles ?? [],
      steps: d.steps ?? [],
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
  const m = location.hash.match(/^#\/o\/(YS-\d{8}-\d{4})/);
  if (m) return openOrder(m[1]);
  if (location.hash === "#/write") return renderWrite();
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

  const down = state.service === "down";
  const full = state.service === "full";
  $("#writeBtn").disabled = !w || down || full;
  $("#seedNote").textContent = down
    ? "지금은 잠시 점검 중이에요. 곧 다시 열립니다."
    : full
      ? "지금은 만드는 이야기가 많아요. 잠시 후에 다시 와 주세요."
      : `3분 입력 · ${state.limits.tiers[0]}~${state.limits.tiers.at(-1)}컷 · 티켓 1장`;

  const live = state.orders.filter((o) => o.status !== "deleted");
  $("#drawerSlot").hidden = live.length === 0;
  $("#drawerNote").textContent = live.length ? `YOURS ${live.filter((o) => o.status === "done").length}` : "";

  const grid = clear($("#drawerGrid"));
  live.forEach((o, i) => grid.append(orderCard(o, live.length - i)));
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

  $("#submitBtn").addEventListener("click", submit);
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

  const chips = clear($("#styleChips"));
  for (const s of state.styles) {
    chips.append(
      el(
        "button",
        {
          class: `ys__chip ${state.draft.style === s.id ? "is-on" : ""}`,
          type: "button",
          onclick: () => { state.draft.style = s.id; renderWrite(); },
        },
        el("span", { class: "ys__chipname" }, `${s.icon} ${s.label}`),
        el("span", { class: "ys__chiphint" }, s.hint),
      ),
    );
  }

  updateCounter();
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
  $("#submitBtn").disabled = n < min_chars || state.service === "down";
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
  const btn = $("#submitBtn");
  btn.disabled = true;
  keepText($("#storyText").value.trim());
  try {
    const d = await apiPost("/api/ys/orders", {
      text: $("#storyText").value.trim(),
      cuts: state.draft.cuts,
      style: state.draft.style,
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
  $("#makingTitle").textContent = o.title || "이야기를 웹툰으로 만들고 있어요";

  const list = clear($("#stepList"));
  const now = state.steps.findIndex((s) => s.key === o.step);
  state.steps.forEach((s, i) => {
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

  $("#etaText").textContent =
    o.status === "queued_brain"
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
