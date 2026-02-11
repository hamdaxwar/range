const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
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
let browserInstance = null;
let isLocked = false; // Flag untuk perintah /lock

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== TELEGRAM HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text;
    if (!text) return;

    // Perintah LOCK: Login sekali saja, jangan restart-restart lagi
    if (text === '/lock') {
        if (isLocked) return bot.sendMessage(CHAT_ID, "⚠️ Sudah dalam mode LOCK.");
        isLocked = true;
        await bot.sendMessage(CHAT_ID, "🔒 <b>LOCKED:</b> Login dilakukan sekali, scraper akan berjalan di background.");
        startScraper();
        return;
    }

    // Terima Cookie
    if (text.includes('=') && text.includes(';')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await bot.sendMessage(CHAT_ID, "✅ Cookie disimpan. Ketik <code>/lock</code> untuk mulai sekali jalan.");
    }
});

// ==================== SIMPAN KE JSON (FOLDER GET) ====================
function saveToGetFolder(newData) {
    try {
        const folderPath = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

        let currentCache = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
        }

        currentCache.unshift(newData);
        if (currentCache.length > 500) currentCache = currentCache.slice(0, 500);

        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
        console.log(`[SAVED] ${newData.range} ke cache_range.json`);
    } catch (e) {
        console.error("Gagal simpan JSON:", e.message);
    }
}

// ==================== MAIN SCRAPER (LOGIN SEKALI) ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) return;

    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
    });
    browserInstance = browser;

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    try {
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        const cookies = rawCookie.split(';').map(item => {
            const [name, ...rest] = item.trim().split('=');
            return { name: name, value: rest.join('='), domain: "x.mnitnetwork.com", path: '/', secure: true };
        });
        await context.addCookies(cookies);

        const page = await context.newPage();
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        if (page.url().includes('login')) {
            await bot.sendMessage(CHAT_ID, "❌ Login Gagal. Cookie mungkin sampah.");
            await browser.close();
            return;
        }

        // ================= LOOP MONITORING =================
        while (true) {
            const rowSelector = ".group.flex.flex-col.sm\\:flex-row";
            const elements = await page.locator(rowSelector).all();

            for (const el of elements) {
                const phoneInfo = await el.locator(".text-slate-600.font-mono").innerText().catch(() => ""); 
                const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                const messageRaw = await el.locator("p.font-mono").innerText().catch(() => "");

                if (serviceRaw.toLowerCase().includes('facebook') || serviceRaw.toLowerCase().includes('whatsapp')) {
                    const splitInfo = phoneInfo.split('•').map(s => s.trim());
                    const range = splitInfo[0] || "Unknown";
                    const country = splitInfo[1] || "Unknown";
                    
                    const cacheKey = `${range}_${messageRaw.slice(-15)}`;

                    if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                        const data = {
                            range: range,
                            country: country,
                            service: serviceRaw,
                            full_msg: messageRaw.replace('➜', '').trim(),
                            detected_at: new Date().toLocaleString('id-ID')
                        };

                        // SIMPAN KE JSON (TIDAK KIRIM TELEGRAM)
                        saveToGetFolder(data);
                        LAST_PROCESSED_RANGE.add(cacheKey);
                    }
                }
            }
            if (LAST_PROCESSED_RANGE.size > 1000) LAST_PROCESSED_RANGE.clear();
            await new Promise(r => setTimeout(r, 5000));
        }

    } catch (err) {
        console.error("Scraper Error:", err.message);
        // Jika error, tidak otomatis restart startScraper karena mode LOCK
    }
}

console.log("🤖 Bot Standby... Kirim cookie lalu /lock");
