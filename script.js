const API_BASE_URL = 'https://api.aon2.info/api/v1/aion2';
const PROXY_URL = '';
const APP_VERSION = '2026-01-09.1';

// 게시글 등록 알림(모집/구직)
const POST_WEBHOOK_SECRET = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1NjU1OTI1NzA3ODk4ODgyMS81VDczT1VxWUxnZzFEYUs1Skk3M0R2OFpfYzdNVlBiajZXUkE0c3VyQ0paQ1ZXSW96T1Voel9rWDBhVEdiSkx3WkJLRg==';
// 삭제 사유/오류 로그(감사용)
const LOG_WEBHOOK_SECRET = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1ODY4MjU4OTQ1MDg2NjY4OS9QazduSFUtRmlubTJGQmo1cTk3UF85YU5hNzhZU3ZTOGRaY2M4OGdQaVFTZ285RXhqOXU4aDQ1UlNpQ291QTJiUUVVRQ==';

const DISCORD_POST_WEBHOOK_URL = atob(POST_WEBHOOK_SECRET);
const DISCORD_LOG_WEBHOOK_URL = atob(LOG_WEBHOOK_SECRET);

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

const firebaseConfig = {
    apiKey: "AIzaSyCDqmgOsbXZu9FNkGCULDuEnu9ehSR2gbY",
    authDomain: "aion2rudra.firebaseapp.com",
    projectId: "aion2rudra",
    storageBucket: "aion2rudra.firebasestorage.app",
    messagingSenderId: "786371182560",
    appId: "1:786371182560:web:29dfdd720a9b369d2e7585"
};

let db;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
} catch (e) {
    console.error("Firebase 초기화 실패.", e);
}

let currentTab = 'party';
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
    // 일반 유저는 "내 닉네임 == 작성자 닉네임" 일 때만 관리 가능 (추가로 비밀번호 확인)
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
    loginBtn: document.getElementById('loginBtn'),
    userInfo: document.getElementById('userInfo'),
    userNickname: document.getElementById('userNickname'),
    logoutBtn: document.getElementById('logoutBtn'),
    adminVerifyBtn: document.getElementById('adminVerifyBtn'),
    adminBadge: document.getElementById('adminBadge'),
    authNickname: document.getElementById('authNickname'),
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
    calcRecommendOutput: document.getElementById('calcRecommendOutput')
};

document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    handleDiscordAdminCallback();
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
        elements.authModal.classList.remove('hidden');
    });
    
    elements.authCloseBtn.addEventListener('click', () => {
        elements.authModal.classList.add('hidden');
    });

    elements.authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        login(elements.authNickname.value);
        elements.authModal.classList.add('hidden');
    });

    elements.logoutBtn.addEventListener('click', logout);

    if (elements.adminVerifyBtn) {
        elements.adminVerifyBtn.addEventListener('click', beginDiscordAdminVerify);
    }

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
                    <img src="${charData.profile_img || 'https://via.placeholder.com/100'}" class="search-avatar">
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
        alert('닉네임을 먼저 설정해주세요 (로그인).');
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

function loadUser() {
    const savedUser = localStorage.getItem('rudra_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        if (currentUser) {
            if (typeof currentUser.isAdmin !== 'boolean') currentUser.isAdmin = false;

            // 기존 닉네임 기반 어드민/구버전 데이터 차단: Discord 인증으로만 관리자 유지
            if (currentUser.isAdmin && currentUser.adminAuth?.provider !== 'discord') {
                currentUser.isAdmin = false;
                delete currentUser.adminAuth;
                localStorage.setItem('rudra_user', JSON.stringify(currentUser));
            }
        }
        updateUserUI();
    }
}

function login(nickname) {
    fetchCharacterData(nickname).then(data => {
        if (data) {
            currentUser = {
                name: data.name,
                class: data.class,
                level: data.level,
                itemLevel: data.item_level,
                dps: data.dps,
                avatar: data.profile_img,
                verified: true,
                isAdmin: false
            };
        } else {
            currentUser = {
                name: nickname,
                class: '미인증',
                level: 0,
                itemLevel: 0,
                dps: 0,
                avatar: null,
                verified: false,
                isAdmin: false
            };
        }
        
        const savedUser = JSON.parse(localStorage.getItem('rudra_user') || '{}');
        if (savedUser && savedUser.name === currentUser.name && savedUser.dps) {
            currentUser.dps = savedUser.dps;
        }

        localStorage.setItem('rudra_user', JSON.stringify(currentUser));
        updateUserUI();
    });
}

function logout() {
    currentUser = null;
    localStorage.removeItem('rudra_user');
    updateUserUI();
    location.reload();
}

function updateUserUI() {
    if (currentUser) {
        elements.loginBtn.classList.add('hidden');
        elements.userInfo.classList.remove('hidden');
        elements.userNickname.textContent = currentUser.name;

        if (elements.adminBadge) {
            elements.adminBadge.classList.toggle('hidden', !currentUser.isAdmin);
        }

        if (elements.adminVerifyBtn) {
            elements.adminVerifyBtn.classList.toggle('hidden', !!currentUser.isAdmin);
        }

        // 관리자인 경우 공지 작성 버튼 표시
        if (currentUser.isAdmin) {
            elements.writeNoticeBtn.classList.remove('hidden');
        } else {
            elements.writeNoticeBtn.classList.add('hidden');
        }
    } else {
        elements.loginBtn.classList.remove('hidden');
        elements.userInfo.classList.add('hidden');
        elements.writeNoticeBtn.classList.add('hidden');
        if (elements.adminVerifyBtn) elements.adminVerifyBtn.classList.add('hidden');
        if (elements.adminBadge) elements.adminBadge.classList.add('hidden');
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
        localStorage.setItem('rudra_user', JSON.stringify(currentUser));
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
        postData.members = [{
            name: currentUser.name,
            class: currentUser.class,
            dps: myDps, 
            itemLevel: currentUser.itemLevel,
            avatar: currentUser.avatar,
            isLeader: true
        }];
        postData.author = { ...currentUser, dps: myDps };
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
                .then(() => {
                    elements.writeModal.classList.add('hidden');
                    elements.postForm.reset();
                    showToast(`<i class="fa-solid fa-check"></i> 등록되었습니다.`);
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

        localStorage.setItem('rudra_user', JSON.stringify(currentUser));
        updateUserUI();
        showToast('어드민 인증 완료!');
    } catch (e) {
        console.error(e);
        showToast('디스코드 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
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
                    const avatarSrc = m.avatar ? m.avatar : 'https://via.placeholder.com/40?text=' + encodeURIComponent(m.name.substring(0,1));
                    membersHtml += `
                        <img src="${avatarSrc}" 
                             class="full-member-avatar" 
                             title="${m.name}" 
                             onclick="event.stopPropagation(); openAtulPage('${m.name}')"
                             onerror="this.src='https://via.placeholder.com/40?text=User'">
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
                        <img src="${post.author.avatar || 'https://via.placeholder.com/32'}" class="author-avatar" onerror="this.src='https://via.placeholder.com/32'">
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
        authorAvatar.src = post.author.avatar || 'https://via.placeholder.com/64';
        authorAvatar.onerror = () => { authorAvatar.src = 'https://via.placeholder.com/64'; };
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
            const avatarSrc = m.avatar ? m.avatar : 'https://via.placeholder.com/60?text=' + encodeURIComponent(m.name.substring(0,1));
            const dpsVal = m.dps > 0 ? `DPS ${m.dps.toLocaleString()}` : '';
            const itemLevelVal = m.itemLevel || 0;

            membersHtml += `
                <div class="party-member-card" onclick="openAtulPage('${m.name}')">
                    <img src="${avatarSrc}" class="pm-avatar" onerror="this.src='https://via.placeholder.com/60?text=User'">
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
        const searchJson = await searchRes.json();
        
        if (!searchJson.data || !searchJson.data.character) return null;

        const charId = searchJson.data.character.characterId;
        const detailUrl = `${PROXY_URL}https://api.aon2.info/api/v1/aion2/characters/detail?serverId=2002&characterId=${encodeURIComponent(charId)}`;
        const detailRes = await fetch(detailUrl);
        const detailJson = await detailRes.json();

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
