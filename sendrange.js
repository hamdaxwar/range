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
    // --- STANDBY MODE: CEK FILE COOKIE ---
    if (!fs.existsSync(COOKIE_FILE)) {
        console.log("⏳ [WAITING] File active_session.json tidak ditemukan.");
        console.log("💡 Silahkan buat filenya sekarang di VPS...");
        
        // Kirim notif ke telegram hanya sekali tiap restart
        if (!global.sentWaitNotif) {
            await sendTelegramMsg("<b>[STANDBY]</b> File <code>active_session.json</code> belum ada.\n\nSegera buat filenya di VPS agar bot bisa lanjut login!");
            global.sentWaitNotif = true;
        }

        // Cek lagi setiap 5 detik (Looping tanpa browser)
        return setTimeout(startScraper, 5000);
    }

    console.log("🚀 [SCRAPER] Cookie ditemukan! Memulai Browser...");
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext();
    
    try {
        const cookieVal = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        
        // Inject Cookie mauthtoken
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
        await new Promise(r => setTimeout(r, 7000));

        // Verifikasi apakah sesi valid
        if (page.url().includes('login')) {
            console.log("❌ Sesi tidak valid / expired.");
            await page.screenshot({ path: 'expired.png' });
            await sendTelegramPhoto("❌ <b>Cookie Expired!</b>\nSilahkan update file active_session.json dengan token baru.", 'expired.png');
            
            // Hapus file cookie yang sudah expired agar bot balik ke Standby Mode
            fs.unlinkSync(COOKIE_FILE); 
            global.sentWaitNotif = false;
            await browser.close();
            return setTimeout(startScraper, 5000);
        }

        await sendTelegramMsg("✅ <b>Login Berhasil!</b> Monitoring sedang berjalan...");

        // Loop Monitoring Data
        while (true) {
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
            await new Promise(r => setTimeout(r, 15000));
        }

    } catch (err) {
        console.error("🔥 Error:", err.message);
        await browser.close().catch(() => {});
        setTimeout(startScraper, 10000);
    }
}

startScraper();
