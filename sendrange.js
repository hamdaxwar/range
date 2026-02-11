const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');

const CREDENTIALS = {
    email: "muhamadreyhan0073@gmail.com",
    pw: "fd140206"
};

const URLS = {
    login: "https://x.mnitnetwork.com/mauth/login",
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let LAST_PROCESSED_RANGE = new Set();

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
        console.log(`💾 [SAVED] ${newData.range}`);
    } catch (err) { console.error("❌ [FILE ERROR]:", err.message); }
}

async function startScraper() {
    console.log("🚀 [SCRAPER] Membuka Browser di layar VNC (Non-Headless)...");
    
    const browser = await chromium.launch({ 
        headless: true, // WAJIB FALSE agar muncul di VNC
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ] 
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    try {
        // 1. BUKA HALAMAN LOGIN
        console.log(`🌐 Menuju: ${URLS.login}`);
        await page.goto(URLS.login, { waitUntil: 'load', timeout: 60000 });

        // JEDA STABILITAS (Tunggu 5 detik agar Cloudflare/Loading selesai)
        console.log("⏳ Menunggu stabilitas browser (5 detik)...");
        await new Promise(r => setTimeout(r, 5000));

        // AMBIL SCREENSHOT UNTUK CEK APAKAH ADA CAPTCHA
        await page.screenshot({ path: 'debug_step1.png' });

        // 2. ISI EMAIL & PW
        console.log("⌨️ Mencari input email...");
        await page.waitForSelector("input[type='email']", { timeout: 30000 });
        
        console.log("⌨️ Mengisi Email...");
        await page.fill("input[type='email']", CREDENTIALS.email, { delay: 100 });
        
        console.log("⌨️ Mengisi Password...");
        await page.fill("input[type='password']", CREDENTIALS.pw, { delay: 100 });

        // 3. ENTER & TUNGGU REDIRECT
        console.log("⌨️ Menekan ENTER...");
        await page.keyboard.press('Enter');

        console.log("⏳ Menunggu redirect login sukses (10 detik)...");
        await new Promise(r => setTimeout(r, 10000));
        await page.screenshot({ path: 'debug_after_login.png' });

        // 4. PAKSA KE CONSOLE
        console.log(`🛠️ Navigasi Paksa ke: ${URLS.console}`);
        await page.goto(URLS.console, { waitUntil: 'networkidle', timeout: 60000 });

        // VERIFIKASI APAKAH SUDAH DI CONSOLE
        await page.waitForSelector(".group.flex.flex-col", { timeout: 20000 });
        console.log("✅ BERHASIL: Sudah di halaman Console.");

        // 5. LOOPING SCRAPE
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
                        const country = countryRaw.includes('•') ? countryRaw.split('•')[1].trim() : countryRaw.trim();
                        const service = serviceRaw.toLowerCase().includes('whatsapp') ? 'whatsapp' : 'facebook';

                        const cacheKey = `${cleanPhone}_${service}`;
                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            saveToGetFolder({
                                range: cleanPhone,
                                country: country,
                                service: service,
                                full_msg: messageRaw.trim(),
                                detected_at: new Date().toLocaleString()
                            });
                            LAST_PROCESSED_RANGE.add(cacheKey);
                        }
                    }
                }
            } catch (e) { console.log("⚠️ Scrape error, retrying..."); }
            await new Promise(r => setTimeout(r, 10000));
        }

    } catch (fatal) {
        console.error("🔥 [FATAL]:", fatal.message);
        await page.screenshot({ path: 'error_final.png' });
        await browser.close().catch(() => {});
        console.log("🔄 Restarting in 10s...");
        setTimeout(startScraper, 10000);
    }
}

startScraper();
