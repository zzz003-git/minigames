/**
 * POST /game/session/arm
 *
 * "실제 플레이가 지금 시작됐다" 를 서버에 알립니다.
 *   - 스탑워치: START 를 탭한 순간
 *   - 타이핑:   3초 카운트다운이 끝난 순간
 *
 * 클라이언트는 이 요청의 응답을 기다리지 않고 즉시 타이머를 돌립니다.
 * (응답을 기다리면 네트워크 지연이 기록에 섞이기 때문)
 * 서버는 요청이 도착한 시각을 armed_ts 로 저장하고, 결과 제출 때
 * "그 시각 이후 이만큼 흐른 것이 물리적으로 가능한가" 를 검증합니다.
 */

import { requireOneOf } from "../lib/http.js";
import { getOpenSession, armSession } from "../lib/db.js";

export async function arm({ env, userId, body }) {
  const gameType = requireOneOf(body.game_type, "game_type", ["STOPWATCH", "TYPING", "MEMORY"]);
  const session = await getOpenSession(env, body.session_id, userId, gameType);
  const { armed_ts, applied } = await armSession(env, session.session_id);
  return { armed_ts: session.armed_ts ?? armed_ts, applied };
}
