const path = require('path');

const PORT = process.env.PORT || 3000;

module.exports = {
    PORT,
    ROM_DIR: path.join(__dirname, '..', 'public', 'roms'),
    SUBMISSIONS_FILE: path.join(__dirname, '..', 'submissions.json'),
    USERS_FILE: path.join(__dirname, '..', 'users.json'),
    MAX_SUBMISSIONS: 100,
    BASE_URL: process.env.BASE_URL || ('http://localhost:' + PORT),
    SESSION_SECRET: process.env.SESSION_SECRET || 'star-tearoom-secret'
};
