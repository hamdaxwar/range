const { chromium, devices } = require('playwright');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// ==================== KONFIGURASI ====================
const TELEGRAM_TOKEN = "8558006836:AAGR3N4DwXYSlpOxjRvjZcPAmC1CUWRJexY";
const CHAT_ID = "7184123643";
const LOGIN_URL = "https://x.mnitnetwork.com/mauth/login";
const CONSOLE_URL = "https://x.mnitnetwork.com/mdashboard/console";
const USER_DATA_DIR = './user_data_iphone'; 

let LAST_PROCESSED_RANGE = new Set();
let browserContext = null;
let pageInstance = null;
let canStartMonitoring = false;
let lastDataTimestamp = Date.now();

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Emulator iPhone 13
const iPhone = devices['iPhone 13'];

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
        if (!cookieRaw) return sendMsg("Format salah.");

        await sendMsg("♻️ <b>Injecting iPhone Cookie...</b>");
        const cookies = parseCookies(cookieRaw, "x.mnitnetwork.com");
        await browserContext.addCookies(cookies);
        
        await pageInstance.goto(CONSOLE_URL, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 10000));

        const ss = await pageInstance.screenshot();
        if (pageInstance.url().includes('login')) {
            await sendPhoto("❌ <b>Gagal!</b> Masih tertahan di login/captcha. Cek screenshot iPhone mode.", ss);
        } else {
            await sendPhoto("✅ <b>Login Berhasil (iPhone Mode)!</b>\nKetik <code>/mulai</code>", ss);
        }
    }

    if (text === '/mulai') {
        canStartMonitoring = true;
        lastDataTimestamp = Date.now();
        await sendMsg("🚀 <b>Monitoring iPhone Mode Aktif!</b>");
    }
});

// ==================== CORE ENGINE ====================
async function initBrowser() {
    console.log("🚀 Menjalankan Headless iPhone Emulator...");
    
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: true, // Tanpa layar (aman untuk VPS)
        ...iPhone,      // Menggunakan spek layar dan user agent iPhone 13
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    
    pageInstance = browserContext.pages()[0] || await browserContext.newPage();

    await pageInstance.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 5000));

    const ss = await pageInstance.screenshot();
    await sendPhoto("🤖 <b>Bot Headless iPhone Aktif!</b>\nKirim cookie via <code>/addcookie</code>", ss);

    // Monitoring Loop
    while (true) {
        if (canStartMonitoring) {
            try {
                // Selector tetap disesuaikan dengan struktur web dashboard MNIT
                const rows = await pageInstance.locator(".group.flex.flex-col").all();

                for (const row of rows) {
                    const phoneInfo = await row.locator(".text-slate-600").innerText().catch(() => ""); 
                    const serviceRaw = await row.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await row.locator("p").innerText().catch(() => "");

                    if (serviceRaw.toLowerCase().includes('facebook') || serviceRaw.toLowerCase().includes('whatsapp')) {
                        const splitInfo = phoneInfo.split('•').map(s => s.trim());
                        const range = splitInfo[0] || "Unknown";
                        const country = splitInfo[1] || "Unknown";
                        const cacheKey = `${range}_${messageRaw.slice(-15)}`;

                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            await sendMsg(`Range:${range}\nCountry:${country}\nService:${serviceRaw}\nfull_msg:${messageRaw.replace('➜', '').trim()}`);
                            LAST_PROCESSED_RANGE.add(cacheKey);
                            lastDataTimestamp = Date.now(); 
                        }
                    }
                }

                if (Date.now() - lastDataTimestamp > 600000) {
                    const ssIdle = await pageInstance.screenshot();
                    await sendPhoto("⚠️ 10 Menit tanpa data baru (iPhone Mode).", ssIdle);
                    lastDataTimestamp = Date.now(); 
                }

                if (LAST_PROCESSED_RANGE.size > 500) LAST_PROCESSED_RANGE.clear();
            } catch (err) { }
        }
        await new Promise(r => setTimeout(r, 4000));
    }
}

initBrowser().catch(err => console.error(err));
