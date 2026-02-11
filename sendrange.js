const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8244546257:AAGu3vwXPZbfcJznfW9WwhHOkdumyKM079g";
const CHAT_ID = "7184123643";

const CREDENTIALS = {
    email: "muhamadreyhan0073@gmail.com",
    pw: "fd140206"
};

const URLS = {
    login: "https://x.mnitnetwork.com/mauth/login",
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let LAST_PROCESSED_RANGE = new Set();

// ==================== FUNGSI TELEGRAM ====================
async function sendTelegramPhoto(caption, photoPath) {
    try {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('photo', fs.createReadStream(photoPath));

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, {
            headers: form.getHeaders()
        });
    } catch (e) {
        console.error("❌ Gagal kirim Telegram:", e.message);
    }
}

async function sendTelegramMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text
        });
    } catch (e) {}
}

// ==================== LOGIK PENYIMPANAN ====================
function saveToGetFolder(newData) {
    try {
        const folderPath = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
        let currentCache = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8') || "[]");
        }
        currentCache.unshift(newData);
        if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2), 'utf-8');
    } catch (err) { console.error("❌ [FILE ERROR]:", err.message); }
}

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    console.log("🚀 [SCRAPER] Memulai Browser...");
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        await sendTelegramMsg("🚀 Scraper MNIT Dimulai...");

        // 1. BUKA HALAMAN LOGIN
        console.log("🌐 Membuka Login...");
        await page.goto(URLS.login, { waitUntil: 'networkidle', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000)); // Tunggu stabilitas
        
        await page.screenshot({ path: 'login_page.png' });
        await sendTelegramPhoto("📸 Status: Halaman Login Terbuka", 'login_page.png');

        // 2. ISI FORM
        console.log("⌨️ Mengisi data login...");
        await page.fill("input[type='email']", CREDENTIALS.email);
        await page.fill("input[type='password']", CREDENTIALS.pw);
        await page.keyboard.press('Enter');

        // 3. TUNGGU REDIRECT
        console.log("⏳ Menunggu redirect...");
        await new Promise(r => setTimeout(r, 10000));
        
        await page.screenshot({ path: 'after_login.png' });
        
        if (page.url().includes('login')) {
            await sendTelegramPhoto("⚠️ Gagal Login / Stuck di Login", 'after_login.png');
            throw new Error("Login gagal atau diblokir Cloudflare.");
        }

        await sendTelegramPhoto("✅ Berhasil Login! Menuju Console...", 'after_login.png');

        // 4. NAVIGASI KE CONSOLE
        await page.goto(URLS.console, { waitUntil: 'networkidle' });
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'console_view.png' });
        await sendTelegramPhoto("📊 Monitoring Console Aktif", 'console_view.png');

        // 5. LOOP MONITORING
        while (true) {
            const elements = await page.locator(".group.flex.flex-col.sm\\:flex-row").all();
            for (const el of elements) {
                const phoneRaw = await el.locator(".font-mono").first().innerText().catch(() => "");
                const countryRaw = await el.locator(".text-slate-600").innerText().catch(() => "");
                const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                const messageRaw = await el.locator("p").innerText().catch(() => "");

                if (phoneRaw.includes('XXX')) {
                    const cleanPhone = phoneRaw.trim();
                    const cacheKey = `${cleanPhone}_${serviceRaw}`;

                    if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                        const country = countryRaw.includes('•') ? countryRaw.split('•')[1].trim() : countryRaw.trim();
                        saveToGetFolder({
                            range: cleanPhone,
                            country: country,
                            service: serviceRaw.toLowerCase().includes('whatsapp') ? 'whatsapp' : 'facebook',
                            full_msg: messageRaw.trim(),
                            detected_at: new Date().toLocaleString()
                        });
                        LAST_PROCESSED_RANGE.add(cacheKey);
                        console.log(`💾 [DETECTED] ${cleanPhone}`);
                    }
                }
            }
            await new Promise(r => setTimeout(r, 15000));
        }

    } catch (fatal) {
        console.error("🔥 Error:", fatal.message);
        await page.screenshot({ path: 'error_log.png' });
        await sendTelegramPhoto(`🔥 FATAL ERROR: ${fatal.message}`, 'error_log.png');
        await browser.close().catch(() => {});
        setTimeout(startScraper, 15000);
    }
}

startScraper();
