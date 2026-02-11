const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');
const os = require('os');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8558006836:AAGR3N4DwXYSlpOxjRvjZcPAmC1CUWRJexY";
const CHAT_ID = "7184123643";
const COOKIE_FILE = path.join(__dirname, 'active_session.json');

const URLS = {
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let LAST_PROCESSED_RANGE = new Set();
let isBrowserRunning = false;
let browserInstance = null;

// ==================== INIT TELEGRAM BOT ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: {
        interval: 2000,
        autoStart: true,
        params: { timeout: 10 }
    } 
});

// ==================== TELEGRAM FUNCTIONS ====================
async function sendMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("❌ Gagal kirim pesan Telegram:", e.message);
    }
}

async function sendPhoto(caption, photoPath) {
    try {
        if (!fs.existsSync(photoPath)) return;
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('photo', fs.createReadStream(photoPath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, { 
            headers: form.getHeaders() 
        });
    } catch (e) {
        console.error("❌ Gagal kirim foto:", e.message);
    }
}

// ==================== PESAN AWAL BOT ====================
async function notifyBotStart() {
    const msg = `
🤖 <b>BOT AKTIF</b>

Silahkan kirim COOKIE disini untuk login.
(Contoh: mauthtoken=xxx; twk_idm_key=xxx; ...)
`;
    await sendMsg(msg);
}

// ==================== PARSE COOKIE STRING ====================
function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const [name, ...rest] = item.trim().split('=');
        return {
            name: name,
            value: rest.join('='),
            domain: domain,
            path: '/',
            httpOnly: false,
            secure: true
        };
    });
}

// ==================== LISTENER COOKIE TELEGRAM ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;

    const text = msg.text;
    if (!text) return;

    // deteksi cookie full (ada "=" dan ";")
    if (text.includes('=') && text.includes(';')) {

        // simpan cookie full
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');

        await sendMsg("✅ <b>Cookie diterima!</b>\n📁 File diperbarui\n🚀 Login dimulai...");

        // kalau browser masih hidup → restart
        if (browserInstance) {
            try {
                await browserInstance.close();
            } catch {}
            isBrowserRunning = false;
        }

        startScraper();
    }
});

// ==================== CACHE SAVE ====================
function saveToGetFolder(newData) {
    const folderPath = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    let currentCache = [];
    if (fs.existsSync(CACHE_FILE_PATH)) {
        try {
            currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
        } catch (e) {
            currentCache = [];
        }
    }

    currentCache.unshift(newData);
    if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);

    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
}

// ==================== MAIN SCRAPER (LOGIN COOKIE) ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) {
        console.log("⏳ Menunggu cookie...");
        return;
    }

    isBrowserRunning = true;

    const browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ] 
    });

    browserInstance = browser;

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    try {
        // baca cookie full
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();

        // parse cookie → array
        const cookies = parseCookies(rawCookie, "x.mnitnetwork.com");

        // inject semua cookie
        await context.addCookies(cookies);

        const page = await context.newPage();
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });

        await new Promise(r => setTimeout(r, 10000));

        const currentUrl = page.url();
        const screenshotPath = 'login_result.png';
        await page.screenshot({ path: screenshotPath });

        // cek login gagal
        if (currentUrl.includes('login')) {
            await sendPhoto("❌ <b>Login gagal!</b>\nCookie expired / invalid.", screenshotPath);
            isBrowserRunning = false;
            await browser.close();
            return;
        }

        await sendPhoto("✅ <b>Login berhasil!</b>\nMonitoring dimulai.", screenshotPath);

        // ================= LOOP MONITORING =================
        while (true) {
            const rowSelector = ".group.flex.flex-col.sm\\:flex-row";
            const elements = await page.locator(rowSelector).all();

            for (const el of elements) {
                const phoneRaw = await el.locator(".font-mono").first().innerText().catch(() => "");
                const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                const messageRaw = await el.locator("p").innerText().catch(() => "");

                if (phoneRaw.includes('XXX')) {
                    const cleanPhone = phoneRaw.trim();
                    const cacheKey = `${cleanPhone}_${serviceRaw}`;

                    if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                        const data = {
                            range: cleanPhone,
                            service: serviceRaw.toLowerCase().includes('whatsapp') ? 'whatsapp' : 'facebook',
                            full_msg: messageRaw.trim(),
                            detected_at: new Date().toLocaleString('id-ID')
                        };

                        saveToGetFolder(data);
                        LAST_PROCESSED_RANGE.add(cacheKey);

                        await sendMsg(`✨ <b>RANGE TERDETEKSI</b>\n\n📱 ${cleanPhone}\n⚙️ ${data.service}`);
                    }
                }
            }

            if (LAST_PROCESSED_RANGE.size > 500) LAST_PROCESSED_RANGE.clear();
            await new Promise(r => setTimeout(r, 15000));
        }

    } catch (err) {
        await sendMsg(`🔥 <b>Error Sistem:</b>\n<code>${err.message}</code>\nRestart...`);
        isBrowserRunning = false;
        await browser.close().catch(() => {});
        setTimeout(startScraper, 10000);
    }
}

// ==================== START BOT ====================
(async () => {
    console.log("🤖 Bot Standby...");
    await notifyBotStart();
    startScraper();
})();
