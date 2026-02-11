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
        form.append('photo', fs.createReadStream(photoPath), { contentType: 'image/png' });
        
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, { 
            headers: form.getHeaders() 
        });
        
        // Hapus file setelah dikirim agar lokal bersih
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

    if (text.startsWith('/addcookie') || (text.includes('=') && text.includes(';'))) {
        let cookieRaw = text.replace('/addcookie', '').trim();
        fs.writeFileSync(COOKIE_FILE, cookieRaw, 'utf-8');
        await sendMsg("♻️ <b>Cookie Diperbarui!</b> Sedang mencoba login ulang...");
        
        if (browserInstance) {
            await browserInstance.close().catch(() => {});
            isBrowserRunning = false;
        }
        startScraper();
    }
});

// ==================== CORE SCRAPER ====================
async function startScraper() {
    if (isBrowserRunning) return;
    if (!fs.existsSync(COOKIE_FILE)) {
        await sendMsg("⚠️ <b>Cookie tidak ditemukan!</b> Kirim cookie atau gunakan /addcookie.");
        return;
    }

    isBrowserRunning = true;
    const browser = await chromium.launch({ headless: true });
    browserInstance = browser;

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        await context.addCookies(parseCookies(rawCookie, "x.mnitnetwork.com"));

        const page = await context.newPage();
        await page.goto(URLS.console, { waitUntil: 'networkidle', timeout: 60000 });

        await new Promise(r => setTimeout(r, 5000));
        const currentUrl = page.url();
        const ssPath = `login_${Date.now()}.png`;
        await page.screenshot({ path: ssPath });

        if (currentUrl.includes('login')) {
            await sendPhoto("❌ <b>Login Gagal!</b> Cookie expired. Silahkan kirim cookie baru via /addcookie.", ssPath);
            isBrowserRunning = false;
            await browser.close();
            return;
        }

        await sendPhoto("✅ <b>Login Berhasil!</b> Monitoring berjalan (interval 4s).", ssPath);

        // Monitoring Loop
        while (true) {
            const rowSelector = ".group.flex.flex-col.sm\\:flex-row";
            const rows = await page.locator(rowSelector).all();

            for (const row of rows) {
                // Seleksi teks spesifik sesuai struktur HTML yang diberikan
                const phoneWithCountry = await row.locator(".text-slate-600.font-mono").innerText().catch(() => ""); 
                const service = await row.locator(".text-blue-400").innerText().catch(() => "");
                const message = await row.locator("p.font-mono").innerText().catch(() => "");

                const serviceLower = service.toLowerCase();
                if (serviceLower.includes('facebook') || serviceLower.includes('whatsapp')) {
                    
                    // Ekstrak Range dan Country: "23278967XXX • Sierra Leone"
                    const parts = phoneWithCountry.split('•').map(s => s.trim());
                    const range = parts[0] || "Unknown";
                    const country = parts[1] || "Unknown";
                    
                    const cacheKey = `${range}_${service}_${message.slice(0, 10)}`;

                    if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                        const resultMsg = `Range:${range}\nCountry:${country}\nService:${service}\nfull_msg:${message.replace('➜', '').trim()}`;
                        
                        await sendMsg(resultMsg);
                        LAST_PROCESSED_RANGE.add(cacheKey);

                        // Save to cache file logic
                        const data = { range, country, service, full_msg: message, detected_at: new Date().toISOString() };
                        saveToCache(data);
                    }
                }
            }

            if (LAST_PROCESSED_RANGE.size > 200) LAST_PROCESSED_RANGE.clear();
            await new Promise(r => setTimeout(r, 4000)); // Delay 4 detik
        }

    } catch (err) {
        console.error(err);
        await sendMsg(`⚠️ <b>Error:</b> ${err.message}. Merestart...`);
        isBrowserRunning = false;
        await browser.close().catch(() => {});
        setTimeout(startScraper, 5000);
    }
}

function saveToCache(data) {
    try {
        const folder = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        let cache = fs.existsSync(CACHE_FILE_PATH) ? JSON.parse(fs.readFileSync(CACHE_FILE_PATH)) : [];
        cache.unshift(data);
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache.slice(0, 100), null, 2));
    } catch (e) {}
}

// Start
(async () => {
    console.log("🚀 Scraper Running...");
    startScraper();
})();
