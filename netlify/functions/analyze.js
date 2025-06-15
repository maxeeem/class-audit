const OpenAI = require('openai');
const Busboy = require('busboy');
const { Readable } = require('stream');

// Helper function to parse multipart/form-data
function parseMultipartForm(event) {
    return new Promise((resolve, reject) => {
        const busboy = Busboy({
            headers: {
                'content-type': event.headers['content-type'] || event.headers['Content-Type']
            }
        });

        const result = {
            files: [],
            fields: {}
        };

        busboy.on('file', (fieldname, file, G) => {
            const chunks = [];
            file.on('data', (chunk) => {
                chunks.push(chunk);
            });
            file.on('end', () => {
                result.files.push({
                    fieldname,
                    file: Buffer.concat(chunks),
                    filename: G.filename,
                    mimeType: G.mimeType,
                });
            });
        });

        busboy.on('field', (fieldname, val) => {
            result.fields[fieldname] = val;
        });

        busboy.on('finish', () => {
            resolve(result);
        });

        busboy.on('error', err => reject(err));

        // Create a readable stream from the base64 encoded body
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
        const { files, fields } = await parseMultipartForm(event);
        const prompt = fields.prompt;
        const pdfFile = files[0];

        if (!prompt || !pdfFile) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt or PDF file.' }) };
        }
        
        // Step 1: Upload the file to OpenAI
        const file = await openai.files.create({
            file: pdfFile.file, // Pass the buffer directly
            purpose: 'assistants',
        });
        
        // Step 2: Create an Assistant
        const assistant = await openai.beta.assistants.create({
            name: "PDF Analyzer Assistant",
            instructions: "You are an assistant that analyzes PDF documents. Answer user questions based on the content of the provided files.",
            model: "gpt-4o",
            tools: [{ type: "file_search" }]
        });
        
        // Step 3: Create a Thread and add the user's message and file
        const thread = await openai.beta.threads.create({
            messages: [{
                role: "user",
                content: prompt,
                attachments: [{
                    file_id: file.id,
                    tools: [{ type: "file_search" }]
                }]
            }]
        });
        
        // Step 4: Create a Run and wait for it to complete
        let run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: assistant.id,
        });

        while (run.status === 'in_progress' || run.status === 'queued') {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            run = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        }

        if (run.status !== 'completed') {
            throw new Error(`Run failed with status: ${run.status}`);
        }

        // Step 5: Retrieve the messages from the thread
        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantMessage = messages.data.find(m => m.role === 'assistant');
        const analysis = assistantMessage ? assistantMessage.content[0].text.value : 'No analysis was returned.';

        // Step 6: Clean up the created resources on OpenAI
        await openai.beta.assistants.del(assistant.id);
        await openai.files.del(file.id);
        await openai.beta.threads.del(thread.id);

        return {
            statusCode: 200,
            body: JSON.stringify({ analysis: analysis }),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' }),
        };
    }
};
