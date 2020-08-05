require('dotenv').config();

const fs = require('fs');
const util = require('util');
const { Telegraf } = require('telegraf');
const Telegram = require('telegraf/telegram');
const session = require('telegraf/session');
const Markup = require('telegraf/markup');
const mongoose = require('mongoose');
const Tweet = require('./models/tweet.js');
const User = require('./models/user.js');

const readFile = util.promisify(fs.readFile);

const bot = new Telegraf(process.env.BOT_TOKEN);
const telegram = new Telegram(process.env.BOT_TOKEN);

bot.use(session());
bot.start(ctx => ctx.reply('Ready for some cringe?'));
bot.launch();

mongoose.connect(
    process.env.MONGO_URL,
    { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true },
    () => console.log('mlab: Connected!'),
);

bot.command('register', async ctx => {
    const id = ctx.update.message.chat.id;

    ctx.reply("Now send me your twitter username (without '@').");

    ctx.session.register = true;

    bot.on('text', async ctx => {
        if (ctx.session.register) {
            try {
                await deleteUserById(id);
                await new User({
                    telegram_id: id,
                    twitter_username: ctx.message.text,
                }).save();
                ctx.reply('User added.');
            } catch (err) {
                console.error(err);
            }
            ctx.session.register = false;
        }
    });
});

bot.command('parse', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user.twitter_username;

    if (username) {
        await deleteAllTweetsByUsername(username);

        try {
            const rawTweetData = await readFile(`./data/${username}/tweet.js`, 'utf-8');
            const tweets = parseRawTweets(rawTweetData, username);
            ctx.reply(
                'Initiated populating database with your tweets. This process may take a while.',
            );
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

bot.command('oldest', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user.twitter_username;

    if (username) {
        const tweet = await getOldestTweet(username);
        ctx.reply(`https://twitter.com/${tweet.username}/status/${tweet.id}`);
    }
});

bot.command('rewindall', async ctx => {
    const user = await findUserById(ctx.update.message.chat.id);
    const username = user.twitter_username;

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
    const username = user.twitter_username;

    if (username) {
        const oldestTweet = await getOldestTweet(username);
        const yearsRange = new Date().getFullYear() - oldestTweet.date.getFullYear();
        const tweets = await collectPastTweets(username, yearsRange);

        await rewindOne(ctx, tweets);
    }
});

const rewindOne = async (ctx, tweets, index = 0, chatId = null, messageId = null) => {
    const yearsAgo = tweets[index].yearsAgo;
    const messageText = `${yearsAgo} year${yearsAgo > 1 ? 's' : ''} ago: ${
        '\n\n' + tweets[index].url
    }`;

    if (!chatId && !messageId) {
        const message = await ctx.reply(messageText);
        chatId = message.chat.id;
        messageId = message.message_id;
    }

    const actionId = chatId + messageId;
    telegram.editMessageText(chatId, messageId, null, messageText, {
        reply_markup: tweetMenu(index, tweets.length, actionId),
    });

    setActions(tweets, index, chatId, messageId);
};

const setActions = (tweets, index, chatId, messageId) => {
    const actionId = chatId + messageId;

    bot.action(`nextTweet-${actionId}`, async ctx => {
        if (index < tweets.length - 1) {
            await rewindOne(ctx, tweets, ++index, chatId, messageId);
        }
    });

    bot.action(`previousTweet-${actionId}`, async ctx => {
        if (index > 0) {
            await rewindOne(ctx, tweets, --index, chatId, messageId);
        }
    });

    bot.action(`tweetByIndex-${actionId}`, async ctx => {
        await ctx.reply('Now send me tweet index to jump to.');

        ctx.session.tweetByIndexActionFired = true;

        bot.on('text', async ctx => {
            if (ctx.session.tweetByIndexActionFired) {
                const newIndex = Number(ctx.message.text);

                if (newIndex > 0 && newIndex <= tweets.length) {
                    await rewindOne(ctx, tweets, newIndex - 1);
                    ctx.session.tweetByIndexActionFired = false;
                } else {
                    await ctx.reply('Invalid index value.');
                }
            }
        });
    });
};

const tweetMenu = (index, length, actionId) =>
    Markup.inlineKeyboard(
        [
            Markup.callbackButton('←', `previousTweet-${actionId}`, index === 0),
            Markup.callbackButton(`${index + 1}/${length}`, `tweetByIndex-${actionId}`),
            Markup.callbackButton('→', `nextTweet-${actionId}`, index === length - 1),
        ],
        {
            rows: 1,
        },
    );

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

const deleteAllTweetsByUsername = async username => {
    try {
        await Tweet.deleteMany({ username: username });
        console.log(`Removed all tweets by @${username}.`);
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
