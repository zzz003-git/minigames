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

/** 트리거별 안내 문구 (기획서 11장 트리거 명세와 1:1 대응) */
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

const REWARDED = new Set([
  "STOPWATCH_ATTEMPT",
  "BASEBALL_ATTEMPT",
  "TYPING_SENTENCE",
  "MEMORY_LEVEL",
]);

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
async function showRewardedAd(trigger) {
  // TODO(광고 연동): 아래 목업 호출을 SDK 호출로 교체
  //   return AdSdk.showRewarded({ placement: trigger });
  return playMockAd(trigger, { skippable: false });
}

/**
 * 전면 광고 노출.
 * @param {string} trigger
 * @returns {Promise<void>}
 */
async function showInterstitialAd(trigger) {
  // TODO(광고 연동): 아래 목업 호출을 SDK 호출로 교체
  //   return AdSdk.showInterstitial({ placement: trigger });
  return playMockAd(trigger, { skippable: true });
}

// ── 목업 광고 오버레이 ────────────────────────────────────────

/**
 * 광고 자리를 시각적으로 보여주는 목업. 카운트다운이 끝나면 닫을 수 있습니다.
 * @param {string} trigger
 * @param {{ skippable:boolean }} opts  skippable=true 면 카운트다운 후 바로 닫기 버튼
 */
function playMockAd(trigger, { skippable }) {
  const copy = TRIGGER_COPY[trigger] ?? { title: "광고", reward: "", seconds: 5 };

  return new Promise((resolve, reject) => {
    const overlay = el("div", { class: "ad-overlay", role: "dialog", "aria-modal": "true" });
    const countEl = el("div", { class: "ad-box__count" }, `${copy.seconds}초 후 보상을 받을 수 있습니다`);
    const actionBtn = el("button", { class: "btn btn--primary", type: "button", disabled: true }, "잠시만 기다려 주세요");
    const cancelBtn = el("button", { class: "btn btn--ghost", type: "button" }, "닫기 (보상 없음)");

    const box = el(
      "div",
      { class: "ad-box" },
      el("div", { class: "ad-box__tag" }, el("span", {}, "광고 · Advertisement"), el("span", {}, skippable ? "INTERSTITIAL" : "REWARDED")),
      el(
        "div",
        { class: "ad-box__stage" },
        el("div", { class: "ad-box__mock" }, "📺"),
        el("div", { class: "ad-box__note" }, "여기에 실제 광고가 노출됩니다."),
        el("div", { class: "ad-box__note" }, "(광고 SDK 연동 대기 — 현재는 목업 화면)"),
      ),
      el(
        "div",
        { class: "ad-box__footer" },
        el("div", { class: "hint" }, copy.reward),
        countEl,
        actionBtn,
        cancelBtn,
      ),
    );

    overlay.append(box);
    document.body.append(overlay);

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
 * @param {string} trigger  TRIGGER_COPY 의 키 (= 서버 AD_TRIGGERS 키와 동일)
 * @param {{ sessionId?: string }} opts
 * @returns {Promise<object|null>} 서버가 지급한 보상 정보. 취소/실패 시 null
 */
export async function watchAdForReward(trigger, { sessionId } = {}) {
  const isRewarded = REWARDED.has(trigger);

  try {
    await (isRewarded ? showRewardedAd(trigger) : showInterstitialAd(trigger));
  } catch {
    toast("광고를 끝까지 시청해야 보상이 지급됩니다.", "error");
    return null;
  }

  try {
    const res = await apiPost("/ad/reward", {
      trigger,
      session_id: sessionId ?? null,
      // 실연동 시에는 SDK 가 돌려준 검증용 값이 여기 실립니다.
      transaction_id: null,
    });
    return res;
  } catch (err) {
    toast(err.message, "error");
    return null;
  }
}

/** 하단 고정 광고 배너 버튼을 만듭니다. */
export function renderAdBar(host, { label, onClick }) {
  clear(host);
  const btn = el("button", { class: "adbar", type: "button", onclick: onClick }, label);
  host.append(btn);
  return btn;
}
