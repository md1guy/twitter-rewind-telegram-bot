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
        } catch (err) {
            console.error(err);
        }

        return ctx.scene.leave();
    },
);

const jumpToTweetWizard = new WizardScene(
    'JUMP_TO_TWEET_SCENE',
    async ctx => {
        const { message_id } = await ctx.reply('Now send me tweet index to jump to.');
        ctx.scene.state.requestIndexMessageId = message_id;
        return ctx.wizard.next();
    },
    async ctx => {
        ctx.session.index = Number(ctx.message.text) - 1;

        if (ctx.session.index >= 0 && ctx.session.index < ctx.scene.state.tweets.length) {
            try {
                await ctx.scene.state.rewindOne(ctx, ctx.scene.state.tweets, ctx.session.index, ctx.scene.state.chatId, ctx.scene.state.messageId);
                ctx.deleteMessage(ctx.scene.state.requestIndexMessageId);
                ctx.deleteMessage(ctx.message.message_id);
            } catch (err) {
                console.error(err);
            }
        } else {
            ctx.reply('Invalid index value.');
        }

        return ctx.scene.leave();
    },
);

exports.registerUserWizard = registerUserWizard;
exports.jumpToTweetWizard = jumpToTweetWizard;
