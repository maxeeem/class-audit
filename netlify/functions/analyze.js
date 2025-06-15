const { OpenAI } = require('openai');
const Busboy = require('busboy');
const { Readable } = require('stream');

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
    
    const openai = new OpenAI({ apiKey });

    try {
        const { file: pdfFile, prompt } = await parseMultipartForm(event);

        if (!prompt || !pdfFile) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt or PDF file.' }) };
        }
        
        // Convert the file buffer to a base64 string for the API
        const base64pdf = pdfFile.buffer.toString('base64');

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { 
                        type: "image_url", // For PDFs, we use image_url type with a data URI
                        image_url: {
                            url: `data:application/pdf;base64,${base64pdf}`
                        }
                    }
                ],
            }],
            max_tokens: 1500,
        });

        const analysis = response.choices[0]?.message?.content || 'No analysis was returned.';

        return {
            statusCode: 200,
            body: JSON.stringify({ analysis }),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' }),
        };
    }
};
