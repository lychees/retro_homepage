const express = require('express');
const fs = require('fs');
const path = require('path');
const { ROM_DIR } = require('./config');

const router = express.Router();

router.get('/api/roms', (req, res) => {
    let files = [];
    try {
        files = fs.readdirSync(ROM_DIR).filter(f => f.toLowerCase().endsWith('.nes'));
    } catch (e) {
        console.error('读取 ROM 目录失败:', e.message);
        return res.json({ roms: [] });
    }

    const roms = files.map(f => {
        const clean = f
            .replace(/\.nes$/i, '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s*\[[^\]]*\]\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return {
            name: clean || f,
            file: f,
            path: encodeURIComponent(f)
        };
    });

    res.json({ roms });
});

router.get('/roms/:name', (req, res) => {
    const filename = decodeURIComponent(req.params.name);
    const filePath = path.join(ROM_DIR, filename);
    // 防止路径穿越
    if (!filePath.startsWith(ROM_DIR)) {
        return res.status(403).send('Forbidden');
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Not found');
    }
    res.sendFile(filePath);
});

module.exports = router;
