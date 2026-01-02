// 전역 변수
const API_BASE_URL = 'https://api.aon2.info/api/v1/aion2';
const PROXY_URL = ''; // 필요시 CORS 프록시 사용

// 상태 관리
let currentTab = 'party'; // party, member, completed
let posts = [];
let currentUser = null;
let currentEditingPostId = null;

// DOM 요소
const elements = {
    // 게시판
    postList: document.getElementById('postList'),
    writeBtn: document.getElementById('writeBtn'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    roleFilter: document.getElementById('roleFilter'),
    
    // 모달 공통
    modals: document.querySelectorAll('.modal'),
    
    // 글쓰기 모달
    writeModal: document.getElementById('writeModal'),
    writeCloseBtn: document.querySelector('.write-close'),
    postForm: document.getElementById('postForm'),
    postRoleCheckboxes: document.querySelectorAll('input[name="postRole"]'),
    postMyDps: document.getElementById('postMyDps'),
    
    // 로그인 모달
    authModal: document.getElementById('authModal'),
    authCloseBtn: document.querySelector('.auth-close'),
    authForm: document.getElementById('authForm'),
    loginBtn: document.getElementById('loginBtn'),
    userInfo: document.getElementById('userInfo'),
    userNickname: document.getElementById('userNickname'),
    logoutBtn: document.getElementById('logoutBtn'),
    authNickname: document.getElementById('authNickname'),

    // 파티 관리 모달
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

    // 상세 보기 모달
    detailModal: document.getElementById('detailModal'),
    detailCloseBtn: document.querySelector('.detail-close'),
    detailRoles: document.getElementById('detailRoles'),
    detailTitle: document.getElementById('detailTitle'),
    detailAuthor: document.getElementById('detailAuthor'),
    detailTime: document.getElementById('detailTime'),
    detailContent: document.getElementById('detailContent'),
    detailLink: document.getElementById('detailLink'),
    
    // 상세 보기 - 작성자 및 파티원
    detailAuthorProfile: document.getElementById('detailAuthorProfile'),
    detailAuthorAvatar: document.getElementById('detailAuthorAvatar'),
    detailAuthorName: document.getElementById('detailAuthorName'),
    detailAuthorClass: document.getElementById('detailAuthorClass'),
    detailAuthorItemLevel: document.getElementById('detailAuthorItemLevel')
};

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    loadPosts();
    setupEventListeners();
});

function setupEventListeners() {
    // --- 탭 전환 ---
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab;
            renderPosts();
        });
    });

    // --- 필터 ---
    elements.roleFilter.addEventListener('change', renderPosts);

    // --- 로그인/로그아웃 ---
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

    // --- 글쓰기 ---
    elements.writeBtn.addEventListener('click', () => {
        if (!currentUser) {
            alert('닉네임을 먼저 설정해주세요 (로그인).');
            elements.authModal.classList.remove('hidden');
            return;
        }
        elements.writeModal.classList.remove('hidden');
        elements.postForm.reset();
        
        if (currentUser.dps) {
            elements.postMyDps.value = currentUser.dps;
        }
    });

    elements.writeCloseBtn.addEventListener('click', () => {
        elements.writeModal.classList.add('hidden');
    });

    // 직업 체크박스 로직
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

    // --- 파티 관리 ---
    elements.manageCloseBtn.addEventListener('click', () => {
        elements.manageModal.classList.add('hidden');
        currentEditingPostId = null;
    });

    elements.btnStatusRecruiting.addEventListener('click', () => updatePostStatus('recruiting'));
    elements.btnStatusFull.addEventListener('click', () => updatePostStatus('full'));
    
    elements.addMemberBtn.addEventListener('click', addPartyMember);
    elements.deletePostBtn.addEventListener('click', deletePost);

    // --- 상세 보기 ---
    elements.detailCloseBtn.addEventListener('click', () => {
        elements.detailModal.classList.add('hidden');
    });

    // 모달 바깥 클릭 시 닫기
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
    });
}

// --- 사용자 관리 ---
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
                itemLevel: data.item_level, // API 값
                dps: 0, // 기본값
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

// --- 게시글 처리 ---
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

    const newPost = {
        id: Date.now(),
        type: currentTab === 'completed' ? 'party' : currentTab,
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
    savePosts();
    renderPosts();
    
    elements.writeModal.classList.add('hidden');
    elements.postForm.reset();
}

function savePosts() {
    localStorage.setItem('rudra_posts', JSON.stringify(posts));
}

function loadPosts() {
    const saved = localStorage.getItem('rudra_posts');
    if (saved) {
        posts = JSON.parse(saved);
    }
    renderPosts();
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

        // DPS 및 아이템 레벨 표시
        const dpsVal = (post.author.dps || 0).toLocaleString();
        const itemLevelVal = (post.author.itemLevel || 0).toLocaleString();
        
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
                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                        ${rolesHtml}
                        ${statusHtml}
                    </div>
                    <span class="post-time">${timeString}</span>
                </div>
                <h3 class="post-title">${post.title}</h3>
                <p class="post-content">${post.content}</p>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    ${post.link ? `<button onclick="event.stopPropagation(); window.open('${post.link}')" class="btn-outline" style="font-size:0.8rem;">오픈채팅/디코</button>` : '<span></span>'}
                    <button onclick="event.stopPropagation(); checkPasswordAndManage(${post.id})" class="btn-outline" style="font-size:0.7rem; padding:4px 8px; margin-left:auto;">관리</button>
                </div>
                
                <div class="post-footer">
                    <div class="author-info">
                        <img src="${post.author.avatar || 'https://via.placeholder.com/32'}" class="author-avatar" onerror="this.src='https://via.placeholder.com/32'">
                        <div>
                            <div class="author-name">${post.author.name}</div>
                            <div style="font-size: 0.75rem; color: #a1a1aa;">
                                ${post.author.class} 
                                <span class="dps-tag">DPS ${dpsVal}</span>
                                <span style="font-size:0.7rem; color:#666; margin-left:4px;">(Lv.${itemLevelVal})</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        card.onclick = () => showPostDetail(post.id);
        elements.postList.appendChild(card);
    });
}

// --- 상세 보기 ---
function showPostDetail(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    elements.detailModal.classList.remove('hidden');
    
    // 기본 정보
    const roles = Array.isArray(post.roles) ? post.roles : [post.role];
    elements.detailRoles.innerHTML = roles.map(r => `<span class="role-badge">${r}</span>`).join(' ');
    elements.detailTitle.textContent = post.title;
    elements.detailAuthor.textContent = post.author.name;
    elements.detailTime.textContent = new Date(post.createdAt).toLocaleString();
    elements.detailContent.textContent = post.content;
    
    // 링크 버튼
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
            const dpsVal = m.dps || 0; 
            const itemLevelVal = m.itemLevel || 0;

            membersHtml += `
                <div class="party-member-card" onclick="openAtulPage('${m.name}')">
                    <img src="${avatarSrc}" class="pm-avatar" onerror="this.src='https://via.placeholder.com/60?text=User'">
                    <div class="pm-name">${m.name}</div>
                    <div class="pm-class">${m.class}</div>
                    <div class="pm-dps" style="color:#a78bfa;">DPS ${dpsVal.toLocaleString()}</div>
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

// --- 관리 ---
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
        posts = posts.filter(p => p.id !== currentEditingPostId);
        savePosts();
        renderPosts();
        elements.manageModal.classList.add('hidden');
    }
}

// --- API ---
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

        return {
            name: data.characterName,
            level: data.level,
            class: data.classInfo ? data.classInfo.className : '알 수 없음',
            item_level: data.totalItemLevel, // API 값
            profile_img: data.profileImageUrl,
            server: '지켈',
            charId: charId 
        };
    } catch (error) {
        console.error(error);
        return null;
    }
}
