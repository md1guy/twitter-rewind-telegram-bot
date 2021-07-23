if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const readFile = require('util').promisify(require('fs').readFile);
const schedule = require('node-schedule');
const { Telegraf } = require('telegraf');
const Telegram = require('telegraf/telegram');
const Stage = require('telegraf/stage');
const session = require('telegraf/session');
const mongoose = require('mongoose');
const Tweet = require('./models/tweet');
const User = require('./models/user');
const scenes = require('./scenes');
const markup = require('./markup');

const bot = new Telegraf(process.env.BOT_TOKEN);
const telegram = new Telegram(process.env.BOT_TOKEN);
const stage = new Stage();

stage.register(scenes.registerUserWizard, scenes.jumpToTweetWizard);

bot.use(session());
bot.use(stage.middleware());
bot.start(ctx => ctx.reply('Ready for some cringe?'));
bot.launch();

mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true }, () =>
    console.log('mongodb: Connected!'),
);

schedule.scheduleJob('0 8 * * *', async () => {
    try {
        const subscribedUsers = await User.find({ subscribed: true });
        subscribedUsers.forEach(user => {
            rewind(null, user.twitter_username, user.telegram_id);
        });
    } catch (err) {
        console.error(err);
    }

});

bot.command('version', ctx => {
    const revision = require('child_process').execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
    ctx.reply(revision);
});

bot.command('register', async ctx => {
    ctx.scene.enter('REGISTER_USER_SCENE', { deleteUserById: deleteUserById });
});

bot.command('parse', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user ? user.twitter_username : null;

    if (username) {
        await deleteAllTweetsByUsername(username);

        try {
            const rawTweetData = await readFile(`./data/${username}/tweet.js`, 'utf-8');
            const tweets = parseRawTweets(rawTweetData, username);
            ctx.reply('Initiated populating database with your tweets. This process may take a while.');
            tweets.forEach(async (e, i) => {
                await populateDatabase(e);
                if (i === tweets.length - 1) {
                    ctx.reply('Done.');
                }
            });
        } catch (err) {
            console.error(err);
        }
    }
});

bot.command('remove_data', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user ? user.twitter_username : null;

    if (username) {
        await deleteAllTweetsByUsername(username, ctx);
    }
});

bot.command('oldest', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user ? user.twitter_username : null;

    if (username) {
        const tweet = await getOldestTweet(username);
        ctx.reply(`https://twitter.com/${tweet.username}/status/${tweet.id}`);
    }
});

bot.command('rewindall', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user ? user.twitter_username : null;

    if (username) {
        const oldestTweet = await getOldestTweet(username);
        const yearsRange = new Date().getFullYear() - oldestTweet.date.getFullYear();
        const tweets = await collectPastTweets(username, yearsRange);

        try {
            let yearsAgo;

            for (const tweet of tweets) {
                if (tweet.yearsAgo !== yearsAgo) {
                    yearsAgo = tweet.yearsAgo;
                    await ctx.reply(`${yearsAgo} year${yearsAgo > 1 ? 's' : ''} ago:`);
                }

                await ctx.reply(tweet.url);
                await new Promise(r => setTimeout(r, 300));
            }
        } catch (err) {
            console.error(err);
        }
    }
});

bot.command('rewind', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user ? user.twitter_username : null;

    if (username) {
        rewind(ctx, username);
    }
});

bot.command('subscribe', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    await subscribeUser(user);
    ctx.reply('Succesfully subscribed for daily rewinds.');
});

bot.command('unsubscribe', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    await unsubscribeUser(user);
    ctx.reply('Succesfully unsubscribed for daily rewinds.');
});

const rewind = async (ctx, username, chatId) => {
    const oldestTweet = await getOldestTweet(username);
    if (oldestTweet) {
        const yearsRange = new Date().getFullYear() - oldestTweet.date.getFullYear();
        const tweets = await collectPastTweets(username, yearsRange);

        await rewindOne(ctx ? ctx : null, tweets, 0, chatId ? chatId : null);
    }
};

const rewindOne = async (ctx, tweets, index = 0, chatId = null, messageId = null) => {
    const yearsAgo = tweets[index].yearsAgo;
    const messageText = `${yearsAgo} year${yearsAgo > 1 ? 's' : ''} ago: ${'\n\n' + tweets[index].url}`;

    if (!ctx && chatId) {
        const message = await bot.telegram.sendMessage(chatId, messageText);
        chatId = message.chat.id;
        messageId = message.message_id;
    }

    if (!chatId && !messageId) {
        const message = await ctx.reply(messageText);
        chatId = message.chat.id;
        messageId = message.message_id;
    }

    const actionId = chatId + messageId;
    telegram.editMessageText(chatId, messageId, null, messageText, {
        reply_markup: markup.tweetMenu(index, tweets.length, actionId),
    });

    setActions(tweets, index, chatId, messageId);
};

const setActions = (tweets, index, chatId, messageId) => {
    const actionId = chatId + messageId;

    const nextTweetRegex = new RegExp(`(nextTweet)-(${actionId})-([0-9]+)`);
    const previousTweet = new RegExp(`(previousTweet)-(${actionId})-([0-9]+)`);
    const tweetByIndexRegex = new RegExp(`(tweetByIndex)-(${actionId})-([0-9]+)`);

    bot.action(nextTweetRegex, async ctx => {
        index = ctx.match[3];
        if (index < tweets.length - 1) {
            await rewindOne(ctx, tweets, ++index, chatId, messageId);
        }
    });

    bot.action(previousTweet, async ctx => {
        index = ctx.match[3];
        if (index > 0) {
            await rewindOne(ctx, tweets, --index, chatId, messageId);
        }
    });

    bot.action(tweetByIndexRegex, async ctx => {
        ctx.scene.enter('JUMP_TO_TWEET_SCENE', {
            rewindOne: rewindOne,
            tweets: tweets,
            chatId: chatId,
            messageId: messageId,
        });
    });
};

const parseRawTweets = (rawTweetData, username) => {
    const jsonArray = rawTweetData.substring(rawTweetData.indexOf('['));
    const tweets = [];

    JSON.parse(jsonArray).forEach(e => {
        const tweet = {
            id: e.tweet.id,
            username: username,
            date: new Date(e.tweet.created_at),
            text: e.tweet.full_text,
        };
        tweets.push(tweet);
    });

    return tweets;
};

const populateDatabase = async tweetObject => {
    try {
        return await new Tweet({
            id: tweetObject.id,
            username: tweetObject.username,
            text: tweetObject.text,
            date: tweetObject.date,
        }).save();
    } catch (err) {
        console.error(err);
    }
};

const deleteAllTweetsByUsername = async (username, ctx) => {
    try {
        await Tweet.deleteMany({ username: username });
        if (ctx) ctx.reply(`Removed all tweets by @${username}.`);
    } catch (err) {
        console.error(err);
    }
};

const getOldestTweet = async username => {
    try {
        return await Tweet.findOne({ username: username }, {}, { sort: { date: 1 } }).exec();
    } catch (err) {
        console.error(err);
    }
};

const deleteUserById = async id => {
    try {
        await User.deleteOne({ telegram_id: id });
        console.log(`Removed user with id: '${id}'.`);
    } catch (err) {
        console.error(err);
    }
};

const findUserById = async id => {
    try {
        return await User.findOne({ telegram_id: id }).exec();
    } catch (err) {
        console.error(err);
    }
};

const subscribeUser = async user => {
    try {
        user.subscribed = true;
        user.save();
    } catch (err) {
        console.error(err);
    }
};

const unsubscribeUser = async user => {
    try {
        user.subscribed = false;
        user.save();
    } catch (err) {
        console.error(err);
    }
};

const collectPastTweets = async (username, yearsRange) => {
    let yearsAgo = 1;
    let mappedTweets = [];

    while (yearsAgo <= yearsRange) {
        const dateFrom = new Date();
        const dateTo = new Date();
        dateFrom.setFullYear(dateFrom.getFullYear() - yearsAgo);
        dateTo.setFullYear(dateTo.getFullYear() - yearsAgo);
        dateFrom.setHours(0, 0, 0, 0);
        dateTo.setHours(0, 0, 0, 0);
        dateTo.setDate(dateTo.getDate() + 1);

        try {
            const tweets = await Tweet.find({
                username: username,
                date: { $gte: dateFrom, $lt: dateTo },
            })
                .sort({ date: 'asc' })
                .exec();
            tweets.forEach(tweet =>
                mappedTweets.push({
                    text: tweet.text,
                    url: `https://twitter.com/${tweet.username}/status/${tweet.id}`,
                    yearsAgo: yearsAgo,
                }),
            );
        } catch (err) {
            console.error(err);
        }

        yearsAgo++;
    }

    return mappedTweets;
};
