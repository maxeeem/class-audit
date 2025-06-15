const axios = require('axios');

exports.handler = async function(event) {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'API key is not set on the server.' }) };
    }

    const openaiHeaders = {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
    };

    const { threadId, runId } = event.queryStringParameters || {};
    if (!threadId || !runId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing threadId or runId.' }) };
    }

    try {
        // 1. Check run status
        const statusRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
            headers: openaiHeaders,
        });
        const runStatus = statusRes.data.status;

        if (runStatus !== 'completed') {
            return {
                statusCode: 200,
                body: JSON.stringify({ status: runStatus }),
            };
        }

        // 2. Get the latest message from the thread
        const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            headers: openaiHeaders,
        });
        const messages = messagesRes.data.data;
        const lastMessage = messages.find(m => m.role === 'assistant');
        const analysis = lastMessage?.content?.map(c => c.text?.value).join('\n') || 'No analysis was returned.';

        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'completed', analysis }),
        };
    } catch (error) {
        console.error('Check Status Function Error:', error?.response?.data || error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error?.response?.data?.error?.message || error.message || 'An internal server error occurred.' }),
        };
    }
};
