import { config } from 'dotenv';
import { Client } from 'twitter-api-sdk';
import { Telegraf } from 'telegraf';
import { Logger } from 'tslog';
import { setTimeout } from 'timers/promises';
import cliProgress from 'cli-progress';

config();

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN as string;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID as string;
const USERS_TO_MONITOR = process.env.USER_TO_MONITOR?.split(',').map(u => u.trim()) || [];

if (!TWITTER_BEARER_TOKEN || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || USERS_TO_MONITOR.length === 0) {
    throw new Error("Missing environment variables. Check .env or Render settings.");
}

const logger = new Logger({ name: "Twitter2TelegramBot" });

function logWithEmoji(message: string, emoji: string) {
    logger.info(`${emoji} ${message}`);
}

let client: Client;
try {
    client = new Client(TWITTER_BEARER_TOKEN);
    logWithEmoji("Connected to Twitter API", "🐦");
} catch (e) {
    logger.error("❌ Failed to connect to Twitter API:", e);
}

let bot: Telegraf;
try {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    logWithEmoji("Connected to Telegram", "🤖");
} catch (e) {
    logger.error("❌ Failed to connect to Telegram Bot:", e);
}

async function sendTelegramMessage(message: string) {
    const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',').map(id => id.trim()) || [];

    for (const chatId of chatIds) {
        try {
            await bot.telegram.sendMessage(chatId, message);
            logWithEmoji(`Message sent to Telegram chat ${chatId}`, "📩");
        } catch (e) {
            logger.error(`❌ Error sending message to ${chatId}:`, e);
        }
    }
}

async function checkTweets(username: string, userId: string, lastTweetId: string | null, startTime: string) {
    try {
        const response = await client.tweets.usersIdTweets(userId, {
            since_id: lastTweetId || undefined,
            max_results: 5,
            'tweet.fields': ['id', 'text', 'author_id', 'created_at'],
            start_time: startTime,
        });

        if (response.data && response.data.length > 0) {
            for (const tweet of response.data.reverse()) {
                const message = `🕊 New tweet from @${username}:\n\n${tweet.text}\nhttps://x.com/${username}/status/${tweet.id}`;
                await sendTelegramMessage(message);
                lastTweetId = tweet.id;
            }
            logWithEmoji(`✅ Tweets sent for @${username}`, "✅");
        } else {
            logWithEmoji(`No new tweets for @${username}`, "❌");
        }

        return lastTweetId;
    } catch (e) {
        if ((e as any).code === 429) {
            logWithEmoji("⚠️ Rate limit hit. Sleeping 15 min...", "⏳");
            await setTimeout(900000);
        } else {
            logger.error(`❌ Error fetching tweets for @${username}:`, e);
        }
    }

    return lastTweetId;
}

async function main() {
    const startTime = new Date().toISOString();
    const userIdMap: Record<string, string> = {};
    const lastTweetIds: Record<string, string | null> = {};

    // Get user IDs and latest tweet
    for (const username of USERS_TO_MONITOR) {
        try {
            const user = await client.users.findUserByUsername(username, { 'user.fields': ['id'] });
            if (!user.data) throw new Error("User not found");

            userIdMap[username] = user.data.id;
            logWithEmoji(`Fetched ID for @${username}`, "🆔");

            const tweets = await client.tweets.usersIdTweets(user.data.id, { max_results: 1 });
            lastTweetIds[username] = tweets?.data?.[0]?.id ?? null;
        } catch (e) {
            logger.error(`❌ Could not init @${username}:`, e);
        }
    }

    await sendTelegramMessage("🚀 Twitter2Telegram Bot started");

    while (true) {
        for (const username of USERS_TO_MONITOR) {
            const userId = userIdMap[username];
            const lastId = lastTweetIds[username];

            if (!userId) continue;

            const updatedId = await checkTweets(username, userId, lastId, startTime);
            lastTweetIds[username] = updatedId;
        }

        logWithEmoji("Sleeping until next cycle...", "🕰️");

        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progressBar.start(100, 0);
        const sleep = 120000; // 2 min
        const interval = sleep / 100;

        for (let i = 0; i <= 100; i++) {
            await setTimeout(interval);
            progressBar.update(i);
        }
        progressBar.stop();
    }
}

main().catch(e => logger.error(e));
