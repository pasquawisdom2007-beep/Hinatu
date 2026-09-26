'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { v4: uuid } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── CONFIG ── */
const ADMIN_PASS = process.env.ADMIN_PASS || 'Pasqua1264';
const PAYMENT = {
    bank: process.env.PAY_BANK || 'GTBank',
    name: process.env.PAY_NAME || 'PASQUA TECH',
    acct: process.env.PAY_ACCT || '0000000000',  // update with real account
};

const DB_FILE    = path.join(__dirname, 'data', 'db.json');

/* ── IN-MEMORY STORE ── */
let store = { requests: [] };

function loadDB() {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        store = JSON.parse(raw);
    } catch (_) {
        store = { requests: [] };
    }
}

function saveDB() {
    try {
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
    } catch (_) {}
}

function genId() {
    return 'BNX-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

loadDB();

/* ── MIDDLEWARE ── */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── ADMIN AUTH MIDDLEWARE ── */
function adminOnly(req, res, next) {
    const auth = req.headers['x-admin-key'] || req.query.key || '';
    if (auth !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

/* ══════════════════════════════════════════
   PUBLIC ROUTES
══════════════════════════════════════════ */

/* GET /api/stats — public stats for homepage */
app.get('/api/stats', (req, res) => {
    const all     = store.requests;
    const total   = all.length;
    const banned  = all.filter(r => r.status === 'banned').length;
    const pending = all.filter(r => r.status !== 'banned').length;
    res.json({ total, banned, pending });
});

/* GET /api/requests/:id — user tracks their own request */
app.get('/api/requests/:id', (req, res) => {
    const r = store.requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    /* return safe fields only — no internal admin notes */
    res.json({
        id: r.id,
        number: r.number,
        status: r.status,
        createdAt: r.createdAt,
        approvedAt: r.approvedAt || null,
        bannedAt: r.bannedAt || null,
        paymentConfirmed: r.paymentConfirmed || false,
        payNotified: r.payNotified || false,
    });
});

/* POST /api/requests — user submits a new request */
app.post('/api/requests', (req, res) => {
    const { number, reason } = req.body;
    if (!number || String(number).replace(/\D/g, '').length < 7) {
        return res.status(400).json({ error: 'Invalid number' });
    }
    const id = genId();
    const rec = {
        id,
        number: String(number).replace(/[\s\-\(\)]/g, '').trim(),
        reason: reason || '—',
        status: 'payment_pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        paymentConfirmed: false,
        payNotified: false,
        bannedAt: null,
    };
    store.requests.push(rec);
    saveDB();
    res.status(201).json({ id, status: rec.status });
});

/* POST /api/requests/:id/notify-payment — user says they paid */
app.post('/api/requests/:id/notify-payment', (req, res) => {
    const r = store.requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    r.payNotified = true;
    r.payNotifiedAt = Date.now();
    r.updatedAt = Date.now();
    saveDB();
    res.json({ ok: true });
});

/* ══════════════════════════════════════════
   ADMIN ROUTES (password protected)
══════════════════════════════════════════ */

/* GET /api/admin/requests — all requests */
app.get('/api/admin/requests', adminOnly, (req, res) => {
    const list = [...store.requests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json(list);
});

/* POST /api/admin/requests — admin manually adds a request */
app.post('/api/admin/requests', adminOnly, (req, res) => {
    const { id, number, reason, status } = req.body;
    if (!number || String(number).replace(/\D/g, '').length < 7) {
        return res.status(400).json({ error: 'Invalid number' });
    }
    const existing = store.requests.find(x => x.id === id);
    if (existing) return res.status(409).json({ error: 'ID already exists' });

    const rec = {
        id: id || genId(),
        number: String(number).replace(/[\s\-\(\)]/g, '').trim(),
        reason: reason || '—',
        status: status || 'payment_pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        paymentConfirmed: status === 'ban_pending' || status === 'banned',
        addedByAdmin: true,
        bannedAt: status === 'banned' ? Date.now() : null,
    };
    store.requests.push(rec);
    saveDB();
    res.status(201).json(rec);
});

/* PATCH /api/admin/requests/:id — update status */
app.patch('/api/admin/requests/:id', adminOnly, (req, res) => {
    const r = store.requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const { status, note } = req.body;
    if (status) {
        r.status = status;
        if (status === 'ban_pending') r.paymentConfirmed = true;
        if (status === 'banned') { r.bannedAt = Date.now(); r.paymentConfirmed = true; }
    }
    if (note) r.adminNote = note;
    r.updatedAt = Date.now();
    saveDB();
    res.json(r);
});

/* DELETE /api/admin/requests/:id */
app.delete('/api/admin/requests/:id', adminOnly, (req, res) => {
    const idx = store.requests.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    store.requests.splice(idx, 1);
    saveDB();
    res.json({ ok: true });
});

/* POST /api/admin/verify — check admin password */
app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) return res.json({ ok: true });
    res.status(401).json({ error: 'Wrong password' });
});

/* GET /api/config — payment info for frontend */
app.get('/api/config', (req, res) => {
    res.json(PAYMENT);
});

/* ── FALLBACK → index.html ── */
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── START ── */
app.listen(PORT, () => {
    console.log(`BANX server running on port ${PORT}`);
});

module.exports = app;

/* ── /api/config — public payment info ── */
// NOTE: add this block BEFORE the wildcard * route in server.js
// Already handled inline below — this is a reminder comment only
