const { chromium } = require('playwright');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// ==================== KONFIGURASI ====================
const TELEGRAM_TOKEN = "8558006836:AAGR3N4DwXYSlpOxjRvjZcPAmC1CUWRJexY";
const CHAT_ID = "7184123643";
const LOGIN_URL = "https://x.mnitnetwork.com/mauth/login";
const CONSOLE_URL = "https://x.mnitnetwork.com/mdashboard/console";
const USER_DATA_DIR = './user_data'; // Folder untuk simpan session browser asli

let LAST_PROCESSED_RANGE = new Set();
let browserContext = null;
let pageInstance = null;
let canStartMonitoring = false;
let lastDataTimestamp = Date.now();

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==================== UTILITY ====================
async function sendMsg(text) {
    try { await bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' }); } catch (e) {}
}

async function sendPhoto(caption, buffer) {
    try {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('photo', buffer, { filename: 'screenshot.png' });
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
    } catch (e) { console.error("Gagal kirim foto:", e.message); }
}

function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const parts = item.trim().split('=');
        return { name: parts[0], value: parts.slice(1).join('='), domain: domain, path: '/', secure: true };
    }).filter(c => c.name);
}

// ==================== BOT HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text || "";

    if (text.startsWith('/addcookie')) {
        const cookieRaw = text.replace('/addcookie', '').trim();
        if (!cookieRaw) return sendMsg("Format salah. Gunakan: <code>/addcookie mauthtoken=xxx;...</code>");

        await sendMsg("♻️ <b>Sedang menyuntikkan cookie...</b>");
        const cookies = parseCookies(cookieRaw, "x.mnitnetwork.com");
        await browserContext.addCookies(cookies);
        
        // Pergi ke console
        await pageInstance.goto(CONSOLE_URL, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 7000));

        const ss = await pageInstance.screenshot();
        if (pageInstance.url().includes('login')) {
            await sendPhoto("❌ <b>Masih di halaman Login!</b> Mungkin kena Captcha atau Cookie salah. Cek layar browser!", ss);
        } else {
            await sendPhoto("✅ <b>Sudah di Dashboard!</b>\nSilahkan ketik <code>/mulai</code>", ss);
        }
    }

    if (text === '/mulai') {
        if (pageInstance.url().includes('login')) return sendMsg("❌ Browser masih di halaman login/captcha!");
        canStartMonitoring = true;
        lastDataTimestamp = Date.now();
        await sendMsg("🚀 <b>Monitoring Aktif!</b> Mengecek setiap 4 detik.");
    }
});

// ==================== CORE ENGINE ====================
async function initBrowser() {
    console.log("🚀 Menjalankan Browser dalam mode GUI...");
    
    // Menggunakan Persistent Context agar session tersimpan seperti browser asli
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false, // Browser akan muncul di layar
        args: [
            '--disable-blink-features=AutomationControlled', // Sembunyikan identitas bot
            '--no-sandbox'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    
    // Ambil tab pertama yang otomatis terbuka
    pageInstance = browserContext.pages()[0] || await browserContext.newPage();

    // Langsung ke login page
    await pageInstance.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    
    const ss = await pageInstance.screenshot();
    await sendPhoto("🤖 <b>Bot Siap!</b>\n\nJika di layar muncul Captcha, silahkan <b>klik manual</b> di PC.\nSetelah aman, kirim cookie via <code>/addcookie</code>", ss);

    // Monitoring Loop
    while (true) {
        if (canStartMonitoring) {
            try {
                // Seleksi row sesuai struktur yang kamu berikan
                const rows = await pageInstance.locator(".group.flex.flex-col.sm\\:flex-row").all();

                for (const row of rows) {
                    const phoneInfo = await row.locator(".text-slate-600.font-mono").innerText().catch(() => ""); 
                    const serviceRaw = await row.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await row.locator("p.font-mono").innerText().catch(() => "");

                    const serviceLower = serviceRaw.toLowerCase();
                    if (serviceLower.includes('facebook') || serviceLower.includes('whatsapp')) {
                        const splitInfo = phoneInfo.split('•').map(s => s.trim());
                        const range = splitInfo[0] || "Unknown";
                        const country = splitInfo[1] || "Unknown";
                        
                        const cacheKey = `${range}_${messageRaw.slice(-15)}`;

                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            const cleanMsg = messageRaw.replace('➜', '').trim();
                            const report = `Range:${range}\nCountry:${country}\nService:${serviceRaw}\nfull_msg:${cleanMsg}`;
                            
                            await sendMsg(report);
                            LAST_PROCESSED_RANGE.add(cacheKey);
                            lastDataTimestamp = Date.now(); 
                        }
                    }
                }

                // Jika 10 menit tidak ada update data
                if (Date.now() - lastDataTimestamp > 600000) {
                    const ssIdle = await pageInstance.screenshot();
                    await sendPhoto("⚠️ <b>Info:</b> Tidak ada data masuk 10 menit. Cek screenshot berikut.", ssIdle);
                    lastDataTimestamp = Date.now(); 
                }

                if (LAST_PROCESSED_RANGE.size > 500) LAST_PROCESSED_RANGE.clear();
            } catch (err) {
                console.error("Monitoring Error:", err.message);
            }
        }
        await new Promise(r => setTimeout(r, 4000)); // Cek tiap 4 detik
    }
}

// Start bot
initBrowser().catch(err => console.error("Fatal Error:", err));
