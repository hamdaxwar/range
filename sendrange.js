// Menghilangkan DeprecationWarning untuk pengiriman file
process.env.NTBA_FIX_350 = 1;

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
let pageInstance = null; // Menyimpan instance page agar bisa diakses /ref

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== HELPER: HAPUS FILE OTOMATIS ====================
function autoDelete(filePath) {
    setTimeout(() => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[CLEANUP] File dihapus: ${filePath}`);
        }
    }, 120000); // 2 Menit (120000 ms)
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
        if (!pageInstance) return bot.sendMessage(CHAT_ID, "❌ Scraper belum berjalan. Ketik /lock dulu.");
        
        await bot.sendMessage(CHAT_ID, "🔄 Memuat ulang halaman...");
        await pageInstance.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 3000)); // Tunggu 3 detik sesuai perintah

        const refSS = `refresh_${Date.now()}.png`;
        await pageInstance.screenshot({ path: refSS });
        await bot.sendPhoto(CHAT_ID, refSS, { caption: "📸 Refresh Screenshot" });
        autoDelete(refSS);
        return;
    }

    if (text.includes('=') && text.includes(';')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await bot.sendMessage(CHAT_ID, "✅ Cookie disimpan. Ketik <code>/lock</code> untuk mulai.");
    }
});

// ==================== SIMPAN KE JSON (CEK DUPLIKAT & MAX 25) ====================
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

        // Cari duplikat berdasarkan range
        const existingIndex = currentCache.findIndex(item => item.range === newData.range);

        if (existingIndex !== -1) {
            // Jika range sama tapi message beda, ganti yang lama
            if (currentCache[existingIndex].full_msg !== newData.full_msg) {
                currentCache.splice(existingIndex, 1);
                currentCache.unshift(newData);
            } else {
                return; // Sama persis, abaikan
            }
        } else {
            currentCache.unshift(newData);
        }

        // Batasi maksimal 25 data
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
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
});

    try {
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        const cookies = rawCookie.split(';').map(item => {
            const [name, ...rest] = item.trim().split('=');
            return { name: name, value: rest.join('='), domain: "x.mnitnetwork.com", path: '/', secure: true };
        });
        await context.addCookies(cookies);

        const page = await context.newPage();
        pageInstance = page; // Simpan ke global variable untuk /ref
        
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        if (page.url().includes('login')) {
            await bot.sendMessage(CHAT_ID, "❌ Login Gagal. Cookie sampah.");
            await browser.close();
            return;
        }

        // Screenshot Login Berhasil
        const loginSS = `login_${Date.now()}.png`;
        await page.screenshot({ path: loginSS });
        await bot.sendPhoto(CHAT_ID, loginSS, { caption: "✅ Berhasil Login!" });
        autoDelete(loginSS);

        // ================= LOOP MONITORING =================
        while (true) {
            try {
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

                            saveToGetFolder(data);
                            LAST_PROCESSED_RANGE.add(cacheKey);
                        }
                    }
                }
                if (LAST_PROCESSED_RANGE.size > 1000) LAST_PROCESSED_RANGE.clear();
            } catch (e) { console.log("Loop Error Terlewati."); }

            await new Promise(r => setTimeout(r, 5000));
        }

    } catch (err) {
        console.error("Scraper Error:", err.message);
    }
}

console.log("🤖 Bot Standby... Kirim cookie lalu /lock");
            
