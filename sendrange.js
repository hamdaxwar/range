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
const USER_DATA_DIR = './user_session_safe'; 

let LAST_PROCESSED_RANGE = new Set();
let browserContext = null;
let pageInstance = null;
let canStartMonitoring = false;
let lastDataTimestamp = Date.now();

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
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
    } catch (e) {}
}

function parseCookies(cookieString, domain) {
    return cookieString.split(';').map(item => {
        const parts = item.trim().split('=');
        if (parts.length < 2) return null;
        return { name: parts[0], value: parts.slice(1).join('='), domain: domain, path: '/', secure: true, sameSite: 'Lax' };
    }).filter(c => c !== null);
}

// ==================== BOT HANDLERS ====================
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const text = msg.text || "";

    if (text.startsWith('/addcookie')) {
        const cookieRaw = text.replace('/addcookie', '').trim();
        if (!cookieRaw) return sendMsg("⚠️ Masukkan cookie!");

        await sendMsg("♻️ <b>Processing Session...</b>");
        
        try {
            const cookies = parseCookies(cookieRaw, "x.mnitnetwork.com");
            await browserContext.addCookies(cookies);
            
            // Gunakan navigasi yang lebih "halus"
            await pageInstance.goto(CONSOLE_URL, { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
            
            // Jeda acak 5-8 detik untuk simulasi manusia
            await new Promise(r => setTimeout(r, 5000 + Math.random() * 3000));

            const ss = await pageInstance.screenshot();
            const currentUrl = pageInstance.url();

            if (currentUrl.includes('login') || (await pageInstance.content()).includes('Verify you are human')) {
                await sendPhoto("❌ <b>Cloudflare Detected!</b> Coba ambil cookie baru dari Chrome Incognito di HP asli.", ss);
            } else {
                await sendPhoto("✅ <b>Session Sync Berhasil!</b>\nKetik <code>/mulai</code> untuk monitoring.", ss);
            }
        } catch (e) {
            await sendMsg("🔥 Error: " + e.message);
        }
    }

    if (text === '/mulai') {
        canStartMonitoring = true;
        lastDataTimestamp = Date.now();
        await sendMsg("🚀 <b>Monitoring Aktif!</b>");
    }
});

// ==================== CORE ENGINE ====================
async function initBrowser() {
    console.log("🚀 Starting Stealth iPhone Engine...");
    
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: true,
        ...iPhone,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-infobars',
            '--disable-dev-shm-usage'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });
    
    pageInstance = browserContext.pages()[0] || await browserContext.newPage();

    // Bypass navigator.webdriver
    await pageInstance.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await pageInstance.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    const ss = await pageInstance.screenshot();
    await sendPhoto("🤖 <b>Bot Online</b>\nKirim <code>/addcookie</code>", ss);

    while (true) {
        if (canStartMonitoring) {
            try {
                // Gunakan locator yang lebih spesifik untuk row data
                const rows = await pageInstance.locator(".group.flex.flex-col").all();
                for (const row of rows) {
                    const phoneInfo = await row.locator(".text-slate-600").innerText().catch(() => ""); 
                    const serviceRaw = await row.locator(".text-blue-400").innerText().catch(() => "");
                    const messageRaw = await row.locator("p").innerText().catch(() => "");

                    if (serviceRaw.toLowerCase().includes('facebook') || serviceRaw.toLowerCase().includes('whatsapp')) {
                        const range = phoneInfo.split('•')[0].trim() || "Unknown";
                        const country = phoneInfo.split('•')[1]?.trim() || "Unknown";
                        const cacheKey = `${range}_${messageRaw.slice(-10)}`;

                        if (!LAST_PROCESSED_RANGE.has(cacheKey)) {
                            await sendMsg(`Range:${range}\nCountry:${country}\nService:${serviceRaw}\nfull_msg:${messageRaw.trim()}`);
                            LAST_PROCESSED_RANGE.add(cacheKey);
                            lastDataTimestamp = Date.now(); 
                        }
                    }
                }

                if (Date.now() - lastDataTimestamp > 600000) {
                    const ssIdle = await pageInstance.screenshot();
                    await sendPhoto("⚠️ 10 Menit sepi. Masih aman?", ssIdle);
                    lastDataTimestamp = Date.now(); 
                }
                if (LAST_PROCESSED_RANGE.size > 500) LAST_PROCESSED_RANGE.clear();
            } catch (err) {}
        }
        await new Promise(r => setTimeout(r, 4000));
    }
}

initBrowser().catch(err => console.error(err));
