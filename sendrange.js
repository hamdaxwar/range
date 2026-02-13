// Menghilangkan DeprecationWarning
process.env.NTBA_FIX_350 = 1;

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8558006836:AAGR3N4DwXYSlpOxjRvjZcPAmC1CUWRJexY";
const CHAT_ID = "7184123643";
const COOKIE_FILE = path.join(__dirname, 'active_session.json');

// PATH CHROMIUM
const CHROMIUM_PATH = "/usr/bin/chromium-browser";

const URLS = {
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let LAST_PROCESSED_RANGE = new Set();
let isLocked = false;
let pageInstance = null;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== HELPER: HAPUS FILE OTOMATIS ====================
function autoDelete(filePath) {
    setTimeout(() => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[CLEANUP] File dihapus: ${filePath}`);
        }
    }, 120000);
}

// ==================== TELEGRAM HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text;
    if (!text) return;

    if (text === '/lock') {
        if (isLocked) return bot.sendMessage(CHAT_ID, "⚠️ Sudah dalam mode LOCK.");
        isLocked = true;
        await bot.sendMessage(CHAT_ID, "🔒 <b>LOCKED:</b> Scraper berjalan di background.");
        startScraper();
        return;
    }

    if (text === '/ref') {
        if (!pageInstance) return bot.sendMessage(CHAT_ID, "❌ Scraper belum berjalan.");
        await bot.sendMessage(CHAT_ID, "🔄 Memuat ulang halaman...");
        try {
            await pageInstance.reload({ waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 3000));
            const refSS = `refresh_${Date.now()}.png`;
            await pageInstance.screenshot({ path: refSS });
            await bot.sendPhoto(CHAT_ID, refSS, { caption: "📸 Refresh Screenshot" });
            autoDelete(refSS);
        } catch (e) {
            await bot.sendMessage(CHAT_ID, "❌ Gagal refresh: " + e.message);
        }
        return;
    }

    if (text.includes('=') && text.includes(';')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await bot.sendMessage(CHAT_ID, "✅ Cookie disimpan. Ketik <code>/lock</code>.");
    }
});

// ==================== LOGIKA SIMPAN ====================
function saveToGetFolder(newData) {
    try {
        const folderPath = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

        let currentCache = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            try {
                currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
            } catch {
                currentCache = [];
            }
        }

        const existingIndex = currentCache.findIndex(item => item.range === newData.range);
        if (existingIndex !== -1) {
            if (currentCache[existingIndex].full_msg !== newData.full_msg) {
                currentCache.splice(existingIndex, 1);
                currentCache.unshift(newData);
            } else return;
        } else {
            currentCache.unshift(newData);
        }

        if (currentCache.length > 25) currentCache = currentCache.slice(0, 25);
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
    } catch (e) {
        console.error("Gagal simpan JSON:", e.message);
    }
}

// ==================== MAIN SCRAPER (PUPPETEER) ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) return;

    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    pageInstance = page;

    try {
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();

        const cookies = rawCookie.split(';').map(item => {
            const parts = item.trim().split('=');
            if (parts.length < 2) return null;
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            if (!name || !value) return null;
            return {
                name,
                value,
                domain: "x.mnitnetwork.com",
                path: '/'
            };
        }).filter(Boolean);

        await page.setCookie(...cookies);

        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        if (page.url().includes('login')) {
            await bot.sendMessage(CHAT_ID, "❌ Login Gagal. Cookie tidak valid.");
            await browser.close();
            isLocked = false;
            return;
        }

        const loginSS = `login_${Date.now()}.png`;
        await page.screenshot({ path: loginSS });
        await bot.sendPhoto(CHAT_ID, loginSS, { caption: "✅ Berhasil Login!" });
        autoDelete(loginSS);

        while (true) {
            try {
                const elements = await page.$$('.group.flex.flex-col.sm\\:flex-row');

                for (const el of elements) {
                    const phoneInfo = await el.$eval('.text-slate-600.font-mono', el => el.innerText).catch(() => "");
                    const serviceRaw = await el.$eval('.text-blue-400', el => el.innerText).catch(() => "");
                    const messageRaw = await el.$eval('p.font-mono', el => el.innerText).catch(() => "");

                    if (serviceRaw.toLowerCase().includes('facebook') || serviceRaw.toLowerCase().includes('whatsapp')) {
                        const splitInfo = phoneInfo.split('•').map(s => s.trim());
                        const range = splitInfo[0] || "Unknown";
                        const country = splitInfo[1] || "Unknown";
                        const cacheKey = `${range}_${messageRaw.slice(-15)}`;

                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            saveToGetFolder({
                                range,
                                country,
                                service: serviceRaw,
                                full_msg: messageRaw.replace('➜', '').trim(),
                                detected_at: new Date().toLocaleString('id-ID')
                            });
                            LAST_PROCESSED_RANGE.add(cacheKey);
                        }
                    }
                }

                if (LAST_PROCESSED_RANGE.size > 1000) LAST_PROCESSED_RANGE.clear();

            } catch (e) {}

            await new Promise(r => setTimeout(r, 5000));
        }

    } catch (err) {
        console.error("Scraper Error:", err.message);
        isLocked = false;
    }
}

console.log("🤖 Bot Standby... Kirim cookie lalu /lock");
