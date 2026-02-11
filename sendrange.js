const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8244546257:AAGu3vwXPZbfcJznfW9WwhHOkdumyKM079g";
const CHAT_ID = "7184123643";
// Folder untuk menyimpan session/cookies agar tidak dianggap bot baru terus
const USER_DATA_DIR = path.join(__dirname, 'session_data');

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
    } catch (e) { console.error("❌ Telegram Error"); }
}

async function sendTelegramMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID, text: text, parse_mode: 'HTML'
        });
    } catch (e) {}
}

// ==================== MAIN SCRAPER ====================
async function startScraper() {
    console.log("🚀 [SCRAPER] Memulai Browser dengan Persistent Context...");
    
    // Menggunakan launchPersistentContext agar cookie tersimpan
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await context.newPage();

    try {
        await sendTelegramMsg("<b>[SYSTEM]</b> Mencoba login menggunakan Persistent Session...");

        await page.goto(URLS.login, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 12000)); 

        // Cek apakah sudah login otomatis dari session sebelumnya
        if (page.url().includes('dashboard')) {
            await sendTelegramMsg("✅ Session ditemukan, melewati halaman login...");
        } else {
            const emailInput = page.locator("input[type='email']");
            if (await emailInput.isVisible()) {
                // Human typing dengan delay lebih lama dan acak
                await emailInput.click();
                for (const char of CREDENTIALS.email) {
                    await page.keyboard.type(char, { delay: Math.random() * 300 + 100 });
                }
                
                await new Promise(r => setTimeout(r, 2000));
                
                await page.locator("input[type='password']").click();
                for (const char of CREDENTIALS.pw) {
                    await page.keyboard.type(char, { delay: Math.random() * 250 + 100 });
                }

                await new Promise(r => setTimeout(r, 3000));
                
                // Klik tombol Sign In menggunakan koordinat acak
                const loginBtn = page.locator("button[type='submit']");
                await loginBtn.click({ delay: Math.random() * 500 + 200 });
                
                await new Promise(r => setTimeout(r, 15000));
            }
        }

        // Cek hasil akhir login
        await page.screenshot({ path: 'final_check.png' });
        await sendTelegramPhoto("📸 Status Login Terakhir", 'final_check.png');

        if (page.url().includes('login')) {
            throw new Error("Masih terdeteksi bot/Salah password.");
        }

        // Lanjut ke Monitoring...
        await page.goto(URLS.console, { waitUntil: 'networkidle' });
        // ... (sisanya sama dengan script sebelumnya)

    } catch (fatal) {
        console.error("🔥 Error:", fatal.message);
        await sendTelegramMsg(`🔥 <b>ERROR:</b> ${fatal.message}`);
        await context.close();
        setTimeout(startScraper, 30000);
    }
}

startScraper();
