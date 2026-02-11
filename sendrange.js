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
let isLocked = false; 

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== TELEGRAM HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text;
    if (!text) return;

    if (text === '/lock') {
        if (isLocked) return bot.sendMessage(CHAT_ID, "⚠️ Sudah dalam mode LOCK.");
        isLocked = true;
        await bot.sendMessage(CHAT_ID, "🔒 <b>LOCKED:</b> Login dilakukan sekali, scraper berjalan...");
        startScraper();
        return;
    }

    if (text.includes('=') && text.includes(';')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await bot.sendMessage(CHAT_ID, "✅ Cookie disimpan. Ketik <code>/lock</code> untuk mulai.");
    }
});

// ==================== LOGIKA SIMPAN & DUPLIKAT (MAX 25) ====================
function saveToGetFolder(newData) {
    try {
        const folderPath = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

        let currentCache = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            try {
                currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
            } catch (e) { currentCache = []; }
        }

        // Cari apakah ada range yang sama
        const existingIndex = currentCache.findIndex(item => item.range === newData.range);

        if (existingIndex !== -1) {
            // Jika range sama, cek apakah message-nya berbeda
            if (currentCache[existingIndex].full_msg !== newData.full_msg) {
                // Hapus data lama, masukkan yang baru di posisi paling atas
                currentCache.splice(existingIndex, 1);
                currentCache.unshift(newData);
                console.log(`[UPDATE] Pesan baru untuk range: ${newData.range}`);
            } else {
                // Jika range dan pesan sama, tidak perlu simpan (duplikat persis)
                return;
            }
        } else {
            // Jika range benar-benar baru, masukkan ke atas
            currentCache.unshift(newData);
            console.log(`[NEW] Range ditambahkan: ${newData.range}`);
        }

        // Batasi maksimal 25 data (hapus yang paling lama)
        if (currentCache.length > 25) {
            currentCache = currentCache.slice(0, 25);
        }

        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
    } catch (e) {
        console.error("Gagal simpan JSON:", e.message);
    }
}

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) return;

    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
    });

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
        
        // Tunggu sebentar untuk loading data dashboard
        await page.waitForTimeout(10000);

        if (page.url().includes('login')) {
            await bot.sendMessage(CHAT_ID, "❌ Login Gagal. Cookie kadaluwarsa.");
            await browser.close();
            return;
        }

        // Loop Monitoring
        while (true) {
            try {
                const rowSelector = ".group.flex.flex-col.sm\\:flex-row";
                const elements = await page.locator(rowSelector).all();

                for (const el of elements) {
                    const phoneInfo = await el.locator(".text-slate-600.font-mono").innerText().catch(() => ""); 
                    const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await el.locator("p.font-mono").innerText().catch(() => "");

                    const isTarget = serviceRaw.toLowerCase().includes('facebook') || serviceRaw.toLowerCase().includes('whatsapp');

                    if (isTarget && phoneInfo) {
                        const splitInfo = phoneInfo.split('•').map(s => s.trim());
                        const range = splitInfo[0] || "Unknown";
                        const country = splitInfo[1] || "Unknown";
                        
                        const data = {
                            range: range,
                            country: country,
                            service: serviceRaw,
                            full_msg: messageRaw.replace('➜', '').trim(),
                            detected_at: new Date().toLocaleString('id-ID')
                        };

                        // Kirim ke fungsi pengolah cache
                        saveToGetFolder(data);
                    }
                }
            } catch (innerErr) {
                console.log("Error saat scraping row:", innerErr.message);
            }
            
            await page.waitForTimeout(5000); // Scan setiap 5 detik
        }

    } catch (err) {
        console.error("Scraper Error:", err.message);
        // Tetap menyala meskipun error, atau bisa tambahkan restart logic jika perlu
    }
}

console.log("🤖 Bot Standby... Kirim cookie lalu /lock");
