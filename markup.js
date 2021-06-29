const Markup = require('telegraf/markup');

const tweetMenu = (index, length, actionId) =>
    Markup.inlineKeyboard(
        [
            Markup.callbackButton('←', `previousTweet-${actionId}-${index}`, index === 0),
            Markup.callbackButton(`${index + 1}/${length}`, `tweetByIndex-${actionId}-${index}`),
            Markup.callbackButton('→', `nextTweet-${actionId}-${index}`, index === length - 1),
        ],
        {
            rows: 1,
        },
    );

exports.tweetMenu = tweetMenu;
