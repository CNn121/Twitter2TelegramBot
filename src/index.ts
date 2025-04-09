async function main() {
    const startTime = new Date().toISOString();

    const userIdMap: Record<string, string> = {};
    const lastTweetIds: Record<string, string | null> = {};

    // Resolve user IDs for each username
    for (const username of USERS_TO_MONITOR) {
        try {
            const user = await client.users.findUserByUsername(username, { 'user.fields': ['id'] });
            if (!user.data) {
                logWithEmoji(`❌ User not found: ${username}`, "⚠️");
                continue;
            }

            userIdMap[username] = user.data.id;
            logWithEmoji(`Fetched ID for @${username}: ${user.data.id}`, "🆔");

            const lastTweetResponse = await client.tweets.usersIdTweets(user.data.id, { max_results: 5 });
            if (lastTweetResponse.data && lastTweetResponse.data.length > 0) {
                lastTweetIds[username] = lastTweetResponse.data[0].id;
                logWithEmoji(`Initialized last tweet ID for @${username}`, "🔍");
            } else {
                lastTweetIds[username] = null;
                logWithEmoji(`No initial tweet found for @${username}`, "⚠️");
            }

        } catch (e) {
            logger.error(`Error resolving @${username}: ${e}`);
        }
    }

    // Send a startup notification
    await sendTestMessage();

    // Start loop
    while (true) {
        for (const username of USERS_TO_MONITOR) {
            const userId = userIdMap[username];
            const lastTweetId = lastTweetIds[username];

            if (!userId) continue;

            const newLastTweetId = await checkTweets(username, userId, lastTweetId, startTime);
            lastTweetIds[username] = newLastTweetId;
        }

        logWithEmoji("Waiting for next fetch cycle", "⏳");

        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progressBar.start(100, 0);

        const sleepDuration = 120000; // 2 minutes
        const updateInterval = sleepDuration / 100;

        for (let i = 0; i <= 100; i++) {
            await setTimeout(updateInterval);
            progressBar.update(i);
        }

        progressBar.stop();
    }
}
