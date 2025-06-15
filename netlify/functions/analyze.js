const { OpenAI } = require('openai');
const Busboy = require('busboy');
const { Readable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');

// Helper function to parse the multipart/form-data from the browser
function parseMultipartForm(event) {
    return new Promise((resolve, reject) => {
        const busboy = Busboy({
            headers: {
                'content-type': event.headers['content-type'] || event.headers['Content-Type']
            }
        });

        const result = {
            file: null,
            prompt: ''
        };

        busboy.on('file', (fieldname, file, { filename, mimeType }) => {
            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => {
                result.file = {
                    buffer: Buffer.concat(chunks),
                    filename,
                    mimeType,
                };
            });
        });

        busboy.on('field', (fieldname, val) => {
            if (fieldname === 'prompt') {
                result.prompt = val;
            }
        });

        busboy.on('finish', () => resolve(result));
        busboy.on('error', err => reject(err));

        const bodyBuffer = Buffer.from(event.body, 'base64');
        const stream = new Readable();
        stream.push(bodyBuffer);
        stream.push(null);
        stream.pipe(busboy);
    });
}

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'API key is not set on the server.' }) };
    }

    // Common headers for all OpenAI Assistants API requests
    const openaiHeaders = {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
    };

    try {
        const { file: pdfFile, prompt } = await parseMultipartForm(event);

        if (!prompt || !pdfFile) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt or PDF file.' }) };
        }

        // 1. Upload the PDF to OpenAI's file storage
        const formData = new FormData();
        formData.append('file', pdfFile.buffer, {
            filename: pdfFile.filename,
            contentType: pdfFile.mimeType || 'application/pdf',
        });
        formData.append('purpose', 'assistants');

        const uploadRes = await axios.post('https://api.openai.com/v1/files', formData, {
            headers: {
                ...formData.getHeaders(),
                ...openaiHeaders,
            },
        });
        const fileId = uploadRes.data.id;

        // 2. Create a thread
        const threadRes = await axios.post('https://api.openai.com/v1/threads', {}, {
            headers: openaiHeaders,
        });
        const threadId = threadRes.data.id;

        // 3. Add a message to the thread with the file and prompt
        const messageRes = await axios.post(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            role: 'user',
            content: prompt,
            attachments: [{ file_id: fileId, tools: [{ type: 'file_search' }] }],
        }, {
            headers: openaiHeaders,
        });

        // 4. Run the assistant (replace with your Assistant ID)
        const assistantId = process.env.OPENAI_ASSISTANT_ID; // Set this in your environment
        if (!assistantId) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Assistant ID is not set on the server.' }) };
        }
        const runRes = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
            assistant_id: assistantId,
        }, {
            headers: openaiHeaders,
        });
        const runId = runRes.data.id;

        // Return threadId and runId for polling
        return {
            statusCode: 200,
            body: JSON.stringify({ threadId, runId }),
        };

    } catch (error) {
        console.error('Function Error:', error?.response?.data || error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error?.response?.data?.error?.message || error.message || 'An internal server error occurred.' }),
        };
    }
};
