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
    console: "https://x.mnitnetwork.com/mdashboard/console",
    api_info: "https://x.mnitnetwork.com/mapi/v1/mdashboard/console/info"
};

// Set untuk menyimpan ID log yang sudah diproses agar tidak duplikat
let PROCESSED_IDS = new Set();
let isBrowserRunning = false;
let browserInstance = null;

// ==================== INIT TELEGRAM BOT ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: {
        interval: 2000,
        autoStart: true,
        params: { timeout: 10 }
    } 
});

// ==================== TELEGRAM FUNCTIONS ====================
async function sendMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("❌ Gagal kirim pesan Telegram:", e.message);
    }
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
    } catch (e) {
        console.error("❌ Gagal kirim foto:", e.message);
    }
}

// ==================== PESAN AWAL BOT ====================
async function notifyBotStart() {
    const msg = `
🤖 <b>BOT API MONITOR AKTIF</b>

Metode: Direct API Fetch (AJAX)
Target: WhatsApp & Facebook
Interval: 4 Detik

Silahkan kirim COOKIE disini untuk login.
`;
    await sendMsg(msg);
}

// ==================== PARSE COOKIE STRING ====================
function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const [name, ...rest] = item.trim().split('=');
        return {
            name: name,
            value: rest.join('='),
            domain: domain,
            path: '/',
            httpOnly: false,
            secure: true
        };
    });
}

// ==================== LISTENER COOKIE TELEGRAM ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;

    const text = msg.text;
    if (!text) return;

    if (text.includes('=') && text.includes(';')) {
        fs.writeFileSync(COOKIE_FILE, text.trim(), 'utf-8');
        await sendMsg("✅ <b>Cookie diterima!</b>\n📁 File diperbarui\n🚀 Login API dimulai...");

        if (browserInstance) {
            try { await browserInstance.close(); } catch {}
            isBrowserRunning = false;
        }
        startScraper();
    }
});

// ==================== CACHE SAVE ====================
function saveToGetFolder(newData) {
    const folderPath = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    let currentCache = [];
    if (fs.existsSync(CACHE_FILE_PATH)) {
        try {
            currentCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
        } catch (e) {
            currentCache = [];
        }
    }

    // Masukkan data baru di paling atas (unshift)
    currentCache.unshift(newData);
    
    // Batasi cache max 100 item agar file tidak terlalu besar
    if (currentCache.length > 100) currentCache = currentCache.slice(0, 100);

    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(currentCache, null, 2));
}

// ==================== MAIN LOGIC ====================
async function startScraper() {
    if (!fs.existsSync(COOKIE_FILE)) {
        console.log("⏳ Menunggu cookie...");
        return;
    }

    isBrowserRunning = true;

    // Launch browser (Headless)
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    browserInstance = browser;

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    try {
        const rawCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
        const cookies = parseCookies(rawCookie, "x.mnitnetwork.com");
        await context.addCookies(cookies);

        const page = await context.newPage();
        
        // 1. Buka halaman console dulu untuk memastikan session valid
        console.log("🔄 Melakukan initial login check...");
        await page.goto(URLS.console, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await new Promise(r => setTimeout(r, 5000)); // Tunggu render sebentar

        // Cek apakah terlempar ke login page
        if (page.url().includes('login')) {
            await sendMsg("❌ <b>Login Gagal!</b>\nCookie expired. Silakan kirim cookie baru.");
            await browser.close();
            return;
        }

        await sendMsg("✅ <b>Login Berhasil!</b>\n🔄 Memulai loop API (4s delay)...");

        // 2. Loop Fetch API (AJAX Style)
        while (isBrowserRunning) {
            try {
                // Tembak API menggunakan request context browser (otomatis bawa cookie)
                const apiResponse = await context.request.get(URLS.api_info);
                
                if (!apiResponse.ok()) {
                    console.log(`⚠️ API Error: ${apiResponse.status()}`);
                    // Jika 401 Unauthorized, break loop
                    if (apiResponse.status() === 401) throw new Error("Unauthorized (Cookie Expired)");
                } else {
                    const json = await apiResponse.json();
                    
                    // Pastikan struktur JSON ada
                    if (json && json.data && Array.isArray(json.data.logs)) {
                        processLogs(json.data.logs);
                    }
                }

            } catch (innerErr) {
                console.error("⚠️ Error saat fetch API:", innerErr.message);
                if (innerErr.message.includes("Unauthorized")) {
                    await sendMsg("⚠️ <b>Sesi Berakhir</b>\nSilakan kirim cookie baru.");
                    break; 
                }
            }

            // Delay 4 detik sebelum request berikutnya
            await new Promise(r => setTimeout(r, 4000));
        }

    } catch (err) {
        console.error("🔥 Critical Error:", err);
        await sendMsg(`🔥 <b>System Crash:</b>\n${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

// ==================== PROCESS LOGS ====================
async function processLogs(logs) {
    // Balik urutan agar yang terlama diproses dulu (opsional, tergantung preferensi)
    // Tapi karena kita prepend ke file, biarkan default urutan API (biasanya terbaru di atas)
    
    let newItemCount = 0;

    for (const log of logs) {
        // 1. Cek Duplikasi ID
        if (PROCESSED_IDS.has(log.id)) continue;

        // 2. Ambil field yang dibutuhkan
        const appNameRaw = log.app_name || "";
        const appNameLower = appNameRaw.toLowerCase();

        // 3. Filter hanya WhatsApp atau Facebook
        if (appNameLower.includes("whatsapp") || appNameLower.includes("facebook")) {
            
            // Format Data Output
            const outputData = {
                range: log.range,         // dari JSON
                country: log.country,     // dari JSON
                app_name: appNameRaw,     // dari JSON (Original Case)
                sms: log.sms              // dari JSON
            };

            // Simpan ke Cache File
            saveToGetFolder(outputData);
            
            // Notifikasi Telegram
            const msg = `
✨ <b>NEW LOG DETECTED</b>

📱 <b>App:</b> ${outputData.app_name}
🌍 <b>Country:</b> ${outputData.country}
🔢 <b>Range:</b> <code>${outputData.range}</code>
💬 <b>SMS:</b> ${outputData.sms.substring(0, 50)}...
`;
            // Kirim notif (tanpa await agar tidak memblokir loop terlalu lama)
            sendMsg(msg);
            
            newItemCount++;
        }

        // Tandai ID ini sudah diproses
        PROCESSED_IDS.add(log.id);
    }

    // Bersihkan memori Set jika sudah terlalu banyak
    if (PROCESSED_IDS.size > 2000) {
        PROCESSED_IDS = new Set(Array.from(PROCESSED_IDS).slice(-500));
    }

    if (newItemCount > 0) {
        console.log(`✅ ${newItemCount} item baru disimpan.`);
    }
}

// ==================== START BOT ====================
(async () => {
    console.log("🤖 Bot Started...");
    await notifyBotStart();
    startScraper();
})();
