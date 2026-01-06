const API_BASE_URL = 'https://api.aon2.info/api/v1/aion2';
const PROXY_URL = '';

const WEBHOOK_SECRET = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1NjU1OTI1NzA3ODk4ODgyMS81VDczT1VxWUxnZzFEYUs1Skk3M0R2OFpfYzdNVlBiajZXUkE0c3VyQ0paQ1ZXSW96T1Voel9rWDBhVEdiSkx3WkJLRg==';
const DISCORD_WEBHOOK_URL = atob(WEBHOOK_SECRET);

const CONSTANTS = {
    POST_EXPIRATION_MS: 3 * 60 * 60 * 1000 // 3시간 (밀리초)
};

let currentTab = 'party';
let posts = [];
let currentUser = null;
let currentEditingPostId = null;

// 콘텐츠 및 난이도 데이터
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
    "닥사": {
        details: ["필드", "어비스"],
        difficulties: []
    },
    "기타": {
        details: ["자유 입력"],
        difficulties: []
    }
};

const elements = {
    postList: document.getElementById('postList'),
    writeBtn: document.getElementById('writeBtn'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    roleFilter: document.getElementById('roleFilter'),
    modals: document.querySelectorAll('.modal'),
    writeModal: document.getElementById('writeModal'),
    writeCloseBtn: document.querySelector('.write-close'),
    postForm: document.getElementById('postForm'),
    postCategory: document.getElementById('postCategory'),
    detailSelectGroup: document.getElementById('detailSelectGroup'),
    postDetail: document.getElementById('postDetail'),
    postDifficulty: document.getElementById('postDifficulty'),
    postRoleCheckboxes: document.querySelectorAll('input[name="postRole"]'),
    postMyDps: document.getElementById('postMyDps'),
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
    guideBtn: document.getElementById('guideBtn'),
    guideModal: document.getElementById('guideModal'),
    guideCloseBtn: document.querySelector('.guide-close'),
    toastContainer: document.getElementById('toastContainer')
};

document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    loadPosts();
    setupEventListeners();
});

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

    elements.writeBtn.addEventListener('click', () => {
        if (!currentUser) {
            alert('닉네임을 먼저 설정해주세요 (로그인).');
            elements.authModal.classList.remove('hidden');
            return;
        }
        elements.writeModal.classList.remove('hidden');
        elements.postForm.reset();
        
        // 카테고리 초기화
        elements.detailSelectGroup.classList.add('hidden');
        elements.postDetail.innerHTML = '<option value="">선택</option>';
        elements.postDifficulty.innerHTML = '<option value="">난이도</option>';

        if (currentUser.dps) {
            elements.postMyDps.value = currentUser.dps;
        }
    });

    elements.writeCloseBtn.addEventListener('click', () => {
        elements.writeModal.classList.add('hidden');
    });

    // 카테고리 변경 시 로직
    elements.postCategory.addEventListener('change', (e) => {
        const category = e.target.value;
        const data = categoryData[category];
        
        if (!data) {
            elements.detailSelectGroup.classList.add('hidden');
            return;
        }

        elements.detailSelectGroup.classList.remove('hidden');
        
        // 세부 내용 채우기
        elements.postDetail.innerHTML = '';
        data.details.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            elements.postDetail.appendChild(option);
        });

        // 난이도 채우기
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

    // 가이드 모달
    elements.guideBtn.addEventListener('click', () => {
        elements.guideModal.classList.remove('hidden');
    });
    elements.guideCloseBtn.addEventListener('click', () => {
        elements.guideModal.classList.add('hidden');
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
    });
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
    } else {
        elements.loginBtn.classList.remove('hidden');
        elements.userInfo.classList.add('hidden');
    }
}

function handlePostSubmit(e) {
    e.preventDefault();
    
    const selectedRoles = Array.from(elements.postRoleCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);

    if (selectedRoles.length === 0) {
        alert('최소 1개 이상의 직업을 선택해주세요.');
        return;
    }

    const password = document.getElementById('postPassword').value;
    if (!password || password.length < 4) {
        alert('비밀번호를 4자리 이상 입력해주세요.');
        return;
    }
    
    const myDpsInput = document.getElementById('postMyDps').value;
    const myDps = myDpsInput ? parseInt(myDpsInput) : 0;

    currentUser.dps = myDps;
    localStorage.setItem('rudra_user', JSON.stringify(currentUser));

    const category = elements.postCategory.value;
    const detail = elements.postDetail.value;
    const difficulty = elements.postDifficulty.value;
    const difficultyText = (elements.postDifficulty.style.display !== 'none' && difficulty) ? `[${difficulty}]` : '';

    const newPost = {
        id: Date.now(),
        type: currentTab === 'completed' ? 'party' : currentTab,
        category: category,
        categoryDetail: detail,
        difficulty: difficulty,
        title: document.getElementById('postTitle').value,
        content: document.getElementById('postContent').value,
        roles: selectedRoles,
        link: document.getElementById('postLink').value,
        password: password,
        createdAt: new Date().toISOString(),
        status: 'recruiting',
        members: [],
        author: {
            ...currentUser,
            dps: myDps
        }
    };
    
    newPost.members.push({
        name: currentUser.name,
        class: currentUser.class,
        dps: myDps, 
        itemLevel: currentUser.itemLevel,
        avatar: currentUser.avatar,
        isLeader: true
    });

    posts.unshift(newPost);
    savePosts(); // 포스트 먼저 저장 (ID 확보)
    renderPosts();
    
    // 디스코드 알림 전송 (비동기 처리 후 메시지 ID 업데이트)
    sendDiscordNotification(newPost).then(msgId => {
        if (msgId) {
            newPost.discordMessageId = msgId;
            savePosts(); // 메시지 ID 저장
        }
    });
    
    elements.writeModal.classList.add('hidden');
    elements.postForm.reset();
}

function sendDiscordNotification(post) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('여기에')) return Promise.resolve(null);

    const isParty = post.type === 'party';
    const typeIcon = isParty ? '📢' : '⚔️';
    const typeText = isParty ? '파티원 모집' : '파티 구직';
    
    // 카테고리 정보
    let categoryText = '기타';
    if (post.category) {
        categoryText = post.category;
        if (post.categoryDetail) categoryText += ` - ${post.categoryDetail}`;
        if (post.difficulty) categoryText += ` (${post.difficulty})`;
    }

    // 작성자 정보
    let authorText = `${post.author.name} (${post.author.class})`;
    if (post.type === 'member' && post.author.dps > 0) {
        authorText += ` / DPS ${post.author.dps.toLocaleString()}`;
    }

    // 설명 구성
    let description = `\n**${post.title}**\n\n`;
    description += `${post.content}\n\n`;
    
    description += `👤 **작성자:** ${authorText}\n`;
    description += `🎮 **콘텐츠:** ${categoryText}\n`;
    description += `🎯 **대상:** ${post.roles.join(', ')}`;

    if (post.link) {
        description += `\n\n🔗 [오픈채팅/디코 바로가기](${post.link})`;
    }

    const payload = {
        content: null,
        embeds: [
            {
                title: `${typeIcon} ${typeText}`,
                description: description,
                color: isParty ? 7506394 : 5763719, // 보라색 / 초록색
                footer: {
                    text: "루드라(성역) 파티 매칭"
                },
                timestamp: new Date().toISOString()
            }
        ]
    };

    // wait=true 파라미터를 추가하여 메시지 ID를 반환받음
    return fetch(`${DISCORD_WEBHOOK_URL}?wait=true`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        return data.id; // 메시지 ID 반환
    })
    .catch(err => {
        console.error('Discord Webhook Error:', err);
        return null;
    });
}

function deleteDiscordMessage(post) {
    if (!post.discordMessageId || !DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('여기에')) return;

    // 웹훅 메시지 삭제 API
    fetch(`${DISCORD_WEBHOOK_URL}/messages/${post.discordMessageId}`, {
        method: 'DELETE'
    }).catch(err => console.error('Discord Delete Error:', err));
}

function savePosts() {
    localStorage.setItem('rudra_posts', JSON.stringify(posts));
}

function loadPosts() {
    const saved = localStorage.getItem('rudra_posts');
    if (saved) {
        posts = JSON.parse(saved);
    }
    // 게시글 로드 시 만료 검사 수행
    checkExpiredPosts();
    renderPosts();
}

// 만료된 게시글 확인 및 삭제
function checkExpiredPosts() {
    const now = Date.now();
    let expiredCount = 0;
    
    // 만료된 게시글 필터링
    const activePosts = [];
    const expiredPosts = [];

    posts.forEach(post => {
        const postTime = new Date(post.createdAt).getTime();
        // 만료 시간 지났고, 아직 완료 상태가 아닌 경우
        if (now - postTime > CONSTANTS.POST_EXPIRATION_MS) {
            expiredPosts.push(post);
        } else {
            activePosts.push(post);
        }
    });

    if (expiredPosts.length > 0) {
        expiredPosts.forEach(post => {
            deleteDiscordMessage(post); // 디스코드 메시지 삭제 요청
        });

        posts = activePosts; // 게시글 리스트 갱신
        savePosts(); // 저장
        
        expiredCount = expiredPosts.length;
        showToast(`<i class="fa-solid fa-clock-rotate-left"></i> 유효기간(3시간)이 지난 게시글 ${expiredCount}개가 정리되었습니다.`);
    }
}

// 토스트 메시지 표시 함수
function showToast(message, duration = 4000) {
    const container = elements.toastContainer;
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = message;

    container.appendChild(toast);

    // 일정 시간 후 삭제
    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.3s forwards';
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, duration);
}

function renderPosts() {
    elements.postList.innerHTML = '';
    const isAdmin = currentUser && currentUser.isAdmin;

    let filteredPosts = posts.filter(post => {
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
        
        // 카테고리 표시
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
                ${isAdmin ? `<button onclick="event.stopPropagation(); checkPasswordAndManage(${post.id})" class="btn-outline" style="position:absolute; bottom:10px; right:10px; z-index:10;">관리</button>` : ''}
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
                    
                    <div style="display:flex; gap:8px;">
                        ${post.link ? `<button onclick="event.stopPropagation(); window.open('${post.link}')" class="btn-outline btn-small">참여</button>` : ''}
                        <button onclick="event.stopPropagation(); checkPasswordAndManage(${post.id})" class="btn-outline btn-small">관리</button>
                    </div>
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
    
    // 카테고리 표시
    if (post.category) {
        elements.detailCategoryBadge.innerHTML = `<span class="category-badge" style="font-size:0.9rem;">[${post.category}] ${post.categoryDetail || ''} ${post.difficulty ? '(' + post.difficulty + ')' : ''}</span>`;
    } else {
        elements.detailCategoryBadge.innerHTML = '';
    }

    const roles = Array.isArray(post.roles) ? post.roles : [post.role];
    elements.detailRoles.innerHTML = roles.map(r => `<span class="role-badge">${r}</span>`).join(' ');
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

    const container = elements.detailAuthorProfile.parentElement;
    
    let membersHtml = `<label style="display:block; margin-bottom:10px; color:#a1a1aa;">파티원 목록 (${post.members ? post.members.length : 0}/8)</label>`;
    membersHtml += `<div class="party-grid" id="detailPartyList">`;
    
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
    
    container.innerHTML += `
        <p style="font-size: 0.8rem; color: #a78bfa; margin-top: 15px; text-align: center;">
            <i class="fa-solid fa-arrow-pointer"></i> 카드를 클릭하면 상세 페이지로 이동합니다.
        </p>
    `;
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
        // 모집 완료로 변경 시 디스코드 메시지 삭제
        if (status === 'full' && post.status !== 'full') {
            deleteDiscordMessage(post);
            post.discordMessageId = null; // ID 초기화
        }
        
        post.status = status;
        savePosts();
        renderPosts();
        alert('상태가 변경되었습니다.');
        elements.manageModal.classList.add('hidden');
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

        if (!post.members) post.members = [];
        
        post.members.push(newMember);
        savePosts();
        renderPartyMembers(); 
        elements.newMemberName.value = '';
    }
}

window.deletePartyMember = function(index) {
    if (!currentEditingPostId) return;
    const post = posts.find(p => p.id === currentEditingPostId);
    if (post && post.members) {
        if(confirm('삭제하시겠습니까?')) {
            post.members.splice(index, 1);
            savePosts();
            renderPartyMembers();
        }
    }
}

function renderPartyMembers() {
    if (!currentEditingPostId) return;
    const post = posts.find(p => p.id === currentEditingPostId);
    elements.partyMemberList.innerHTML = '';
    
    if (!post.members) return;

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
        if (post) {
            deleteDiscordMessage(post); // 삭제 시 디스코드 메시지도 삭제
        }

        posts = posts.filter(p => p.id !== currentEditingPostId);
        savePosts();
        renderPosts();
        elements.manageModal.classList.add('hidden');
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
