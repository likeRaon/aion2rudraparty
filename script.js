const API_BASE_URL = 'https://api.aon2.info/api/v1/aion2';
const PROXY_URL = '';

const WEBHOOK_SECRET = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1NjU1OTI1NzA3ODk4ODgyMS81VDczT1VxWUxnZzFEYUs1Skk3M0R2OFpfYzdNVlBiajZXUkE0c3VyQ0paQ1ZXSW96T1Voel9rWDBhVEdiSkx3WkJLRg==';
const DISCORD_WEBHOOK_URL = atob(WEBHOOK_SECRET);

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
    toastContainer: document.getElementById('toastContainer')
};

document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    setupRealtimeListener();
    setupEventListeners();
});

function setupRealtimeListener() {
    if (!db) return;

    db.collection("posts")
        .orderBy("createdAt", "desc")
        .onSnapshot((snapshot) => {
            posts = [];
            snapshot.forEach((doc) => {
                posts.push({ id: doc.id, ...doc.data() });
            });
            checkExpiredPosts();
            renderPosts();
            renderNotices(); 
        }, (error) => {
            console.error("데이터 불러오기 실패:", error);
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

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            if (e.target.id === 'writeModal') return;
            e.target.classList.add('hidden');
        }
    });
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
                verified: true
            };
        } else {
            currentUser = {
                name: nickname,
                class: '미인증',
                level: 0,
                itemLevel: 0,
                dps: 0,
                avatar: null,
                verified: false
            };
        }
        
        const savedUser = JSON.parse(localStorage.getItem('rudra_user') || '{}');
        if (savedUser && savedUser.name === currentUser.name && savedUser.dps) {
            currentUser.dps = savedUser.dps;
        }

        if (nickname === '근접(어드민)') {
            currentUser.isAdmin = true;
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
        expirationMs = 0; 
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
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('여기에')) return Promise.resolve(null);

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

    return fetch(`${DISCORD_WEBHOOK_URL}?wait=true`, {
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
    if (!post.discordMessageId || !DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('여기에')) return;

    fetch(`${DISCORD_WEBHOOK_URL}/messages/${post.discordMessageId}`, {
        method: 'DELETE'
    }).catch(err => console.error('Discord Delete Error:', err));
}

function checkExpiredPosts() {
    if (!db) return;
    const now = Date.now();
    let expiredCount = 0;

    posts.forEach(post => {
        if (post.type === 'notice') return;
        if (post.expirationTime === 0) return;

        const expirationMs = post.expirationTime || CONSTANTS.DEFAULT_EXPIRATION_MS;
        const postTime = new Date(post.createdAt).getTime();

        if (now - postTime > expirationMs) {
            db.collection("posts").doc(post.id).delete()
                .then(() => {
                    deleteDiscordMessage(post);
                })
                .catch(err => console.error("만료 삭제 오류:", err));
            
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

// 좌측 배너용 공지사항 렌더링
function renderNotices(showAll = false) {
    const noticeList = elements.noticeList;
    if (!noticeList) return;

    const notices = posts.filter(p => p.type === 'notice').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
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
        db.collection("posts").doc(notice.id).delete()
            .then(() => {
                showToast("공지사항이 삭제되었습니다.");
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

    let filteredPosts = posts.filter(post => {
        if (post.type === 'notice') return false; 

        if (currentTab === 'completed') {
            return post.status === 'full';
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
                    ${currentUser && currentUser.isAdmin ? `<button onclick="event.stopPropagation(); checkPasswordAndManage('${post.id}')" class="btn-outline full-width">관리</button>` : ''}
                </div>
            `;
            
        } else {
            card.innerHTML = `
                <div class="post-header">
                    <div class="badge-container">
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
                    <button onclick="event.stopPropagation(); checkPasswordAndManage('${post.id}')" class="btn-outline full-width" style="padding: 8px;">관리</button>
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

    if (currentUser && currentUser.isAdmin) {
        openManageModal(post);
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
    const name = elements.newMemberName.value.trim();
    const cls = elements.newMemberClass.value;
    
    if (!name) return alert('닉네임을 입력하세요.');

    elements.addMemberBtn.textContent = '검색중...';
    const charData = await fetchCharacterData(name);
    elements.addMemberBtn.textContent = '추가';
    
    const post = posts.find(p => p.id === currentEditingPostId);
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
        
        db.collection("posts").doc(currentEditingPostId).delete()
            .then(() => {
                if (post) deleteDiscordMessage(post);
                elements.manageModal.classList.add('hidden');
                showToast("게시글이 삭제되었습니다.");
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

        let dps = 0;
        if (data.combatPoint) dps = data.combatPoint;
        else if (data.stats && data.stats.combatPower) dps = data.stats.combatPower;
        else dps = data.totalItemLevel;

        return {
            name: data.characterName,
            level: data.level,
            class: data.classInfo ? data.classInfo.className : '알 수 없음',
            item_level: data.totalItemLevel, 
            dps: dps,
            profile_img: data.profileImageUrl,
            server: '지켈',
            charId: charId 
        };
    } catch (error) {
        console.error(error);
        return null;
    }
}
