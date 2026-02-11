require('dotenv').config();
const { chromium } = require('playwright');
const axios = require('axios');
const { performLogin } = require('./login');

// ==================== KONFIGURASI ====================
const CONFIG = {
    EMAIL: process.env.MNIT_EMAIL,
    PASSWORD: process.env.MNIT_PASSWORD,
    LOGIN_URL: "https://x.mnitnetwork.com/mauth/login",
    CONSOLE_URL: "https://x.mnitnetwork.com/mdashboard/console",
    RECEIVER_URL: "http://127.0.0.1:3000/receive-range", // Endpoint folder /get
    CHECK_INTERVAL: 5000, // Cek setiap 10 detik
    RELOAD_INTERVAL: 10 * 60 * 1000 // Refresh halaman tiap 10 menit agar session segar
};

// Cache sederhana untuk menghindari pengiriman data ganda dalam satu sesi
let LAST_SENT_PHONE = new Set();

async function startScraper() {
    console.log("🚀 [SCRAPER] Memulai Chromium...");
    const browser = await chromium.launch({ 
        headless: true, // Ubah ke false jika ingin melihat prosesnya di VPS/Desktop
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
        // 1. Jalankan proses login dari modul login.js
        await performLogin(page, CONFIG.EMAIL, CONFIG.PASSWORD, CONFIG.LOGIN_URL);

        console.log("🔍 [SCRAPER] Memulai pemantauan live range...");

        // Setup auto-reload halaman secara berkala agar tidak logout/idle
        setInterval(async () => {
            console.log("🔄 [SCRAPER] Refreshing page to keep session alive...");
            await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        }, CONFIG.RELOAD_INTERVAL);

        // 2. Looping Pemantauan
        while (true) {
            try {
                // Selector berdasarkan pola dashboard yang kamu gunakan
                const rowSelector = ".group.flex.flex-col.sm\\:flex-row"; 
                const elements = await page.locator(rowSelector).all();

                for (const el of elements) {
                    // Ambil data dari elemen (Sesuaikan selector jika MNIT berbeda dengan Stex)
                    const phoneRaw = await el.locator(".font-mono").first().innerText().catch(() => "");
                    const countryRaw = await el.locator(".text-slate-600").innerText().catch(() => "");
                    const serviceRaw = await el.locator(".text-blue-400").innerText().catch(() => "");
                    const message = await el.locator("p").innerText().catch(() => "");

                    // Filter hanya nomor yang mengandung 'XXX' (Range baru)
                    if (phoneRaw.includes('XXX')) {
                        const cleanPhone = phoneRaw.trim();
                        const country = countryRaw.includes('•') ? countryRaw.split('•')[1].trim() : countryRaw.trim();
                        const service = serviceRaw.toLowerCase().includes('whatsapp') ? 'whatsapp' : 'facebook';

                        const cacheKey = `${cleanPhone}_${service}`;

                        if (!LAST_SENT_PHONE.has(cacheKey)) {
                            console.log(`📡 [SEND] Mengirim range: ${cleanPhone} (${country})`);
                            
                            // SETOR DATA KE BOT UTAMA (Folder /get/range.js)
                            await axios.post(CONFIG.RECEIVER_URL, {
                                phone: cleanPhone,
                                country: country,
                                service: service,
                                message: message.trim()
                            }).then(() => {
                                LAST_SENT_PHONE.add(cacheKey);
                            }).catch((err) => {
                                console.error("⚠️ [ERROR] Bot utama (folder /get) tidak merespon.");
                            });
                        }
                    }
                }

                // Bersihkan cache jika sudah terlalu banyak (setiap 100 data)
                if (LAST_SENT_PHONE.size > 100) LAST_SENT_PHONE.clear();

            } catch (e) {
                console.error("❌ [LOOP ERR] Terjadi kesalahan saat scraping:", e.message);
            }

            // Tunggu sebelum cek lagi
            await new Promise(r => setTimeout(r, CONFIG.CHECK_INTERVAL));
        }

    } catch (fatal) {
        console.error("🔥 [FATAL] Scraper berhenti:", fatal.message);
        await browser.close();
        // Restart otomatis jika crash
        setTimeout(startScraper, 5000);
    }
}

// Jalankan Scraper
startScraper();
