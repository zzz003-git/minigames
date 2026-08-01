/**
 * 광고 모듈 — 목업 노출 + 실제 SDK 연동 자리
 * ==========================================================================
 *
 * 현재 상태: 목업(mock). 실제 광고 SDK가 없으므로 "광고 자리"와 보상 흐름만
 * 동작하도록 만들어 두었습니다. 서버 쪽 검증 스텁은 src/lib/adverify.js 입니다.
 *
 * ── 실제 광고 연동할 때 손댈 곳 ───────────────────────────────────────────
 *   1. loadAdSdk()          : 광고 SDK 스크립트 로드 / 초기화
 *   2. showRewardedAd()     : 목업 오버레이 대신 SDK 의 보상형 광고 호출
 *   3. showInterstitialAd() : 목업 오버레이 대신 SDK 의 전면 광고 호출
 *   → 아래 함수 시그니처(Promise 반환, 시청 완료 시 resolve)를 유지하면
 *     게임 코드는 전혀 수정할 필요가 없습니다.
 *
 * Rewarded / Interstitial 은 원래 모바일 앱 SDK 기능이라 순수 웹에서는
 * 그대로 재현되지 않습니다. WebView 로 감쌀 때 네이티브 브리지
 * (window.AdBridge 같은 객체)를 통해 호출하는 형태가 됩니다.
 * ==========================================================================
 */

import { apiPost } from "./api.js";
import { el, toast, clear } from "./ui.js";

/**
 * 트리거별 안내 문구 (기획서 11장 트리거 명세 + 아케이드 10종)
 *
 * 게임이 14개가 되면서 목록을 손으로 관리하면 빠뜨리기 쉬워졌습니다.
 * 오리지널 4종처럼 문구가 특별한 것만 여기 적고, 아케이드 10종은 접미사 규칙으로 처리합니다.
 *   *_ATTEMPT  도전 기회 +1
 *   *_BOOST    런 진행 중 보상 (구체적 문구는 호출부가 boostLabel 로 넘겨 줍니다)
 *   *_STATS    전체 통계·랭킹 열람
 */
const TRIGGER_COPY = {
  STOPWATCH_ATTEMPT: { title: "도전 기회 +1", reward: "기회 1회가 추가됩니다", seconds: 5 },
  STOPWATCH_STATS: { title: "전체 통계 열람", reward: "타임별 전체 통계가 공개됩니다", seconds: 3 },
  BASEBALL_ATTEMPT: { title: "기회 +3 충전", reward: "시도 기회 3회가 충전됩니다", seconds: 5 },
  BASEBALL_STATS: { title: "전체 통계 열람", reward: "전체 통계가 공개됩니다", seconds: 3 },
  TYPING_SENTENCE: { title: "새 문장 도전권", reward: "새 문장 1회가 추가됩니다", seconds: 5 },
  TYPING_RANK: { title: "전체 순위 열람", reward: "전체 순위가 공개됩니다", seconds: 3 },
  MEMORY_LEVEL: { title: "다음 레벨 도전권", reward: "레벨 도전권 1장이 지급됩니다", seconds: 5 },
  MEMORY_RANK: { title: "전체 랭킹 열람", reward: "전체 랭킹이 공개됩니다", seconds: 3 },
};

/** 접미사로 결정되는 기본 문구 */
const SUFFIX_COPY = {
  _ATTEMPT: { title: "도전 기회 +1", reward: "오늘 도전 기회가 1회 추가됩니다", seconds: 5 },
  _BOOST: { title: "이어서 도전하기", reward: "지금 판을 이어서 진행합니다", seconds: 5 },
  _STATS: { title: "전체 순위 열람", reward: "전체 순위와 통계가 공개됩니다", seconds: 3 },
  _RANK: { title: "전체 순위 열람", reward: "전체 순위가 공개됩니다", seconds: 3 },
};

/** 전면(Interstitial)인지 보상형(Rewarded)인지 — 서버 AD_TRIGGERS 의 type 과 같은 규칙 */
const isInterstitial = (trigger) => trigger.endsWith("_STATS") || trigger.endsWith("_RANK");

function copyOf(trigger, override) {
  const suffix = Object.keys(SUFFIX_COPY).find((s) => trigger.endsWith(s));
  const base = TRIGGER_COPY[trigger] ?? SUFFIX_COPY[suffix] ?? { title: "광고", reward: "", seconds: 5 };
  return override ? { ...base, ...override } : base;
}

// ── 실제 SDK 연동 자리 ────────────────────────────────────────

/**
 * 광고 SDK 초기화. (미구현 — 연동 스펙 수신 후 작성)
 * @returns {Promise<boolean>} 사용 가능 여부
 */
export async function loadAdSdk() {
  // TODO(광고 연동): SDK 스크립트 삽입 및 초기화
  //   예) await loadScript('https://.../sdk.js'); AdSdk.init({ appId, ... });
  //   WebView 환경이면 window.AdBridge 존재 여부를 확인
  return false;
}

/**
 * 보상형 광고 재생. 시청 완료 시 resolve, 중도 이탈 시 reject.
 * @param {string} trigger
 * @returns {Promise<void>}
 */
async function showRewardedAd(trigger, copy) {
  // TODO(광고 연동): 아래 목업 호출을 SDK 호출로 교체
  //   return AdSdk.showRewarded({ placement: trigger });
  return playMockAd(trigger, { skippable: false, copy });
}

/**
 * 전면 광고 노출.
 * @param {string} trigger
 * @returns {Promise<void>}
 */
async function showInterstitialAd(trigger, copy) {
  // TODO(광고 연동): 아래 목업 호출을 SDK 호출로 교체
  //   return AdSdk.showInterstitial({ placement: trigger });
  return playMockAd(trigger, { skippable: true, copy });
}

// ── 목업 광고 오버레이 ────────────────────────────────────────

/**
 * 광고 자리를 시각적으로 보여주는 목업. 카운트다운이 끝나면 닫을 수 있습니다.
 * @param {string} trigger
 * @param {{ skippable:boolean }} opts
 */
function playMockAd(trigger, { skippable, copy }) {
  return new Promise((resolve, reject) => {
    const overlay = el("div", { class: "ad-overlay", role: "dialog", "aria-modal": "true", "aria-label": copy.title });
    const countEl = el("div", { class: "ad-box__count" }, `${copy.seconds}초 후 보상을 받을 수 있습니다`);
    const actionBtn = el("button", { class: "btn btn--primary", type: "button", disabled: true }, "잠시만 기다려 주세요");
    const cancelBtn = el("button", { class: "btn btn--ghost", type: "button" }, "닫기 (보상 없음)");

    const box = el(
      "div",
      { class: "ad-box" },
      el(
        "div",
        { class: "ad-box__tag" },
        el("span", {}, "광고 · ADVERTISEMENT"),
        el("span", {}, skippable ? "INTERSTITIAL" : "REWARDED"),
      ),
      el(
        "div",
        { class: "ad-box__stage" },
        el("div", { class: "ad-box__mock", "aria-hidden": "true" }, "▣"),
        el("div", { class: "ad-box__note" }, "여기에 실제 광고가 노출됩니다"),
        el("div", { class: "ad-box__note" }, "광고 SDK 연동 대기 — 현재는 목업 화면입니다"),
      ),
      el(
        "div",
        { class: "ad-box__footer" },
        el("div", { class: "ad-box__reward" }, copy.reward),
        countEl,
        actionBtn,
        cancelBtn,
      ),
    );

    overlay.append(box);
    document.body.append(overlay);
    actionBtn.focus();

    let left = copy.seconds;
    const tick = setInterval(() => {
      left -= 1;
      if (left > 0) {
        countEl.textContent = `${left}초 후 보상을 받을 수 있습니다`;
        return;
      }
      clearInterval(tick);
      countEl.textContent = "시청 완료";
      actionBtn.disabled = false;
      actionBtn.textContent = skippable ? "확인" : "보상 받기";
      cancelBtn.remove();
    }, 1000);

    const close = () => {
      clearInterval(tick);
      overlay.remove();
    };

    actionBtn.addEventListener("click", () => {
      close();
      resolve();
    });

    cancelBtn.addEventListener("click", () => {
      close();
      reject(new Error("AD_CANCELLED"));
    });
  });
}

// ── 게임 코드가 사용하는 공개 API ─────────────────────────────

/**
 * 광고를 재생하고 서버에 보상을 요청합니다.
 *
 * @param {string} trigger  서버 AD_TRIGGERS 의 키
 * @param {{ sessionId?: string, copy?: { title?:string, reward?:string } }} opts
 *   copy — 같은 `_BOOST` 트리거라도 게임마다 보상 문구가 다르므로 호출부가 덮어씁니다.
 * @returns {Promise<object|null>} 서버가 지급한 보상 정보. 취소/실패 시 null
 */
export async function watchAdForReward(trigger, { sessionId, copy } = {}) {
  const text = copyOf(trigger, copy);

  try {
    await (isInterstitial(trigger)
      ? showInterstitialAd(trigger, text)
      : showRewardedAd(trigger, text));
  } catch {
    toast("광고를 끝까지 시청해야 보상이 지급됩니다.", "error");
    return null;
  }

  try {
    return await apiPost("/ad/reward", {
      trigger,
      session_id: sessionId ?? null,
      // 실연동 시에는 SDK 가 돌려준 검증용 값이 여기 실립니다.
      transaction_id: null,
    });
  } catch (err) {
    toast(err.message, "error");
    return null;
  }
}

/**
 * "추가 혜택" 보상 카드.
 *
 * 하단 고정 배너가 아니라 일반 콘텐츠 흐름 안에 놓이는 카드입니다.
 * 게임 시작 버튼보다 시각적으로 약하게 보이도록 surface 배경 + 얇은 테두리만 씁니다.
 *
 * @param {HTMLElement} host
 * @param {{ icon?:string, title:string, desc?:string, cta?:string,
 *           onClick:()=>void, disabled?:boolean }} opts
 * @returns {HTMLButtonElement}
 */
export function renderRewardCard(host, { icon = "🎁", title, desc, note, cta = "광고 보기", onClick, disabled = false }) {
  clear(host);

  const btn = el(
    "button",
    { class: "reward", type: "button", disabled, onclick: disabled ? null : onClick },
    el("span", { class: "reward__icon", "aria-hidden": "true" }, icon),
    el(
      "span",
      { class: "reward__text" },
      el("span", { class: "reward__title" }, title),
      desc ? el("span", { class: "reward__desc" }, desc) : null,
      note ? el("span", { class: "reward__note" }, note) : null,
    ),
    el("span", { class: "reward__cta" }, disabled ? "불가" : cta),
  );

  host.append(btn);
  return btn;
}

/** 보상 카드 영역 비우기 */
export const clearRewardCard = (host) => clear(host);
