const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');

const CREDENTIALS = {
    email: "muhamadreyhan0073@gmail.com",
    pw: "fd140206"
};

const URLS = {
    login: "https://x.mnitnetwork.com/mauth/login",
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

// Memory untuk mencegah duplikat saat scraping
let LAST_PROCESSED_RANGE = new Set();

/**
 * Fungsi Simpan Data ke Folder Get
 */
function saveToGetFolder(newData) {
    try {
        let currentCache = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8') || "[]");
        }

        currentCache.unshift(newData);
        if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);

        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2), 'utf-8');
        console.log(`💾 [SAVED] ${newData.range} -> get/cache_range.json`);
    } catch (err) {
        console.error("❌ [FILE ERROR]:", err.message);
    }
}

/**
 * Fungsi Utama Scraper
 */
async function startScraper() {
    console.log("🚀 [SCRAPER] Memulai Browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    try {
        // --- PROSES LOGIN ---
        console.log(`🌐 Membuka halaman login: ${URLS.login}`);
        await page.goto(URLS.login, { waitUntil: 'load' });

        console.log("⌨️ Mengisi Email...");
        await page.waitForSelector("input[type='email']");
        await page.fill("input[type='email']", CREDENTIALS.email);

        console.log("⌨️ Mengisi Password dan Menekan ENTER...");
        await page.fill("input[type='password']", CREDENTIALS.pw);
        await page.keyboard.press('Enter');

        // Tunggu proses login (biasanya redirect ke dashboard)
        console.log("⏳ Menunggu redirect sukses login...");
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});

        // --- PAKSA KE CONSOLE ---
        console.log(`🛠️ Navigasi paksa ke Console: ${URLS.console}`);
        await page.goto(URLS.console, { waitUntil: 'networkidle' });

        // --- LOOPING SCRAPE ---
        console.log("🔍 [MONITOR] Memulai pemantauan range...");
        
        while (true) {
            try {
                // Selector baris dashboard (sesuaikan jika MNIT berubah)
                const rowSelector = ".group.flex.flex-col.sm\\:flex-row"; 
                const elements = await page.locator(rowSelector).all();

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
                            const dataToSave = {
                                range: cleanPhone,
                                country: country,
                                service: service,
                                full_msg: messageRaw.trim(),
                                detected_at: new Date().toLocaleString()
                            };

                            saveToGetFolder(dataToSave);
                            LAST_PROCESSED_RANGE.add(cacheKey);
                        }
                    }
                }

                // Bersihkan set berkala
                if (LAST_PROCESSED_RANGE.size > 200) LAST_PROCESSED_RANGE.clear();

            } catch (e) {
                console.log("⚠️ Scrape delay/error...");
            }

            // Cek setiap 10 detik
            await new Promise(r => setTimeout(r, 10000));
        }

    } catch (fatal) {
        console.error("🔥 [FATAL] Terjadi kesalahan fatal:", fatal.message);
        await browser.close().catch(() => {});
        console.log("🔄 Me-restart scraper dalam 10 detik...");
        setTimeout(startScraper, 10000);
    }
}

// Jalankan
startScraper();
