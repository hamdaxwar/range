const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8244546257:AAGu3vwXPZbfcJznfW9WwhHOkdumyKM079g";
const CHAT_ID = "7184123643";
const COOKIE_FILE = path.join(__dirname, 'active_session.json');

const URLS = {
    base: "https://x.mnitnetwork.com",
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let LAST_PROCESSED_RANGE = new Set();

// ==================== FUNGSI TELEGRAM ====================
async function sendTelegramMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID, text: text, parse_mode: 'HTML'
        });
    } catch (e) {}
}

async function sendTelegramPhoto(caption, photoPath) {
    try {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('photo', fs.createReadStream(photoPath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
    } catch (e) {}
}

// ==================== LOGIKA PENYIMPANAN ====================
function saveToGetFolder(newData) {
    const folderPath = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    let currentCache = [];
    if (fs.existsSync(CACHE_FILE_PATH)) {
        try { currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8')); } catch (e) {}
    }
    currentCache.unshift(newData);
    if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
}

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    // Jika file cookie belum ada, bot akan stand-by
    if (!fs.existsSync(COOKIE_FILE)) {
        console.log("❌ Cookie belum ada. Silahkan buat file active_session.json");
        await sendTelegramMsg("<b>[WAKE UP]</b> Bot Scraper aktif, tapi Cookie belum ada.\n\nKirim token mauthtoken kamu ke sini.");
        return;
    }

    console.log("🚀 [SCRAPER] Memulai dengan Cookie Injection...");
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    
    try {
        // Load Cookie dari file
        const cookieVal = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        await context.addCookies([{
            name: 'mauthtoken',
            value: cookieVal,
            domain: 'x.mnitnetwork.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
        }]);

        const page = await context.newPage();
        
        console.log("🛠️ Langsung menuju Console...");
        await page.goto(URLS.console, { waitUntil: 'networkidle', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // Cek apakah berhasil masuk atau terpental ke login
        if (page.url().includes('login')) {
            await page.screenshot({ path: 'session_expired.png' });
            await sendTelegramPhoto("❌ <b>Cookie Expired!</b> Silahkan kirim cookie baru.", 'session_expired.png');
            await browser.close();
            return;
        }

        await sendTelegramMsg("✅ <b>Login Berhasil via Cookie!</b> Monitoring dimulai...");

        while (true) {
            try {
                const elements = await page.locator(".group.flex.flex-col.sm\\:flex-row").all();
                for (const el of elements) {
                    const phoneRaw = await el.locator(".font-mono").first().innerText().catch(() => "");
                    const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await el.locator("p").innerText().catch(() => "");

                    if (phoneRaw.includes('XXX')) {
                        const cleanPhone = phoneRaw.trim();
                        const cacheKey = `${cleanPhone}_${serviceRaw}`;
                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            saveToGetFolder({
                                range: cleanPhone,
                                service: serviceRaw.toLowerCase().includes('whatsapp') ? 'whatsapp' : 'facebook',
                                full_msg: messageRaw.trim(),
                                detected_at: new Date().toLocaleString('id-ID')
                            });
                            LAST_PROCESSED_RANGE.add(cacheKey);
                            console.log(`✨ Detected: ${cleanPhone}`);
                        }
                    }
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 15000));
        }

    } catch (err) {
        console.error("🔥 Fatal Error:", err.message);
        await browser.close().catch(() => {});
        setTimeout(startScraper, 30000);
    }
}

startScraper();
