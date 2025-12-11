
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TOKEN_LIMITS = {
  small: 512,
  medium: 1536,
  large: 4096
};

const RESPONSE_INSTRUCTIONS = {
  small: 'Keep your response very brief and concise - around 2-3 sentences maximum. Get straight to the point.',
  medium: 'Provide a moderate-length response with key details. Use bullet points if helpful. Keep it focused.',
  large: 'You can provide a detailed, comprehensive response with examples and explanations.'
};

async function generate(prompt, apiKey, responseSize = 'medium', history = []) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const maxTokens = TOKEN_LIMITS[responseSize] || TOKEN_LIMITS.medium;
    const lengthInstruction = RESPONSE_INSTRUCTIONS[responseSize] || RESPONSE_INSTRUCTIONS.medium;
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        maxOutputTokens: maxTokens
      },
      systemInstruction: `You are a professional interview coach and expert assistant. You are helping a candidate during a live interview by providing accurate, confident, and well-structured answers to interview questions. 

Your role:
- Provide clear, professional answers as if you were the ideal candidate
- Be concise yet comprehensive - cover key points without rambling
- Use industry-standard terminology and best practices
- Structure answers logically (use frameworks like STAR for behavioral questions)
- For technical questions, provide accurate code examples or explanations
- Be confident and articulate in your responses

${lengthInstruction}`
    });
    
    // Build conversation history for context
    let fullPrompt = prompt;
    if (history && history.length > 0) {
      // Take last 10 messages for context (5 exchanges)
      const recentHistory = history.slice(-10);
      const contextMessages = recentHistory.map(msg => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`
      ).join('\n\n');
      fullPrompt = `Previous conversation:\n${contextMessages}\n\nCurrent question: ${prompt}`;
    }
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API error:', error);
    return `Error: ${error.message}`;
  }
}

module.exports = { generate };
