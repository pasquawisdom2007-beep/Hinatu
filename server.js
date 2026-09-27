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
    acct: process.env.PAY_ACCT || '0000000000',
};

/* ── DB ── */
const DB_FILE = path.join(__dirname, 'data', 'db.json');
let store = { requests: [] };

function loadDB() {
    try { store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch (_) { store = { requests: [] }; }
}
function saveDB() {
    try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2)); }
    catch (_) {}
}
function genId() {
    return 'BNX-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}
loadDB();

/* ── SSE CLIENT REGISTRY ──
   sseClients: Map<requestId, Set<res>>
   When admin changes a request status, we push to all
   connected clients watching that requestId.            */
const sseClients = new Map();

function sseRegister(id, res) {
    if (!sseClients.has(id)) sseClients.set(id, new Set());
    sseClients.get(id).add(res);
}
function sseRemove(id, res) {
    sseClients.get(id)?.delete(res);
    if (sseClients.get(id)?.size === 0) sseClients.delete(id);
}
function ssePush(id, payload) {
    const clients = sseClients.get(id);
    if (!clients?.size) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    clients.forEach(res => { try { res.write(data); } catch (_) {} });
}

/* ── MIDDLEWARE ── */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── ADMIN AUTH ── */
function adminOnly(req, res, next) {
    const key = req.headers['x-admin-key'] || req.query.key || '';
    if (key !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

/* ════════════════════════════════════════
   PUBLIC ROUTES
════════════════════════════════════════ */

/* GET /api/config */
app.get('/api/config', (_, res) => res.json(PAYMENT));

/* GET /api/stats */
app.get('/api/stats', (_, res) => {
    const all = store.requests;
    res.json({
        total:   all.length,
        banned:  all.filter(r => r.status === 'banned').length,
        pending: all.filter(r => r.status !== 'banned').length,
    });
});

/* GET /api/requests/:id  — user tracks their request */
app.get('/api/requests/:id', (req, res) => {
    const r = store.requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({
        id:               r.id,
        number:           r.number,
        status:           r.status,
        createdAt:        r.createdAt,
        approvedAt:       r.approvedAt  || null,
        bannedAt:         r.bannedAt    || null,
        rejectedAt:       r.rejectedAt  || null,
        rejectReason:     r.rejectReason || null,
        paymentConfirmed: r.paymentConfirmed || false,
        payNotified:      r.payNotified  || false,
    });
});

/* GET /api/events/:id  — SSE stream for a specific request */
app.get('/api/events/:id', (req, res) => {
    const id = req.params.id;
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    /* Send heartbeat every 25s to keep connection alive */
    res.write(`data: ${JSON.stringify({ type: 'connected', id })}\n\n`);
    const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_) {} }, 25000);

    sseRegister(id, res);
    req.on('close', () => { clearInterval(hb); sseRemove(id, res); });
});

/* POST /api/requests  — user submits new request */
app.post('/api/requests', (req, res) => {
    const { number, reason } = req.body;
    if (!number || String(number).replace(/\D/g, '').length < 7)
        return res.status(400).json({ error: 'Invalid number' });
    const id  = genId();
    const rec = {
        id,
        number:           String(number).replace(/[\s\-\(\)]/g, '').trim(),
        reason:           reason || '—',
        status:           'payment_pending',
        createdAt:        Date.now(),
        updatedAt:        Date.now(),
        paymentConfirmed: false,
        payNotified:      false,
        approvedAt:       null,
        bannedAt:         null,
        rejectedAt:       null,
        rejectReason:     null,
    };
    store.requests.push(rec);
    saveDB();
    res.status(201).json({ id, status: rec.status });
});

/* POST /api/requests/:id/notify-payment  — user says they paid */
app.post('/api/requests/:id/notify-payment', (req, res) => {
    const r = store.requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    r.payNotified    = true;
    r.payNotifiedAt  = Date.now();
    r.updatedAt      = Date.now();
    saveDB();
    res.json({ ok: true });
});

/* POST /api/admin/verify */
app.post('/api/admin/verify', (req, res) => {
    if (req.body.password === ADMIN_PASS) return res.json({ ok: true });
    res.status(401).json({ error: 'Wrong password' });
});

/* ════════════════════════════════════════
   ADMIN ROUTES
════════════════════════════════════════ */

/* GET /api/admin/requests */
app.get('/api/admin/requests', adminOnly, (req, res) => {
    const list = [...store.requests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json(list);
});

/* POST /api/admin/requests  — admin adds manually */
app.post('/api/admin/requests', adminOnly, (req, res) => {
    const { id, number, reason, status } = req.body;
    if (!number || String(number).replace(/\D/g, '').length < 7)
        return res.status(400).json({ error: 'Invalid number' });
    if (id && store.requests.find(x => x.id === id))
        return res.status(409).json({ error: 'ID already exists' });
    const rec = {
        id:               id || genId(),
        number:           String(number).replace(/[\s\-\(\)]/g, '').trim(),
        reason:           reason || '—',
        status:           status || 'payment_pending',
        createdAt:        Date.now(),
        updatedAt:        Date.now(),
        paymentConfirmed: ['ban_pending','banned'].includes(status),
        addedByAdmin:     true,
        approvedAt:       status === 'ban_pending' || status === 'banned' ? Date.now() : null,
        bannedAt:         status === 'banned' ? Date.now() : null,
        rejectedAt:       status === 'rejected' ? Date.now() : null,
        rejectReason:     null,
        payNotified:      false,
    };
    store.requests.push(rec);
    saveDB();
    res.status(201).json(rec);
});

/* PATCH /api/admin/requests/:id  — approve / ban / reject */
app.patch('/api/admin/requests/:id', adminOnly, (req, res) => {
    const r = store.requests.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });

    const { status, rejectReason } = req.body;
    const prev = r.status;

    if (status && status !== prev) {
        r.status    = status;
        r.updatedAt = Date.now();

        if (status === 'ban_pending') {
            r.paymentConfirmed = true;
            r.approvedAt       = Date.now();
        }
        if (status === 'banned') {
            r.paymentConfirmed = true;
            r.bannedAt         = Date.now();
            if (!r.approvedAt) r.approvedAt = Date.now();
        }
        if (status === 'rejected') {
            r.rejectedAt   = Date.now();
            r.rejectReason = rejectReason || 'No reason provided';
        }

        saveDB();

        /* ── SSE PUSH to user watching this request ── */
        const ssePayload = {
            type:         'status_change',
            id:           r.id,
            prev,
            status:       r.status,
            approvedAt:   r.approvedAt  || null,
            bannedAt:     r.bannedAt    || null,
            rejectedAt:   r.rejectedAt  || null,
            rejectReason: r.rejectReason || null,
            number:       r.number,
        };
        ssePush(r.id, ssePayload);
    }

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

/* ── FALLBACK ── */
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`BANX running on :${PORT}`));
module.exports = app;
