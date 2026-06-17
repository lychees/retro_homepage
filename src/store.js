const fs = require('fs');
const { SUBMISSIONS_FILE, USERS_FILE } = require('./config');

// 投稿画廊内存存储
let submissions = [];

function loadSubmissions() {
    try {
        if (fs.existsSync(SUBMISSIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')) || [];
            submissions.length = 0;
            data.forEach(item => submissions.push(item));
        }
    } catch (e) {
        console.error('加载投稿文件失败:', e.message);
        submissions.length = 0;
    }
}

function saveSubmissions() {
    try {
        fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
    } catch (e) {
        console.error('保存投稿失败:', e.message);
    }
}

// 用户系统
let users = [];

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || [];
            users.length = 0;
            data.forEach(item => users.push(item));
        }
    } catch (e) {
        console.error('加载用户文件失败:', e.message);
        users.length = 0;
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('保存用户失败:', e.message);
    }
}

function getUserById(id) {
    return users.find(u => u.id === id);
}

function getUserByUsername(username) {
    return users.find(u => u.username === username);
}

function findUserByAccount(provider, providerId) {
    return users.find(u => Array.isArray(u.accounts) && u.accounts.some(a => a.provider === provider && a.id === providerId));
}

function addUserAccount(user, provider, providerId) {
    if (!Array.isArray(user.accounts)) user.accounts = [];
    if (!user.accounts.some(a => a.provider === provider)) {
        user.accounts.push({ provider: provider, id: providerId });
    }
}

function findSubmission(id) {
    return submissions.find(s => s.id === id);
}

loadSubmissions();
loadUsers();

module.exports = {
    users,
    submissions,
    loadUsers,
    saveUsers,
    loadSubmissions,
    saveSubmissions,
    getUserById,
    getUserByUsername,
    findUserByAccount,
    addUserAccount,
    findSubmission
};
