require('dotenv').config();
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performLogin } = require('./login');

// ==================== KONFIGURASI PATH ====================
// Menunjuk ke file cache_range.json yang ada di dalam folder 'get'
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');

const CONFIG = {
    EMAIL: process.env.MNIT_EMAIL,
    PASSWORD: process.env.MNIT_PASSWORD,
    LOGIN_URL: "https://x.mnitnetwork.com/mauth/login",
    CHECK_INTERVAL: 5000, // Cek dashboard setiap 10 detik
};

// Memory cache agar tidak menulis data yang sama berulang kali ke file
let LAST_PROCESSED_RANGE = new Set();

/**
 * Fungsi untuk menyimpan data langsung ke file JSON di folder sebelah (get)
 */
function saveToGetFolder(newData) {
    try {
        let currentCache = [];

        // 1. Pastikan folder 'get' ada (opsional, untuk safety)
        const getFolder = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(getFolder)) {
            fs.mkdirSync(getFolder, { recursive: true });
        }

        // 2. Baca file lama jika sudah ada
        if (fs.existsSync(CACHE_FILE_PATH)) {
            const fileContent = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
            currentCache = JSON.parse(fileContent || "[]");
        }

        // 3. Tambahkan data baru di posisi paling atas (unshift)
        currentCache.unshift(newData);

        // 4. Batasi maksimal 100 data agar file tidak membengkak
        if (currentCache.length > 100) {
            currentCache = currentCache.slice(0, 100);
        }

        // 5. Tulis kembali ke get/cache_range.json
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2), 'utf-8');
        console.log(`💾 [SUCCESS] Data disimpan ke: get/cache_range.json`);

    } catch (err) {
        console.error("❌ [FILE ERROR] Gagal menulis ke folder get:", err.message);
    }
}

/**
 * Main Scraper Loop
 */
async function startScraper() {
    console.log("🚀 [SCRAPER] Memulai pemantauan dashboard MNIT...");
    
    const browser = await chromium.launch({ 
        headless: true, // Ubah ke false jika ingin melihat prosesnya (hanya di Desktop)
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    try {
        // 1. Jalankan proses login yang sudah dibuat di login.js
        await performLogin(page, CONFIG.EMAIL, CONFIG.PASSWORD, CONFIG.LOGIN_URL);

        while (true) {
            try {
                // Selector baris data di dashboard MNIT
                const rowSelector = ".group.flex.flex-col.sm\\:flex-row"; 
                const elements = await page.locator(rowSelector).all();

                for (const el of elements) {
                    // Ekstraksi data dari elemen
                    const phoneRaw = await el.locator(".font-mono").first().innerText().catch(() => "");
                    const countryRaw = await el.locator(".text-slate-600").innerText().catch(() => "");
                    const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await el.locator("p").innerText().catch(() => "");

                    // Filter: Hanya proses jika mengandung 'XXX' (Range baru)
                    if (phoneRaw.includes('XXX')) {
                        const cleanPhone = phoneRaw.trim();
                        const country = countryRaw.includes('•') ? countryRaw.split('•')[1].trim() : countryRaw.trim();
                        const service = serviceRaw.toLowerCase().includes('whatsapp') ? 'whatsapp' : 'facebook';
                        const fullMsg = messageRaw.trim();

                        const cacheKey = `${cleanPhone}_${service}`;

                        // Cek apakah range ini sudah diproses di sesi ini
                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            
                            // Format data sesuai permintaan kamu
                            const dataToSave = {
                                range: cleanPhone,
                                country: country,
                                service: service,
                                full_msg: fullMsg,
                                detected_at: new Date().toLocaleString('id-ID')
                            };

                            // SIMPAN KE FOLDER SEBELAH
                            saveToGetFolder(dataToSave);
                            
                            LAST_PROCESSED_RANGE.add(cacheKey);
                            console.log(`📡 [DETECTED] New Range: ${cleanPhone} | Country: ${country}`);
                        }
                    }
                }

                // Bersihkan memory cache setiap 200 data agar tidak overload
                if (LAST_PROCESSED_RANGE.size > 200) LAST_PROCESSED_RANGE.clear();

            } catch (e) {
                console.error("⚠️ [SCRAPE ERR] Sedang menunggu elemen muncul atau halaman dimuat...");
            }

            // Jeda antar pengecekan
            await new Promise(r => setTimeout(r, CONFIG.CHECK_INTERVAL));
        }

    } catch (fatal) {
        console.error("🔥 [FATAL ERROR] Scraper crash, mencoba restart dalam 10 detik...", fatal.message);
        await browser.close().catch(() => {});
        setTimeout(startScraper, 10000);
    }
}

// Menangani error tak terduga agar PM2 bisa restart dengan benar
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Jalankan program
startScraper();
