const Markup = require('telegraf/markup');

const tweetMenu = (index, length, actionId) => Markup.inlineKeyboard(
    [
        Markup.callbackButton('←', `previousTweet-${actionId}`, index === 0),
        Markup.callbackButton(`${index + 1}/${length}`, `tweetByIndex-${actionId}`),
        Markup.callbackButton('→', `nextTweet-${actionId}`, index === length - 1),
    ],
    {
        rows: 1,
    },
);

exports.tweetMenu = tweetMenu;