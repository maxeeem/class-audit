// Use require to import the node-fetch package.
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // Only allow POST requests.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Get the secret API key from Netlify's environment variables.
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('API key is not set on the server.');
        }

        // Get the data sent from the frontend.
        const { prompt, text } = JSON.parse(event.body);
        if (!prompt || !text) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt or text.' }) };
        }

        const fullPrompt = `Based on the following document text, please perform this task: "${prompt}"\n\nHere is the document text:\n---\n${text}`;
        
        const payload = {
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: fullPrompt }]
        };

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            console.error("OpenAI API Error:", result);
            return { statusCode: response.status, body: JSON.stringify({ error: result.error?.message || 'Failed to get a response from OpenAI.' }) };
        }
        
        const analysis = result.choices[0]?.message?.content || 'No analysis was returned.';

        // Send the successful analysis back to the frontend.
        return {
            statusCode: 200,
            body: JSON.stringify({ analysis: analysis })
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
        };
    }
};
