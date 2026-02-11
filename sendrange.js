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

Silahkan kirim token disini untuk menyimpan dan melakukan login.
`;
    await sendMsg(msg);
}

// ==================== LISTENER TOKEN TELEGRAM ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;

    const text = msg.text;

    if (!text) return;

    // token biasanya JWT diawali eyJ
    if (text.startsWith('eyJ')) {

        // simpan token ke file
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');

        await sendMsg("✅ <b>Token diterima</b>\n📁 File diperbarui/dibuat\n🚀 Melakukan login...");

        if (!isBrowserRunning) {
            startScraper();
        } else {
            await sendMsg("⚠️ Browser masih berjalan, token akan dipakai saat restart.");
        }
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

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) {
        console.log("⏳ Menunggu token...");
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

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    try {
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
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });

        await new Promise(r => setTimeout(r, 10000));

        const currentUrl = page.url();
        const screenshotPath = 'login_result.png';
        await page.screenshot({ path: screenshotPath });

        if (currentUrl.includes('login')) {
            await sendPhoto("❌ <b>Login gagal!</b>\nToken expired atau invalid.", screenshotPath);
            fs.unlinkSync(COOKIE_FILE);
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
