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
        if (!fs.existsSync(photoPath)) return;
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('photo', fs.createReadStream(photoPath));

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, {
            headers: form.getHeaders()
        });
    } catch (e) {
        console.error("❌ Gagal kirim Telegram Photo:", e.message);
    }
}

async function sendTelegramMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("❌ Gagal kirim Telegram Msg:", e.message);
    }
}

// ==================== LOGIKA PENYIMPANAN ====================
function saveToGetFolder(newData) {
    try {
        const folderPath = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        let currentCache = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            const fileContent = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
            try {
                currentCache = JSON.parse(fileContent || "[]");
            } catch (e) { currentCache = []; }
        }

        currentCache.unshift(newData);
        if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);

        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2), 'utf-8');
        console.log(`💾 [SAVED] ${newData.range}`);
    } catch (err) {
        console.error("❌ [FILE ERROR]:", err.message);
    }
}

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    console.log("🚀 [SCRAPER] Memulai Browser Stealth Mode...");
    const browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-blink-features=AutomationControlled'
        ] 
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    try {
        await sendTelegramMsg("<b>[SYSTEM]</b> Mencoba login dengan Human Click Mode...");

        // 1. BUKA HALAMAN LOGIN
        console.log("🌐 Membuka Login...");
        try {
            await page.goto(URLS.login, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log("⚠️ Timeout akses halaman, lanjut cek elemen...");
        }

        await new Promise(r => setTimeout(r, 10000)); 
        await page.screenshot({ path: 'step1_login.png' });
        await sendTelegramPhoto("📸 Step 1: Halaman Login", 'step1_login.png');

        // 2. CEK INPUT & LOGIN (HUMAN TYPING)
        const emailInput = page.locator("input[type='email']");
        const passwordInput = page.locator("input[type='password']");
        const loginBtn = page.locator("button[type='submit']");

        if (await emailInput.isVisible()) {
            console.log("⌨️ Mengetik Email...");
            await emailInput.click();
            for (const char of CREDENTIALS.email) {
                await page.keyboard.type(char, { delay: Math.random() * 150 + 50 });
            }

            await new Promise(r => setTimeout(r, 1000));

            console.log("⌨️ Mengetik Password...");
            await passwordInput.click();
            for (const char of CREDENTIALS.pw) {
                await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
            }
            
            await new Promise(r => setTimeout(r, 2000));
            
            // --- SIMULASI PERGERAKAN MOUSE KE TOMBOL ---
            console.log("🖱️ Menggerakkan kursor ke tombol Sign In...");
            const btnBox = await loginBtn.boundingBox();
            if (btnBox) {
                await page.mouse.move(
                    btnBox.x + Math.random() * btnBox.width, 
                    btnBox.y + Math.random() * btnBox.height,
                    { steps: 15 }
                );
            }

            await page.screenshot({ path: 'ready_to_click.png' });
            await sendTelegramPhoto("📸 Step 2: Form terisi, mencoba KLIK Sign In...", 'ready_to_click.png');

            console.log("🖱️ Klik tombol Sign In...");
            await loginBtn.click();
            
        } else {
            throw new Error("Elemen login tidak ditemukan (Mungkin Cloudflare / Koneksi lambat)");
        }

        // 3. TUNGGU REDIRECT
        console.log("⏳ Menunggu redirect login...");
        await new Promise(r => setTimeout(r, 15000));
        await page.screenshot({ path: 'step3_after_click.png' });
        
        const currentUrl = page.url();
        if (currentUrl.includes('login')) {
            await sendTelegramPhoto(`⚠️ Login Gagal (Masih di halaman login). URL: ${currentUrl}`, 'step3_after_click.png');
            throw new Error("Sistem mendeteksi aktivitas bot atau 'Terjadi kesalahan'");
        }

        await sendTelegramPhoto("✅ Login Berhasil! Masuk ke Dashboard...", 'step3_after_click.png');

        // 4. NAVIGASI KE CONSOLE
        console.log("🛠️ Membuka Console...");
        await page.goto(URLS.console, { waitUntil: 'networkidle', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'step4_console.png' });
        await sendTelegramPhoto("📊 Monitoring Console AKTIF", 'step4_console.png');

        // 5. LOOP MONITORING
        console.log("🔍 [MONITOR] Mencari range...");
        while (true) {
            try {
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
                                detected_at: new Date().toLocaleString('id-ID')
                            });
                            
                            LAST_PROCESSED_RANGE.add(cacheKey);
                            console.log(`✨ [DETEKSI] ${cleanPhone}`);
                        }
                    }
                }
                
                if (LAST_PROCESSED_RANGE.size > 200) LAST_PROCESSED_RANGE.clear();
                
            } catch (e) {
                console.log("⚠️ Scrape error, lanjut...");
            }
            await new Promise(r => setTimeout(r, 15000));
        }

    } catch (fatal) {
        console.error("🔥 Error:", fatal.message);
        await page.screenshot({ path: 'fatal_error.png' });
        await sendTelegramPhoto(`🔥 <b>FATAL ERROR:</b>\n<code>${fatal.message}</code>`, 'fatal_error.png');
        
        await browser.close().catch(() => {});
        console.log("🔄 Restarting scraper...");
        setTimeout(startScraper, 20000);
    }
}

startScraper();
