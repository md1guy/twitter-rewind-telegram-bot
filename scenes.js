const WizardScene = require('telegraf/scenes/wizard');
const User = require('./models/user.js');

const registerUserWizard = new WizardScene(
    'REGISTER_USER_SCENE',
    ctx => {
        ctx.reply("Now send me your twitter username (without '@').");
        return ctx.wizard.next();
    },
    async ctx => {
        try {
            await ctx.scene.state.deleteUserById(ctx.update.message.chat.id);
            await new User({
                telegram_id: ctx.update.message.chat.id,
                twitter_username: ctx.message.text,
                subscribed: false,
            }).save();
            ctx.reply('User added.');
            return ctx.scene.leave();
        } catch (err) {
            console.error(err);
        }
    },
);

const jumpToTweetWizard = new WizardScene(
    'JUMP_TO_TWEET_SCENE',
    ctx => {
        ctx.reply('Now send me tweet index to jump to.');
        return ctx.wizard.next();
    },
    async ctx => {
        ctx.session.index = Number(ctx.message.text) - 1;

        if (ctx.session.index > 0 && ctx.session.index <= ctx.scene.state.tweets.length) {
            await ctx.scene.state.rewindOne(ctx, ctx.scene.state.tweets, ctx.session.index, ctx.scene.state.chatId, ctx.scene.state.messageId);
        } else {
            ctx.reply('Invalid index value.');
        }

        return ctx.scene.leave();
    },
);

exports.registerUserWizard = registerUserWizard;
exports.jumpToTweetWizard = jumpToTweetWizard;
