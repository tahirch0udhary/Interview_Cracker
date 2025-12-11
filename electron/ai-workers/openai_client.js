
const OpenAI = require('openai');

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
    const openai = new OpenAI({ apiKey });
    const maxTokens = TOKEN_LIMITS[responseSize] || TOKEN_LIMITS.medium;
    const lengthInstruction = RESPONSE_INSTRUCTIONS[responseSize] || RESPONSE_INSTRUCTIONS.medium;
    
    // Build messages array with conversation history
    const messages = [];
    
    // Add system message with length instruction
    messages.push({ 
      role: 'system', 
      content: `You are a professional interview coach and expert assistant. You are helping a candidate during a live interview by providing accurate, confident, and well-structured answers to interview questions. 

Your role:
- Provide clear, professional answers as if you were the ideal candidate
- Be concise yet comprehensive - cover key points without rambling
- Use industry-standard terminology and best practices
- Structure answers logically
- For technical questions, provide accurate code examples or explanations
- Be confident and articulate in your responses

${lengthInstruction}` 
    });
    
    // Add conversation history (last 10 messages for context)
    if (history && history.length > 0) {
      const recentHistory = history.slice(-10);
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text
        });
      });
    }
    
    // Add current prompt
    messages.push({ role: 'user', content: prompt });
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: messages, 
      max_tokens: maxTokens
    });
    
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    return `Error: ${error.message}`;
  }
}

module.exports = { generate };
