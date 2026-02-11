const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');

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
let canStartMonitoring = false; // Flag untuk perintah /mulai

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== UTILITY FUNCTIONS ====================
async function sendMsg(text) {
    try {
        await bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' });
    } catch (e) { console.error("❌ Telegram Error:", e.message); }
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
        
        // Hapus screenshot di lokal biar bersih
        fs.unlinkSync(photoPath);
    } catch (e) { console.error("❌ Photo Error:", e.message); }
}

function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const parts = item.trim().split('=');
        return {
            name: parts[0],
            value: parts.slice(1).join('='),
            domain: domain,
            path: '/',
            secure: true
        };
    }).filter(c => c.name);
}

// ==================== BOT HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text || "";

    if (text === '/mulai') {
        canStartMonitoring = true;
        await sendMsg("🚀 <b>Monitoring Dimulai!</b> Saya akan mengecek data setiap 4 detik.");
        return;
    }

    if (text.startsWith('/addcookie') || (text.includes('=') && text.includes(';'))) {
        let cookieRaw = text.replace('/addcookie', '').trim();
        fs.writeFileSync(COOKIE_FILE, cookieRaw, 'utf-8');
        await sendMsg("♻️ <b>Cookie Diperbarui!</b> Mencoba login...");
        
        if (browserInstance) {
            await browserInstance.close().catch(() => {});
            isBrowserRunning = false;
        }
        canStartMonitoring = false; // Reset flag monitoring saat ganti cookie
        startScraper();
    }
});

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    if (isBrowserRunning) return;
    if (!fs.existsSync(COOKIE_FILE)) {
        await sendMsg("⚠️ Cookie belum ada. Silahkan kirim cookie atau /addcookie.");
        return;
    }

    isBrowserRunning = true;
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    browserInstance = browser;

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        await context.addCookies(parseCookies(rawCookie, "x.mnitnetwork.com"));

        const page = await context.newPage();
        await page.goto(URLS.console, { waitUntil: 'networkidle', timeout: 60000 });

        // Tunggu sebentar untuk rendering dashboard
        await new Promise(r => setTimeout(r, 8000));

        const currentUrl = page.url();
        const ssPath = `auth_check_${Date.now()}.png`;
        await page.screenshot({ path: ssPath });

        if (currentUrl.includes('login')) {
            await sendPhoto("❌ <b>LOGIN GAGAL!</b>\nCookie tidak valid atau expired. Silahkan kirim cookie baru.", ssPath);
            await browser.close();
            isBrowserRunning = false;
            return;
        }

        await sendPhoto("✅ <b>LOGIN BERHASIL!</b>\nKirim <code>/mulai</code> untuk menjalankan scraper.", ssPath);

        // ================= LOOP MONITORING =================
        while (true) {
            if (canStartMonitoring) {
                const rowSelector = ".group.flex.flex-col.sm\\:flex-row";
                const rows = await page.locator(rowSelector).all();

                for (const row of rows) {
                    // Seleksi data sesuai target
                    const phoneInfo = await row.locator(".text-slate-600.font-mono").innerText().catch(() => ""); 
                    const serviceRaw = await row.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await row.locator("p.font-mono").innerText().catch(() => "");

                    const serviceLower = serviceRaw.toLowerCase();
                    if (serviceLower.includes('facebook') || serviceLower.includes('whatsapp')) {
                        
                        // Parse: "23278967XXX • Sierra Leone"
                        const splitInfo = phoneInfo.split('•').map(s => s.trim());
                        const range = splitInfo[0] || "Unknown";
                        const country = splitInfo[1] || "Unknown";
                        
                        // Gunakan pesan sebagai bagian dari key agar pesan baru di nomor yang sama tetap terdeteksi
                        const cacheKey = `${range}_${serviceRaw}_${messageRaw.slice(-10)}`;

                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            const cleanMsg = messageRaw.replace('➜', '').trim();
                            
                            const report = `Range:${range}\nCountry:${country}\nService:${serviceRaw}\nfull_msg:${cleanMsg}`;
                            
                            await sendMsg(report);
                            LAST_PROCESSED_RANGE.add(cacheKey);

                            // Simpan ke cache file
                            saveToCache({ range, country, service: serviceRaw, full_msg: cleanMsg });
                        }
                    }
                }
                if (LAST_PROCESSED_RANGE.size > 300) LAST_PROCESSED_RANGE.clear();
            }

            await new Promise(r => setTimeout(r, 4000)); // Cek setiap 4 detik
        }

    } catch (err) {
        console.error(err);
        await sendMsg(`🔥 <b>Sistem Error:</b> <code>${err.message}</code>\nRestarting...`);
        isBrowserRunning = false;
        await browser.close().catch(() => {});
        setTimeout(startScraper, 10000);
    }
}

function saveToCache(data) {
    try {
        const folder = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        let cache = fs.existsSync(CACHE_FILE_PATH) ? JSON.parse(fs.readFileSync(CACHE_FILE_PATH)) : [];
        cache.unshift({ ...data, detected_at: new Date().toLocaleString() });
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache.slice(0, 100), null, 2));
    } catch (e) {}
}

// Start bot
(async () => {
    console.log("🤖 Bot Standby...");
    await sendMsg("🤖 <b>Bot Online.</b> Menunggu perintah atau cookie...");
    startScraper();
})();
