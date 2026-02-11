const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');

// ==================== KONFIGURASI ====================
const CACHE_FILE_PATH = path.join(__dirname, '../get/cache_range.json');
const TELEGRAM_TOKEN = "8558006836:AAGR3N4DwXYSlpOxjRvjZcPAmC1CUWRJexY";
const CHAT_ID = "7184123643";
const COOKIE_FILE = path.join(__dirname, 'active_session.json');

const URLS = {
    console: "https://x.mnitnetwork.com/mdashboard/console"
};

let isMonitoring = false;
let browserInstance = null;
let lastProcessedKey = new Set();

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== UTILS ====================

async function sendMsg(text) {
    try {
        await bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' });
    } catch (e) { console.error("Error Tele:", e.message); }
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
        fs.unlinkSync(photoPath); // Hapus setelah kirim
    } catch (e) { console.error("Error Photo:", e.message); }
}

function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const [name, ...rest] = item.trim().split('=');
        return { name, value: rest.join('='), domain, path: '/', httpOnly: false, secure: true };
    });
}

function saveCache(data) {
    let current = [];
    if (fs.existsSync(CACHE_FILE_PATH)) {
        try { current = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8')); } catch (e) { current = []; }
    }
    current.unshift(data);
    if (current.length > 100) current = current.slice(0, 100);
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(current, null, 2));
}

// ==================== BOT COMMANDS ====================

bot.onText(/\/addcookie (.+)/, async (msg, match) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const newCookie = match[1];
    fs.writeFileSync(COOKIE_FILE, newCookie.trim(), 'utf-8');
    await sendMsg("♻️ <b>Cookie Diperbarui!</b> Merestart scraper...");
    startScraper();
});

// ==================== CORE SCRAPER ====================

async function startScraper() {
    if (isMonitoring && browserInstance) {
        await browserInstance.close().catch(() => {});
    }

    if (!fs.existsSync(COOKIE_FILE)) {
        await sendMsg("⚠️ <b>Cookie tidak ditemukan!</b>\nGunakan perintah: <code>/addcookie [cookie_anda]</code>");
        return;
    }

    isMonitoring = true;
    const browser = await chromium.launch({ headless: true });
    browserInstance = browser;
    const context = await browser.newContext();

    try {
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8');
        await context.addCookies(parseCookies(rawCookie, "x.mnitnetwork.com"));

        const page = await context.newPage();
        await page.goto(URLS.console, { waitUntil: 'networkidle' });

        // Cek Login Success/Fail
        const currentUrl = page.url();
        const ssPath = `check_${Date.now()}.png`;
        await page.screenshot({ path: ssPath });

        if (currentUrl.includes('/login')) {
            await sendPhoto("❌ <b>Login Gagal!</b> Cookie expired atau salah. Masukkan cookie baru lewat <code>/addcookie</code>", ssPath);
            await browser.close();
            isMonitoring = false;
            return;
        }

        await sendPhoto("✅ <b>Login Berhasil!</b> Monitoring berjalan setiap 4 detik.", ssPath);

        // LOOP MONITORING DOM
        while (isMonitoring) {
            const rowSelector = "div.group.flex.flex-col";
            const rows = await page.$$(rowSelector);

            for (const row of rows) {
                try {
                    // Ambil Service
                    const service = await row.$eval(".text-blue-400", el => el.innerText).catch(() => "");
                    const serviceLow = service.toLowerCase();

                    // Filter Hanya WhatsApp & Facebook
                    if (serviceLow.includes("whatsapp") || serviceLow.includes("facebook")) {
                        
                        // Ambil Range & Country dari text (Contoh: 23278967XXX • Sierra Leone)
                        const rawInfo = await row.$eval(".text-slate-600.mt-1.font-mono", el => el.innerText).catch(() => "");
                        const [range, country] = rawInfo.split(' • ').map(s => s.trim());

                        // Ambil Full Message
                        const fullMsg = await row.$eval("p", el => el.innerText.replace('➜', '').trim()).catch(() => "");

                        // Unik Key untuk mencegah duplikat (Range + Message)
                        const uniqueKey = `${range}_${fullMsg.substring(0, 15)}`;

                        if (!lastProcessedKey.has(uniqueKey)) {
                            const data = {
                                range: range,
                                country: country || "Unknown",
                                service: service,
                                full_msg: fullMsg
                            };

                            saveCache(data);
                            lastProcessedKey.add(uniqueKey);

                            await sendMsg(`✨ <b>LOG TERDETEKSI</b>\n\n<b>Range:</b> <code>${data.range}</code>\n<b>Country:</b> ${data.country}\n<b>Service:</b> ${data.service}\n<b>Full Msg:</b> <code>${data.full_msg}</code>`);
                        }
                    }
                } catch (err) { /* Skip row if error */ }
            }

            // Batasi memory Set
            if (lastProcessedKey.size > 200) lastProcessedKey.clear();

            await new Promise(r => setTimeout(r, 4000));
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        }

    } catch (e) {
        console.error("Scraper Error:", e.message);
        isMonitoring = false;
        await browser.close().catch(() => {});
        setTimeout(startScraper, 10000); // Auto-restart jika crash
    }
}

// ==================== INIT ====================
(async () => {
    console.log("🚀 Bot is running...");
    startScraper();
})();
