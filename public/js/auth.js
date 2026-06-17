/**
 * 星間茶室 - 全局账号系统
 * 维护登录态、渲染侧边栏账号入口、提供登录/注册/设置弹窗
 */
(function () {
    'use strict';

    window.currentUser = null;

    function api(path, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['Content-Type'] = 'application/json';
        if (options.body && typeof options.body === 'object') {
            options.body = JSON.stringify(options.body);
        }
        return fetch('/api' + path, options).then(function (res) {
            return res.json().then(function (data) {
                if (!res.ok) throw new Error(data.error || '请求失败');
                return data;
            });
        });
    }

    function fetchMe() {
        return api('/auth/me').then(function (data) {
            window.currentUser = data.user || null;
            renderAuthWidget();
            renderOAuthButtons();
            return window.currentUser;
        }).catch(function () {
            window.currentUser = null;
            renderAuthWidget();
            renderOAuthButtons();
        });
    }

    function logout() {
        return api('/auth/logout', { method: 'POST' }).then(function () {
            window.currentUser = null;
            renderAuthWidget();
            renderOAuthButtons();
        });
    }

    function updateProfile(fields) {
        return api('/user/profile', { method: 'POST', body: fields }).then(function (data) {
            window.currentUser = data.user || null;
            renderAuthWidget();
            renderOAuthButtons();
            return window.currentUser;
        });
    }

    function updateSocial(social) {
        return api('/user/social', { method: 'POST', body: social }).then(function (data) {
            window.currentUser = data.user || null;
            renderAuthWidget();
            renderOAuthButtons();
            return window.currentUser;
        });
    }

    function avatarUrl(user) {
        if (user && user.avatar) return user.avatar;
        return 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\'%3E%3Crect width=\'40\' height=\'40\' fill=\'%23333\'/%3E%3Ctext x=\'50%25\' y=\'55%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%23aaa\' font-family=\'monospace\' font-size=\'20\'%3E?%3C/text%3E%3C/svg%3E';
    }

    var oauthProviders = {};

    function fetchProviders() {
        return fetch('/api/auth/providers')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                oauthProviders = (data && data.providers) || {};
                renderOAuthButtons();
            })
            .catch(function () { oauthProviders = {}; });
    }

    function renderOAuthButtons() {
        var names = { github: 'GitHub', google: 'Google', qq: 'QQ' };
        var icons = { github: '🐙', google: 'G', qq: '🐧' };
        var enabled = Object.keys(oauthProviders).filter(function (k) { return oauthProviders[k]; });
        var loginBox = document.getElementById('auth-oauth-login');
        if (loginBox && enabled.length) {
            loginBox.innerHTML = '<div class="auth-oauth-title">第三方登录</div>' +
                enabled.map(function (p) {
                    return '<a class="auth-oauth-btn auth-oauth-' + p + '" href="/api/auth/' + p + '">' +
                        '<span class="auth-oauth-icon">' + icons[p] + '</span> ' + names[p] + ' 登录' +
                    '</a>';
                }).join('') +
                '<div class="auth-hint">点击上方按钮登录；首次登录将自动创建账号。</div>';
        } else if (loginBox) {
            loginBox.innerHTML = '<div class="auth-oauth-title">暂未开启第三方登录</div>' +
                '<div class="auth-hint">管理员未配置 OAuth 提供方。</div>';
        }

        var bindBox = document.getElementById('auth-oauth-bind');
        if (!bindBox) return;
        var user = window.currentUser;
        if (!user || !enabled.length) {
            bindBox.innerHTML = '';
            return;
        }
        var bound = user.providers || [];
        bindBox.innerHTML = '<div class="auth-oauth-title">绑定账号</div>' +
            enabled.map(function (p) {
                var isBound = bound.indexOf(p) >= 0;
                if (isBound) {
                    return '<span class="auth-oauth-btn bound">' + icons[p] + ' ' + names[p] + ' 已绑定</span>';
                }
                return '<a class="auth-oauth-btn auth-oauth-' + p + '" href="/api/auth/' + p + '">' +
                    '<span class="auth-oauth-icon">' + icons[p] + '</span> 绑定 ' + names[p] +
                '</a>';
            }).join('');
    }

    function checkOAuthResult() {
        var hash = window.location.hash || '';
        if (hash.indexOf('bind=success') >= 0) {
            showModal('profile');
            var err = document.getElementById('auth-profile-error');
            if (err) err.textContent = '第三方账号绑定成功';
            window.location.hash = hash.replace(/[?&]bind=success/, '').replace(/\?&/, '?').replace(/\?$/, '');
        } else if (hash.indexOf('error=account_already_bound') >= 0) {
            showModal('profile');
            var err2 = document.getElementById('auth-profile-error');
            if (err2) err2.textContent = '该第三方账号已绑定到其他用户';
            window.location.hash = hash.replace(/[?&]error=account_already_bound/, '').replace(/\?&/, '?').replace(/\?$/, '');
        } else if (hash.indexOf('error=') >= 0) {
            var match = hash.match(/error=([^&]+)/);
            showModal('login');
            var err3 = document.getElementById('auth-login-error');
            if (err3 && match) err3.textContent = '第三方登录失败：' + decodeURIComponent(match[1]);
            window.location.hash = hash.replace(/[?&]error=[^&]+/, '').replace(/\?&/, '?').replace(/\?$/, '');
        }
    }

    function ensureModal() {
        var modal = document.getElementById('auth-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'auth-modal';
        modal.className = 'modal-overlay auth-modal';
        modal.innerHTML = '<div class="modal-box">' +
            '<div class="modal-header">账号 <button class="modal-close" id="auth-modal-close">×</button></div>' +
            '<div class="auth-tabs">' +
                '<button class="auth-tab active" data-tab="login">登录</button>' +
                '<button class="auth-tab" data-tab="profile">资料</button>' +
            '</div>' +
            '<div class="auth-panel active" data-panel="login">' +
                '<div class="auth-oauth" id="auth-oauth-login"></div>' +
                '<div class="auth-error" id="auth-login-error"></div>' +
            '</div>' +
            '<div class="auth-panel" data-panel="profile">' +
                '<div id="auth-profile-guest">请先登录。</div>' +
                '<div id="auth-profile-form">' +
                    '<label>昵称</label><input type="text" id="auth-profile-nickname" maxlength="16">' +
                    '<label>头像 URL / Data URI</label><textarea id="auth-profile-avatar" rows="3" maxlength="2048" placeholder="图片链接或 base64"></textarea>' +
                    '<label>简介</label><textarea id="auth-profile-bio" rows="3" maxlength="300" placeholder="一句话介绍自己"></textarea>' +
                    '<label>Twitter</label><input type="text" id="auth-social-twitter" maxlength="120" placeholder="@username">' +
                    '<label>GitHub</label><input type="text" id="auth-social-github" maxlength="120" placeholder="username">' +
                    '<label>Bilibili</label><input type="text" id="auth-social-bilibili" maxlength="120" placeholder="UID/链接">' +
                    '<label>Weibo</label><input type="text" id="auth-social-weibo" maxlength="120" placeholder="链接">' +
                    '<label>个人主页</label><input type="text" id="auth-social-homepage" maxlength="120" placeholder="https://...">' +
                    '<div class="auth-oauth-bind" id="auth-oauth-bind"></div>' +
                    '<div class="auth-error" id="auth-profile-error"></div>' +
                    '<button class="auth-submit" id="auth-profile-btn">保存</button>' +
                    '<button class="auth-secondary" id="auth-logout-btn">退出登录</button>' +
                '</div>' +
            '</div>' +
        '</div></div>';
        document.body.appendChild(modal);

        fetchProviders();

        modal.querySelector('#auth-modal-close').addEventListener('click', hideModal);
        modal.addEventListener('click', function (e) { if (e.target === modal) hideModal(); });

        var tabs = modal.querySelectorAll('.auth-tab');
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                var name = tab.getAttribute('data-tab');
                tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
                modal.querySelectorAll('.auth-panel').forEach(function (p) {
                    p.classList.toggle('active', p.getAttribute('data-panel') === name);
                });
                if (name === 'profile') {
                    fillProfileForm();
                    renderOAuthButtons();
                }
            });
        });

        modal.querySelector('#auth-profile-btn').addEventListener('click', function () {
            var nickname = document.getElementById('auth-profile-nickname').value.trim();
            var avatar = document.getElementById('auth-profile-avatar').value.trim();
            var bio = document.getElementById('auth-profile-bio').value.trim();
            document.getElementById('auth-profile-error').textContent = '';
            updateProfile({ nickname: nickname, avatar: avatar, bio: bio }).then(function () {
                var social = {
                    twitter: document.getElementById('auth-social-twitter').value.trim(),
                    github: document.getElementById('auth-social-github').value.trim(),
                    bilibili: document.getElementById('auth-social-bilibili').value.trim(),
                    weibo: document.getElementById('auth-social-weibo').value.trim(),
                    homepage: document.getElementById('auth-social-homepage').value.trim()
                };
                return updateSocial(social);
            }).then(function () {
                document.getElementById('auth-profile-error').textContent = '保存成功';
            }).catch(function (e) {
                document.getElementById('auth-profile-error').textContent = e.message;
            });
        });

        modal.querySelector('#auth-logout-btn').addEventListener('click', function () {
            logout().then(function () {
                switchTab('login');
                hideModal();
            });
        });

        return modal;
    }

    function showModal(tab) {
        var modal = ensureModal();
        modal.style.display = 'flex';
        switchTab(tab || 'login');
    }

    function hideModal() {
        var modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'none';
    }

    function switchTab(name) {
        var modal = document.getElementById('auth-modal');
        if (!modal) return;
        modal.querySelectorAll('.auth-tab').forEach(function (t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === name);
        });
        modal.querySelectorAll('.auth-panel').forEach(function (p) {
            p.classList.toggle('active', p.getAttribute('data-panel') === name);
        });
        if (name === 'profile') fillProfileForm();
    }

    function fillProfileForm() {
        var user = window.currentUser;
        var form = document.getElementById('auth-profile-form');
        var guest = document.getElementById('auth-profile-guest');
        if (!form || !guest) return;
        if (!user) {
            form.style.display = 'none';
            guest.style.display = 'block';
            return;
        }
        form.style.display = 'block';
        guest.style.display = 'none';
        document.getElementById('auth-profile-nickname').value = user.nickname || '';
        document.getElementById('auth-profile-avatar').value = user.avatar || '';
        document.getElementById('auth-profile-bio').value = user.bio || '';
        var social = user.social || {};
        document.getElementById('auth-social-twitter').value = social.twitter || '';
        document.getElementById('auth-social-github').value = social.github || '';
        document.getElementById('auth-social-bilibili').value = social.bilibili || '';
        document.getElementById('auth-social-weibo').value = social.weibo || '';
        document.getElementById('auth-social-homepage').value = social.homepage || '';
    }

    function fillNicknames() {
        var user = window.currentUser;
        if (!user) return;
        ['chat-nick', 'oekaki-nick', 'pictionary-nick'].forEach(function (id) {
            var input = document.getElementById(id);
            if (input && !input.value.trim()) {
                input.value = user.nickname || '';
            }
        });
    }

    function renderAuthWidget() {
        var container = document.getElementById('auth-widget');
        if (!container) return;
        var user = window.currentUser;
        if (user) {
            fillNicknames();
            container.innerHTML = '<div class="auth-widget-logged">' +
                '<img src="' + avatarUrl(user) + '" alt="avatar" class="auth-avatar">' +
                '<div class="auth-info">' +
                    '<div class="auth-nickname">' + escapeHtml(user.nickname || user.username) + '</div>' +
                    '<div class="auth-actions">' +
                        '<a href="#/user/' + encodeURIComponent(user.id) + '" data-link>主页</a>' +
                        '<a href="#" class="auth-open-profile">设置</a>' +
                        '<a href="#" class="auth-logout-link">退出</a>' +
                    '</div>' +
                '</div>' +
            '</div>';
            container.querySelector('.auth-open-profile').addEventListener('click', function (e) {
                e.preventDefault();
                showModal('profile');
            });
            container.querySelector('.auth-logout-link').addEventListener('click', function (e) {
                e.preventDefault();
                logout();
            });
        } else {
            container.innerHTML = '<div class="auth-widget-guest">' +
                '<a href="#" class="auth-login-link">登录 / 注册</a>' +
            '</div>';
            container.querySelector('.auth-login-link').addEventListener('click', function (e) {
                e.preventDefault();
                showModal('login');
            });
        }
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.Auth = {
        fetchMe: fetchMe,
        logout: logout,
        updateProfile: updateProfile,
        updateSocial: updateSocial,
        avatarUrl: avatarUrl,
        showModal: showModal
    };

    document.addEventListener('DOMContentLoaded', function () {
        renderAuthWidget();
        fetchMe().then(function () {
            setTimeout(checkOAuthResult, 0);
        });
    });
})();
