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

const URLS = { console: "https://x.mnitnetwork.com/mdashboard/console" };
let LAST_PROCESSED_RANGE = new Set();
let isBrowserRunning = false;
let browserInstance = null;
let canStartMonitoring = false; 

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

async function sendMsg(text) {
    try { await bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' }); } catch (e) {}
}

async function sendPhoto(caption, photoPath) {
    try {
        if (!fs.existsSync(photoPath)) return;
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('photo', fs.createReadStream(photoPath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
        fs.unlinkSync(photoPath); // Hapus setelah kirim
    } catch (e) {}
}

function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const parts = item.trim().split('=');
        return { name: parts[0], value: parts.slice(1).join('='), domain: domain, path: '/', secure: true };
    }).filter(c => c.name);
}

// ==================== BOT HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text || "";

    if (text === '/mulai') {
        if (isBrowserRunning) {
            canStartMonitoring = true;
            await sendMsg("🚀 <b>Monitoring Aktif!</b> Mengecek data setiap 4 detik tanpa reload.");
        } else {
            await sendMsg("❌ Browser belum siap. Silahkan kirim cookie dulu.");
        }
        return;
    }

    if (text.includes('=') && text.includes(';')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await sendMsg("♻️ <b>Cookie diterima!</b> Mencoba login...");
        if (browserInstance) { await browserInstance.close(); isBrowserRunning = false; }
        canStartMonitoring = false;
        startScraper();
    }
});

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) return;

    isBrowserRunning = true;
    const browser = await chromium.launch({ headless: true });
    browserInstance = browser;

    try {
        const context = await browser.newContext();
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        await context.addCookies(parseCookies(rawCookie, "x.mnitnetwork.com"));

        const page = await context.newPage();
        
        // Panggil GOTO cuma SEKALI di sini buat login
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 8000)); // Jeda biar stabil

        const ssPath = `login_${Date.now()}.png`;
        await page.screenshot({ path: ssPath });

        if (page.url().includes('login')) {
            await sendPhoto("❌ <b>Login Gagal!</b> Cookie mati.", ssPath);
            await browser.close();
            isBrowserRunning = false;
            return;
        }

        await sendPhoto("✅ <b>LOGIN BERHASIL!</b>\nKetik <code>/mulai</code> untuk mulai scan data.", ssPath);

        // ================= LOOP MONITORING (TANPA GOTO LAGI) =================
        while (true) {
            if (canStartMonitoring) {
                const rowSelector = ".group.flex.flex-col.sm\\:flex-row";
                const rows = await page.locator(rowSelector).all();

                for (const row of rows) {
                    const phoneInfo = await row.locator(".text-slate-600.font-mono").innerText().catch(() => ""); 
                    const serviceRaw = await row.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await row.locator("p.font-mono").innerText().catch(() => "");

                    if (serviceRaw.toLowerCase().includes('facebook') || serviceRaw.toLowerCase().includes('whatsapp')) {
                        const splitInfo = phoneInfo.split('•').map(s => s.trim());
                        const range = splitInfo[0] || "Unknown";
                        const country = splitInfo[1] || "Unknown";
                        
                        const cacheKey = `${range}_${messageRaw.slice(-15)}`;

                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            await sendMsg(`Range:${range}\nCountry:${country}\nService:${serviceRaw}\nfull_msg:${messageRaw.replace('➜', '').trim()}`);
                            LAST_PROCESSED_RANGE.add(cacheKey);
                        }
                    }
                }
                if (LAST_PROCESSED_RANGE.size > 500) LAST_PROCESSED_RANGE.clear();
            }
            await new Promise(r => setTimeout(r, 4000)); // Jeda 4 detik tiap putaran
        }

    } catch (err) {
        isBrowserRunning = false;
        await browser.close().catch(() => {});
        setTimeout(startScraper, 5000);
    }
}

(async () => { startScraper(); })();
