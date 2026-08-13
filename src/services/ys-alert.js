/**
 * 너의스토리 워커 감시 — 멈추면 운영자에게 알린다 (2026-08-13)
 *
 * **알리는 쪽은 반드시 클라우드여야 한다.** 죽는 것이 PC 이므로 PC 는 자기 죽음을
 * 알릴 수 없다. 그래서 cron(`index.js` 의 `scheduled`)이 heartbeat 나이를 보고 판정한다.
 *
 * 탐지 지연은 **판정선 + cron 간격**이다. 처음에는 화면과 같은 5분 판정선에 10분
 * cron 이라 5~15분이었는데, 매분 cron + 알림 전용 4분 판정선으로 바꿔 **4~5분**이
 * 됐다(2026-08-13). 판정선을 따로 둔 이유는 `config.ALERT_STALE_MS` 에 적어 두었다.
 *
 * 알림은 장애 하나당 **두 번뿐**이다 — 끊겼을 때 한 번, 돌아왔을 때 한 번.
 * 반복해서 울리면 사람이 알림을 꺼 버리고, 꺼진 알림은 없는 것과 같다.
 * 상태는 `ys_worker.alert_down_at` 한 칸으로 기억한다(0023 마이그레이션).
 *
 * 텔레그램을 고른 이유는 **토큰이 만료되지 않아서**다. 카카오톡 「나에게 보내기」가
 * 더 익숙하지만 refresh token 이 2개월마다 끊기고, 그때 알림은 조용히 멈춘다 —
 * 감시 장치가 말없이 죽는 것이 감시 장치가 없는 것보다 나쁘다.
 */

import { YOURSTORY } from "../lib/config.js";

const ST = YOURSTORY.ST;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * heartbeat 를 보고 필요하면 알린다. cron 이 부른다.
 *
 * 반환값은 로그용이다. `state` 가 `down`/`recovered` 일 때만 알림이 나갔다.
 */
export async function checkWorkerAlert(env) {
  // 설정이 없으면 **상태도 건드리지 않는다.** 로컬·스테이징에서 조용히 지나가되,
  // 나중에 토큰을 넣었을 때 「이미 알린 것으로」 기록돼 첫 장애를 놓치는 일이 없다.
  if (!env.YS_ALERT_TG_TOKEN || !env.YS_ALERT_TG_CHAT) return { skipped: "unconfigured" };

  const row = await env.DB.prepare(
    `SELECT beat_at, alert_down_at FROM ys_worker WHERE id = 1`,
  ).first();
  // 워커가 한 번도 붙은 적이 없으면 「멈춘」 것이 아니라 아직 시작 전이다
  if (!row) return { skipped: "never-started" };

  const now = Date.now();
  // 화면의 판정선(WORKER_STALE_MS)이 아니라 **알림 전용 판정선**을 쓴다.
  // 그래서 「예약으로 받아요」가 뜨기 전에 알림이 먼저 갈 수 있다 — 의도한 것이다.
  const alive = now - row.beat_at < YOURSTORY.ALERT_STALE_MS;
  const alerted = row.alert_down_at != null;

  if (alive && !alerted) return { state: "ok" };
  if (!alive && alerted) return { state: "still_down" };

  const waiting = await waitingCount(env);

  if (!alive) {
    await send(env, [
      "🔴 너의스토리 워커가 멈췄습니다",
      "",
      `마지막 신호  ${hhmm(row.beat_at)} (${minsAgo(now - row.beat_at)} 전)`,
      waiting > 0 ? `대기 중인 예약  ${waiting}건` : "대기 중인 예약  없음",
      "",
      "접수는 계속 열려 있습니다(예약). 워커가 돌아오면 순서대로 나갑니다.",
      "PC 에서 되살리기 →  schtasks /run /tn YourStoryWorker",
    ].join("\n"));

    // **보낸 뒤에 기록한다.** 순서가 반대면 전송이 실패했을 때 「이미 알림」으로
    // 남아 그 장애는 영영 알려지지 않는다. 이 순서면 다음 cron 이 다시 시도한다.
    await env.DB.prepare(`UPDATE ys_worker SET alert_down_at = ? WHERE id = 1`)
      .bind(row.beat_at)
      .run();
    return { state: "down", waiting };
  }

  const downMs = now - row.alert_down_at;
  await send(env, [
    "🟢 너의스토리 워커가 돌아왔습니다",
    "",
    `멈춰 있던 시간  ${minsAgo(downMs)}`,
    waiting > 0 ? `밀린 예약  ${waiting}건 (순서대로 나갑니다)` : "밀린 예약  없음",
  ].join("\n"));

  await env.DB.prepare(`UPDATE ys_worker SET alert_down_at = NULL WHERE id = 1`).run();
  return { state: "recovered", downMs, waiting };
}

const waitingCount = async (env) =>
  (
    await env.DB.prepare(`SELECT COUNT(*) AS n FROM ys_order WHERE status = ?`)
      .bind(ST.QUEUED_BRAIN)
      .first()
  )?.n ?? 0;

/**
 * 텔레그램 한 통.
 *
 * 실패하면 던진다 — 삼키면 알림이 안 가는데도 상태만 「알림 완료」로 넘어간다.
 */
async function send(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.YS_ALERT_TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.YS_ALERT_TG_CHAT,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`telegram ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** 'HH:MM' (KST) — 운영자가 보는 시각은 서버 UTC 가 아니다 */
const hhmm = (ts) => new Date(ts + KST_OFFSET_MS).toISOString().slice(11, 16);

const minsAgo = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
};
