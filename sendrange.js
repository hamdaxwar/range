const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8558006836:AAGR3N4DwXYSlpOxjRvjZcPAmC1CUWRJexY"; // Token Baru
const CHAT_ID = "7184123643";
const COOKIE_FILE = path.join(__dirname, 'active_session.json');

const URLS = {
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let LAST_PROCESSED_RANGE = new Set();
let isBrowserRunning = false;

// Initialize Telegram Bot dengan Jeda Polling agar tidak Limit/Conflict
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: {
        interval: 2000, // Jeda antar request polling (2 detik)
        autoStart: true,
        params: { timeout: 10 }
    } 
});

// ==================== FUNGSI TELEGRAM ====================
async function sendMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID, text: text, parse_mode: 'HTML'
        });
    } catch (e) { console.error("❌ Gagal kirim pesan ke Telegram"); }
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
    } catch (e) { console.error("❌ Gagal kirim foto ke Telegram"); }
}

// ==================== LISTENER TOKEN DARI TELEGRAM ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text;

    if (text && text.startsWith('eyJ')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await bot.sendMessage(CHAT_ID, "✅ <b>Token Diterima!</b> Menyiapkan sistem...");
        if (!isBrowserRunning) {
            startScraper();
        } else {
            await bot.sendMessage(CHAT_ID, "⚠️ Browser sedang berjalan, token akan digunakan saat restart berikutnya.");
        }
    }
});

// ==================== LOGIKA PENYIMPANAN ====================
function saveToGetFolder(newData) {
    const folderPath = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    let currentCache = [];
    if (fs.existsSync(CACHE_FILE_PATH)) {
        try { currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8')); } catch (e) { currentCache = []; }
    }
    currentCache.unshift(newData);
    if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
}

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) {
        console.log("⏳ Standby... Menunggu mauthtoken dari Telegram.");
        return;
    }

    isBrowserRunning = true;
    await sendMsg("🚀 <b>Bot Dimulai!</b> Menghubungkan ke server...");

    console.log("🚀 Membuka Chromium...");
    await sendMsg("🌐 <b>Membuka Chromium...</b>");

    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
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
        
        console.log("🛠️ Navigasi ke Console...");
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Jeda untuk memuat data
        await new Promise(r => setTimeout(r, 10000));
        
        const currentUrl = page.url();
        const screenshotPath = 'login_result.png';
        await page.screenshot({ path: screenshotPath });

        if (currentUrl.includes('login')) {
            console.log("❌ Sesi Expired / Gagal Login.");
            await sendPhoto("❌ <b>Gagal Login!</b> Sesi expired atau ditolak. Silahkan kirim mauthtoken baru.", screenshotPath);
            fs.unlinkSync(COOKIE_FILE); // Hapus cookie rusak
            isBrowserRunning = false;
            await browser.close();
            return;
        }

        await sendPhoto("✅ <b>Berhasil Login!</b> Monitoring range aktif sekarang.", screenshotPath);

        // --- LOOP MONITORING DATA ---
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
            
            // Bersihkan memori Set jika terlalu besar
            if (LAST_PROCESSED_RANGE.size > 500) LAST_PROCESSED_RANGE.clear();
            
            await new Promise(r => setTimeout(r, 15000)); // Cek tiap 15 detik
        }

    } catch (err) {
        console.error("🔥 Error Fatal:", err.message);
        await sendMsg(`🔥 <b>Sistem Error:</b> <code>${err.message}</code>. Mencoba restart browser...`);
        isBrowserRunning = false;
        await browser.close().catch(() => {});
        setTimeout(startScraper, 10000); // Restart dalam 10 detik
    }
}

// Pesan awal saat script dijalankan di VPS
console.log("🤖 Scraper Standby. Menunggu Token...");
startScraper();
