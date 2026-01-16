const API_BASE_URL = 'https://api.aon2.info/api/v1/aion2';
const PROXY_URL = '';
const APP_VERSION = '2026-01-09.1';

// 게시글 등록 알림(모집/구직)
const POST_WEBHOOK_SECRET = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1NjU1OTI1NzA3ODk4ODgyMS81VDczT1VxWUxnZzFEYUs1Skk3M0R2OFpfYzdNVlBiajZXUkE0c3VyQ0paQ1ZXSW96T1Voel9rWDBhVEdiSkx3WkJLRg==';
// 삭제 사유/오류 로그(감사용)
const LOG_WEBHOOK_SECRET = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1ODY4MjU4OTQ1MDg2NjY4OS9QazduSFUtRmlubTJGQmo1cTk3UF85YU5hNzhZU3ZTOGRaY2M4OGdQaVFTZ285RXhqOXU4aDQ1UlNpQ291QTJiUUVVRQ==';

const DISCORD_POST_WEBHOOK_URL = atob(POST_WEBHOOK_SECRET);
const DISCORD_LOG_WEBHOOK_URL = atob(LOG_WEBHOOK_SECRET);

// 뽑기 당첨 알림 (Discord 특정 채널 웹훅)
// ⚠️ 코드에 웹훅 URL을 넣으면 누구나 스팸 전송이 가능해집니다.
// 사용자가 요청한 “하드코딩 방식”으로 동작하도록 아래 상수에 웹훅 URL을 넣어두면
// 모든 사용자 당첨 시 자동으로 디스코드에 전송됩니다.
const DISCORD_GACHA_WIN_WEBHOOK_URL = 'https://discord.com/api/webhooks/1461253087606866022/u1PYYFXAEEaNl9z16ENXMerFVSd2w_GjWSZtVgYCNTngu0vcZLYrk_kskSWYkX-857wN';

// (옵션) 하드코딩이 부담되면 localStorage에 넣는 방식도 지원
const GACHA_WIN_WEBHOOK_STORAGE_KEY = 'rudra_gacha_win_webhook_url';

function getGachaWinWebhookUrl() {
    try {
        if (DISCORD_GACHA_WIN_WEBHOOK_URL) return DISCORD_GACHA_WIN_WEBHOOK_URL;
        const v = String(localStorage.getItem(GACHA_WIN_WEBHOOK_STORAGE_KEY) || '').trim();
        if (!v) return '';
        if (v.startsWith('https://') || v.startsWith('http://')) return v;
        const decoded = atob(v);
        if (decoded.startsWith('https://') || decoded.startsWith('http://')) return decoded;
        return '';
    } catch {
        return '';
    }
}

const DISCORD_ADMIN = {

    clientId: '1440197568847151214',
    guildId: '1427195769793937428',
    roleId: '1427200649971372052',
    scopes: ['identify', 'guilds.members.read'],
    verifyEndpoint: 'https://frosty-tooth-60e.k47m31s.workers.dev/'
};

const CONSTANTS = {
    DEFAULT_EXPIRATION_MS: 3 * 60 * 60 * 1000,
    NOTICE_LIMIT: 3
};

// =========================
// Points / Gacha (Firestore 기반)
// =========================
const POINTS = {
    COST_GACHA: 100,
    BASE_RATE: 0.0005, // 0.05%
    EARN: {
        ATTENDANCE: 10,
        POST: 10,
        STREAK_3: 10,
        STREAK_7: 30,
        STREAK_14: 70
    },
    LIMITS: {
        ATTENDANCE: { daily: 1, weekly: 7 },
        POST_PARTY: { daily: 3, weekly: 21 },  // 파티원 구해요
        POST_MEMBER: { daily: 3, weekly: 21 }  // 파티 구해요
    }
};

const FIRESTORE_POINTS = {
    summary: 'user_point_summary',
    state: 'point_state',
    counters: 'point_counters',
    ledgerUsers: 'point_ledger_users',
    publicAdminLog: 'public_point_admin_log',
    gachaDrawsUsers: 'gacha_draws_users',
    userProfiles: 'user_profiles',
    nicknameIndex: 'nickname_index',
    admins: 'admins',
    roots: 'roots',
    gachaEvent: 'gacha_event',
    gachaRounds: 'gacha_rounds'
};

function normalizeNickname(nick) {
    return String(nick || '').trim();
}

function nicknameKey(nick) {
    const n = normalizeNickname(nick).toLowerCase();
    if (!n) return null;
    // Firestore doc id로 쓰기 위해 최소한의 정규화
    // (한글 포함 대부분 안전. 슬래시만 제거)
    return n.replaceAll('/', '_');
}

function getKstDateKeyFromNow() {
    // KST는 UTC+9 고정(서머타임 없음). "지금"을 +9h shift한 뒤 UTC 기준 날짜를 key로 사용.
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getIsoWeekKeyFromKstNow() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    // ISO week (Mon=1..Sun=7), Thursday 기준으로 연도/주차 결정
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getPointsRefsForUser(userId) {
    const summaryRef = db.collection(FIRESTORE_POINTS.summary).doc(userId);
    const stateRef = db.collection(FIRESTORE_POINTS.state).doc(userId);
    const ledgerCol = db.collection(FIRESTORE_POINTS.ledgerUsers).doc(userId).collection('items');
    const drawsCol = db.collection(FIRESTORE_POINTS.gachaDrawsUsers).doc(userId).collection('items');
    return { summaryRef, stateRef, ledgerCol, drawsCol };
}

async function ensurePointDocsForCurrentUser() {
    if (!db) return;
    if (!currentUser?.uid) return;
    const userId = currentUser.uid;
    const { summaryRef, stateRef } = getPointsRefsForUser(userId);

    try {
        await db.runTransaction(async (tx) => {
            const [sSnap, stSnap] = await Promise.all([tx.get(summaryRef), tx.get(stateRef)]);
            const nowIso = new Date().toISOString();

            if (!sSnap.exists) {
                tx.set(summaryRef, {
                    userId,
                    userNickname: currentUser.name || '',
                    balance: 0,
                    lifetimeEarned: 0,
                    updatedAt: nowIso
                });
            } else {
                tx.set(summaryRef, { userNickname: currentUser.name || '', updatedAt: nowIso }, { merge: true });
            }

            if (!stSnap.exists) {
                tx.set(stateRef, {
                    userId,
                    userNickname: currentUser.name || '',
                    lastCheckinKstDate: null,
                    currentStreakDays: 0,
                    claimed3: false,
                    claimed7: false,
                    claimed14: false,
                    totalDraws: 0,
                    totalWins: 0,
                    gachaPity: 0,
                    gachaNextLuck: null,
                    updatedAt: nowIso
                });
            } else {
                tx.set(stateRef, { userNickname: currentUser.name || '', updatedAt: nowIso }, { merge: true });
            }
        });
    } catch (e) {
        console.error('포인트 초기화 실패:', e);
    }
}

function pointsTypeLabel(type) {
    switch (type) {
        case 'EARN_ATTENDANCE': return '출석 체크';
        case 'EARN_POST_PARTY': return '파티원 구해요 글 작성';
        case 'EARN_POST_MEMBER': return '파티 구해요 글 작성';
        case 'EARN_STREAK_3': return '3일 연속 출석 보너스';
        case 'EARN_STREAK_7': return '7일 연속 출석 보너스';
        case 'EARN_STREAK_14': return '14일 연속 출석 보너스';
        case 'SPEND_GACHA': return '뽑기 1회';
        case 'ADMIN_ADJUST': return '관리자 지급/회수';
        case 'ROOT_BULK_ADJUST': return 'ROOT 일괄 지급/회수';
        default: return type || '';
    }
}

function fmtInt(n) {
    const x = Number(n) || 0;
    return Math.floor(x).toLocaleString();
}

function fmtRate(rate) {
    const r = Number(rate) || 0;
    return `${(r * 100).toFixed(1)}%`;
}

// =========================
// Gacha event config (KST)
// =========================
let gachaEventCache = { loadedAt: 0, data: null };

function parseKstDateTimeLocalToUtcIso(dtLocal) {
    // dtLocal: "YYYY-MM-DDTHH:mm" (사용자 입력을 KST로 해석)
    const s = String(dtLocal || '').trim();
    if (!s) return null;
    // KST를 UTC로 변환: KST = UTC+9 → UTC = KST-9
    const [datePart, timePart] = s.split('T');
    if (!datePart || !timePart) return null;
    const [y, m, d] = datePart.split('-').map(n => parseInt(n, 10));
    const [hh, mm] = timePart.split(':').map(n => parseInt(n, 10));
    if (!y || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    const utcMs = Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
    return new Date(utcMs).toISOString();
}

async function loadGachaEventConfig(force = false) {
    if (!db) return null;
    const now = Date.now();
    if (!force && gachaEventCache.data && (now - gachaEventCache.loadedAt) < 30_000) return gachaEventCache.data;
    try {
        const snap = await db.collection(FIRESTORE_POINTS.gachaEvent).doc('current').get();
        const data = snap.exists ? snap.data() : null;
        gachaEventCache = { loadedAt: now, data };
        return data;
    } catch (e) {
        console.error('gacha event config load failed:', e);
        return null;
    }
}

function isGachaEventActive(cfg, nowUtc = new Date()) {
    const enabled = cfg?.eventEnabled ?? cfg?.enabled; // 구버전 호환
    if (!cfg || enabled !== true) return false;
    const start = cfg.startAtUtc ? new Date(cfg.startAtUtc) : null;
    const end = cfg.endAtUtc ? new Date(cfg.endAtUtc) : null;
    if (!start || Number.isNaN(start.getTime())) return false;
    if (!end || Number.isNaN(end.getTime())) return false;
    const t = nowUtc.getTime();
    return t >= start.getTime() && t <= end.getTime();
}

function getGachaBaseRate(cfg) {
    const active = isGachaEventActive(cfg);
    if (!active) return POINTS.BASE_RATE;
    const mult = Number(cfg.multiplier) || 1;
    return POINTS.BASE_RATE * Math.max(0, mult);
}

function getGachaCost(cfg) {
    const base = POINTS.COST_GACHA;
    const active = isGachaEventActive(cfg);
    if (!active) return base;
    const v = Number(cfg?.costOverride);
    if (Number.isFinite(v) && v >= 0) return Math.floor(v);
    return base;
}

function getGachaControl(cfg) {
    return {
        gachaEnabled: cfg?.gachaEnabled === true, // 명시적으로 true일 때만
        roundNo: Number.isFinite(Number(cfg?.gachaRoundNo)) ? Math.floor(Number(cfg.gachaRoundNo)) : null,
        maxWinners: Number.isFinite(Number(cfg?.gachaMaxWinners)) ? Math.floor(Number(cfg.gachaMaxWinners)) : null,
        winnersCount: Number.isFinite(Number(cfg?.gachaWinnersCount)) ? Math.floor(Number(cfg.gachaWinnersCount)) : 0
    };
}

function pickNextLuckTier() {
    // 등장확률(요구사항 문구/UI 의미에 맞춰 정리)
    // - 98%: 보상 없음(다음 뽑기 확률 변화 없음) → null
    // - 1.5%: 다음 뽑기 한정 소폭 증가 → 'minor'
    // - 0.5%: 다음 뽑기 한정 대폭 증가 → 'major'
    const u = Math.random() * 100;
    if (u < 0.5) return 'major';     // 0.5%
    if (u < 2.0) return 'minor';     // 1.5%
    return null;                    // 98%
}

function computeWinRateForDraw({ cfg, baseRate, nextLuckTier }) {
    const eventActive = isGachaEventActive(cfg);

    // 이벤트 중에는 "다음 1회 한정 당첨 확률"을 무조건 고정(요구사항)
    if (eventActive) {
        if (nextLuckTier === 'minor') return 0.02;  // 2%
        if (nextLuckTier === 'major') return 0.035; // 3.5%
        return baseRate; // 기본은 배수 적용
    }

    // 이벤트 없을 때: 기본 + 증가
    if (nextLuckTier === 'minor') return baseRate + 0.01; // +1%
    if (nextLuckTier === 'major') return baseRate + 0.03; // +3%
    return baseRate;
}

function formatFirestoreError(e) {
    const code = e?.code ? String(e.code) : '';
    const msg = e?.message ? String(e.message) : String(e || '');
    // firebase compat 에러는 message에 "Missing or insufficient permissions." 같은 핵심이 들어감
    if (code && msg) return `${code}: ${msg}`;
    return msg || code || 'unknown error';
}

function addDaysToDateKey(dateKey, deltaDays) {
    const [y, m, d] = String(dateKey || '').split('-').map(v => parseInt(v, 10));
    if (!y || !m || !d) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + (Number(deltaDays) || 0));
    return dt.toISOString().slice(0, 10);
}

async function refreshPointsHeader() {
    if (!elements.pointsBalanceText) return;
    if (!db || !currentUser?.uid) {
        elements.pointsBalanceText.textContent = '0pt';
        return;
    }

    const userId = currentUser.uid;

    try {
        const snap = await db.collection(FIRESTORE_POINTS.summary).doc(userId).get();
        const balance = snap.exists ? (snap.data()?.balance || 0) : 0;
        elements.pointsBalanceText.textContent = `${fmtInt(balance)}pt`;
    } catch (e) {
        console.error(e);
    }
}

function closePointsModal() {
    if (!elements.pointsModal) return;
    elements.pointsModal.classList.add('hidden');
}

function setPointsTabActive(tab) {
    if (!elements.pointsTabBtns) return;
    elements.pointsTabBtns.forEach(b => b.classList.toggle('active', b.dataset.pointsTab === tab));

    if (elements.pointsTabMe) elements.pointsTabMe.classList.toggle('hidden', tab !== 'me');
    if (elements.pointsTabGacha) elements.pointsTabGacha.classList.toggle('hidden', tab !== 'gacha');
    if (elements.pointsTabEvent) elements.pointsTabEvent.classList.toggle('hidden', tab !== 'event');
    if (elements.pointsTabRanking) elements.pointsTabRanking.classList.toggle('hidden', tab !== 'ranking');
    if (elements.pointsTabPublicLog) elements.pointsTabPublicLog.classList.toggle('hidden', tab !== 'publicLog');
    if (elements.pointsTabAdmin) elements.pointsTabAdmin.classList.toggle('hidden', tab !== 'admin');
}

async function switchPointsTab(tab) {
    setPointsTabActive(tab);
    if (tab === 'ranking') await loadPointsRanking();
    if (tab === 'publicLog') await loadPointsPublicAdminLog();
    if (tab === 'gacha') await refreshGachaPanel();
    if (tab === 'admin') await loadPendingApprovals();
    if (tab === 'event') await refreshEventPanel();
}

async function openPointsModal() {
    if (!currentUser) {
        alert('로그인 후 이용 가능합니다.');
        elements.authModal?.classList.remove('hidden');
        return;
    }
    if (!db) {
        alert('DB 연결 설정이 필요합니다.');
        return;
    }
    if (!elements.pointsModal) return;

    elements.pointsModal.classList.remove('hidden');
    setPointsTabActive('me');

    // 승인 전: 포인트 기능 잠금
    if (!currentUser.pointsApproved && !currentUser.isAdmin) {
        // 탭 버튼 잠금(내 포인트 탭만 안내용으로 사용)
        if (elements.pointsTabBtns) {
            elements.pointsTabBtns.forEach(b => {
                const t = b.dataset.pointsTab;
                if (!t) return;
                b.disabled = t !== 'me';
            });
        }
        if (elements.attendanceBtn) elements.attendanceBtn.disabled = true;
        if (elements.gachaDrawBtn) elements.gachaDrawBtn.disabled = true;
        if (elements.pointsRefreshBtn) elements.pointsRefreshBtn.disabled = true;
        if (elements.streakToday) elements.streakToday.textContent = '포인트 승인 필요';
        if (elements.streakHint) elements.streakHint.textContent = '포인트 기능은 관리자 승인 후 사용할 수 있습니다.';
        if (elements.pointsLedgerList) elements.pointsLedgerList.innerHTML = `<div class="points-empty">포인트 기능은 관리자 승인 후 사용할 수 있습니다.</div>`;
        if (elements.gachaResult) { elements.gachaResult.classList.remove('hidden'); elements.gachaResult.textContent = '포인트 승인 후 뽑기를 이용할 수 있습니다.'; }
        return;
    }

    if (elements.pointsTabBtns) {
        elements.pointsTabBtns.forEach(b => { b.disabled = false; });
    }
    if (elements.attendanceBtn) elements.attendanceBtn.disabled = false;
    if (elements.gachaDrawBtn) elements.gachaDrawBtn.disabled = false;
    if (elements.pointsRefreshBtn) elements.pointsRefreshBtn.disabled = false;

    await ensurePointDocsForCurrentUser();
    await refreshPointsAll();
}

async function refreshPointsAll(opts = {}) {
    if (!db || !currentUser?.uid) return;
    await Promise.all([
        refreshPointsHeader(),
        refreshPointsMePanel(),
        loadMyPointLedger(),
        refreshGachaPanel()
    ]);
    if (opts.showToastOnDone) showToast(`<i class="fa-solid fa-rotate"></i> 포인트 정보를 갱신했습니다.`);
}

async function refreshPointsMePanel() {
    if (!db || !currentUser?.uid) return;
    const userId = currentUser.uid;

    const summaryRef = db.collection(FIRESTORE_POINTS.summary).doc(userId);
    const stateRef = db.collection(FIRESTORE_POINTS.state).doc(userId);
    const kstDate = getKstDateKeyFromNow();

    try {
        const [sSnap, stSnap] = await Promise.all([summaryRef.get(), stateRef.get()]);
        const s = sSnap.exists ? sSnap.data() : {};
        const st = stSnap.exists ? stSnap.data() : {};

        const balance = Number(s?.balance) || 0;
        const lifetime = Number(s?.lifetimeEarned) || 0;
        if (elements.pointsMeBalance) elements.pointsMeBalance.textContent = `${fmtInt(balance)}pt`;
        if (elements.pointsMeLifetime) elements.pointsMeLifetime.textContent = `${fmtInt(lifetime)}pt`;

        const last = st?.lastCheckinKstDate || null;
        const streakDays = Number(st?.currentStreakDays) || 0;
        const claimed3 = !!st?.claimed3;
        const claimed7 = !!st?.claimed7;
        const claimed14 = !!st?.claimed14;

        const hasToday = last === kstDate;
        if (elements.streakToday) elements.streakToday.textContent = `오늘: ${hasToday ? '완료' : '미완료'} (KST ${kstDate})`;
        if (elements.streakDays) elements.streakDays.textContent = String(streakDays);

        let nextTarget = null;
        if (!claimed3) nextTarget = 3;
        else if (!claimed7) nextTarget = 7;
        else if (!claimed14) nextTarget = 14;

        if (elements.streakNext) {
            elements.streakNext.textContent = nextTarget ? `${nextTarget}일` : '-';
        }

        const prog = nextTarget ? Math.min(streakDays, nextTarget) / nextTarget : 1;
        if (elements.streakBar) elements.streakBar.style.width = `${Math.round(prog * 100)}%`;
        if (elements.streakHint) {
            if (!nextTarget) elements.streakHint.textContent = '14일 보너스까지 모두 달성했습니다.';
            else if (streakDays >= nextTarget) elements.streakHint.textContent = '다음 출석 시 보너스가 이미 조건을 만족하면 즉시 지급됩니다.';
            else elements.streakHint.textContent = `${nextTarget - streakDays}일 더 출석하면 보너스를 받을 수 있어요.`;
        }
    } catch (e) {
        console.error(e);
    }
}

function renderLedgerRows(list) {
    if (!elements.pointsLedgerList) return;
    if (!list.length) {
        elements.pointsLedgerList.innerHTML = `<div class="points-empty">표시할 원장 내역이 없습니다.</div>`;
        return;
    }

    elements.pointsLedgerList.innerHTML = list.map(it => {
        const delta = Number(it.delta) || 0;
        const plus = delta >= 0;
        const title = pointsTypeLabel(it.type);
        const when = it.kstDate ? `KST ${it.kstDate}` : '';
        const kst = it.createdAt ? (formatKst(it.createdAt) || '') : '';
        const reason = it.reasonText ? `사유: ${it.reasonText}` : '';
        const ref = it.refType && it.refId ? `ref: ${it.refType}/${it.refId}` : '';

        const meta = [when, kst ? `(${kst})` : null, reason, ref].filter(Boolean).join('\n');
        return `
            <div class="points-row">
                <div class="left">
                    <div class="title">${escapeHtml(title)}</div>
                    <div class="meta">${escapeHtml(meta)}</div>
                </div>
                <div class="delta ${plus ? 'plus' : 'minus'}">${plus ? '+' : ''}${fmtInt(delta)}pt</div>
            </div>
        `;
    }).join('');
}

async function loadMyPointLedger() {
    if (!db || !currentUser?.uid || !elements.pointsLedgerList) return;
    const userId = currentUser.uid;
    const { ledgerCol } = getPointsRefsForUser(userId);

    try {
        const snap = await ledgerCol.orderBy('createdAt', 'desc').limit(20).get();
        const list = [];
        snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        renderLedgerRows(list);
    } catch (e) {
        console.error(e);
        elements.pointsLedgerList.innerHTML = `<div class="points-empty">원장 로드 실패: ${escapeHtml(formatFirestoreError(e))}</div>`;
    }
}

async function doAttendanceCheck() {
    if (!db) return alert('DB 연결이 필요합니다.');
    if (!currentUser?.uid) return alert('로그인 후 이용 가능합니다.');
    if (!currentUser.pointsApproved && !currentUser.isAdmin) return alert('포인트 기능은 관리자 승인 후 사용 가능합니다.');

    const userId = currentUser.uid;

    const kstDate = getKstDateKeyFromNow();
    const weekKey = getIsoWeekKeyFromKstNow();
    const nowIso = new Date().toISOString();

    const { summaryRef, stateRef, ledgerCol } = getPointsRefsForUser(userId);
    const ledgerRef = ledgerCol.doc(`EARN_ATTENDANCE__${kstDate}`);
    const dailyRef = db.collection(FIRESTORE_POINTS.counters).doc(`D__${userId}__ATTENDANCE__${kstDate}`);
    const weeklyRef = db.collection(FIRESTORE_POINTS.counters).doc(`W__${userId}__ATTENDANCE__${weekKey}`);

    const yesterday = addDaysToDateKey(kstDate, -1);

    try {
        const result = await db.runTransaction(async (tx) => {
            const [ledgerSnap, dSnap, wSnap, sSnap, stSnap] = await Promise.all([
                tx.get(ledgerRef),
                tx.get(dailyRef),
                tx.get(weeklyRef),
                tx.get(summaryRef),
                tx.get(stateRef)
            ]);

            if (ledgerSnap.exists) return { ok: false, code: 'already' };

            const dailyCount = Number(dSnap.exists ? dSnap.data()?.count : 0) || 0;
            const weeklyCount = Number(wSnap.exists ? wSnap.data()?.count : 0) || 0;
            if (dailyCount >= POINTS.LIMITS.ATTENDANCE.daily) return { ok: false, code: 'daily_limit' };
            if (weeklyCount >= POINTS.LIMITS.ATTENDANCE.weekly) return { ok: false, code: 'weekly_limit' };

            const sum = sSnap.exists ? sSnap.data() : {};
            const curBalance = Number(sum?.balance) || 0;
            const curLifetime = Number(sum?.lifetimeEarned) || 0;

            // 출석 10pt 지급
            tx.set(ledgerRef, {
                userId,
                userNickname: currentUser.name,
                type: 'EARN_ATTENDANCE',
                delta: POINTS.EARN.ATTENDANCE,
                refType: 'attendance',
                refId: kstDate,
                reasonText: null,
                createdAt: nowIso,
                kstDate,
                kstWeekKey: weekKey
            });

            tx.set(dailyRef, { userId, action: 'ATTENDANCE', scope: 'D', key: kstDate, count: firebase.firestore.FieldValue.increment(1), updatedAt: nowIso }, { merge: true });
            tx.set(weeklyRef, { userId, action: 'ATTENDANCE', scope: 'W', key: weekKey, count: firebase.firestore.FieldValue.increment(1), updatedAt: nowIso }, { merge: true });

            tx.set(summaryRef, {
                userId,
                userNickname: currentUser.name,
                balance: curBalance + POINTS.EARN.ATTENDANCE,
                lifetimeEarned: curLifetime + POINTS.EARN.ATTENDANCE,
                updatedAt: nowIso
            }, { merge: true });

            // 연속 출석 상태 갱신 + 보너스
            const st = stSnap.exists ? stSnap.data() : {};
            const last = st?.lastCheckinKstDate || null;
            let streakDays = Number(st?.currentStreakDays) || 0;
            let claimed3 = !!st?.claimed3;
            let claimed7 = !!st?.claimed7;
            let claimed14 = !!st?.claimed14;

            if (last === yesterday) {
                streakDays += 1;
            } else {
                streakDays = 1;
                claimed3 = false;
                claimed7 = false;
                claimed14 = false;
            }

            let bonusTotal = 0;

            const tryBonus = async (milestone, delta, claimedKey) => {
                if (streakDays < milestone) return;
                if (claimedKey === 'claimed3' && claimed3) return;
                if (claimedKey === 'claimed7' && claimed7) return;
                if (claimedKey === 'claimed14' && claimed14) return;

                const bonusRef = ledgerCol.doc(`EARN_STREAK_${milestone}__${kstDate}`);
                const bonusSnap = await tx.get(bonusRef);
                if (bonusSnap.exists) return;

                tx.set(bonusRef, {
                    userId,
                    userNickname: currentUser.name,
                    type: `EARN_STREAK_${milestone}`,
                    delta,
                    refType: 'attendance_streak',
                    refId: String(milestone),
                    reasonText: null,
                    createdAt: nowIso,
                    kstDate,
                    kstWeekKey: weekKey
                });

                bonusTotal += delta;
                if (claimedKey === 'claimed3') claimed3 = true;
                if (claimedKey === 'claimed7') claimed7 = true;
                if (claimedKey === 'claimed14') claimed14 = true;
            };

            await tryBonus(3, POINTS.EARN.STREAK_3, 'claimed3');
            await tryBonus(7, POINTS.EARN.STREAK_7, 'claimed7');
            await tryBonus(14, POINTS.EARN.STREAK_14, 'claimed14');

            if (bonusTotal > 0) {
                tx.set(summaryRef, {
                    balance: curBalance + POINTS.EARN.ATTENDANCE + bonusTotal,
                    lifetimeEarned: curLifetime + POINTS.EARN.ATTENDANCE + bonusTotal,
                    updatedAt: nowIso
                }, { merge: true });
            }

            tx.set(stateRef, {
                userId,
                userNickname: currentUser.name,
                lastCheckinKstDate: kstDate,
                currentStreakDays: streakDays,
                claimed3,
                claimed7,
                claimed14,
                updatedAt: nowIso
            }, { merge: true });

            return { ok: true, streakDays, bonusTotal };
        });

        if (!result?.ok) {
            if (result.code === 'already') return showToast(`<i class="fa-solid fa-circle-info"></i> 오늘은 이미 출석 체크를 했습니다.`);
            if (result.code === 'daily_limit') return showToast(`<i class="fa-solid fa-circle-info"></i> 출석은 일일 최대 1회입니다.`);
            if (result.code === 'weekly_limit') return showToast(`<i class="fa-solid fa-circle-info"></i> 출석은 주간 최대 7회입니다.`);
            return showToast(`<i class="fa-solid fa-circle-info"></i> 출석 처리에 실패했습니다.`);
        }

        const bonusMsg = result.bonusTotal > 0 ? ` (+보너스 ${fmtInt(result.bonusTotal)}pt)` : '';
        showToast(`<i class="fa-solid fa-calendar-check"></i> 출석 완료 +${POINTS.EARN.ATTENDANCE}pt${bonusMsg}`);
        await refreshPointsAll();
    } catch (e) {
        console.error(e);
        alert('출석 처리 중 오류가 발생했습니다.\n\n' + formatFirestoreError(e));
    }
}

async function awardPostCreatePoints(postType, postId) {
    if (!db || !currentUser?.uid) return;
    if (!currentUser.pointsApproved && !currentUser.isAdmin) return;
    if (!postId) return;

    const userId = currentUser.uid;

    const kstDate = getKstDateKeyFromNow();
    const weekKey = getIsoWeekKeyFromKstNow();
    const nowIso = new Date().toISOString();

    const isParty = postType === 'party';   // 파티원 구해요
    const isMember = postType === 'member'; // 파티 구해요
    if (!isParty && !isMember) return;

    const actionKey = isParty ? 'POST_PARTY' : 'POST_MEMBER';
    const limits = isParty ? POINTS.LIMITS.POST_PARTY : POINTS.LIMITS.POST_MEMBER;
    const type = isParty ? 'EARN_POST_PARTY' : 'EARN_POST_MEMBER';

    const { summaryRef, ledgerCol } = getPointsRefsForUser(userId);
    const ledgerRef = ledgerCol.doc(`${type}__${postId}`);
    const dailyRef = db.collection(FIRESTORE_POINTS.counters).doc(`D__${userId}__${actionKey}__${kstDate}`);
    const weeklyRef = db.collection(FIRESTORE_POINTS.counters).doc(`W__${userId}__${actionKey}__${weekKey}`);

    try {
        const res = await db.runTransaction(async (tx) => {
            const [lSnap, dSnap, wSnap, sSnap] = await Promise.all([
                tx.get(ledgerRef),
                tx.get(dailyRef),
                tx.get(weeklyRef),
                tx.get(summaryRef)
            ]);

            if (lSnap.exists) return { ok: false, code: 'already' };
            const dailyCount = Number(dSnap.exists ? dSnap.data()?.count : 0) || 0;
            const weeklyCount = Number(wSnap.exists ? wSnap.data()?.count : 0) || 0;
            if (dailyCount >= limits.daily) return { ok: false, code: 'daily_limit' };
            if (weeklyCount >= limits.weekly) return { ok: false, code: 'weekly_limit' };

            const sum = sSnap.exists ? sSnap.data() : {};
            const curBalance = Number(sum?.balance) || 0;
            const curLifetime = Number(sum?.lifetimeEarned) || 0;

            tx.set(ledgerRef, {
                userId,
                userNickname: currentUser.name,
                type,
                delta: POINTS.EARN.POST,
                refType: 'post',
                refId: String(postId),
                reasonText: null,
                createdAt: nowIso,
                kstDate,
                kstWeekKey: weekKey
            });

            tx.set(dailyRef, { userId, action: actionKey, scope: 'D', key: kstDate, count: firebase.firestore.FieldValue.increment(1), updatedAt: nowIso }, { merge: true });
            tx.set(weeklyRef, { userId, action: actionKey, scope: 'W', key: weekKey, count: firebase.firestore.FieldValue.increment(1), updatedAt: nowIso }, { merge: true });

            tx.set(summaryRef, {
                userId,
                userNickname: currentUser.name,
                balance: curBalance + POINTS.EARN.POST,
                lifetimeEarned: curLifetime + POINTS.EARN.POST,
                updatedAt: nowIso
            }, { merge: true });

            return { ok: true };
        });

        if (res?.ok) {
            showToast(`<i class="fa-solid fa-coins"></i> 포인트 +${POINTS.EARN.POST}pt (글 작성)`);
            await refreshPointsHeader();
        }
    } catch (e) {
        console.error('게시글 포인트 지급 실패:', e);
    }
}

async function refreshGachaPanel(opts = {}) {
    if (!db || !currentUser?.uid) return;
    const userId = currentUser.uid;

    const stateRef = db.collection(FIRESTORE_POINTS.state).doc(userId);
    try {
        const cfg = await loadGachaEventConfig(false);
        const snap = await stateRef.get();
        const st = snap.exists ? snap.data() : {};
        const totalDraws = Number(st?.totalDraws) || 0;

        const eventActive = isGachaEventActive(cfg);
        const badge = eventActive ? (String(cfg?.publicText || '진행중')) : `-`;
        const cost = getGachaCost(cfg);
        const ctrl = getGachaControl(cfg);

        if (elements.gachaTotalDraws) elements.gachaTotalDraws.textContent = fmtInt(totalDraws);
        if (elements.gachaEventBadge) elements.gachaEventBadge.textContent = badge;
        if (elements.gachaCostText) {
            if (eventActive && cost !== POINTS.COST_GACHA) {
                elements.gachaCostText.innerHTML = `<del style="opacity:.55;">${fmtInt(POINTS.COST_GACHA)}pt</del> <span style="color: var(--warning); font-weight: 900;">${fmtInt(cost)}pt</span>`;
            } else {
                elements.gachaCostText.textContent = `${fmtInt(POINTS.COST_GACHA)}pt`;
            }
        }

        // 이벤트 분위기
        const card = elements.pointsTabGacha?.querySelector?.('.points-card');
        if (card) card.classList.toggle('gacha-event-glow', eventActive);

        // 회차/당첨 현황 + 활성/종료 상태
        if (elements.gachaRoundText) {
            elements.gachaRoundText.textContent = ctrl.roundNo ? `${ctrl.roundNo}회차` : '-';
        }
        if (elements.gachaWinnersText) {
            if (ctrl.roundNo && ctrl.maxWinners) {
                elements.gachaWinnersText.textContent = `${ctrl.winnersCount}/${ctrl.maxWinners}`;
            } else {
                elements.gachaWinnersText.textContent = '-';
            }
        }

        // 뽑기 버튼 상태
        if (elements.gachaDrawBtn) {
            const can =
                ctrl.gachaEnabled &&
                ctrl.roundNo &&
                ctrl.maxWinners &&
                ctrl.winnersCount < ctrl.maxWinners;
            elements.gachaDrawBtn.disabled = !can;
        }

        await loadGachaWinnersList(ctrl.roundNo);

        if (opts.showToastOnDone) showToast(`<i class="fa-solid fa-rotate"></i> 뽑기 정보를 갱신했습니다.`);
    } catch (e) {
        console.error(e);
    }
}

async function doGachaDraw() {
    if (!db) return alert('DB 연결이 필요합니다.');
    if (!currentUser?.uid) return alert('로그인 후 이용 가능합니다.');
    if (!currentUser.pointsApproved && !currentUser.isAdmin) return alert('포인트 기능은 관리자 승인 후 사용 가능합니다.');

    const userId = currentUser.uid;

    const kstDate = getKstDateKeyFromNow();
    const weekKey = getIsoWeekKeyFromKstNow();
    const nowIso = new Date().toISOString();
    const cfg = await loadGachaEventConfig(false);
    const baseRate = getGachaBaseRate(cfg);
    const cost = getGachaCost(cfg);
    const ctrl = getGachaControl(cfg);

    if (!ctrl.gachaEnabled) {
        return showToast(`<i class="fa-solid fa-circle-info"></i> 현재 뽑기가 비활성화되어 있습니다.`);
    }
    if (!ctrl.roundNo || !ctrl.maxWinners) {
        return showToast(`<i class="fa-solid fa-circle-info"></i> 뽑기 회차/당첨 인원 설정이 필요합니다.`);
    }
    if (ctrl.winnersCount >= ctrl.maxWinners) {
        return showToast(`<i class="fa-solid fa-circle-info"></i> 이번 회차 뽑기가 종료되었습니다.`);
    }

    const { summaryRef, stateRef, ledgerCol, drawsCol } = getPointsRefsForUser(userId);
    const drawId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const spendLedgerRef = ledgerCol.doc(`SPEND_GACHA__${drawId}`);
    const drawRef = drawsCol.doc(drawId);

    // 연출 시작(결과 확정 전까지 “뽑는중” 표시)
    const showRolling = () => {
        if (elements.gachaResult) elements.gachaResult.classList.add('hidden');
        if (elements.gachaRollStage) elements.gachaRollStage.classList.remove('hidden');
        if (elements.gachaDrawBtn) elements.gachaDrawBtn.disabled = true;
        if (elements.gachaRefreshBtn) elements.gachaRefreshBtn.disabled = true;
    };
    const hideRolling = () => {
        if (elements.gachaRollStage) elements.gachaRollStage.classList.add('hidden');
        if (elements.gachaDrawBtn) elements.gachaDrawBtn.disabled = false;
        if (elements.gachaRefreshBtn) elements.gachaRefreshBtn.disabled = false;
    };
    const rollingTexts = [
        '행운을 불러오는 중…',
        '룰렛이 돌아가는 중…',
        '결과를 확인하는 중…',
        '마지막 한 번 더…'
    ];
    showRolling();
    let rollingTimer = null;
    if (elements.gachaRollText) {
        let i = 0;
        elements.gachaRollText.textContent = rollingTexts[0];
        rollingTimer = setInterval(() => {
            i = (i + 1) % rollingTexts.length;
            elements.gachaRollText.textContent = rollingTexts[i];
        }, 450);
    }

    try {
        const txPromise = db.runTransaction(async (tx) => {
            const cfgRef = db.collection(FIRESTORE_POINTS.gachaEvent).doc('current');
            const winnerRef = db.collection(FIRESTORE_POINTS.gachaRounds).doc(String(ctrl.roundNo)).collection('winners').doc(userId);

            const [sSnap, stSnap, spendSnap, cfgSnap, winnerSnap] = await Promise.all([
                tx.get(summaryRef),
                tx.get(stateRef),
                tx.get(spendLedgerRef),
                tx.get(cfgRef),
                tx.get(winnerRef)
            ]);
            if (spendSnap.exists) return { ok: false, code: 'already' };
            if (winnerSnap.exists) return { ok: false, code: 'already_winner' };

            const cfgNow = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
            const ctrlNow = getGachaControl(cfgNow);
            if (!ctrlNow.gachaEnabled) return { ok: false, code: 'gacha_disabled' };
            if (!ctrlNow.roundNo || !ctrlNow.maxWinners) return { ok: false, code: 'gacha_unconfigured' };
            if (ctrlNow.roundNo !== ctrl.roundNo) return { ok: false, code: 'round_changed' };
            if (ctrlNow.winnersCount >= ctrlNow.maxWinners) return { ok: false, code: 'round_ended' };

            const sum = sSnap.exists ? sSnap.data() : {};
            const balance = Number(sum?.balance) || 0;
            if (balance < cost) return { ok: false, code: 'insufficient', need: cost };

            const st = stSnap.exists ? stSnap.data() : {};
            const beforeDraws = Number(st?.totalDraws) || 0;
            const nextLuckTier = st?.gachaNextLuck || null; // 이전 꽝에서 얻은 "다음 1회 한정" 행운
            const winRate = computeWinRateForDraw({ cfg, baseRate, nextLuckTier });

            const u = new Uint32Array(1);
            crypto.getRandomValues(u);
            const roll = u[0] % 1000000; // 0..999999
            const winThreshold = Math.floor(winRate * 1000000);
            const isWin = roll < winThreshold;

            // 이번 뽑기에서 nextLuckTier는 소비됨(1회 한정)
            let nextLuckForNextDraw = null;
            let loseLuckOutcome = null;
            if (!isWin) {
                loseLuckOutcome = pickNextLuckTier();
                nextLuckForNextDraw = loseLuckOutcome; // null | 'minor' | 'major'
            }

            // 결제 원장
            tx.set(spendLedgerRef, {
                userId,
                userNickname: currentUser.name,
                type: 'SPEND_GACHA',
                delta: -cost,
                refType: 'gacha_draw',
                refId: drawId,
                reasonText: null,
                createdAt: nowIso,
                kstDate,
                kstWeekKey: weekKey
            });

            // 뽑기 결과 기록
            tx.set(drawRef, {
                userId,
                userNickname: currentUser.name,
                createdAt: nowIso,
                kstDate,
                costPoints: cost,
                baseRate: baseRate,
                winRateApplied: winRate,
                nextLuckUsed: nextLuckTier,
                userTotalDrawsBefore: beforeDraws,
                rngRoll: roll,
                isWin,
                loseLuckOutcome: loseLuckOutcome
            });

            // 당첨자 기록/회차 종료 처리
            let winnersCountAfter = ctrlNow.winnersCount;
            if (isWin) {
                winnersCountAfter = ctrlNow.winnersCount + 1;
                tx.set(winnerRef, {
                    uid: userId,
                    nickname: currentUser.name || '',
                    wonAt: nowIso,
                    drawId: drawId,
                    roundNo: ctrlNow.roundNo
                });
                tx.set(cfgRef, {
                    gachaWinnersCount: winnersCountAfter,
                    gachaEnabled: winnersCountAfter >= ctrlNow.maxWinners ? false : true,
                    updatedAt: nowIso,
                    updatedBy: currentUser.uid
                }, { merge: true });
            }

            // 요약 갱신 (누적 획득은 증가하지 않음)
            tx.set(summaryRef, {
                userId,
                userNickname: currentUser.name,
                balance: balance - cost,
                updatedAt: nowIso
            }, { merge: true });

            tx.set(stateRef, {
                userId,
                userNickname: currentUser.name,
                totalDraws: beforeDraws + 1,
                totalWins: (Number(st?.totalWins) || 0) + (isWin ? 1 : 0),
                gachaPity: 0, // (요구) 누적 증가 삭제 → 더 이상 사용하지 않음
                gachaNextLuck: nextLuckForNextDraw,
                updatedAt: nowIso
            }, { merge: true });

            return {
                ok: true,
                isWin,
                roll,
                usedNextLuck: nextLuckTier,
                newNextLuck: nextLuckForNextDraw,
                eventActive: isGachaEventActive(cfg)
            };
        });

        // 최소 연출 시간 확보(체감용)
        const [result] = await Promise.all([txPromise, sleep(1400)]);
        if (rollingTimer) clearInterval(rollingTimer);
        hideRolling();

        if (!result?.ok) {
            if (result.code === 'insufficient') return showToast(`<i class="fa-solid fa-circle-info"></i> 포인트가 부족합니다. (필요 ${fmtInt(result.need || cost)}pt)`);
            if (result.code === 'already_winner') return showToast(`<i class="fa-solid fa-circle-info"></i> 이번 회차에서 이미 당첨되어 더 이상 뽑을 수 없습니다.`);
            if (result.code === 'gacha_disabled') return showToast(`<i class="fa-solid fa-circle-info"></i> 현재 뽑기가 비활성화되어 있습니다.`);
            if (result.code === 'round_ended') return showToast(`<i class="fa-solid fa-circle-info"></i> 이번 회차 뽑기가 종료되었습니다.`);
            if (result.code === 'round_changed') return showToast(`<i class="fa-solid fa-circle-info"></i> 회차 정보가 갱신되었습니다. 새로고침 후 다시 시도해주세요.`);
            return showToast(`<i class="fa-solid fa-circle-info"></i> 뽑기에 실패했습니다.`);
        }

        let msg = '';
        if (result.isWin) {
            msg = `결과: 당첨\n\n축하합니다! 🎉`;
        } else {
            if (result.newNextLuck === 'minor') {
                msg = `결과: 꽝\n뽑기 보상으로 행운이 적용되어 다음 뽑기 확률 소폭 증가 🧚`;
            } else if (result.newNextLuck === 'major') {
                msg = `결과: 꽝\n뽑기 보상으로 행운이 적용되어 다음 뽑기 확률 🎉 대폭 증가 🎉`;
            } else {
                msg = `결과: 꽝\n뽑기 보상을 획득하지 못하였습니다. 🥲`;
            }
            if (result.eventActive) {
                msg += `\n\n※ 이벤트 진행중`;
            }
        }

        if (elements.gachaResult) {
            elements.gachaResult.classList.remove('hidden');
            elements.gachaResult.textContent = msg;
            // 당첨 강조
            if (result.isWin) {
                elements.gachaResult.style.borderColor = 'rgba(16, 185, 129, 0.6)';
                elements.gachaResult.style.background = 'rgba(16, 185, 129, 0.10)';
            } else {
                elements.gachaResult.style.borderColor = 'var(--border)';
                elements.gachaResult.style.background = 'rgba(255,255,255,0.03)';
            }
        }

        if (result.isWin) {
            showToast(`<i class="fa-solid fa-trophy"></i> 당첨! (확률 초기화)`);
            launchConfetti();
            sendGachaWinToDiscord([
                '🎉 **뽑기 당첨!**',
                `- 닉네임: ${currentUser?.name || ''}`,
                `- uid: ${currentUser?.uid || ''}`,
                `- 시각(KST): ${formatKst(new Date().toISOString()) || ''}`
            ].join('\n'));
        } else {
            showToast(`<i class="fa-solid fa-dice"></i> 뽑기 완료`);
        }

        await refreshPointsAll();
    } catch (e) {
        if (rollingTimer) clearInterval(rollingTimer);
        hideRolling();
        console.error(e);
        alert('뽑기 처리 중 오류가 발생했습니다.\n\n' + formatFirestoreError(e));
    }
}

function launchConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = ['#a78bfa', '#8b5cf6', '#22c55e', '#fbbf24', '#60a5fa', '#f472b6'];
    const count = 90;

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        const left = Math.random() * 100;
        const dx = (Math.random() - 0.5) * 260;
        const rot = (Math.random() - 0.5) * 720;
        const delay = Math.random() * 180;
        const dur = 900 + Math.random() * 700;
        const w = 6 + Math.random() * 10;
        const h = 8 + Math.random() * 14;

        p.style.left = `${left}vw`;
        p.style.background = colors[i % colors.length];
        p.style.width = `${w}px`;
        p.style.height = `${h}px`;
        p.style.borderRadius = `${Math.random() * 4}px`;
        p.style.setProperty('--x', `${dx}px`);
        p.style.setProperty('--r', `${rot}deg`);
        p.style.animationDelay = `${delay}ms`;
        p.style.animationDuration = `${dur}ms`;
        container.appendChild(p);
    }

    setTimeout(() => {
        container.remove();
    }, 2500);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function loadPointsRanking() {
    if (!db || !elements.pointsRankingList) return;
    try {
        const snap = await db.collection(FIRESTORE_POINTS.summary).orderBy('lifetimeEarned', 'desc').limit(50).get();
        const list = [];
        snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));

        if (!list.length) {
            elements.pointsRankingList.innerHTML = `<div class="points-empty">랭킹 데이터가 없습니다.</div>`;
            return;
        }

        elements.pointsRankingList.innerHTML = list.map((u, idx) => {
            const name = u.userNickname || u.id;
            const lifetime = Number(u.lifetimeEarned) || 0;
            const balance = Number(u.balance) || 0;
            const me = currentUser?.name && name === currentUser.name;
            return `
                <div class="points-row" style="${me ? 'background: rgba(139,92,246,0.10);' : ''}">
                    <div class="left">
                        <div class="title">#${idx + 1} ${escapeHtml(name)}</div>
                        <div class="meta">누적 획득: ${fmtInt(lifetime)}pt\n현재 보유: ${fmtInt(balance)}pt</div>
                    </div>
                    <div class="delta plus">${fmtInt(lifetime)}pt</div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        elements.pointsRankingList.innerHTML = `<div class="points-empty">랭킹 로드 실패: ${escapeHtml(formatFirestoreError(e))}</div>`;
    }
}

async function loadPointsPublicAdminLog() {
    if (!db || !elements.pointsPublicAdminLogList) return;
    try {
        const snap = await db.collection(FIRESTORE_POINTS.publicAdminLog).orderBy('createdAt', 'desc').limit(100).get();
        const list = [];
        snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));

        if (!list.length) {
            elements.pointsPublicAdminLogList.innerHTML = `<div class="points-empty">표시할 로그가 없습니다.</div>`;
            return;
        }

        elements.pointsPublicAdminLogList.innerHTML = list.map(it => {
            const delta = Number(it.delta) || 0;
            const plus = delta >= 0;
            const admin = it.adminNickname || it.adminId || '(unknown)';
            const target = it.targetNickname || it.targetUserId || '(unknown)';
            const kst = formatKst(it.createdAt) || '';
            const reason = it.reasonText || '';
            return `
                <div class="points-row">
                    <div class="left">
                        <div class="title">${escapeHtml(admin)} → ${escapeHtml(target)}</div>
                        <div class="meta">${escapeHtml(kst)}\n사유: ${escapeHtml(reason)}</div>
                    </div>
                    <div class="delta ${plus ? 'plus' : 'minus'}">${plus ? '+' : ''}${fmtInt(delta)}pt</div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        elements.pointsPublicAdminLogList.innerHTML = `<div class="points-empty">로그 로드 실패: ${escapeHtml(formatFirestoreError(e))}</div>`;
    }
}

async function loadPendingApprovals() {
    if (!db || !elements.pendingApprovalsList) return;
    if (!currentUser?.isAdmin) {
        elements.pendingApprovalsList.innerHTML = `<div class="points-empty">관리자만 볼 수 있습니다.</div>`;
        return;
    }

    elements.pendingApprovalsList.innerHTML = `<div class="points-empty">불러오는 중...</div>`;
    try {
        const snap = await db.collection(FIRESTORE_POINTS.userProfiles)
            .where('pointsApproved', '==', false)
            .limit(100)
            .get();

        const list = [];
        snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));

        list.sort((a, b) => {
            const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return bt - at;
        });

        if (!list.length) {
            elements.pendingApprovalsList.innerHTML = `<div class="points-empty">승인 대기 유저가 없습니다.</div>`;
            return;
        }

        elements.pendingApprovalsList.innerHTML = list.map(u => {
            const nick = u.nickname || '(닉네임 없음)';
            const createdAtIso = u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : null;
            const createdKst = createdAtIso ? (formatKst(createdAtIso) || '') : '';
            return `
                <div class="points-row">
                    <div class="left">
                        <div class="title">${escapeHtml(nick)}</div>
                        <div class="meta">uid: ${escapeHtml(u.uid || u.id)}\n가입: ${escapeHtml(createdKst)}</div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn-success" onclick="approvePointsForUser('${escapeHtml(u.uid || u.id)}')"><i class="fa-solid fa-check"></i> 승인</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        elements.pendingApprovalsList.innerHTML = `<div class="points-empty">로드 실패: ${escapeHtml(formatFirestoreError(e))}</div>`;
    }
}

async function renderGachaEventConfigForRoot() {
    if (!elements.rootEventCard || !currentUser?.isRoot) return;
    const cfg = await loadGachaEventConfig(true);
    if (!cfg) {
        if (elements.gachaEventStatusText) elements.gachaEventStatusText.textContent = '현재 저장된 이벤트 설정이 없습니다.';
        return;
    }

    const enabled = cfg.enabled === true;
    const eventEnabled = cfg.eventEnabled ?? cfg.enabled ?? false;
    if (elements.gachaEventEnabled) elements.gachaEventEnabled.value = eventEnabled ? 'true' : 'false';
    if (elements.gachaEventMultiplier) elements.gachaEventMultiplier.value = String(cfg.multiplier ?? '');
    if (elements.gachaEventCostOverride) elements.gachaEventCostOverride.value = (cfg.costOverride === null || cfg.costOverride === undefined) ? '' : String(cfg.costOverride);
    if (elements.gachaEventMessage) elements.gachaEventMessage.value = String(cfg.publicText || '');
    if (elements.gachaEnabled) elements.gachaEnabled.value = (cfg.gachaEnabled === true) ? 'true' : 'false';
    if (elements.gachaRoundNo) elements.gachaRoundNo.value = String(cfg.gachaRoundNo ?? '');
    if (elements.gachaMaxWinners) elements.gachaMaxWinners.value = String(cfg.gachaMaxWinners ?? '');

    // 저장된 UTC ISO를 KST datetime-local로 변환해서 표시
    const toKstLocal = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
        return k.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    };
    if (elements.gachaEventStartKst) elements.gachaEventStartKst.value = toKstLocal(cfg.startAtUtc);
    if (elements.gachaEventEndKst) elements.gachaEventEndKst.value = toKstLocal(cfg.endAtUtc);

    const active = isGachaEventActive(cfg);
    if (elements.gachaEventStatusText) {
        const startKst = cfg.startAtUtc ? (formatKst(cfg.startAtUtc) || '') : '';
        const endKst = cfg.endAtUtc ? (formatKst(cfg.endAtUtc) || '') : '';
        elements.gachaEventStatusText.textContent =
            `뽑기: ${(cfg.gachaEnabled === true) ? '활성' : '비활성'} / 회차: ${cfg.gachaRoundNo ?? '-'} / 당첨: ${(cfg.gachaWinnersCount ?? 0)}/${(cfg.gachaMaxWinners ?? '-')}\n` +
            `확률 이벤트: ${eventEnabled ? (active ? '진행중' : '대기/종료') : '비활성'}\n` +
            `기간(KST): ${startKst} ~ ${endKst}\n` +
            `배수: ${cfg.multiplier ?? ''}`;
    }
}

async function saveGachaEventConfig() {
    if (!currentUser?.isRoot) return alert('ROOT만 가능합니다.');
    if (!db) return alert('DB 연결이 필요합니다.');

    const eventEnabled = String(elements.gachaEventEnabled?.value || 'false') === 'true';
    const startKst = elements.gachaEventStartKst?.value || '';
    const endKst = elements.gachaEventEndKst?.value || '';
    const mult = parseFloat(elements.gachaEventMultiplier?.value || '1') || 1;
    const costOverrideRaw = String(elements.gachaEventCostOverride?.value || '').trim();
    const costOverride = costOverrideRaw ? Math.max(0, Math.floor(parseFloat(costOverrideRaw) || 0)) : null;
    const publicText = String(elements.gachaEventMessage?.value || '').trim();
    const gachaEnabled = String(elements.gachaEnabled?.value || 'false') === 'true';
    const gachaRoundNo = Math.max(1, Math.floor(parseFloat(elements.gachaRoundNo?.value || '1') || 1));
    const gachaMaxWinners = Math.max(1, Math.floor(parseFloat(elements.gachaMaxWinners?.value || '1') || 1));

    const startUtcIso = parseKstDateTimeLocalToUtcIso(startKst);
    const endUtcIso = parseKstDateTimeLocalToUtcIso(endKst);
    if (eventEnabled) {
        if (!startUtcIso || !endUtcIso) return alert('시작/종료(KST)를 입력하세요.');
        if (new Date(startUtcIso).getTime() > new Date(endUtcIso).getTime()) return alert('시작 시간이 종료 시간보다 늦습니다.');
        if (!(mult >= 0)) return alert('배수는 0 이상이어야 합니다.');
    }

    const ref = db.collection(FIRESTORE_POINTS.gachaEvent).doc('current');
    try {
        // 회차가 변경되면 당첨 카운트는 0으로 리셋
        const prev = await ref.get().then(s => (s.exists ? (s.data() || {}) : {})).catch(() => ({}));
        const prevRound = prev?.gachaRoundNo ?? null;
        const resetWinners = prevRound !== gachaRoundNo;

        await ref.set({
            eventEnabled,
            startAtUtc: startUtcIso,
            endAtUtc: endUtcIso,
            multiplier: mult,
            costOverride: costOverride,
            publicText: publicText,
            gachaEnabled,
            gachaRoundNo,
            gachaMaxWinners,
            gachaWinnersCount: resetWinners ? 0 : (prev?.gachaWinnersCount ?? 0),
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.uid
        }, { merge: true });

        showToast(`<i class="fa-solid fa-wand-magic-sparkles"></i> 이벤트 설정 저장 완료`);
        await loadGachaEventConfig(true);
        await Promise.all([renderGachaEventConfigForRoot(), refreshGachaPanel()]);
    } catch (e) {
        console.error(e);
        alert('저장 실패:\n\n' + formatFirestoreError(e));
    }
}

async function refreshEventPanel() {
    const cfg = await loadGachaEventConfig(false);
    const active = isGachaEventActive(cfg);
    const text = String(cfg?.publicText || '').trim();
    const ctrl = getGachaControl(cfg);

    if (elements.eventPublicBox) {
        if (active) {
            const start = cfg?.startAtUtc ? (formatKst(cfg.startAtUtc) || '') : '';
            const end = cfg?.endAtUtc ? (formatKst(cfg.endAtUtc) || '') : '';
            const cost = getGachaCost(cfg);
            const costLine = (cost !== POINTS.COST_GACHA) ? `- 비용: ${POINTS.COST_GACHA} → ${cost}` : `- 비용: ${POINTS.COST_GACHA}`;
            elements.eventPublicBox.textContent =
                (text ? `${text}\n\n` : '') +
                `상태: 진행중\n` +
                `기간(KST): ${start} ~ ${end}\n` +
                `- 확률 배수: ${cfg?.multiplier ?? ''}\n` +
                `- 뽑기: ${ctrl.gachaEnabled ? '활성' : '비활성'} / 회차: ${ctrl.roundNo || '-'} / 당첨: ${ctrl.winnersCount}/${ctrl.maxWinners || '-'}\n` +
                `${costLine}`;
        } else {
            elements.eventPublicBox.textContent =
                (text ? `${text}\n\n` : '') +
                `상태: ${ctrl.gachaEnabled ? '뽑기 활성' : '뽑기 비활성'} / 회차: ${ctrl.roundNo || '-'} / 당첨: ${ctrl.winnersCount}/${ctrl.maxWinners || '-'}\n` +
                (text ? '' : '현재 진행중인 이벤트가 없습니다.');
        }
    }

    // ROOT 설정 UI 동기화
    await renderGachaEventConfigForRoot();
}

async function loadGachaWinnersList(roundNo) {
    if (!elements.gachaWinnersList) return;
    if (!db || !roundNo) {
        elements.gachaWinnersList.innerHTML = `<div class="points-empty">회차 정보가 없습니다.</div>`;
        return;
    }
    try {
        const col = db.collection(FIRESTORE_POINTS.gachaRounds).doc(String(roundNo)).collection('winners');
        const snap = await col.orderBy('wonAt', 'desc').limit(50).get();
        const list = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        if (!list.length) {
            elements.gachaWinnersList.innerHTML = `<div class="points-empty">아직 당첨자가 없습니다.</div>`;
            return;
        }
        elements.gachaWinnersList.innerHTML = list.map((w, idx) => {
            const name = w.nickname || w.id;
            const at = w.wonAt ? (formatKst(w.wonAt) || w.wonAt) : '';
            return `
                <div class="points-row">
                    <div class="left">
                        <div class="title">#${idx + 1} ${escapeHtml(name)}</div>
                        <div class="meta">${escapeHtml(at)}</div>
                    </div>
                    <div class="delta plus">당첨</div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        elements.gachaWinnersList.innerHTML = `<div class="points-empty">로드 실패: ${escapeHtml(formatFirestoreError(e))}</div>`;
    }
}

async function rootBulkAdjustAllUsers() {
    if (!currentUser?.isRoot) return alert('ROOT만 가능합니다.');
    if (!db) return alert('DB 연결이 필요합니다.');

    const mode = String(elements.rootBulkMode?.value || 'grant');
    const amt = Math.floor(parseFloat(elements.rootBulkAmount?.value || '0') || 0);
    const reason = String(elements.rootBulkReason?.value || '').trim();
    const target = String(elements.rootBulkTarget?.value || 'all');

    if (!amt || amt <= 0) return alert('포인트 값을 1 이상 입력하세요.');
    if (!reason) return alert('사유를 입력하세요. (필수)');

    const delta = mode === 'withdraw' ? -amt : amt;
    const ok = confirm(`전체 유저에게 ${delta >= 0 ? '+' : ''}${delta}pt를 일괄 적용할까요?\n\n- 대상: ${target}\n- 사유: ${reason}\n\n※ 되돌리기 어렵습니다.`);
    if (!ok) return;

    const bulkId = `bulk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const nowIso = new Date().toISOString();

    let processed = 0;
    let skipped = 0;
    let lastDoc = null;

    const status = (msg) => {
        if (elements.rootBulkStatusText) elements.rootBulkStatusText.textContent = msg;
    };
    status('진행중...');

    try {
        while (true) {
            let q = db.collection(FIRESTORE_POINTS.userProfiles).orderBy('createdAt', 'asc').limit(150);
            if (lastDoc) q = q.startAfter(lastDoc);
            const snap = await q.get();
            if (snap.empty) break;

            const docs = snap.docs;
            lastDoc = docs[docs.length - 1];

            for (const d of docs) {
                const p = d.data() || {};
                const uid = p.uid || d.id;
                if (!uid) { skipped++; continue; }

                if (target === 'approved_only' && p.pointsApproved !== true) {
                    skipped++;
                    continue;
                }

                const { summaryRef, ledgerCol } = getPointsRefsForUser(uid);
                const ledgerRef = ledgerCol.doc(`ROOT_BULK_ADJUST__${bulkId}`);

                await db.runTransaction(async (tx) => {
                    const [lSnap, sSnap] = await Promise.all([tx.get(ledgerRef), tx.get(summaryRef)]);
                    if (lSnap.exists) return;

                    const sum = sSnap.exists ? (sSnap.data() || {}) : {};
                    const balance = Number(sum.balance) || 0;
                    const lifetime = Number(sum.lifetimeEarned) || 0;
                    const nextBalance = balance + delta;
                    const nextLifetime = Math.max(0, lifetime + delta); // 요구: 회수도 누적에 반영(차감)

                    tx.set(ledgerRef, {
                        userId: uid,
                        userNickname: String(p.nickname || ''),
                        type: 'ROOT_BULK_ADJUST',
                        delta,
                        refType: 'root_bulk',
                        refId: bulkId,
                        reasonText: reason,
                        adminNickname: currentUser.name || 'ROOT',
                        adminUserId: currentUser.uid,
                        createdAt: nowIso,
                        kstDate: getKstDateKeyFromNow(),
                        kstWeekKey: getIsoWeekKeyFromKstNow()
                    });

                    tx.set(summaryRef, {
                        userId: uid,
                        userNickname: String(p.nickname || ''),
                        balance: nextBalance,
                        lifetimeEarned: nextLifetime,
                        updatedAt: nowIso
                    }, { merge: true });
                });

                processed++;
                if (processed % 10 === 0) status(`진행중... 처리 ${processed}명 / 제외 ${skipped}명`);
            }
        }

        status(`완료: 처리 ${processed}명 / 제외 ${skipped}명`);
        showToast(`<i class="fa-solid fa-bolt"></i> 일괄 적용 완료: ${processed}명`);
    } catch (e) {
        console.error(e);
        status(`오류: ${formatFirestoreError(e)}`);
        alert('일괄 적용 실패:\n\n' + formatFirestoreError(e));
    }
}

window.approvePointsForUser = async function(uid) {
    if (!db) return;
    if (!currentUser?.isAdmin) return alert('관리자만 가능합니다.');
    if (!uid) return;

    const ok = confirm(`이 유저의 포인트 기능을 승인할까요?\n\nuid: ${uid}`);
    if (!ok) return;

    const profileRef = db.collection(FIRESTORE_POINTS.userProfiles).doc(uid);
    const now = firebase.firestore.FieldValue.serverTimestamp();

    try {
        await db.runTransaction(async (tx) => {
            // 트랜잭션 규칙: 모든 read를 먼저 수행해야 함
            const { summaryRef, stateRef } = getPointsRefsForUser(uid);
            const [pSnap, sSnap, stSnap] = await Promise.all([
                tx.get(profileRef),
                tx.get(summaryRef),
                tx.get(stateRef)
            ]);
            if (!pSnap.exists) throw new Error('프로필이 없습니다.');
            const p = pSnap.data() || {};
            if (p.pointsApproved === true) return;

            tx.set(profileRef, { pointsApproved: true, approvedAt: now, approvedBy: currentUser.uid }, { merge: true });

            // 승인과 동시에 포인트 문서도 초기화(요약/상태)
            const nowIso = new Date().toISOString();
            const nick = String(p.nickname || '').trim();

            if (!sSnap.exists) {
                tx.set(summaryRef, { userId: uid, userNickname: nick, balance: 0, lifetimeEarned: 0, updatedAt: nowIso });
            }
            if (!stSnap.exists) {
                tx.set(stateRef, { userId: uid, userNickname: nick, lastCheckinKstDate: null, currentStreakDays: 0, claimed3: false, claimed7: false, claimed14: false, totalDraws: 0, totalWins: 0, gachaPity: 0, updatedAt: nowIso });
            }
        });

        showToast(`<i class="fa-solid fa-check"></i> 승인 완료`);
        await Promise.all([loadPendingApprovals(), loadPointsPublicAdminLog()]);
    } catch (e) {
        console.error(e);
        alert('승인 실패:\n\n' + formatFirestoreError(e));
    }
};

async function adminAdjustPoints() {
    if (!db) return alert('DB 연결이 필요합니다.');
    if (!currentUser?.isAdmin) return alert('관리자만 가능합니다.');

    const targetNick = elements.adminAdjustTarget?.value?.trim() || '';
    const delta = parseInt(elements.adminAdjustDelta?.value || '0', 10);
    const reason = elements.adminAdjustReason?.value?.trim() || '';

    if (!targetNick) return alert('대상 유저 닉네임을 입력하세요.');
    if (!Number.isFinite(delta) || delta === 0) return alert('포인트 변경값을 입력하세요. (0 제외)');
    if (!reason) return alert('사유를 입력하세요. (필수)');

    const nk = nicknameKey(targetNick);
    if (!nk) return alert('닉네임 형식을 확인해 주세요.');

    const nickRef = db.collection(FIRESTORE_POINTS.nicknameIndex).doc(nk);
    const nickSnap = await nickRef.get().catch(() => null);
    const targetUserId = nickSnap?.exists ? (nickSnap.data()?.uid || null) : null;
    if (!targetUserId) return alert('대상 유저를 찾을 수 없습니다.');

    const logId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const nowIso = new Date().toISOString();
    const kstDate = getKstDateKeyFromNow();
    const weekKey = getIsoWeekKeyFromKstNow();

    const targetSummaryRef = db.collection(FIRESTORE_POINTS.summary).doc(targetUserId);
    const targetLedgerCol = db.collection(FIRESTORE_POINTS.ledgerUsers).doc(targetUserId).collection('items');
    const targetLedgerRef = targetLedgerCol.doc(`ADMIN_ADJUST__${logId}`);
    const publicRef = db.collection(FIRESTORE_POINTS.publicAdminLog).doc(logId);

    try {
        await db.runTransaction(async (tx) => {
            const [sSnap, lSnap, pSnap] = await Promise.all([tx.get(targetSummaryRef), tx.get(targetLedgerRef), tx.get(publicRef)]);
            if (lSnap.exists || pSnap.exists) return;

            const sum = sSnap.exists ? sSnap.data() : {};
            const balance = Number(sum?.balance) || 0;
            const lifetime = Number(sum?.lifetimeEarned) || 0;
            // 관리자 회수도 "누적 획득"에서 차감 처리(요구사항)
            // 단, 뽑기/일반 소모는 lifetimeEarned에 영향을 주지 않음(ADMIN_ADJUST만 여기서 처리)
            const nextLifetime = Math.max(0, lifetime + delta);

            tx.set(targetLedgerRef, {
                userId: targetUserId,
                userNickname: targetNick,
                type: 'ADMIN_ADJUST',
                delta,
                refType: 'admin_adjust',
                refId: logId,
                reasonText: reason,
                adminNickname: currentUser.name,
                adminUserId: currentUser.uid,
                createdAt: nowIso,
                kstDate,
                kstWeekKey: weekKey
            });

            tx.set(publicRef, {
                type: 'ADMIN_ADJUST',
                delta,
                reasonText: reason,
                adminNickname: currentUser.name,
                adminId: currentUser.uid,
                targetNickname: targetNick,
                targetUserId,
                createdAt: nowIso,
                kstDate
            });

            tx.set(targetSummaryRef, {
                userId: targetUserId,
                userNickname: targetNick,
                balance: balance + delta,
                lifetimeEarned: nextLifetime,
                updatedAt: nowIso
            }, { merge: true });
        });

        showToast(`<i class="fa-solid fa-gavel"></i> 관리자 조정 완료 (${delta >= 0 ? '+' : ''}${fmtInt(delta)}pt)`);
        elements.adminAdjustReason.value = '';
        elements.adminAdjustDelta.value = '';

        await Promise.all([loadPointsPublicAdminLog(), refreshPointsHeader(), refreshPointsMePanel(), loadMyPointLedger()]);
    } catch (e) {
        console.error(e);
        alert('관리자 조정 중 오류가 발생했습니다.\n\n' + formatFirestoreError(e));
    }
}

const firebaseConfig = {
    apiKey: "AIzaSyCDqmgOsbXZu9FNkGCULDuEnu9ehSR2gbY",
    authDomain: "aion2rudra.firebaseapp.com",
    projectId: "aion2rudra",
    storageBucket: "aion2rudra.firebasestorage.app",
    messagingSenderId: "786371182560",
    appId: "1:786371182560:web:29dfdd720a9b369d2e7585"
};

let db;
let auth;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
} catch (e) {
    console.error("Firebase 초기화 실패.", e);
}

let currentTab = 'all';
let posts = [];
let currentUser = null;
let currentEditingPostId = null;
let isNoticeWritingMode = false; 
let isEditMode = false; // 글 수정 모드 여부
let editingPostData = null; // 수정 중인 글 데이터
let currentCalcData = null; // 현재 계산기용 데이터
let lastSimulatedScore = null; // 시뮬레이터 직전 계산값(변화량 표시용)
let lastSnapshotById = new Map(); // 하드 삭제 감지용(이전 스냅샷 캐시)

function getSessionId() {
    let sid = sessionStorage.getItem('rudra_session_id');
    if (!sid) {
        sid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        sessionStorage.setItem('rudra_session_id', sid);
    }
    return sid;
}

async function logAuditEvent(eventType, payload = {}) {
    if (!db) return;
    try {
        await db.collection("audit_logs").add({
            eventType,
            payload,
            createdAt: new Date().toISOString(),
            actor: getDeleteActor()
        });
    } catch (e) {
        console.error("audit 로그 기록 실패:", e);
    }
}

async function sendLogToDiscord(lines) {
    if (!DISCORD_LOG_WEBHOOK_URL) return;
    try {
        const content = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
        if (!content.trim()) return;

        await fetch(`${DISCORD_LOG_WEBHOOK_URL}?wait=false`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
    } catch (e) {
        console.error("로그 웹훅 전송 실패:", e);
    }
}

async function sendGachaWinToDiscord(payload) {
    const url = getGachaWinWebhookUrl();
    if (!url) {
        // 웹훅 미설정이면 조용히 스킵(필요시 콘솔에만 힌트)
        console.warn('[gacha] win webhook not configured. set localStorage:', GACHA_WIN_WEBHOOK_STORAGE_KEY);
        return;
    }
    try {
        const content = String(payload || '').trim();
        if (!content) return;
        await fetch(`${url}?wait=false`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
    } catch (e) {
        console.error("뽑기 당첨 웹훅 전송 실패:", e);
    }
}

function formatPostTypeLabel(type) {
    if (type === 'party') return '📢 파티원 모집';
    if (type === 'member') return '⚔️ 파티 구직';
    if (type === 'notice') return '🔔 공지사항';
    return '📝 게시글';
}

function formatKst(isoOrDate) {
    try {
        const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
        if (!d || Number.isNaN(d.getTime())) return null;
        return new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(d);
    } catch {
        return null;
    }
}

function getHardDeleteNotifyCache() {
    try {
        return JSON.parse(sessionStorage.getItem('rudra_hard_delete_notified') || '{}');
    } catch {
        return {};
    }
}

function setHardDeleteNotified(postId) {
    try {
        const cache = getHardDeleteNotifyCache();
        cache[postId] = Date.now();
        sessionStorage.setItem('rudra_hard_delete_notified', JSON.stringify(cache));
    } catch {}
}

function shouldNotifyHardDelete(postId) {
    if (!postId) return false;
    const cache = getHardDeleteNotifyCache();
    if (cache[postId]) return false; // 같은 세션에서 중복 방지
    return true;
}

async function notifyDeletionToDiscord(postLike, reasonCode, reasonMessage) {
    const p = postLike || {};
    const title = p.title || '(제목 없음)';
    const author = p.author?.name ? `${p.author.name}${p.author?.class ? ` (${p.author.class})` : ''}` : '(작성자 정보 없음)';
    const createdAt = p.createdAt || null;
    const postId = p.id || p.postId || null;
    const detectedAtIso = new Date().toISOString();
    const detectedAtKst = formatKst(detectedAtIso);
    const createdAtKst = createdAt ? formatKst(createdAt) : null;
    const deletedAtIso = p.deletedAt || null;
    const deletedAtKst = deletedAtIso ? formatKst(deletedAtIso) : null;

    const lines = [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '🗑️ **게시글 삭제/정리 감지**',
        `- **감지시각(KST)**: ${detectedAtKst || ''}`,
        `- **감지시각(ISO)**: ${detectedAtIso}`,
        '',
        `- **유형**: ${formatPostTypeLabel(p.type)}`,
        `- **제목**: ${title}`,
        `- **작성자**: ${author}`,
        createdAtKst ? `- **작성시간(KST)**: ${createdAtKst}` : null,
        createdAt ? `- **작성시간(ISO)**: ${createdAt}` : null,
        postId ? `- **postId**: ${postId}` : null,
        `- **appVersion**: ${APP_VERSION}`,
        '',
        `- **사유코드**: ${reasonCode || 'unknown'}`,
        `- **사유**: ${reasonMessage || ''}`,
        deletedAtKst ? `- **삭제처리시각(KST)**: ${deletedAtKst}` : null,
        deletedAtIso ? `- **삭제처리시각(ISO)**: ${deletedAtIso}` : null,
        p.deletedSource ? `- **삭제경로**: ${p.deletedSource}` : null,
        '',
        `- **감지자(현재 세션)**: ${currentUser?.name || 'unknown'}${currentUser?.isAdmin ? ' (admin)' : ''}`,
        '※ hard_delete_detected의 “감지자”는 삭제 실행자가 아니라, 사라짐을 감지한 사용자일 수 있습니다.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].filter(Boolean);

    await sendLogToDiscord(lines);
}

function getDeleteActor() {
    const actor = {
        at: new Date().toISOString(),
        by: currentUser?.name || null,
        isAdmin: !!currentUser?.isAdmin,
        authProvider: currentUser?.adminAuth?.provider || null,
        discordUserId: currentUser?.adminAuth?.discordUserId || null,
        userAgent: navigator.userAgent,
        page: location.href,
        appVersion: APP_VERSION,
        sessionId: getSessionId()
    };
    return actor;
}

function canManagePost(post) {
    if (!post) return false;
    if (!currentUser) return false;
    if (currentUser.isAdmin) return true;
    // 일반 유저는 "내 uid == 작성자 uid" 일 때만 관리 가능 (추가로 비밀번호 확인)
    if (currentUser.uid && post.authorUid && currentUser.uid === post.authorUid) return true;
    // 구버전 데이터(authorUid 없던 시절) 호환: 닉네임 비교
    return currentUser.name && post.author && currentUser.name === post.author.name;
}

async function softDeletePostById(postId, reasonCode, reasonMessage, source = null) {
    if (!db || !postId) return;

    const patch = {
        deletedAt: new Date().toISOString(),
        deletedReasonCode: reasonCode || 'unknown',
        deletedReason: reasonMessage || '',
        deletedSource: source || null,
        deletedActor: getDeleteActor(),
        status: 'deleted'
    };

    await db.collection("posts").doc(postId).update(patch);
}

function normalizeScoreInfoStats(detailData) {
    const list = detailData?.scoreInfo?.stats?.stats;
    if (!Array.isArray(list)) return null;

    const map = {};
    list.forEach(s => {
        if (!s || typeof s !== 'object') return;
        if (!s.id) return;
        map[s.id] = s.value || s.percent || null;
        map[`${s.id}__raw`] = s;
    });

    const getPercent = (id) => {
        const raw = map[`${id}__raw`];
        const p = raw?.value?.percent ?? raw?.percent;
        return Number.isFinite(p) ? p : 0;
    };
    const getValue = (id) => {
        const raw = map[`${id}__raw`];
        const v = raw?.value?.value ?? raw?.value;
        return Number.isFinite(v) ? v : 0;
    };

    return {
        attackPower: getValue('attackPower'),
        combatSpeed: getPercent('combatSpeed'),
        weaponDamageAmp: getPercent('weaponDamage'),
        damageAmp: getPercent('damage'),
        criticalDamageAmp: getPercent('criticalDamage'),
        cooldownReduction: getPercent('cooldown'),
        stunHit: getPercent('powerStrike'),
        perfect: getPercent('perfection'),
        multiHit: getPercent('multiHit'),
        criticalHit: getValue('critical')
    };
}

function extractWeaponMinMaxFromItemDetails(detailData) {
    const items = detailData?.itemDetails;
    if (!Array.isArray(items)) return { weaponMinAttack: 0, weaponMaxAttack: 0 };

    for (const it of items) {
        const mainStats = it?.mainStats;
        if (!Array.isArray(mainStats)) continue;
        for (const ms of mainStats) {
            if (ms?.id === 'WeaponFixingDamage') {
                const min = Number.isFinite(ms?.minValue) ? ms.minValue : 0;
                const max = Number.isFinite(ms?.maxValue) ? ms.maxValue : 0;
                return { weaponMinAttack: min, weaponMaxAttack: max };
            }
        }
    }
    return { weaponMinAttack: 0, weaponMaxAttack: 0 };
}

const categoryData = {
    "정복": {
        details: ["크라오 동굴", "드라웁니르", "우루구구 협곡", "바크론의 공중섬", "불의 신전", "사나운 뿔 암굴"],
        difficulties: ["보통", "어려움"]
    },
    "성역": {
        details: ["1넴", "2넴", "무관"],
        difficulties: []
    },
    "초월": {
        details: ["데우스 연구기지", "조각난 아르카니스"],
        difficulties: ["1단계", "2단계", "3단계", "4단계", "5단계", "6단계", "7단계", "8단계", "9단계", "10단계"]
    },
    "토벌전": {
        details: ["토벌전"],
        difficulties: ["쉬움", "보통", "어려움"]
    },
    "PVE (닥사)": {
        details: ["필드", "어비스"],
        difficulties: []
    },
    "PVP": {
        details: ["시공, 어비스"],
        difficulties: []
    }
};

const elements = {
    postList: document.getElementById('postList'),
    noticeList: document.getElementById('noticeList'),
    loadMoreNoticeBtn: document.getElementById('loadMoreNoticeBtn'),
    writeBtn: document.getElementById('writeBtn'),
    writeNoticeBtn: document.getElementById('writeNoticeBtn'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    roleFilter: document.getElementById('roleFilter'),
    categoryFilter: document.getElementById('categoryFilter'),
    modals: document.querySelectorAll('.modal'),
    writeModal: document.getElementById('writeModal'),
    modalTitle: document.getElementById('modalTitle'),
    writeCloseBtn: document.querySelector('.write-close'),
    postForm: document.getElementById('postForm'),
    postCategory: document.getElementById('postCategory'),
    detailSelectGroup: document.getElementById('detailSelectGroup'),
    postDetail: document.getElementById('postDetail'),
    postDifficulty: document.getElementById('postDifficulty'),
    postRoleCheckboxes: document.querySelectorAll('input[name="postRole"]'),
    postMyDps: document.getElementById('postMyDps'),
    postExpiration: document.getElementById('postExpiration'),
    postTitle: document.getElementById('postTitle'),
    postContent: document.getElementById('postContent'),
    postLink: document.getElementById('postLink'),
    postPassword: document.getElementById('postPassword'),
    submitPostBtn: document.getElementById('submitPostBtn'),
    noticeMessage: document.getElementById('noticeMessage'),
    categoryGroup: document.getElementById('categoryGroup'),
    roleGroup: document.getElementById('roleGroup'),
    linkGroup: document.getElementById('linkGroup'),
    dpsGroup: document.getElementById('dpsGroup'),
    expirationGroup: document.getElementById('expirationGroup'),
    passwordGroup: document.getElementById('passwordGroup'),
    authModal: document.getElementById('authModal'),
    authCloseBtn: document.querySelector('.auth-close'),
    authForm: document.getElementById('authForm'),
    authModalTitle: document.getElementById('authModalTitle'),
    authHelpText: document.getElementById('authHelpText'),
    authTabLogin: document.getElementById('authTabLogin'),
    authTabSignup: document.getElementById('authTabSignup'),
    authLoginId: document.getElementById('authLoginId'),
    authPassword: document.getElementById('authPassword'),
    authPasswordConfirm: document.getElementById('authPasswordConfirm'),
    authRememberMe: document.getElementById('authRememberMe'),
    authPasswordConfirmGroup: document.getElementById('authPasswordConfirmGroup'),
    loginBtn: document.getElementById('loginBtn'),
    userInfo: document.getElementById('userInfo'),
    userNickname: document.getElementById('userNickname'),
    logoutBtn: document.getElementById('logoutBtn'),
    adminVerifyBtn: document.getElementById('adminVerifyBtn'),
    adminBadge: document.getElementById('adminBadge'),
    rootBadge: document.getElementById('rootBadge'),
    adminToolsBtn: document.getElementById('adminToolsBtn'),
    authNickname: document.getElementById('authNickname'),
    authNicknameGroup: document.getElementById('authNicknameGroup'),
    authSubmitBtn: document.getElementById('authSubmitBtn'),
    manageModal: document.getElementById('manageModal'),
    manageCloseBtn: document.querySelector('.manage-close'),
    managePostInfo: document.getElementById('managePostInfo'),
    btnStatusRecruiting: document.getElementById('btnStatusRecruiting'),
    btnStatusFull: document.getElementById('btnStatusFull'),
    newMemberName: document.getElementById('newMemberName'),
    newMemberClass: document.getElementById('newMemberClass'),
    addMemberBtn: document.getElementById('addMemberBtn'),
    partyMemberList: document.getElementById('partyMemberList'),
    deletePostBtn: document.getElementById('deletePostBtn'),
    detailModal: document.getElementById('detailModal'),
    detailCloseBtn: document.querySelector('.detail-close'),
    detailCategoryBadge: document.getElementById('detailCategoryBadge'),
    detailRoles: document.getElementById('detailRoles'),
    detailTitle: document.getElementById('detailTitle'),
    detailAuthor: document.getElementById('detailAuthor'),
    detailTime: document.getElementById('detailTime'),
    detailContent: document.getElementById('detailContent'),
    detailLink: document.getElementById('detailLink'),
    detailAuthorProfile: document.getElementById('detailAuthorProfile'),
    detailPartySection: document.getElementById('detailPartySection'),
    detailPartyListContainer: document.getElementById('detailPartyListContainer'),
    guideBtn: document.getElementById('guideBtn'),
    guideModal: document.getElementById('guideModal'),
    guideCloseBtn: document.querySelector('.guide-close'),
    toastContainer: document.getElementById('toastContainer'),
    
    // 검색 관련 요소
    headerSearchInput: document.getElementById('headerSearchInput'),
    headerSearchBtn: document.getElementById('headerSearchBtn'),
    searchResultModal: document.getElementById('searchResultModal'),
    searchCloseBtn: document.querySelector('.search-close'),
    searchResultContent: document.getElementById('searchResultContent'),
    openCalculatorBtn: document.getElementById('openCalculatorBtn'),
    
    // 계산기 관련 요소
    dpsCalculatorModal: document.getElementById('dpsCalculatorModal'),
    calcCloseBtn: document.querySelector('.calc-close'),
    doCalculateBtn: document.getElementById('doCalculateBtn'),
    calcAttackPower: document.getElementById('calcAttackPower'),
    calcWeaponMin: document.getElementById('calcWeaponMin'),
    calcWeaponMax: document.getElementById('calcWeaponMax'),
    calcCritStat: document.getElementById('calcCritStat'),
    calcCombatSpeed: document.getElementById('calcCombatSpeed'),
    calcWeaponDamageAmp: document.getElementById('calcWeaponDamageAmp'),
    calcDamageAmp: document.getElementById('calcDamageAmp'),
    calcCritDamageAmp: document.getElementById('calcCritDamageAmp'),
    calcSkillDamage: document.getElementById('calcSkillDamage'),
    calcCooldownReduction: document.getElementById('calcCooldownReduction'),
    calcStunHit: document.getElementById('calcStunHit'),
    calcPerfect: document.getElementById('calcPerfect'),
    calcMultiHit: document.getElementById('calcMultiHit'),
    calcResultScore: document.getElementById('calcResultScore'),
    calcDiff: document.getElementById('calcDiff'),
    calcAtulBtn: document.getElementById('calcAtulBtn'),
    calcTargetScore: document.getElementById('calcTargetScore'),
    doRecommendBtn: document.getElementById('doRecommendBtn'),
    calcRecommendOutput: document.getElementById('calcRecommendOutput'),

    // 관리자 도구
    adminToolsModal: document.getElementById('adminToolsModal'),
    adminToolsCloseBtn: document.querySelector('.admin-tools-close'),
    adminTabBtns: document.querySelectorAll('.admin-tab-btn'),
    adminTabAudit: document.getElementById('adminTabAudit'),
    adminTabBackup: document.getElementById('adminTabBackup'),
    auditList: document.getElementById('auditList'),
    auditTypeFilter: document.getElementById('auditTypeFilter'),
    auditSearch: document.getElementById('auditSearch'),
    auditReloadBtn: document.getElementById('auditReloadBtn'),
    exportPostsBtn: document.getElementById('exportPostsBtn'),
    exportNoticesBtn: document.getElementById('exportNoticesBtn'),
    exportPostsIncludeDeletedBtn: document.getElementById('exportPostsIncludeDeletedBtn'),
    restoreList: document.getElementById('restoreList'),
    restoreSearch: document.getElementById('restoreSearch'),
    restoreReloadBtn: document.getElementById('restoreReloadBtn'),
    importJsonText: document.getElementById('importJsonText'),
    importMode: document.getElementById('importMode'),
    importBtn: document.getElementById('importBtn'),
    clearImportBtn: document.getElementById('clearImportBtn'),

    // 포인트/뽑기
    pointsOpenBtn: document.getElementById('pointsOpenBtn'),
    pointsBalanceText: document.getElementById('pointsBalanceText'),
    pointsModal: document.getElementById('pointsModal'),
    pointsCloseBtn: document.querySelector('.points-close'),
    pointsHowtoBtn: document.getElementById('pointsHowtoBtn'),
    pointsHowtoPanel: document.getElementById('pointsHowtoPanel'),
    pointsTabBtns: document.querySelectorAll('.points-tab-btn'),
    pointsAdminTabBtn: document.getElementById('pointsAdminTabBtn'),
    pointsEventTabBtn: document.getElementById('pointsEventTabBtn'),
    pointsTabMe: document.getElementById('pointsTabMe'),
    pointsTabGacha: document.getElementById('pointsTabGacha'),
    pointsTabEvent: document.getElementById('pointsTabEvent'),
    pointsTabRanking: document.getElementById('pointsTabRanking'),
    pointsTabPublicLog: document.getElementById('pointsTabPublicLog'),
    pointsTabAdmin: document.getElementById('pointsTabAdmin'),
    pointsMeBalance: document.getElementById('pointsMeBalance'),
    pointsMeLifetime: document.getElementById('pointsMeLifetime'),
    pointsLedgerList: document.getElementById('pointsLedgerList'),
    attendanceBtn: document.getElementById('attendanceBtn'),
    pointsRefreshBtn: document.getElementById('pointsRefreshBtn'),
    streakToday: document.getElementById('streakToday'),
    streakDays: document.getElementById('streakDays'),
    streakNext: document.getElementById('streakNext'),
    streakBar: document.getElementById('streakBar'),
    streakHint: document.getElementById('streakHint'),
    gachaTotalDraws: document.getElementById('gachaTotalDraws'),
    gachaEventBadge: document.getElementById('gachaEventBadge'),
    gachaCostText: document.getElementById('gachaCostText'),
    gachaRoundText: document.getElementById('gachaRoundText'),
    gachaWinnersText: document.getElementById('gachaWinnersText'),
    gachaDrawBtn: document.getElementById('gachaDrawBtn'),
    gachaRefreshBtn: document.getElementById('gachaRefreshBtn'),
    gachaRollStage: document.getElementById('gachaRollStage'),
    gachaRollText: document.getElementById('gachaRollText'),
    gachaResult: document.getElementById('gachaResult'),
    gachaWinnersList: document.getElementById('gachaWinnersList'),
    pointsRankingList: document.getElementById('pointsRankingList'),
    pointsPublicAdminLogList: document.getElementById('pointsPublicAdminLogList'),
    adminAdjustTarget: document.getElementById('adminAdjustTarget'),
    adminAdjustDelta: document.getElementById('adminAdjustDelta'),
    adminAdjustReason: document.getElementById('adminAdjustReason'),
    adminAdjustSubmitBtn: document.getElementById('adminAdjustSubmitBtn'),
    pendingApprovalsReloadBtn: document.getElementById('pendingApprovalsReloadBtn'),
    pendingApprovalsList: document.getElementById('pendingApprovalsList'),
    rootEventCard: document.getElementById('rootEventCard'),
    rootBulkPointsCard: document.getElementById('rootBulkPointsCard'),
    rootBulkMode: document.getElementById('rootBulkMode'),
    rootBulkAmount: document.getElementById('rootBulkAmount'),
    rootBulkReason: document.getElementById('rootBulkReason'),
    rootBulkTarget: document.getElementById('rootBulkTarget'),
    rootBulkApplyBtn: document.getElementById('rootBulkApplyBtn'),
    rootBulkStatusText: document.getElementById('rootBulkStatusText'),
    gachaEventEnabled: document.getElementById('gachaEventEnabled'),
    gachaEventStartKst: document.getElementById('gachaEventStartKst'),
    gachaEventEndKst: document.getElementById('gachaEventEndKst'),
    gachaEventMultiplier: document.getElementById('gachaEventMultiplier'),
    gachaEventCostOverride: document.getElementById('gachaEventCostOverride'),
    gachaEventMessage: document.getElementById('gachaEventMessage'),
    gachaEnabled: document.getElementById('gachaEnabled'),
    gachaRoundNo: document.getElementById('gachaRoundNo'),
    gachaMaxWinners: document.getElementById('gachaMaxWinners'),
    saveGachaEventBtn: document.getElementById('saveGachaEventBtn'),
    gachaEventStatusText: document.getElementById('gachaEventStatusText'),
    eventPublicBox: document.getElementById('eventPublicBox')
};

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    setupRealtimeListener();
    setupEventListeners();

    // 만료 정리 루틴: 스냅샷 갱신이 없더라도 "페이지가 열려있는 동안" 주기적으로 정리
    // (서버가 없으므로, 아무도 접속하지 않으면 정리는 그 시점까지 지연될 수 있음)
    setInterval(() => {
        try { checkExpiredPosts(); } catch (e) { console.error(e); }
    }, 60 * 1000);
});

function setupRealtimeListener() {
    if (!db) return;

    db.collection("posts")
        .orderBy("createdAt", "desc")
        .onSnapshot((snapshot) => {
            // 하드 삭제(문서 자체 삭제) 감지: 이전 스냅샷에 있던 문서가 이번엔 사라졌다면 기록
            const nextById = new Map();
            snapshot.forEach((doc) => {
                nextById.set(doc.id, doc.data());
            });
            for (const [oldId, oldData] of lastSnapshotById.entries()) {
                if (!nextById.has(oldId)) {
                    logAuditEvent("hard_delete_detected", {
                        postId: oldId,
                        previousData: oldData || null
                    });
                    // 비정상(하드 삭제) 감지 로그를 디스코드에도 남김
                    if (shouldNotifyHardDelete(oldId)) {
                        setHardDeleteNotified(oldId);
                        notifyDeletionToDiscord({ ...(oldData || {}), postId: oldId }, 'hard_delete_detected', '문서가 하드 삭제되어 스냅샷에서 사라짐');
                    }
                }
            }
            lastSnapshotById = nextById;

            posts = [];
            snapshot.forEach((doc) => {
                posts.push({ id: doc.id, ...doc.data() });
            });
            checkExpiredPosts();
            renderPosts();
            renderNotices(); 
        }, (error) => {
            console.error("데이터 불러오기 실패:", error);
            logAuditEvent("realtime_listener_error", {
                code: error?.code || null,
                message: error?.message || String(error)
            });
            sendLogToDiscord([
                '⚠️ **Firestore 실시간 리스너 오류**',
                '',
                `- **code**: ${error?.code || ''}`,
                `- **message**: ${error?.message || String(error)}`
            ]);
        });
}

function setupEventListeners() {
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab;
            renderPosts();
        });
    });

    elements.roleFilter.addEventListener('change', renderPosts);
    if (elements.categoryFilter) {
        elements.categoryFilter.addEventListener('change', renderPosts);
    }

    elements.loginBtn.addEventListener('click', () => {
        // 기본은 로그인 탭
        setAuthMode('login');
        elements.authModal.classList.remove('hidden');
    });
    
    elements.authCloseBtn.addEventListener('click', () => {
        elements.authModal.classList.add('hidden');
    });

    if (elements.authTabLogin) elements.authTabLogin.addEventListener('click', () => setAuthMode('login'));
    if (elements.authTabSignup) elements.authTabSignup.addEventListener('click', () => setAuthMode('signup'));

    elements.authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitAuthForm();
    });

    elements.logoutBtn.addEventListener('click', logout);

    // adminVerifyBtn(디스코드 OAuth)은 "완벽 보안" 구조에선 사용하지 않음
    // (관리자 여부는 Firestore `admins/{uid}` 존재 여부로 판별)

    if (elements.adminToolsBtn) {
        elements.adminToolsBtn.addEventListener('click', openAdminToolsModal);
    }
    if (elements.adminToolsCloseBtn) {
        elements.adminToolsCloseBtn.addEventListener('click', closeAdminToolsModal);
    }

    // 포인트/뽑기 모달
    if (elements.pointsOpenBtn) {
        elements.pointsOpenBtn.addEventListener('click', openPointsModal);
    }
    if (elements.pointsCloseBtn) {
        elements.pointsCloseBtn.addEventListener('click', closePointsModal);
    }
    if (elements.pointsHowtoBtn && elements.pointsHowtoPanel) {
        elements.pointsHowtoBtn.addEventListener('click', () => {
            elements.pointsHowtoPanel.classList.toggle('hidden');
        });
    }
    if (elements.pointsTabBtns) {
        elements.pointsTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.pointsTab;
                if (!tab) return;
                switchPointsTab(tab);
            });
        });
    }
    if (elements.pointsRefreshBtn) elements.pointsRefreshBtn.addEventListener('click', () => refreshPointsAll({ showToastOnDone: true }));
    if (elements.attendanceBtn) elements.attendanceBtn.addEventListener('click', doAttendanceCheck);
    if (elements.gachaDrawBtn) elements.gachaDrawBtn.addEventListener('click', doGachaDraw);
    if (elements.gachaRefreshBtn) elements.gachaRefreshBtn.addEventListener('click', () => refreshGachaPanel({ showToastOnDone: true }));
    if (elements.adminAdjustSubmitBtn) elements.adminAdjustSubmitBtn.addEventListener('click', adminAdjustPoints);
    if (elements.pendingApprovalsReloadBtn) elements.pendingApprovalsReloadBtn.addEventListener('click', loadPendingApprovals);
    if (elements.saveGachaEventBtn) elements.saveGachaEventBtn.addEventListener('click', saveGachaEventConfig);
    if (elements.rootBulkApplyBtn) elements.rootBulkApplyBtn.addEventListener('click', rootBulkAdjustAllUsers);

    if (elements.adminTabBtns) {
        elements.adminTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                elements.adminTabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.adminTab;
                elements.adminTabAudit.classList.toggle('hidden', tab !== 'audit');
                elements.adminTabBackup.classList.toggle('hidden', tab !== 'backup');
            });
        });
    }
    if (elements.auditReloadBtn) elements.auditReloadBtn.addEventListener('click', loadAuditLogs);
    if (elements.auditTypeFilter) elements.auditTypeFilter.addEventListener('change', renderAuditLogs);
    if (elements.auditSearch) elements.auditSearch.addEventListener('input', renderAuditLogs);
    if (elements.restoreReloadBtn) elements.restoreReloadBtn.addEventListener('click', renderRestoreList);
    if (elements.restoreSearch) elements.restoreSearch.addEventListener('input', renderRestoreList);

    if (elements.exportPostsBtn) elements.exportPostsBtn.addEventListener('click', () => exportPostsJson({ includeDeleted: false, onlyNotices: false }));
    if (elements.exportNoticesBtn) elements.exportNoticesBtn.addEventListener('click', () => exportPostsJson({ includeDeleted: false, onlyNotices: true }));
    if (elements.exportPostsIncludeDeletedBtn) elements.exportPostsIncludeDeletedBtn.addEventListener('click', () => exportPostsJson({ includeDeleted: true, onlyNotices: false }));
    if (elements.importBtn) elements.importBtn.addEventListener('click', importPostsJson);
    if (elements.clearImportBtn) elements.clearImportBtn.addEventListener('click', () => { if (elements.importJsonText) elements.importJsonText.value = ''; });

    // 일반 글쓰기 버튼
    elements.writeBtn.addEventListener('click', () => {
        openWriteModal(false);
    });

    // 공지 작성 버튼 (관리자용)
    elements.writeNoticeBtn.addEventListener('click', () => {
        openWriteModal(true);
    });

    elements.writeCloseBtn.addEventListener('click', () => {
        elements.writeModal.classList.add('hidden');
    });

    elements.postCategory.addEventListener('change', (e) => {
        const category = e.target.value;
        const data = categoryData[category];
        
        if (!data) {
            elements.detailSelectGroup.classList.add('hidden');
            return;
        }

        elements.detailSelectGroup.classList.remove('hidden');
        
        elements.postDetail.innerHTML = '';
        data.details.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            elements.postDetail.appendChild(option);
        });

        elements.postDifficulty.innerHTML = '';
        if (data.difficulties.length > 0) {
            elements.postDifficulty.style.display = 'block';
            data.difficulties.forEach(item => {
                const option = document.createElement('option');
                option.value = item;
                option.textContent = item;
                elements.postDifficulty.appendChild(option);
            });
        } else {
            elements.postDifficulty.style.display = 'none';
        }
    });

    const roleAny = document.getElementById('role_any');
    const otherRoles = Array.from(elements.postRoleCheckboxes).filter(cb => cb.value !== '무관');

    if (roleAny) {
        roleAny.addEventListener('change', () => {
            if (roleAny.checked) otherRoles.forEach(cb => cb.checked = false);
        });
    }

    otherRoles.forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked && roleAny) roleAny.checked = false;
        });
    });

    elements.postForm.addEventListener('submit', handlePostSubmit);

    elements.manageCloseBtn.addEventListener('click', () => {
        elements.manageModal.classList.add('hidden');
        currentEditingPostId = null;
    });

    elements.btnStatusRecruiting.addEventListener('click', () => updatePostStatus('recruiting'));
    elements.btnStatusFull.addEventListener('click', () => updatePostStatus('full'));
    
    elements.addMemberBtn.addEventListener('click', addPartyMember);
    elements.deletePostBtn.addEventListener('click', deletePost);

    elements.detailCloseBtn.addEventListener('click', () => {
        elements.detailModal.classList.add('hidden');
    });

    elements.guideBtn.addEventListener('click', () => {
        elements.guideModal.classList.remove('hidden');
    });
    elements.guideCloseBtn.addEventListener('click', () => {
        elements.guideModal.classList.add('hidden');
    });

    // 공지 더보기 버튼
    elements.loadMoreNoticeBtn.addEventListener('click', () => {
        renderNotices(true); // 전체 보기
        elements.loadMoreNoticeBtn.classList.add('hidden');
    });

    // 헤더 캐릭터 검색 이벤트
    elements.headerSearchBtn.addEventListener('click', handleHeaderSearch);
    elements.headerSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleHeaderSearch();
    });

    elements.searchCloseBtn.addEventListener('click', () => {
        elements.searchResultModal.classList.add('hidden');
    });
    
    // 계산기 관련 이벤트
    if (elements.openCalculatorBtn) {
        elements.openCalculatorBtn.addEventListener('click', () => {
            // 처음 열 때 변화량은 0으로 시작
            lastSimulatedScore = null;
            if (elements.calcDiff) {
                elements.calcDiff.textContent = '(0)';
                elements.calcDiff.style.color = 'var(--text-muted)';
            }
            if (currentCalcData) {
                fillCalculator(currentCalcData);
            }
            elements.dpsCalculatorModal.classList.remove('hidden');
        });
    }

    if (elements.calcCloseBtn) {
        elements.calcCloseBtn.addEventListener('click', () => {
            elements.dpsCalculatorModal.classList.add('hidden');
        });
    }

    if (elements.doCalculateBtn) {
        elements.doCalculateBtn.addEventListener('click', calculateEstimatedDps);
    }

    if (elements.doRecommendBtn) {
        elements.doRecommendBtn.addEventListener('click', recommendStatsForTargetScore);
    }

    if (elements.calcAtulBtn) {
        elements.calcAtulBtn.addEventListener('click', () => {
            if (!currentCalcData?.name) {
                alert('먼저 캐릭터를 검색해주세요.');
                return;
            }
            openAtulPage(currentCalcData.name);
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            if (e.target.id === 'writeModal') return;
            if (e.target.id === 'dpsCalculatorModal') return;
            if (e.target.id === 'searchResultModal') return;
            e.target.classList.add('hidden');
        }
    });

    setupGlobalTooltips();
}

function setupGlobalTooltips() {
    let tooltip = document.getElementById('globalTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'globalTooltip';
        tooltip.className = 'global-tooltip';
        document.body.appendChild(tooltip);
    }

    const icons = document.querySelectorAll('.tooltip-icon[data-tooltip]');
    icons.forEach(icon => {
        icon.addEventListener('mouseenter', () => {
            const text = icon.getAttribute('data-tooltip') || '';
            if (!text) return;
            tooltip.textContent = text;
            tooltip.classList.add('show');

            const rect = icon.getBoundingClientRect();
            const padding = 12;
            const tooltipRect = tooltip.getBoundingClientRect();

            // 기본: 아이콘 중앙 위
            let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
            let top = rect.top - tooltipRect.height - 10;

            // 좌/우 화면 밖으로 나가면 보정
            left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));

            // 위가 부족하면 아래로
            if (top < padding) {
                top = rect.bottom + 10;
            }

            tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        });

        icon.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
            tooltip.style.transform = 'translate(-9999px, -9999px)';
        });
    });
}

// 헤더 검색 핸들러
async function handleHeaderSearch() {
    const nickname = elements.headerSearchInput.value.trim();
    if (!nickname) {
        alert('닉네임을 입력해주세요.');
        return;
    }

    // 버튼 로딩 상태
    const originalBtnText = elements.headerSearchBtn.innerHTML;
    elements.headerSearchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    elements.headerSearchBtn.disabled = true;

    try {
        const charData = await fetchCharacterData(nickname);
        currentCalcData = charData; // 계산기용 데이터 저장
        
        if (charData) {
            // 검색 성공 -> 모달에 표시
            elements.searchResultContent.innerHTML = `
                <div class="search-profile">
                    <img src="${safeAvatarUrl(charData.profile_img, charData.name)}" class="search-avatar">
                    <div class="search-name">${charData.name}</div>
                    <div class="search-class">${charData.class} (Lv.${charData.level})</div>
                </div>
                
                <div class="score-box-container">
                    <div class="score-box">
                        <div class="score-label">아온 점수</div>
                        <div class="score-value">${Math.floor(charData.aonScore || 0).toLocaleString()}</div>
                    </div>
                    <div class="score-box">
                        <div class="score-label">아툴 전투력</div>
                        <div class="score-value">${(charData.combatScore || 0).toLocaleString()}</div>
                        <div class="score-sub">※ 실제 아툴과<p> 상이할 수 있습니다.</div>
                    </div>
                </div>

                <div style="margin-top:20px; text-align:center;">
                     <button class="btn-outline full-width" onclick="window.open('https://www.aion2tool.com/char/serverid=2002/${encodeURIComponent(nickname)}', '_blank')">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> 아툴에서 자세히 보기
                     </button>
                </div>
            `;
            elements.searchResultModal.classList.remove('hidden');
            
            // 계산기 버튼 활성화
            elements.openCalculatorBtn.classList.remove('hidden');
            
        } else {
            alert('캐릭터를 찾을 수 없습니다.');
            elements.openCalculatorBtn.classList.add('hidden');
        }
    } catch (err) {
        console.error(err);
        alert('검색 중 오류가 발생했습니다.');
    } finally {
        elements.headerSearchBtn.innerHTML = originalBtnText;
        elements.headerSearchBtn.disabled = false;
        elements.headerSearchInput.value = '';
    }
}

// 계산기 데이터 채우기
function fillCalculator(data) {
    if (!data) return;
    const s = data.calcStats;
    if (!s) {
        showToast(`<i class="fa-solid fa-circle-info"></i> AON API에서 세부 스탯 자동 불러오기를 할 수 없어, 직접 입력이 필요합니다.`);
        return;
    }

    elements.calcAttackPower.value = s.attackPower || 0;
    elements.calcWeaponMin.value = s.weaponMinAttack || 0;
    elements.calcWeaponMax.value = s.weaponMaxAttack || 0;
    elements.calcCritStat.value = s.criticalHit || 0;

    elements.calcCombatSpeed.value = s.combatSpeed || 0;
    elements.calcWeaponDamageAmp.value = s.weaponDamageAmp || 0;
    elements.calcDamageAmp.value = s.damageAmp || 0;
    elements.calcCritDamageAmp.value = s.criticalDamageAmp || 0;
    elements.calcSkillDamage.value = s.skillDamage || 0;
    elements.calcCooldownReduction.value = s.cooldownReduction || 0;
    elements.calcStunHit.value = s.stunHit || 0;
    elements.calcPerfect.value = s.perfect || 0;
    elements.calcMultiHit.value = s.multiHit || 0;
    
    // 초기 계산 실행
    calculateEstimatedDps();
}

function convertCritStatToChance(critStat) {
    // 스탯 × 0.7 / 10 = 확률%
    return (critStat * 0.7) / 10;
}

function clampPercent(x, max = 100) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(n, 0), max);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function defaultAvatarDataUri(label = 'A') {
    const ch = String(label || 'A').trim().slice(0, 1).toUpperCase() || 'A';
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">` +
        `<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">` +
        `<stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22c55e"/>` +
        `</linearGradient></defs>` +
        `<rect width="128" height="128" rx="64" fill="url(#g)"/>` +
        `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="Cafe24Ssurround, Pretendard, sans-serif" font-size="56" fill="rgba(255,255,255,0.92)">` +
        `${ch}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function safeAvatarUrl(url, nameForFallback = 'A') {
    const u = String(url || '').trim();
    if (u && (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:'))) return u;
    return defaultAvatarDataUri(nameForFallback);
}

// =========================
// Admin Tools (Audit / Backup)
// =========================
let auditUnsub = null;
let auditCache = [];

function openAdminToolsModal() {
    if (!currentUser?.isAdmin) {
        alert('관리자만 접근 가능합니다.');
        return;
    }
    if (!elements.adminToolsModal) return;
    elements.adminToolsModal.classList.remove('hidden');
    loadAuditLogs();
    renderRestoreList();
}

function closeAdminToolsModal() {
    if (!elements.adminToolsModal) return;
    elements.adminToolsModal.classList.add('hidden');
    if (auditUnsub) {
        auditUnsub();
        auditUnsub = null;
    }
}

function renderRestoreList() {
    if (!elements.restoreList) return;
    if (!currentUser?.isAdmin) {
        elements.restoreList.innerHTML = `<div style="color: var(--text-sub); padding: 12px;">관리자만 볼 수 있습니다.</div>`;
        return;
    }

    const q = (elements.restoreSearch?.value || '').trim().toLowerCase();
    const deleted = posts
        .filter(p => p && p.deletedAt && p.type !== 'notice')
        .concat(posts.filter(p => p && p.deletedAt && p.type === 'notice')) // 공지는 아래쪽에 이어 붙이기
        .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

    let rows = deleted;
    if (q) {
        rows = rows.filter(p => {
            const hay = `${p.id || ''} ${p.title || ''} ${p.author?.name || ''} ${p.deletedReasonCode || ''}`.toLowerCase();
            return hay.includes(q);
        });
    }

    if (!rows.length) {
        elements.restoreList.innerHTML = `<div style="color: var(--text-sub); padding: 12px;">삭제된 글이 없습니다.</div>`;
        return;
    }

    const html = rows.slice(0, 200).map(p => {
        const kst = formatKst(p.deletedAt) || '';
        const typeLabel = formatPostTypeLabel(p.type);
        const author = p.author?.name ? `${p.author.name}${p.author?.class ? ` (${p.author.class})` : ''}` : '(작성자 없음)';
        const reason = `${p.deletedReasonCode || ''}${p.deletedReason ? ` / ${p.deletedReason}` : ''}`;
        return `
            <div class="audit-item">
                <div class="audit-top">
                    <div class="audit-type">${escapeHtml(typeLabel)} <span style="color: var(--text-muted); font-weight:700;">(복구 가능)</span></div>
                    <div class="audit-time">${escapeHtml(kst)} <span style="color: var(--text-muted);">(${escapeHtml(p.deletedAt)})</span></div>
                </div>
                <div class="audit-body">
제목: ${escapeHtml(p.title || '')}
작성자: ${escapeHtml(author)}
postId: ${escapeHtml(p.id || '')}
사유: ${escapeHtml(reason)}
                </div>
                <div class="admin-tools-row" style="margin-top:10px;">
                    <button class="btn-success" onclick="restoreSoftDeletedPost('${escapeHtml(p.id)}')"><i class="fa-solid fa-rotate-left"></i> 복구</button>
                </div>
            </div>
        `;
    }).join('');

    elements.restoreList.innerHTML = html;
}

window.restoreSoftDeletedPost = async function(postId) {
    if (!currentUser?.isAdmin) return alert('관리자만 가능합니다.');
    if (!db) return alert('DB 연결이 필요합니다.');
    if (!postId) return;

    const post = posts.find(p => p.id === postId);
    if (!post) return alert('문서를 찾을 수 없습니다.');
    if (!post.deletedAt) return alert('이미 삭제 상태가 아닙니다.');

    const ok = confirm(`이 글을 복구할까요?\n\n- 제목: ${post.title || ''}\n- 작성자: ${post.author?.name || ''}\n- 삭제사유: ${post.deletedReasonCode || ''}`);
    if (!ok) return;

    const del = firebase.firestore.FieldValue.delete();
    const patch = {
        deletedAt: del,
        deletedReasonCode: del,
        deletedReason: del,
        deletedActor: del,
        deletedSource: del
    };

    // 게시글은 deleted 상태에서 복구하면 recruiting으로 되돌림 (공지는 status가 의미 없지만 통일)
    patch.status = 'recruiting';

    try {
        await db.collection("posts").doc(postId).update(patch);
        showToast(`<i class="fa-solid fa-rotate-left"></i> 복구되었습니다.`);
        sendLogToDiscord([
            '🟢 **복구 실행**',
            `- postId: ${postId}`,
            `- type: ${post.type}`,
            `- title: ${post.title || ''}`,
            `- by: ${currentUser?.name || 'unknown'} (admin)`,
            `- at(KST): ${formatKst(new Date().toISOString()) || ''}`
        ]);
    } catch (e) {
        console.error(e);
        alert('복구 실패: ' + (e?.message || String(e)));
    }
}

function renderAuditLogs() {
    if (!elements.auditList) return;
    const type = elements.auditTypeFilter?.value || 'all';
    const q = (elements.auditSearch?.value || '').trim().toLowerCase();

    let rows = auditCache.slice();
    if (type !== 'all') rows = rows.filter(r => r.eventType === type);
    if (q) {
        rows = rows.filter(r => {
            const hay = JSON.stringify(r).toLowerCase();
            return hay.includes(q);
        });
    }

    if (!rows.length) {
        elements.auditList.innerHTML = `<div style="color: var(--text-sub); padding: 12px;">표시할 로그가 없습니다.</div>`;
        return;
    }

    const html = rows.slice(0, 200).map(r => {
        const kst = formatKst(r.createdAt) || '';
        const iso = r.createdAt || '';
        const actorName = r.actor?.by || '(unknown)';
        const actorAdmin = r.actor?.isAdmin ? ' (admin)' : '';
        const actorDiscord = r.actor?.discordUserId ? ` / discord:${r.actor.discordUserId}` : '';
        const title = r.payload?.previousData?.title || r.payload?.title || '';
        const postId = r.payload?.postId || r.payload?.id || '';
        const msg = r.payload?.message || r.payload?.error || '';
        const line2 = [
            postId ? `postId=${postId}` : null,
            title ? `title="${title}"` : null,
            msg ? `msg="${msg}"` : null
        ].filter(Boolean).join(' / ');

        return `
            <div class="audit-item">
                <div class="audit-top">
                    <div class="audit-type">${escapeHtml(r.eventType || '')}</div>
                    <div class="audit-time">${escapeHtml(kst)} <span style="color: var(--text-muted);">(${escapeHtml(iso)})</span></div>
                </div>
                <div class="audit-body">
감지자: ${escapeHtml(actorName)}${escapeHtml(actorAdmin)}${escapeHtml(actorDiscord)}
${escapeHtml(line2)}
                </div>
            </div>
        `;
    }).join('');

    elements.auditList.innerHTML = html;
}

function loadAuditLogs() {
    if (!db || !elements.auditList) return;
    elements.auditList.innerHTML = `<div style="color: var(--text-sub); padding: 12px;">로그를 불러오는 중...</div>`;

    if (auditUnsub) {
        auditUnsub();
        auditUnsub = null;
    }

    auditUnsub = db.collection("audit_logs")
        .orderBy("createdAt", "desc")
        .limit(200)
        .onSnapshot((snap) => {
            auditCache = [];
            snap.forEach(doc => auditCache.push({ id: doc.id, ...doc.data() }));
            renderAuditLogs();
        }, (err) => {
            console.error(err);
            elements.auditList.innerHTML = `<div style="color: var(--danger); padding: 12px;">로그 로드 실패: ${escapeHtml(err?.message || String(err))}</div>`;
        });
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function exportPostsJson(opts) {
    if (!currentUser?.isAdmin) {
        alert('관리자만 가능합니다.');
        return;
    }
    const includeDeleted = !!opts?.includeDeleted;
    const onlyNotices = !!opts?.onlyNotices;

    let list = posts.slice();
    if (!includeDeleted) list = list.filter(p => !p.deletedAt);
    if (onlyNotices) list = list.filter(p => p.type === 'notice');

    const payload = list.map(p => ({ ...p })); // shallow copy (id 포함)
    const name = onlyNotices ? 'notices' : (includeDeleted ? 'posts_all_including_deleted' : 'posts');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`${name}_${ts}.json`, payload);
    showToast(`<i class="fa-solid fa-file-export"></i> 내보내기 완료: ${payload.length}개`);
}

async function importPostsJson() {
    if (!currentUser?.isAdmin) {
        alert('관리자만 가능합니다.');
        return;
    }
    if (!db) return alert('DB 연결이 필요합니다.');
    const txt = elements.importJsonText?.value || '';
    if (!txt.trim()) return alert('JSON을 붙여넣어 주세요.');

    let data;
    try {
        data = JSON.parse(txt);
    } catch (e) {
        alert('JSON 파싱에 실패했습니다. 형식을 확인해 주세요.');
        return;
    }
    if (!Array.isArray(data)) {
        alert('JSON은 배열 형태여야 합니다. 예: [{"id":"..."}]');
        return;
    }

    const mode = elements.importMode?.value || 'upsert';
    const ok = confirm(`가져오기 ${data.length}건을 진행할까요?\n모드: ${mode}`);
    if (!ok) return;

    const chunks = [];
    const size = 400; // batch 500 제한 여유
    for (let i = 0; i < data.length; i += size) chunks.push(data.slice(i, i + size));

    let upserted = 0;
    let skipped = 0;
    for (const chunk of chunks) {
        const batch = db.batch();
        for (const item of chunk) {
            if (!item || typeof item !== 'object') continue;
            const id = item.id;
            const docRef = id ? db.collection("posts").doc(String(id)) : db.collection("posts").doc();
            const payload = { ...item };
            delete payload.id;

            // 최소 필드 보정
            if (!payload.createdAt) payload.createdAt = new Date().toISOString();
            if (!payload.type) payload.type = 'party';

            if (mode === 'create_only') {
                // create_only는 존재 여부를 batch에서 확인할 수 없으므로 "set(merge=false)" 대신 "set(merge=true)"로 안전하게 쓰지 않음
                // 여기서는 그냥 skip 처리(정확한 create_only는 별도 get 필요)
                skipped++;
                continue;
            }

            batch.set(docRef, payload, { merge: true });
            upserted++;
        }
        await batch.commit();
    }

    showToast(`<i class="fa-solid fa-file-import"></i> 가져오기 완료: upsert ${upserted} / skip ${skipped}`);
}

function readCalcStatsFromInputs() {
    const toNum = (el) => parseFloat(el?.value) || 0;
    return {
        attackPower: Math.max(0, toNum(elements.calcAttackPower)),
        weaponMin: Math.max(0, toNum(elements.calcWeaponMin)),
        weaponMax: Math.max(0, toNum(elements.calcWeaponMax)),
        critStat: Math.max(0, toNum(elements.calcCritStat)),

        combatSpeed: clampPercent(toNum(elements.calcCombatSpeed)),
        weaponDamageAmp: clampPercent(toNum(elements.calcWeaponDamageAmp)),
        damageAmp: clampPercent(toNum(elements.calcDamageAmp), 999),
        critDamageAmp: clampPercent(toNum(elements.calcCritDamageAmp), 999),
        skillDamage: clampPercent(toNum(elements.calcSkillDamage), 999),
        cooldownReduction: clampPercent(toNum(elements.calcCooldownReduction), 95), // 100%는 분모 0
        stunHit: clampPercent(toNum(elements.calcStunHit), 999),
        perfect: clampPercent(toNum(elements.calcPerfect), 999),
        multiHit: clampPercent(toNum(elements.calcMultiHit), 999)
    };
}

function computeAtulScoreFromStats(stats, options = {}) {
    const critMode = options.critMode || 'legacy'; // 'legacy' | 'expected'
    const attackPower = stats.attackPower || 0;
    const weaponMin = stats.weaponMin || 0;
    const weaponMax = stats.weaponMax || 0;
    const critStat = stats.critStat || 0;

    const combatSpeed = stats.combatSpeed || 0;
    const weaponDamageAmp = stats.weaponDamageAmp || 0;
    const damageAmp = stats.damageAmp || 0;
    const critDamageAmp = stats.critDamageAmp || 0;
    const skillDamage = stats.skillDamage || 0;
    const cooldownReduction = stats.cooldownReduction || 0;
    const stunHit = stats.stunHit || 0;
    const perfect = stats.perfect || 0;
    const multiHit = stats.multiHit || 0;

    const damageIncreaseValues = {};

    if (combatSpeed > 0) damageIncreaseValues.combatSpeed = combatSpeed;
    if (weaponDamageAmp > 0) damageIncreaseValues.weaponDamageAmp = weaponDamageAmp * 0.66;
    if (damageAmp > 0) damageIncreaseValues.damageAmp = damageAmp;

    const criticalChance = clampPercent(convertCritStatToChance(critStat)); // 0~100%
    let adjustedAttackPower = attackPower;

    // 치명 처리:
    // - legacy: (기존 방식) "치피증이 있을 때만" 치명 기대값 증가를 반영
    // - expected: (추천용) 기본 치명(1.5배) 기대값을 항상 반영
    const BASE_CRITICAL_DAMAGE = 1.5;
    const p = Math.min(Math.max(criticalChance / 100, 0), 1);

    if (critMode === 'legacy') {
        if (critDamageAmp > 0 && criticalChance > 0) {
            const amplifiedCriticalDamage = BASE_CRITICAL_DAMAGE + (critDamageAmp / 100);
            const baseExpectedDamage = (1 - p) * 1 + p * BASE_CRITICAL_DAMAGE;
            const amplifiedExpectedDamage = (1 - p) * 1 + p * amplifiedCriticalDamage;
            const damageIncrease = ((amplifiedExpectedDamage / baseExpectedDamage) - 1) * 100;
            damageIncreaseValues.criticalDamageAmp = damageIncrease;
        }
    } else {
        const critDamageMultiplier = BASE_CRITICAL_DAMAGE + (critDamageAmp / 100);
        const expectedCritMultiplier = (1 - p) * 1 + p * critDamageMultiplier; // 1.0 ~ (1.5+치피증)
        if (expectedCritMultiplier > 1) {
            damageIncreaseValues.criticalExpected = (expectedCritMultiplier - 1) * 100;
        }
    }

    if (skillDamage > 0) damageIncreaseValues.skillDamage = skillDamage;

    if (cooldownReduction > 0 && cooldownReduction < 100) {
        const COOLDOWN_EFFICIENCY = 0.5;
        const cooldownMultiplier = 100 / (100 - cooldownReduction);
        const theoreticalDamageIncrease = (cooldownMultiplier - 1) * 100;
        const actualDamageIncrease = theoreticalDamageIncrease * COOLDOWN_EFFICIENCY;
        damageIncreaseValues.cooldownReduction = actualDamageIncrease;
    }

    if (stunHit > 0) damageIncreaseValues.stunHit = stunHit;

    if (perfect > 0 && weaponMin > 0 && weaponMax > 0 && weaponMax > weaponMin) {
        const damageIncrease = perfect * ((weaponMax - weaponMin) / (weaponMax + weaponMin));
        damageIncreaseValues.perfect = damageIncrease;
    }

    if (multiHit > 0) {
        const baseMultiHitPercent = 18;
        const totalMultiHitPercent = baseMultiHitPercent + multiHit;

        const f = (x) => 11.1 * x + 13.9 * Math.pow(x, 2) + 17.8 * Math.pow(x, 3) + 23.9 * Math.pow(x, 4);

        const baseDamageIncrease = f(baseMultiHitPercent / 100);
        const totalDamageIncrease = f(totalMultiHitPercent / 100);

        const baseMultiplier = 1 + baseDamageIncrease / 100;
        const totalMultiplier = 1 + totalDamageIncrease / 100;
        const actualDamageIncrease = ((totalMultiplier / baseMultiplier) - 1) * 100;

        damageIncreaseValues.multiHit = actualDamageIncrease;
    }

    let totalMultiplier = 1.0;
    for (const key in damageIncreaseValues) {
        totalMultiplier *= (1 + damageIncreaseValues[key] / 100);
    }

    const finalCombatScore = adjustedAttackPower * totalMultiplier;
    const score = Math.round(finalCombatScore);

    return {
        score,
        totalMultiplier,
        criticalChance
    };
}

// DPS 계산 로직
function calculateEstimatedDps() {
    const stats = readCalcStatsFromInputs();
    // "예상 아툴 전투력"은 기존 계산 방식(legacy) 유지
    const { score } = computeAtulScoreFromStats(stats, { critMode: 'legacy' });

    elements.calcResultScore.textContent = score.toLocaleString();

    if (elements.calcDiff) {
        if (lastSimulatedScore === null || !Number.isFinite(lastSimulatedScore)) {
            lastSimulatedScore = score;
            elements.calcDiff.textContent = '(0)';
            elements.calcDiff.style.color = 'var(--text-muted)';
            return;
        }

        const diff = score - lastSimulatedScore;
        lastSimulatedScore = score;

        const sign = diff > 0 ? '+' : '';
        elements.calcDiff.textContent = `(${sign}${diff.toLocaleString()})`;
        elements.calcDiff.style.color = diff > 0 ? 'var(--success)' : (diff < 0 ? 'var(--danger)' : 'var(--text-muted)');
    }
}

function recommendStatsForTargetScore() {
    const out = elements.calcRecommendOutput;
    if (!out) return;

    const target = parseFloat(elements.calcTargetScore?.value) || 0;
    const baseStats = readCalcStatsFromInputs();
    // 목표/표시 기준 점수는 legacy(예상 아툴 전투력과 동일 기준)
    const base = computeAtulScoreFromStats(baseStats, { critMode: 'legacy' });

    if (!target || target <= 0) {
        out.textContent = '목표 전투력을 숫자로 입력해 주세요.';
        return;
    }

    if (target <= base.score) {
        out.textContent = `이미 목표 달성 상태입니다.\n현재 ${base.score.toLocaleString()} ≥ 목표 ${Math.round(target).toLocaleString()}`;
        return;
    }

    // “가능한 모든 사항”의 현실 제약을 수식 레벨에서 반영할 수 있는 범위:
    // - 비선형/상호작용(치명확률×치피증, 쿨감 분모 등)을 반복 재평가로 반영
    // - 퍼센트 상한(0~100, 쿨감 0~95) 같은 수학적/안전 상한 적용
    // - 무기 최소/최대는 실제로 함께 오르는 경우가 많아 "무기공격력(최소+최대 동시)" 항목을 우선 고려

    // 스텝은 "현실적으로 비교 가능한 단위"로 조정 (너무 작은 단위는 %스탯에 밀려 항상 하위로 고정되는 현상 완화)
    const knobs = [
        { key: 'attackPower', label: '공격력', step: 100, apply: (s, step) => ({ ...s, attackPower: s.attackPower + step }) },
        { key: 'weaponDamage', label: '무기공격력(최소+최대)', step: 5, apply: (s, step) => ({ ...s, weaponMin: s.weaponMin + step, weaponMax: s.weaponMax + step }) },
        { key: 'critStat', label: '치명타 수치', step: 200, apply: (s, step) => ({ ...s, critStat: s.critStat + step }) },

        { key: 'combatSpeed', label: '전투 속도(%)', step: 1.0, apply: (s, step) => ({ ...s, combatSpeed: clampPercent(s.combatSpeed + step) }) },
        { key: 'weaponDamageAmp', label: '무기 피해 증폭(%)', step: 1.0, apply: (s, step) => ({ ...s, weaponDamageAmp: clampPercent(s.weaponDamageAmp + step) }) },
        { key: 'damageAmp', label: '피해 증폭(통합 %)', step: 1.0, apply: (s, step) => ({ ...s, damageAmp: Math.max(0, s.damageAmp + step) }) },
        { key: 'critDamageAmp', label: '치명타 피해 증폭(%)', step: 1.0, apply: (s, step) => ({ ...s, critDamageAmp: Math.max(0, s.critDamageAmp + step) }) },
        { key: 'skillDamage', label: '스킬 피해 증폭(%)', step: 1.0, apply: (s, step) => ({ ...s, skillDamage: Math.max(0, s.skillDamage + step) }) },
        { key: 'cooldownReduction', label: '재사용 대기시간 감소(%)', step: 1.0, apply: (s, step) => ({ ...s, cooldownReduction: clampPercent(s.cooldownReduction + step, 95) }) },
        { key: 'stunHit', label: '강타 적중(%)', step: 1.0, apply: (s, step) => ({ ...s, stunHit: Math.max(0, s.stunHit + step) }) },
        { key: 'perfect', label: '완벽(%)', step: 1.0, apply: (s, step) => ({ ...s, perfect: Math.max(0, s.perfect + step) }) },
        { key: 'multiHit', label: '다단 히트 적중(%)', step: 1.0, apply: (s, step) => ({ ...s, multiHit: Math.max(0, s.multiHit + step) }) }
    ];

    const evalOneStepLegacy = (stats, k) => {
        const cur = computeAtulScoreFromStats(stats, { critMode: 'legacy' }).score;
        const nextStats = k.apply(stats, k.step);
        const next = computeAtulScoreFromStats(nextStats, { critMode: 'legacy' }).score;
        const gain = next - cur;
        return { gain, nextStats };
    };

    // 추천 효율 평가용(기대값 반영): 랭킹과 선택을 더 합리적으로 만들기 위한 내부 평가
    const evalOneStepExpected = (stats, k) => {
        const cur = computeAtulScoreFromStats(stats, { critMode: 'expected' }).score;
        const nextStats = k.apply(stats, k.step);
        const next = computeAtulScoreFromStats(nextStats, { critMode: 'expected' }).score;
        const gain = next - cur;
        return { gain, nextStats };
    };

    // 추천판단(치명 기대 반영) vs 표시기준(기존 계산)으로 설명
    const detailedDelta = knobs.map(k => {
        const expected = evalOneStepExpected(baseStats, k);
        const legacy = evalOneStepLegacy(baseStats, k);
        return {
            key: k.key,
            label: k.label,
            step: k.step,
            expectedGain: expected.gain,
            legacyGain: legacy.gain
        };
    }).sort((a, b) => b.expectedGain - a.expectedGain);

    // 현재 상태에서의 1스텝 효율 랭킹(기대값 반영)
    const baseRank = detailedDelta.slice();

    // 목표 달성을 위한 반복(그리디, 매번 효율 재평가)
    let working = { ...baseStats };
    let workingScore = base.score;
    const plan = new Map(); // label -> totalIncrease
    const MAX_ITERS = 2000;

    for (let i = 0; i < MAX_ITERS && workingScore < target; i++) {
        let best = null;
        for (const k of knobs) {
            const expected = evalOneStepExpected(working, k);
            const legacy = evalOneStepLegacy(working, k);
            // 선택 기준은 expected(기대값) 이지만, 실제 목표 도달(표시)은 legacy 기준으로 누적
            const scoreGainForChoice = expected.gain;
            if (!best || scoreGainForChoice > best.choiceGain) {
                best = { k, choiceGain: scoreGainForChoice, legacyGain: legacy.gain, nextStats: legacy.nextStats };
            }
        }

        if (!best || best.legacyGain <= 0) break;

        working = best.nextStats;
        workingScore = computeAtulScoreFromStats(working, { critMode: 'legacy' }).score;
        plan.set(best.k.label, (plan.get(best.k.label) || 0) + best.k.step);
    }

    const diff = Math.max(0, Math.round(target) - workingScore);
    const top5 = baseRank.slice(0, 5)
        .map((r, idx) => {
            const exp = r.expectedGain || 0;
            const leg = r.legacyGain || 0;
            const stepTxt = Number.isInteger(r.step) ? r.step : r.step.toFixed(1);
            return `${idx + 1}. ${r.label} +${stepTxt} → 추천판단 +${exp.toLocaleString()} / 표시기준 +${leg.toLocaleString()}`;
        })
        .join('\n');

    const planLines = Array.from(plan.entries())
        .map(([label, inc]) => `- ${label}: +${Number.isInteger(inc) ? inc : inc.toFixed(1)}`);

    const fullList = detailedDelta
        .map(r => {
            const exp = r.expectedGain || 0;
            const leg = r.legacyGain || 0;
            const stepTxt = Number.isInteger(r.step) ? r.step : r.step.toFixed(1);
            return `- ${r.label} +${stepTxt} → 추천판단 +${exp.toLocaleString()} / 표시기준 +${leg.toLocaleString()}`;
        })
        .join('\n');

    const notes = [];
    if (!baseStats.weaponMin || !baseStats.weaponMax) {
        notes.push('무기 최소/최대가 0이면 "완벽" 계산이 사실상 의미가 없거나(조건 미충족), 결과가 왜곡될 수 있어요.');
    }
    if (baseStats.weaponMax <= baseStats.weaponMin) {
        notes.push('무기 최대공격력이 최소공격력보다 작거나 같으면 "완벽" 기대 증가량이 0으로 처리됩니다.');
    }
    if (baseStats.cooldownReduction >= 95) {
        notes.push('재사용 대기시간 감소는 수식상 100%에 가까워질수록 분모가 작아져 급격히 커질 수 있어 95% 상한으로 제한했습니다.');
    }

    const need = Math.max(0, Math.round(target) - base.score);
    const planText = (planLines.length ? planLines.join('\n') : '- (추천 가능한 증가가 없습니다. 입력값/상한을 확인해 주세요)');
    const noteText = (notes.length ? `\n\n[주의/가정]\n- ${notes.join('\n- ')}` : '');

    out.innerHTML =
        `<div style="font-weight:700; color: var(--text-main);">목표 달성 추천 결과</div>` +
        `<div style="margin-top:6px; color: var(--text-sub);">` +
        `현재 <b>${base.score.toLocaleString()}</b> → 목표 <b>${Math.round(target).toLocaleString()}</b> (필요 +${need.toLocaleString()})` +
        `</div>` +
        `<div style="margin-top:10px; padding:10px; border:1px solid var(--border); border-radius:10px; background:rgba(255,255,255,0.03);">` +
        `<div style="font-size:0.85rem; color: var(--text-sub); line-height:1.6;">` +
        `- <b>표시기준</b>: 화면의 “예상 아툴 전투력(계산하기)”과 같은 기준(기존 계산)<br>` +
        `- <b>추천판단</b>: 어떤 스탯이 효율적인지 고를 때는 치명 기대값까지 반영해서 판단` +
        `</div>` +
        `</div>` +
        `<div style="margin-top:14px;"><b>TOP 5 (왜 이 순서인지)</b></div>` +
        `<pre style="margin-top:6px; white-space:pre-wrap; font-family:inherit; color: var(--text-sub);">${escapeHtml(top5)}</pre>` +
        `<details style="margin-top:10px;">` +
        `<summary style="cursor:pointer; color: var(--primary-light); font-weight:700;">전체 변화량(자세히 보기)</summary>` +
        `<pre style="margin-top:8px; white-space:pre-wrap; font-family:inherit; color: var(--text-sub);">${escapeHtml(fullList)}</pre>` +
        `</details>` +
        `<div style="margin-top:14px;"><b>추천 플랜</b></div>` +
        `<pre style="margin-top:6px; white-space:pre-wrap; font-family:inherit; color: var(--text-sub);">${escapeHtml(planText)}</pre>` +
        `<div style="margin-top:10px; color: var(--text-sub);">예상 도달 전투력(표시기준): <b>${workingScore.toLocaleString()}</b>` +
        `${diff > 0 ? ` <span style="color: var(--warning); font-weight:700;">(목표까지 약 ${diff.toLocaleString()} 부족)</span>` : ` <span style="color: var(--success); font-weight:700;">(목표 달성)</span>`}` +
        `</div>` +
        (notes.length ? `<pre style="margin-top:10px; white-space:pre-wrap; font-family:inherit; color: var(--text-muted);">${escapeHtml(noteText.trim())}</pre>` : '');
}


// 글쓰기 모달 열기
function openWriteModal(isNotice, editPost = null) {
    if (!currentUser) {
        alert('로그인 후 이용 가능합니다.');
        elements.authModal.classList.remove('hidden');
        return;
    }

    isNoticeWritingMode = isNotice;
    isEditMode = !!editPost;
    editingPostData = editPost;

    elements.writeModal.classList.remove('hidden');
    elements.postForm.reset();
    elements.detailSelectGroup.classList.add('hidden');
    elements.postDetail.innerHTML = '<option value="">선택</option>';
    elements.postDifficulty.innerHTML = '<option value="">난이도</option>';

    if (currentUser.dps) {
        elements.postMyDps.value = currentUser.dps;
    }

    if (isEditMode && editPost) {
        elements.postTitle.value = editPost.title;
        elements.postContent.value = editPost.content;
        elements.submitPostBtn.textContent = '수정하기';
        elements.modalTitle.textContent = isNotice ? '공지사항 수정' : '게시글 수정';
    } else {
        elements.submitPostBtn.textContent = '등록하기';
        elements.modalTitle.textContent = isNotice ? '공지사항 작성' : '파티 모집글 작성';
    }

    if (isNotice) {
        // 공지 작성/수정 모드
        elements.noticeMessage.classList.remove('hidden');
        elements.categoryGroup.classList.add('hidden');
        elements.roleGroup.classList.add('hidden');
        elements.linkGroup.classList.add('hidden');
        elements.dpsGroup.classList.add('hidden');
        elements.expirationGroup.classList.add('hidden');
        elements.passwordGroup.classList.add('hidden');
        
        elements.postCategory.removeAttribute('required');
        elements.postPassword.removeAttribute('required');
    } else {
        // 일반 작성 모드
        elements.noticeMessage.classList.add('hidden');
        elements.categoryGroup.classList.remove('hidden');
        elements.roleGroup.classList.remove('hidden');
        elements.linkGroup.classList.remove('hidden');
        elements.dpsGroup.classList.remove('hidden');
        elements.expirationGroup.classList.remove('hidden');
        elements.passwordGroup.classList.remove('hidden');

        elements.postCategory.setAttribute('required', 'true');
        if (!isEditMode) elements.postPassword.setAttribute('required', 'true');
        else elements.postPassword.removeAttribute('required');
    }
}

let authMode = 'login'; // 'login' | 'signup'
let signupUidInFlight = null;

async function waitForUserProfile(uid, tries = 12, delayMs = 200) {
    if (!db || !uid) return null;
    const ref = db.collection(FIRESTORE_POINTS.userProfiles).doc(uid);
    for (let i = 0; i < tries; i++) {
        const snap = await ref.get().catch(() => null);
        if (snap?.exists) return snap;
        await new Promise(r => setTimeout(r, delayMs));
    }
    return null;
}

function setAuthMode(mode) {
    authMode = mode === 'signup' ? 'signup' : 'login';
    if (elements.authTabLogin) elements.authTabLogin.classList.toggle('active', authMode === 'login');
    if (elements.authTabSignup) elements.authTabSignup.classList.toggle('active', authMode === 'signup');

    const isSignup = authMode === 'signup';
    if (elements.authModalTitle) elements.authModalTitle.textContent = isSignup ? '회원가입' : '로그인';
    if (elements.authSubmitBtn) elements.authSubmitBtn.textContent = isSignup ? '회원가입' : '로그인';
    if (elements.authNicknameGroup) elements.authNicknameGroup.classList.toggle('hidden', !isSignup);
    if (elements.authPasswordConfirmGroup) elements.authPasswordConfirmGroup.classList.toggle('hidden', !isSignup);
    if (elements.authHelpText) {
        elements.authHelpText.innerHTML = isSignup
            ? '회원가입 후 닉네임은 <b>변경할 수 없습니다</b>.<br>포인트 기능은 <b>관리자 승인</b> 후 사용할 수 있습니다.'
            : '아이디/비밀번호로 로그인합니다.';
    }
    // 비밀번호 자동완성 힌트
    if (elements.authPassword) {
        elements.authPassword.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
    }

    // 비밀번호 확인(회원가입만)
    if (elements.authPasswordConfirm) elements.authPasswordConfirm.value = '';
}

async function initAuth() {
    if (!auth || !db) return;
    setAuthMode('login');

    auth.onAuthStateChanged(async (u) => {
        if (!u) {
            currentUser = null;
            updateUserUI();
            return;
        }

        try {
            const profileRef = db.collection(FIRESTORE_POINTS.userProfiles).doc(u.uid);
            const adminRef = db.collection(FIRESTORE_POINTS.admins).doc(u.uid);
            const rootRef = db.collection(FIRESTORE_POINTS.roots).doc(u.uid);
            let [pSnap, aSnap, rSnap] = await Promise.all([profileRef.get(), adminRef.get(), rootRef.get()]);

            if (!pSnap.exists) {
                // 회원가입 직후: 프로필 생성 트랜잭션이 진행 중일 수 있으므로 잠깐 대기
                if (signupUidInFlight && signupUidInFlight === u.uid) {
                    const waited = await waitForUserProfile(u.uid, 15, 200);
                    if (waited?.exists) {
                        pSnap = waited;
                        aSnap = await adminRef.get();
                        rSnap = await rootRef.get();
                    }
                }
            }

            if (!pSnap.exists) {
                // 프로필이 없으면 정상 상태가 아니므로 로그아웃 처리
                await auth.signOut();
                currentUser = null;
                updateUserUI();
                alert(
                    '회원 프로필이 없습니다. 다시 회원가입해 주세요.\n\n' +
                    '- 보통 회원가입 중 Firestore 권한(Rules) 문제로 프로필 생성이 실패했을 때 발생합니다.\n' +
                    '- Firebase 콘솔의 Authentication에 사용자만 생성되고, Firestore에 user_profiles가 없을 수 있습니다.'
                );
                return;
            }

            const p = pSnap.data() || {};
            const nickname = normalizeNickname(p.nickname);
            const pointsApproved = !!p.pointsApproved;
            const isAdmin = aSnap.exists;
            const isRoot = rSnap.exists;

            currentUser = {
                uid: u.uid,
                name: nickname || '(닉네임 없음)',
                class: '회원',
                level: 0,
                itemLevel: 0,
                dps: 0,
                avatar: null,
                verified: true,
                isAdmin: isAdmin || isRoot,
                isRoot,
                pointsApproved
            };

            updateUserUI();
        } catch (e) {
            console.error(e);
            alert('로그인 상태를 불러오는 중 오류가 발생했습니다.\n\n' + formatFirestoreError(e));
        }
    });
}

function isValidLoginId(id) {
    // Firebase email로 변환할 것이므로 안전한 문자만 허용(원하면 규칙 완화 가능)
    return /^[a-zA-Z0-9._-]{3,20}$/.test(String(id || ''));
}

function loginIdToEmail(loginId) {
    // 이메일 입력 없이 "아이디"만 받기 위한 내부 변환
    // 프로젝트 내 고정 도메인(실제 메일 전송 안 함)
    const id = String(loginId || '').trim().toLowerCase();
    return `${id}@aion2rudra.local`;
}

async function applyAuthPersistence() {
    if (!auth) return;
    const remember = !!elements.authRememberMe?.checked;
    const p = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
    try {
        await auth.setPersistence(p);
    } catch (e) {
        console.error('setPersistence failed:', e);
    }
}

async function submitAuthForm() {
    if (!auth || !db) return alert('Auth/DB 초기화가 필요합니다.');

    const loginId = String(elements.authLoginId?.value || '').trim();
    const pw = String(elements.authPassword?.value || '');
    const nick = String(elements.authNickname?.value || '').trim();

    if (!loginId) return alert('아이디를 입력하세요.');
    if (!isValidLoginId(loginId)) return alert('아이디 형식이 올바르지 않습니다.\n\n- 3~20자\n- 영문/숫자/._- 만 허용');
    if (!pw || pw.length < 6) return alert('비밀번호를 6자 이상 입력하세요.');
    const email = loginIdToEmail(loginId);

    if (authMode === 'login') {
        try {
            await applyAuthPersistence();
            await auth.signInWithEmailAndPassword(email, pw);
            elements.authModal.classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert('로그인 실패:\n\n' + formatFirestoreError(e));
        }
        return;
    }

    // signup
    if (!nick) return alert('닉네임을 입력하세요.');
    if (nick.length < 2) return alert('닉네임은 2글자 이상으로 입력하세요.');
    if (nick.length > 20) return alert('닉네임은 20글자 이하로 입력하세요.');

    const nk = nicknameKey(nick);
    if (!nk) return alert('닉네임 형식을 확인해 주세요.');

    const pw2 = String(elements.authPasswordConfirm?.value || '');
    if (!pw2) return alert('비밀번호 확인을 입력하세요.');
    if (pw !== pw2) return alert('비밀번호와 비밀번호 확인이 일치하지 않습니다.');

    let cred = null;
    try {
        await applyAuthPersistence();
        cred = await auth.createUserWithEmailAndPassword(email, pw);
        const uid = cred.user.uid;
        signupUidInFlight = uid;

        // 토큰 준비(간헐적 permission-denied 완화)
        try { await cred.user.getIdToken(true); } catch {}

        // 닉네임 중복 방지: nickname_index/{nk} 선점
        const nickRef = db.collection(FIRESTORE_POINTS.nicknameIndex).doc(nk);
        const profileRef = db.collection(FIRESTORE_POINTS.userProfiles).doc(uid);

        await db.runTransaction(async (tx) => {
            const [nSnap, pSnap] = await Promise.all([tx.get(nickRef), tx.get(profileRef)]);
            if (nSnap.exists) throw new Error('이미 사용 중인 닉네임입니다.');
            if (pSnap.exists) throw new Error('프로필이 이미 존재합니다.');

            tx.set(nickRef, {
                uid,
                nickname: nick,
                nicknameLower: nk,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            tx.set(profileRef, {
                uid,
                nickname: nick,
                nicknameLower: nk,
                loginId: String(loginId),
                loginIdLower: String(loginId).trim().toLowerCase(),
                pointsApproved: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedAt: null,
                approvedBy: null
            });
        });

        elements.authModal.classList.add('hidden');
        showToast(`<i class="fa-solid fa-user-plus"></i> 회원가입 완료! 포인트는 관리자 승인 후 사용 가능합니다.`);
        signupUidInFlight = null;
    } catch (e) {
        console.error(e);
        // 회원가입은 성공했는데 프로필 생성이 실패하면 계정 삭제 처리(닉네임 중복 등)
        try {
            if (cred?.user) await cred.user.delete();
        } catch {}
        signupUidInFlight = null;
        const code = String(e?.code || '');
        const msg = String(e?.message || formatFirestoreError(e) || '');

        if (code === 'auth/email-already-in-use') {
            alert(
                '회원가입 실패:\n\n' +
                '이미 사용 중인 아이디입니다.\n\n' +
                '- 같은 아이디로 이미 가입되어 있으면 “로그인”을 이용해 주세요.\n' +
                '- 정말 새로 만들고 싶다면 다른 아이디로 가입해야 합니다.'
            );
            return;
        }

        alert(
            '회원가입 실패:\n\n' +
            msg +
            '\n\n(참고: Firestore Rules에서 user_profiles/nickname_index 생성이 막히면 이 오류가 날 수 있습니다.)'
        );
    }
}

async function logout() {
    try {
        if (auth) await auth.signOut();
    } catch (e) {
        console.error(e);
    }
}

function updateUserUI() {
    if (currentUser) {
        elements.loginBtn.classList.add('hidden');
        elements.userInfo.classList.remove('hidden');
        elements.userNickname.textContent = currentUser.name;

        if (elements.adminBadge) {
            elements.adminBadge.classList.toggle('hidden', !currentUser.isAdmin);
        }
        if (elements.rootBadge) {
            elements.rootBadge.classList.toggle('hidden', !currentUser.isRoot);
        }

        if (elements.adminVerifyBtn) {
            // Discord OAuth 기반 어드민 인증 버튼은 사용하지 않음
            elements.adminVerifyBtn.classList.add('hidden');
        }

        if (elements.adminToolsBtn) {
            elements.adminToolsBtn.classList.toggle('hidden', !currentUser.isAdmin);
        }

        if (elements.pointsAdminTabBtn) {
            elements.pointsAdminTabBtn.classList.toggle('hidden', !currentUser.isAdmin);
        }
        if (elements.pointsEventTabBtn) {
            elements.pointsEventTabBtn.classList.toggle('hidden', !currentUser.isRoot);
        }
        if (elements.rootEventCard) {
            elements.rootEventCard.classList.toggle('hidden', !currentUser.isRoot);
        }
        if (elements.rootBulkPointsCard) {
            elements.rootBulkPointsCard.classList.toggle('hidden', !currentUser.isRoot);
        }

        // 관리자인 경우 공지 작성 버튼 표시
        if (currentUser.isAdmin) {
            elements.writeNoticeBtn.classList.remove('hidden');
        } else {
            elements.writeNoticeBtn.classList.add('hidden');
        }

        // 포인트 UI 갱신(헤더) - 승인된 유저/관리자만
        if (currentUser.pointsApproved || currentUser.isAdmin) {
            ensurePointDocsForCurrentUser().then(() => {
                refreshPointsHeader().catch(() => {});
            });
        } else {
            if (elements.pointsBalanceText) elements.pointsBalanceText.textContent = '승인필요';
        }
    } else {
        elements.loginBtn.classList.remove('hidden');
        elements.userInfo.classList.add('hidden');
        elements.writeNoticeBtn.classList.add('hidden');
        if (elements.adminVerifyBtn) elements.adminVerifyBtn.classList.add('hidden');
        if (elements.adminBadge) elements.adminBadge.classList.add('hidden');
        if (elements.rootBadge) elements.rootBadge.classList.add('hidden');
        if (elements.adminToolsBtn) elements.adminToolsBtn.classList.add('hidden');
        if (elements.pointsAdminTabBtn) elements.pointsAdminTabBtn.classList.add('hidden');
        if (elements.pointsEventTabBtn) elements.pointsEventTabBtn.classList.add('hidden');
        if (elements.rootEventCard) elements.rootEventCard.classList.add('hidden');
        if (elements.rootBulkPointsCard) elements.rootBulkPointsCard.classList.add('hidden');
        if (elements.pointsBalanceText) elements.pointsBalanceText.textContent = '0pt';
    }
}

function handlePostSubmit(e) {
    e.preventDefault();
    
    if (!db) {
        alert("데이터베이스 연결 설정이 필요합니다.");
        return;
    }

    const password = elements.postPassword.value;

    if (!isNoticeWritingMode && !isEditMode) {
        if (!password || password.length < 4) {
            alert('비밀번호를 4자리 이상 입력해주세요.');
            return;
        }
    }

    let postType = currentTab;
    if (currentTab === 'completed') postType = 'party';

    let category = '';
    let detail = '';
    let difficulty = '';
    let selectedRoles = [];
    let myDps = 0;
    let expirationMs = 0;
    let link = '';

    if (isNoticeWritingMode) {
        // 공지 작성 데이터 처리
        postType = 'notice';
        expirationMs = 0; // 공지사항은 영구 보존 (자동 삭제 안 함)
        // 공지는 필수 필드 최소화
    } else {
        // 일반 글쓰기 데이터 처리
        selectedRoles = Array.from(elements.postRoleCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        if (selectedRoles.length === 0) {
            alert('최소 1개 이상의 직업을 선택해주세요.');
            return;
        }

        const myDpsInput = document.getElementById('postMyDps').value;
        myDps = myDpsInput ? parseInt(myDpsInput) : 0;

        const expirationHours = parseInt(elements.postExpiration.value);
        if (expirationHours > 0) {
            expirationMs = expirationHours * 60 * 60 * 1000;
        }

        category = elements.postCategory.value;
        detail = elements.postDetail.value;
        difficulty = elements.postDifficulty.value;
        link = document.getElementById('postLink').value;
    }

    if (!isEditMode) {
        currentUser.dps = myDps;
    }
    
    const postData = {
        title: elements.postTitle.value,
        content: elements.postContent.value,
    };

    // 새로 작성할 때만 들어가는 필드
    if (!isEditMode) {
        postData.type = postType;
        postData.category = category;
        postData.categoryDetail = detail;
        postData.difficulty = difficulty;
        postData.roles = selectedRoles;
        postData.link = link;
        postData.password = password;
        postData.createdAt = new Date().toISOString();
        postData.expirationTime = expirationMs;
        postData.status = 'recruiting';
        postData.authorUid = currentUser.uid || null;
        postData.members = [{
            name: currentUser.name,
            class: currentUser.class,
            dps: myDps, 
            itemLevel: currentUser.itemLevel,
            avatar: currentUser.avatar,
            isLeader: true
        }];
        // Firestore 저장용 author 객체는 최소 정보만 포함 (uid 포함)
        postData.author = {
            name: currentUser.name,
            class: currentUser.class,
            level: currentUser.level,
            itemLevel: currentUser.itemLevel,
            dps: myDps,
            avatar: currentUser.avatar,
            verified: !!currentUser.verified,
            uid: currentUser.uid || null
        };
    } else {
        // 수정 모드: 공지사항이면 expirationTime은 항상 0으로 유지
        if (editingPostData && editingPostData.type === 'notice') {
            postData.expirationTime = 0;
        }
    }
    
    if (isEditMode && editingPostData) {
        // 수정 (Update)
        db.collection("posts").doc(editingPostData.id).update(postData)
            .then(() => {
                elements.writeModal.classList.add('hidden');
                elements.postForm.reset();
                showToast(`<i class="fa-solid fa-check"></i> 수정되었습니다.`);
            })
            .catch(err => {
                console.error("수정 실패:", err);
                alert("수정 중 오류가 발생했습니다.");
            });
    } else {
        // 신규 등록 (Create)
        sendDiscordNotification(postData).then(msgId => {
            if (msgId) {
                postData.discordMessageId = msgId;
            }
            
            db.collection("posts").add(postData)
                .then(async (docRef) => {
                    elements.writeModal.classList.add('hidden');
                    elements.postForm.reset();
                    showToast(`<i class="fa-solid fa-check"></i> 등록되었습니다.`);

                    // 포인트 지급: 파티원 구해요/파티 구해요 글 작성 시 +10 (일/주 제한 KST 기준)
                    try {
                        await ensurePointDocsForCurrentUser();
                        await awardPostCreatePoints(postData.type, docRef?.id);
                    } catch (e) {
                        console.error(e);
                    }
                })
                .catch((error) => {
                    console.error("Error adding document: ", error);
                    alert("등록 중 오류가 발생했습니다.");
                });
        });
    }
}

function sendDiscordNotification(post) {
    if (!DISCORD_POST_WEBHOOK_URL || DISCORD_POST_WEBHOOK_URL.includes('여기에')) return Promise.resolve(null);

    let typeIcon = '📢';
    let typeText = '파티원 모집';
    
    if (post.type === 'member') {
        typeIcon = '⚔️';
        typeText = '파티 구직';
    } else if (post.type === 'notice') {
        typeIcon = '🔔';
        typeText = '공지사항';
    }

    let categoryText = '기타';
    if (post.category) {
        categoryText = post.category;
        if (post.categoryDetail) categoryText += ` - ${post.categoryDetail}`;
        if (post.difficulty) categoryText += ` (${post.difficulty})`;
    }

    let authorText = `${post.author.name} (${post.author.class})`;
    if (post.type === 'member' && post.author.dps > 0) {
        authorText += ` / DPS ${post.author.dps.toLocaleString()}`;
    }

    let description = `\n**${post.title}**\n\n`;
    description += `${post.content}\n\n`;
    
    description += `👤 **작성자:** ${authorText}\n`;
    if (post.type !== 'notice') {
        description += `🎮 **콘텐츠:** ${categoryText}\n`;
        description += `🎯 **대상:** ${post.roles.join(', ')}`;
    }

    if (post.link) {
        description += `\n\n🔗 [오픈채팅/디코 바로가기](${post.link})`;
    }

    const payload = {
        content: null,
        embeds: [
            {
                title: `${typeIcon} ${typeText}`,
                url: window.location.href, 
                description: description,
                color: post.type === 'party' ? 7506394 : (post.type === 'member' ? 5763719 : 15105570),
                footer: {
                    text: "전투&명가 파티 매칭"
                },
                timestamp: new Date().toISOString()
            }
        ]
    };

    return fetch(`${DISCORD_POST_WEBHOOK_URL}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => data.id)
    .catch(err => {
        console.error('Discord Webhook Error:', err);
        return null;
    });
}

function deleteDiscordMessage(post) {
    // 게시글 등록 알림을 보낸 "등록용 웹훅"으로만 메시지 삭제 가능
    if (!post.discordMessageId || !DISCORD_POST_WEBHOOK_URL || DISCORD_POST_WEBHOOK_URL.includes('여기에')) return;

    fetch(`${DISCORD_POST_WEBHOOK_URL}/messages/${post.discordMessageId}`, {
        method: 'DELETE'
    }).catch(err => {
        console.error('Discord Delete Error:', err);
        logAuditEvent("discord_delete_error", {
            postId: post?.id || null,
            discordMessageId: post?.discordMessageId || null,
            error: String(err)
        });
        sendLogToDiscord([
            '⚠️ **디스코드 등록 알림 메시지 삭제 실패**',
            '',
            `- **postId**: ${post?.id || ''}`,
            `- **discordMessageId**: ${post?.discordMessageId || ''}`,
            `- **error**: ${String(err)}`
        ]);
    });
}

function checkExpiredPosts() {
    if (!db) return;
    const now = Date.now();
    let expiredCount = 0;

    posts.forEach(post => {
        // 공지사항은 영구 보존 (관리자가 직접 삭제할 때만 삭제됨)
        if (post.type === 'notice') return;

        // 이미 삭제 처리된 글은 스킵
        if (post.deletedAt) return;
        
        // 매칭 완료된 게시글은 자동 삭제 안 함 (관리자가 직접 삭제할 때만 삭제됨)
        if (post.status === 'full') return;
        
        // expirationTime이 0이면 자동 삭제 안 함 (유지)
        if (post.expirationTime === 0) return;

        const expirationMs = post.expirationTime || CONSTANTS.DEFAULT_EXPIRATION_MS;
        const postTime = new Date(post.createdAt).getTime();

        if (now - postTime > expirationMs) {
            // 하드 삭제 대신 사유 기록(soft delete)
            softDeletePostById(post.id, 'expired', '유효기간 만료로 자동 삭제', 'auto_expire')
                .then(() => {
                    deleteDiscordMessage(post);
                    db.collection("posts").doc(post.id).update({ discordMessageId: null }).catch(() => {});
                    notifyDeletionToDiscord({ ...post, id: post.id }, 'expired', '유효기간 만료로 자동 삭제');
                })
                .catch(err => {
                    console.error("만료 삭제 오류:", err);
                    logAuditEvent("expire_soft_delete_error", {
                        postId: post?.id || null,
                        error: String(err)
                    });
                });
            
            expiredCount++;
        }
    });

    if (expiredCount > 0) {
        showToast(`<i class="fa-solid fa-clock-rotate-left"></i> 유효기간이 지난 게시글 ${expiredCount}개가 정리되었습니다.`);
    }
}

function showToast(message, duration = 4000) {
    const container = elements.toastContainer;
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.3s forwards';
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, duration);
}

function getDiscordRedirectUri() {
    return `${location.origin}${location.pathname}`;
}

function base64UrlEncodeArrayBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(str) {
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncodeArrayBuffer(digest);
}

function randomString(len = 64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
    return out;
}

async function beginDiscordAdminVerify() {
    if (!currentUser) {
        showToast('닉네임 로그인 후 어드민 인증을 진행해 주세요.');
        return;
    }

    if (location.protocol === 'file:') {
        alert('로컬 파일(file://)로 열면 Discord redirect_uri가 file://로 잡혀 인증이 실패합니다.\n\n- GitHub Pages 주소로 접속해서 시도하거나\n- 로컬 서버(http://localhost)로 실행해 주세요.');
        return;
    }

    if (!DISCORD_ADMIN.clientId || DISCORD_ADMIN.clientId.includes('PUT_DISCORD_OAUTH_CLIENT_ID_HERE')) {
        alert('DISCORD_ADMIN.clientId 설정이 필요합니다. Discord 개발자 포털에서 OAuth2 Client ID를 넣어주세요.');
        return;
    }

    const state = randomString(32);
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);

    sessionStorage.setItem('discord_admin_state', state);
    sessionStorage.setItem('discord_admin_verifier', verifier);

    const params = new URLSearchParams({
        client_id: DISCORD_ADMIN.clientId,
        redirect_uri: getDiscordRedirectUri(),
        response_type: 'code',
        scope: DISCORD_ADMIN.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function handleDiscordAdminCallback() {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (!code && !error) return;

    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    history.replaceState({}, document.title, url.toString());

    if (error) {
        showToast('디스코드 인증이 취소되었거나 실패했습니다.');
        return;
    }

    if (!currentUser) {
        showToast('닉네임 로그인 후 다시 어드민 인증을 진행해 주세요.');
        return;
    }

    const savedState = sessionStorage.getItem('discord_admin_state');
    const verifier = sessionStorage.getItem('discord_admin_verifier');

    sessionStorage.removeItem('discord_admin_state');
    sessionStorage.removeItem('discord_admin_verifier');

    if (!savedState || !verifier || !state || savedState !== state) {
        showToast('디스코드 인증 상태값이 일치하지 않습니다. 다시 시도해 주세요.');
        return;
    }

    try {
        const result = await verifyDiscordAdminViaWorker({
            code,
            codeVerifier: verifier,
            redirectUri: getDiscordRedirectUri()
        });

        if (!result?.ok) {
            showToast(result?.message || '어드민 권한이 없습니다.');
            return;
        }

        currentUser.isAdmin = true;
        currentUser.adminAuth = {
            provider: 'discord',
            discordUserId: result.discordUser?.id || '',
            discordUsername: result.discordUser?.username || '',
            verifiedAt: new Date().toISOString(),
            guildId: DISCORD_ADMIN.guildId,
            roleId: DISCORD_ADMIN.roleId
        };

        // 어드민 인증은 "권한"만 증명합니다. 캐릭터(직업/레벨/아바타) 미인증 상태면 한번 더 조회해서 갱신합니다.
        await refreshCurrentUserCharacter();

        localStorage.setItem('rudra_user', JSON.stringify(currentUser));
        updateUserUI();
        showToast('어드민 인증 완료!');
    } catch (e) {
        console.error(e);
        showToast('디스코드 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
}

async function refreshCurrentUserCharacter() {
    try {
        if (!currentUser?.name) return;
        const data = await fetchCharacterData(currentUser.name);
        if (!data) return;

        // DPS는 유저 입력값을 우선하므로 그대로 두고, 캐릭터 프로필만 갱신
        const keepDps = currentUser.dps || 0;
        currentUser = {
            ...currentUser,
            name: data.name,
            class: data.class,
            level: data.level,
            itemLevel: data.item_level,
            avatar: data.profile_img,
            verified: true,
            dps: keepDps
        };
    } catch (e) {
        console.error('캐릭터 정보 갱신 실패:', e);
    }
}

async function verifyDiscordAdminViaWorker(payload) {
    if (!DISCORD_ADMIN.verifyEndpoint || DISCORD_ADMIN.verifyEndpoint.includes('PUT_CLOUDFLARE_WORKER_VERIFY_URL_HERE')) {
        throw new Error('DISCORD_ADMIN.verifyEndpoint 설정이 필요합니다.');
    }

    const res = await fetch(DISCORD_ADMIN.verifyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code: payload.code,
            codeVerifier: payload.codeVerifier,
            redirectUri: payload.redirectUri,
            guildId: DISCORD_ADMIN.guildId,
            roleId: DISCORD_ADMIN.roleId
        })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `verify failed: ${res.status}`);
    return data;
}

// 좌측 배너용 공지사항 렌더링
function renderNotices(showAll = false) {
    const noticeList = elements.noticeList;
    if (!noticeList) return;

    const notices = posts
        .filter(p => p.type === 'notice' && !p.deletedAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    if (notices.length === 0) {
        noticeList.innerHTML = '<div class="notice-empty">등록된 공지사항이 없습니다.</div>';
        elements.loadMoreNoticeBtn.classList.add('hidden');
        return;
    }

    // showAll이면 전체 보여줌
    const displayNotices = showAll ? notices : notices.slice(0, CONSTANTS.NOTICE_LIMIT);
    
    if (!showAll && notices.length > CONSTANTS.NOTICE_LIMIT) {
        elements.loadMoreNoticeBtn.classList.remove('hidden');
    } else {
        elements.loadMoreNoticeBtn.classList.add('hidden');
    }

    noticeList.innerHTML = '';
    displayNotices.forEach(notice => {
        const timeString = new Date(notice.createdAt).toLocaleDateString();
        const card = document.createElement('div');
        card.className = 'notice-card';
        card.innerHTML = `
            <div class="notice-header">
                <span class="notice-badge">NOTICE</span>
                <span class="notice-date">${timeString}</span>
            </div>
            <h4 class="notice-title">${notice.title}</h4>
            <p class="notice-content">${notice.content}</p>
            ${currentUser && currentUser.isAdmin ? `
                <div style="margin-top:8px; text-align:right;">
                    <button id="editNoticeBtn-${notice.id}" class="btn-outline btn-small" style="font-size:0.7rem; padding:4px 8px;">수정</button>
                    <button id="deleteNoticeBtn-${notice.id}" class="btn-danger btn-small" style="font-size:0.7rem; padding:4px 8px; margin-left: 4px;">삭제</button>
                </div>
            ` : ''}
        `;
        
        card.style.cursor = 'pointer';
        card.onclick = () => showPostDetail(notice.id);
        noticeList.appendChild(card);

        // 수정/삭제 버튼 이벤트 바인딩 (버블링 방지)
        if (currentUser && currentUser.isAdmin) {
            const editBtn = document.getElementById(`editNoticeBtn-${notice.id}`);
            const deleteBtn = document.getElementById(`deleteNoticeBtn-${notice.id}`);
            
            if(editBtn) {
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    openWriteModal(true, notice); 
                };
            }
            if(deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteNotice(notice);
                };
            }
        }
    });
}

function deleteNotice(notice) {
    if(confirm('이 공지사항을 삭제하시겠습니까?')) {
        // 공지사항도 사유를 남기고 숨김 처리(soft delete)
        softDeletePostById(notice.id, 'notice_deleted', '관리자에 의해 공지사항 삭제', 'notice_delete_ui')
            .then(() => {
                showToast("공지사항이 삭제되었습니다.");
                notifyDeletionToDiscord({ ...notice, id: notice.id }, 'notice_deleted', '관리자에 의해 공지사항 삭제');
            })
            .catch(err => {
                console.error("공지 삭제 실패:", err);
                alert("삭제 중 오류가 발생했습니다.");
            });
    }
}

function renderPosts() {
    elements.postList.innerHTML = '';
    
    posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 전체 탭에서는 글쓰기 버튼 숨김
    if (elements.writeBtn) {
        elements.writeBtn.classList.toggle('hidden', currentTab === 'all');
    }

    let filteredPosts = posts.filter(post => {
        if (post.type === 'notice') return false; 
        if (post.deletedAt) return false;

        if (currentTab === 'completed') {
            return post.status === 'full';
        } else if (currentTab === 'all') {
            return post.status !== 'full' && (post.type === 'party' || post.type === 'member');
        } else {
            return post.status !== 'full' && post.type === currentTab;
        }
    });
    
    const filterRole = elements.roleFilter.value;
    if (filterRole !== 'all') {
        filteredPosts = filteredPosts.filter(post => {
            const postRoles = Array.isArray(post.roles) ? post.roles : [post.role];
            if (postRoles.includes('무관')) return true;
            if (filterRole === 'tank' && (postRoles.includes('수호성') || postRoles.includes('검성'))) return true;
            if (filterRole === 'dps' && (postRoles.includes('살성') || postRoles.includes('궁성') || postRoles.includes('마도성') || postRoles.includes('정령성'))) return true;
            if (filterRole === 'healer' && (postRoles.includes('치유성') || postRoles.includes('호법성'))) return true;
            return false;
        });
    }

    const filterCategory = elements.categoryFilter ? elements.categoryFilter.value : 'all';
    if (filterCategory !== 'all') {
        filteredPosts = filteredPosts.filter(post => post.category === filterCategory);
    }

    if (filteredPosts.length === 0) {
        elements.postList.innerHTML = '<div class="no-posts" style="text-align:center; padding:40px; color:#aaa; grid-column:1/-1;">게시글이 없습니다.</div>';
        return;
    }

    filteredPosts.forEach(post => {
        const timeString = new Date(post.createdAt).toLocaleDateString() + ' ' + 
                          new Date(post.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const roles = Array.isArray(post.roles) ? post.roles : [post.role];
        const rolesHtml = roles.map(r => `<span class="role-badge">${r}</span>`).join(' ');
        
        const statusHtml = post.status === 'full' 
            ? '<span class="party-status status-full">모집완료</span>' 
            : '<span class="party-status status-recruiting">모집중</span>';

        const dpsDisplay = (post.author.dps > 0) ? `<span class="dps-tag">DPS ${post.author.dps.toLocaleString()}</span>` : '';
        const itemLevelDisplay = (post.author.itemLevel || 0).toLocaleString();
        
        let categoryHtml = '';
        if (post.category) {
            categoryHtml = `<span class="category-badge">[${post.category}] ${post.categoryDetail || ''} ${post.difficulty ? '(' + post.difficulty + ')' : ''}</span>`;
        }

        const card = document.createElement('div');
        card.className = `post-card type-${post.type}`;
        
        if (post.status === 'full') {
            card.className += ' status-full';
            
            let membersHtml = '';
            if (post.members && post.members.length > 0) {
                post.members.slice(0, 5).forEach(m => {
                    const avatarSrc = safeAvatarUrl(m.avatar, m.name);
                    membersHtml += `
                        <img src="${avatarSrc}" 
                             class="full-member-avatar" 
                             title="${m.name}" 
                             onclick="event.stopPropagation(); openAtulPage('${m.name}')"
                             onerror="this.src=defaultAvatarDataUri('U')">
                    `;
                });
                if (post.members.length > 5) {
                    membersHtml += `<div class="full-member-avatar" style="background:#333; color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">+${post.members.length - 5}</div>`;
                }
            } else {
                membersHtml = '<span style="color:#666; font-size:0.9rem;">멤버 정보 없음</span>';
            }

            card.innerHTML = `
                <div class="full-overlay">
                    <div class="full-text">모집 완료</div>
                    <div class="full-members">${membersHtml}</div>
                    <div style="color:#aaa; font-size:0.9rem; margin-top:10px;">${post.title}</div>
                    <div style="font-size:0.8rem; color:#666; margin-top:5px;">클릭하여 상세 정보 보기</div>
                </div>
                <div style="padding:10px; text-align:center;">
                    ${canManagePost(post) ? `<button onclick="event.stopPropagation(); checkPasswordAndManage('${post.id}')" class="btn-outline full-width">관리</button>` : ''}
                </div>
            `;
            
        } else {
            const typeBadgeHtml = (currentTab === 'all')
                ? (post.type === 'party'
                    ? `<span class="type-badge party"><i class="fa-solid fa-users"></i> 파티원 구해요</span>`
                    : `<span class="type-badge member"><i class="fa-solid fa-user-plus"></i> 파티 구해요</span>`)
                : '';

            card.innerHTML = `
                <div class="post-header">
                    <div class="badge-container">
                        ${typeBadgeHtml}
                        ${statusHtml}
                        ${categoryHtml}
                        ${rolesHtml}
                    </div>
                    <span class="post-time">${timeString}</span>
                </div>
                <h3 class="post-title">${post.title}</h3>
                <p class="post-content">${post.content}</p>
                
                <div class="post-footer">
                    <div class="author-info">
                        <img src="${safeAvatarUrl(post.author.avatar, post.author.name)}" class="author-avatar" onerror="this.src=defaultAvatarDataUri('U')">
                        <div class="author-detail">
                            <div class="author-name">${post.author.name}</div>
                            <div class="author-meta">
                                ${post.author.class} 
                                ${dpsDisplay}
                                <span style="margin-left:4px;">(Lv.${itemLevelDisplay})</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    ${post.link ? `<button onclick="event.stopPropagation(); window.open('${post.link}')" class="btn-primary full-width" style="padding: 8px;">참여</button>` : ''}
                    ${canManagePost(post) ? `<button onclick="event.stopPropagation(); checkPasswordAndManage('${post.id}')" class="btn-outline full-width" style="padding: 8px;">관리</button>` : ''}
                </div>
            `;
        }
        
        card.onclick = () => showPostDetail(post.id);
        elements.postList.appendChild(card);
    });
}

function showPostDetail(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    elements.detailModal.classList.remove('hidden');
    
    if (post.type === 'notice') {
        elements.detailPartySection.classList.add('hidden');
        elements.detailCategoryBadge.innerHTML = '<span class="notice-badge" style="font-size:0.9rem;">NOTICE</span>';
    } else {
        elements.detailPartySection.classList.remove('hidden');
        
        if (post.category) {
            elements.detailCategoryBadge.innerHTML = `<span class="category-badge" style="font-size:0.9rem;">[${post.category}] ${post.categoryDetail || ''} ${post.difficulty ? '(' + post.difficulty + ')' : ''}</span>`;
        } else {
            elements.detailCategoryBadge.innerHTML = '';
        }
        
        // 파티원 목록 렌더링
        renderDetailPartyList(post);
    }

    const roles = Array.isArray(post.roles) ? post.roles : [post.role];
    elements.detailRoles.innerHTML = post.type === 'notice' ? '' : roles.map(r => `<span class="role-badge">${r}</span>`).join(' ');
    
    elements.detailTitle.textContent = post.title;
    elements.detailAuthor.textContent = post.author.name;
    elements.detailTime.textContent = new Date(post.createdAt).toLocaleString();
    elements.detailContent.textContent = post.content;
    
    if (post.link) {
        elements.detailLink.href = post.link;
        elements.detailLink.classList.remove('hidden');
    } else {
        elements.detailLink.classList.add('hidden');
    }
}

function renderDetailPartyList(post) {
    const container = elements.detailPartyListContainer;
    if (!container) return;

    // 작성자 정보 업데이트 (UI 상단)
    const authorAvatar = document.getElementById('detailAuthorAvatar');
    const authorName = document.getElementById('detailAuthorName');
    const authorClass = document.getElementById('detailAuthorClass');
    const authorItemLevel = document.getElementById('detailAuthorItemLevel');

    if (post.author) {
        authorAvatar.src = safeAvatarUrl(post.author.avatar, post.author.name);
        authorAvatar.onerror = () => { authorAvatar.src = defaultAvatarDataUri('U'); };
        authorName.textContent = post.author.name;
        authorClass.textContent = post.author.class;
        authorItemLevel.textContent = (post.author.itemLevel || 0).toLocaleString();
        
        // 작성자 클릭 시 아툴 이동
        const authorProfile = document.getElementById('detailAuthorProfile');
        authorProfile.onclick = () => openAtulPage(post.author.name);
    }

    // 파티원 목록
    let membersHtml = `<label style="display:block; margin-bottom:10px; color:#a1a1aa;">파티원 목록 (${post.members ? post.members.length : 0}/8)</label>`;
    membersHtml += `<div class="party-grid">`;
    
    if (post.members && post.members.length > 0) {
        post.members.forEach(m => {
            const avatarSrc = safeAvatarUrl(m.avatar, m.name);
            const dpsVal = m.dps > 0 ? `DPS ${m.dps.toLocaleString()}` : '';
            const itemLevelVal = m.itemLevel || 0;

            membersHtml += `
                <div class="party-member-card" onclick="openAtulPage('${m.name}')">
                    <img src="${avatarSrc}" class="pm-avatar" onerror="this.src=defaultAvatarDataUri('U')">
                    <div class="pm-name">${m.name}</div>
                    <div class="pm-class">${m.class}</div>
                    <div class="pm-dps" style="color:#a78bfa;">${dpsVal}</div>
                    <div style="font-size:0.8rem; color:#666;">(Lv.${itemLevelVal.toLocaleString()})</div>
                </div>
            `;
        });
    } else {
        membersHtml += `<div style="color:#666;">파티원이 없습니다.</div>`;
    }
    membersHtml += `</div>`;
    
    container.innerHTML = membersHtml;
}

function openAtulPage(nickname) {
    if (nickname) {
        const url = `https://www.aion2tool.com/char/serverid=2002/${encodeURIComponent(nickname)}`;
        window.open(url, '_blank');
    }
}

window.checkPasswordAndManage = function(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    if (!currentUser) {
        alert('관리 기능은 로그인(닉네임 설정) 후 사용 가능합니다.');
        elements.authModal.classList.remove('hidden');
        return;
    }

    if (currentUser.isAdmin) {
        openManageModal(post);
        return;
    }

    // 작성자 닉네임이 아니면 비밀번호를 알아도 관리 불가 (사칭/무단삭제 방지)
    if (!canManagePost(post)) {
        alert('작성자 본인(동일 닉네임)만 관리할 수 있습니다.');
        return;
    }

    const inputPwd = prompt('게시글 비밀번호를 입력하세요:');
    if (inputPwd === post.password) {
        openManageModal(post);
    } else {
        alert('비밀번호가 일치하지 않습니다.');
    }
}

function openManageModal(post) {
    currentEditingPostId = post.id;
    elements.manageModal.classList.remove('hidden');
    elements.managePostInfo.innerHTML = `<h4>${post.title}</h4>`;
    renderPartyMembers();
}

function updatePostStatus(status) {
    if (!currentEditingPostId) return;
    const post = posts.find(p => p.id === currentEditingPostId);
    if (post) {
        if (!canManagePost(post)) {
            alert('권한이 없습니다.');
            return;
        }
        db.collection("posts").doc(post.id).update({
            status: status
        }).then(() => {
             if (status === 'full' && post.status !== 'full') {
                deleteDiscordMessage(post);
                db.collection("posts").doc(post.id).update({ discordMessageId: null });
            }
            alert('상태가 변경되었습니다.');
            elements.manageModal.classList.add('hidden');
        });
    }
}

async function addPartyMember() {
    if (!currentEditingPostId) return;
    const post = posts.find(p => p.id === currentEditingPostId);
    if (!post || !canManagePost(post)) {
        alert('권한이 없습니다.');
        return;
    }
    const name = elements.newMemberName.value.trim();
    const cls = elements.newMemberClass.value;
    
    if (!name) return alert('닉네임을 입력하세요.');

    elements.addMemberBtn.textContent = '검색중...';
    const charData = await fetchCharacterData(name);
    elements.addMemberBtn.textContent = '추가';
    
    if (post) {
        const newMember = {
            name: name,
            class: cls,
            isLeader: false,
            dps: 0, 
            itemLevel: charData ? charData.item_level : 0,
            avatar: charData ? charData.profile_img : null 
        };

        const updatedMembers = post.members ? [...post.members, newMember] : [newMember];
        
        db.collection("posts").doc(post.id).update({
            members: updatedMembers
        }).then(() => {
            elements.newMemberName.value = '';
        });
    }
}

window.deletePartyMember = function(index) {
    if (!currentEditingPostId) return;
    const post = posts.find(p => p.id === currentEditingPostId);
    if (post && post.members) {
        if (!canManagePost(post)) {
            alert('권한이 없습니다.');
            return;
        }
        if(confirm('삭제하시겠습니까?')) {
            const updatedMembers = [...post.members];
            updatedMembers.splice(index, 1);
            
            db.collection("posts").doc(post.id).update({
                members: updatedMembers
            });
        }
    }
}

function renderPartyMembers() {
    if (!currentEditingPostId) return;
    const post = posts.find(p => p.id === currentEditingPostId);
    elements.partyMemberList.innerHTML = '';
    
    if (!post || !post.members) return;

    post.members.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'member-item';
        item.innerHTML = `
            <div class="member-info">
                ${member.isLeader ? '<i class="fa-solid fa-crown" style="color:#ffd700;"></i>' : ''}
                <b>${member.name}</b> (${member.class})
            </div>
            <button onclick="deletePartyMember(${index})" style="border:none; background:none; color:red; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
        `;
        elements.partyMemberList.appendChild(item);
    });
}

function deletePost() {
    if (!currentEditingPostId) return;
    if (confirm('삭제하시겠습니까?')) {
        const post = posts.find(p => p.id === currentEditingPostId);
        if (post && !canManagePost(post)) {
            alert('권한이 없습니다.');
            return;
        }
        
        // 하드 삭제 대신 사유 기록(soft delete)
        softDeletePostById(currentEditingPostId, 'manual_delete', '작성자/관리자 수동 삭제', 'post_delete_ui')
            .then(() => {
                if (post) deleteDiscordMessage(post);
                if (post) db.collection("posts").doc(post.id).update({ discordMessageId: null }).catch(() => {});
                elements.manageModal.classList.add('hidden');
                showToast("게시글이 삭제되었습니다.");
                notifyDeletionToDiscord({ ...(post || {}), id: currentEditingPostId }, 'manual_delete', '작성자/관리자 수동 삭제');
            })
            .catch(err => {
                console.error("삭제 실패", err);
                alert("삭제 중 오류가 발생했습니다.");
            });
    }
}

async function fetchCharacterData(nickname) {
    try {
        const searchUrl = `${PROXY_URL}https://api.aon2.info/api/v1/aion2/rankings/item-level/search?characterName=${encodeURIComponent(nickname)}&raceId=2&serverId=2002`;
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) {
            const txt = await searchRes.text().catch(() => '');
            console.warn('character search failed:', searchRes.status, txt.slice(0, 200));
            throw new Error(`search http ${searchRes.status}`);
        }
        let searchJson;
        try {
            searchJson = await searchRes.json();
        } catch {
            const txt = await searchRes.text().catch(() => '');
            // 혹시 문자열(JSON stringified)로 오는 케이스 대비
            try { searchJson = JSON.parse(txt); } catch { searchJson = null; }
        }
        
        const character =
            searchJson?.data?.character ||
            searchJson?.character ||
            (Array.isArray(searchJson?.data?.characters) ? searchJson.data.characters[0] : null) ||
            null;
        if (!character) return null;

        const charId = character.characterId || character.id || character.character_id;
        if (!charId) return null;
        const detailUrl = `${PROXY_URL}https://api.aon2.info/api/v1/aion2/characters/detail?serverId=2002&characterId=${encodeURIComponent(charId)}`;
        const detailRes = await fetch(detailUrl);
        if (!detailRes.ok) {
            const txt = await detailRes.text().catch(() => '');
            console.warn('character detail failed:', detailRes.status, txt.slice(0, 200));
            throw new Error(`detail http ${detailRes.status}`);
        }
        const detailJson = await detailRes.json().catch(() => null);

        if (!detailJson.data) return null;
        
        const data = detailJson.data;

        // DPS(전투력) 우선순위 로직 수정
        let dps = 0;
        if (data.combatScore) dps = data.combatScore;
        else if (data.combatPoint) dps = data.combatPoint;
        else if (data.stats && data.stats.combatPower) dps = data.stats.combatPower;
        else dps = data.totalItemLevel;

        // 계산기용 스탯: AON의 scoreInfo.stats.stats가 실제 전투력 계산용 요약 스탯을 제공
        const calcStatsBase = normalizeScoreInfoStats(data);
        const weaponMinMax = extractWeaponMinMaxFromItemDetails(data);
        const calcStats = calcStatsBase ? {
            ...calcStatsBase,
            ...weaponMinMax,
            // scoreInfo에는 스킬 딜증이 별도 항목으로 없을 수 있어 기본 0 (사용자 입력 필요)
            skillDamage: 0
        } : null;

        return {
            name: data.characterName,
            level: data.level,
            class: data.classInfo ? data.classInfo.className : '알 수 없음',
            item_level: data.totalItemLevel, 
            dps: dps,
            profile_img: data.profileImageUrl,
            server: '지켈',
            charId: charId,
            aonScore: data.aonScore || 0,
            combatScore: data.combatScore || 0,
            calcStats: calcStats
        };
    } catch (error) {
        console.error(error);
        return null;
    }
}
