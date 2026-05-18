import { Telegraf } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

bot.start((ctx) => ctx.reply('Welcome! Send me a text or voice message to add a task to the dashboard.'));

bot.on('text', async (ctx) => {
    const taskTitle = ctx.message.text;
    const telegramUserId = ctx.from.id;

    try {
        const { error } = await supabase
            .from('tasks')
            .insert([{ telegram_user_id: telegramUserId, title: taskTitle, status: 'Pending' }]);

        if (error) throw error;
        await ctx.reply('✅ Task successfully added to the dashboard!');
    } catch (err) {
        console.error(err);
        await ctx.reply('❌ Error saving text task.');
    }
});

bot.on('voice', async (ctx) => {
    const fileId = ctx.message.voice.file_id;
    const telegramUserId = ctx.from.id;

    try {
        const processingMessage = await ctx.reply('🎙 Voice message received. Processing text...');
        const fileLink = await ctx.telegram.getFileLink(fileId);

        const fileResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(fileResponse.data);

        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
        formData.append('file', blob, 'voice.ogg');
        formData.append('model', 'whisper-large-v3');

        const groqResponse = await axios.post(
            'https://api.groq.com/openai/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'multipart/form-data',
                },
            }
        );

        const transcribedText = groqResponse.data.text;

        if (!transcribedText || transcribedText.trim() === '') {
            throw new Error('Transcription result is empty');
        }

        const { error } = await supabase
            .from('tasks')
            .insert([{ telegram_user_id: telegramUserId, title: transcribedText, status: 'Pending' }]);

        if (error) throw error;

        await bot.telegram.editMessageText(
            ctx.chat.id,
            processingMessage.message_id,
            null,
            `✅ Voice task added successfully!\n\n"${transcribedText}"`
        );

    } catch (err) {
        console.error(err);
        await ctx.reply('❌ Failed to process voice message. Please try again.');
    }
});

export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
        } catch (err) {
            console.error(err);
            res.status(500).send('Internal Server Error');
        }
    } else {
        res.status(200).send('Bot is running...');
    }
}

if (process.env.NODE_ENV !== 'production') {
    bot.launch().then(() => console.log('🤖 Bot successfully launched locally...'));
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));