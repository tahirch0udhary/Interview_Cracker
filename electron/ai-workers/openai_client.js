const OpenAI = require('openai');

// ============================================================================
// CONFIGURATION
// ============================================================================
const ASSISTANT_INSTRUCTIONS = `You are a professional interview coach and expert assistant. You are helping a candidate during a live interview by providing accurate, confident, and well-structured answers to interview questions.

Your role:
- Provide clear, professional answers as if you were the ideal candidate
- Be concise yet comprehensive - cover key points without rambling
- Use industry-standard terminology and best practices
- Structure answers logically
- For technical questions, provide accurate code examples or explanations
- Be confident and articulate in your responses`;

const RESPONSE_INSTRUCTIONS = {
  small: 'Keep your response very brief and concise - around 2-3 sentences maximum. Get straight to the point.',
  medium: 'Provide a moderate-length response with key details. Use bullet points if helpful. Keep it focused.',
  large: 'You can provide a detailed, comprehensive response with examples and explanations.'
};

// Store assistant and thread IDs (persists during app session)
let openaiClient = null;
let assistantId = null;
let threadId = null;

// ============================================================================
// ASSISTANT MANAGEMENT
// ============================================================================
async function getOrCreateAssistant(openai) {
  if (assistantId) {
    try {
      await openai.beta.assistants.retrieve(assistantId);
      return assistantId;
    } catch (e) {
      console.log('Assistant not found, creating new one...');
      assistantId = null;
    }
  }

  const assistant = await openai.beta.assistants.create({
    name: 'Interview Coach',
    instructions: ASSISTANT_INSTRUCTIONS,
    model: 'gpt-4.1-mini'
  });

  assistantId = assistant.id;
  console.log('Created new assistant:', assistantId);
  return assistantId;
}

async function getOrCreateThread(openai) {
  if (threadId) {
    try {
      await openai.beta.threads.retrieve(threadId);
      return threadId;
    } catch (e) {
      console.log('Thread not found, creating new one...');
      threadId = null;
    }
  }

  const thread = await openai.beta.threads.create();
  threadId = thread.id;
  console.log('Created new thread:', threadId);
  return threadId;
}

// ============================================================================
// MAIN GENERATE FUNCTION
// ============================================================================
async function generate(prompt, apiKey, responseSize = 'medium', history = []) {
  try {
    // Initialize or reuse OpenAI client
    if (!openaiClient) {
      openaiClient = new OpenAI({ apiKey });
    }

    const openai = openaiClient;
    const lengthInstruction = RESPONSE_INSTRUCTIONS[responseSize] || RESPONSE_INSTRUCTIONS.medium;

    // Get or create assistant and thread
    const asstId = await getOrCreateAssistant(openai);
    const thrdId = await getOrCreateThread(openai);
    
    console.log(`Using assistant: ${asstId}, thread: ${thrdId}`);

    // Add user message to thread
    await openai.beta.threads.messages.create(thrdId, {
      role: 'user',
      content: `${prompt}\n\n[Response guideline: ${lengthInstruction}]`
    });

    // Run the assistant and wait for completion using createAndPoll
    console.log('Starting run...');
    const run = await openai.beta.threads.runs.createAndPoll(thrdId, {
      assistant_id: asstId
    });
    
    console.log(`Run completed with status: ${run.status}`);

    if (run.status !== 'completed') {
      throw new Error(`Run failed with status: ${run.status}`);
    }

    // Get the assistant's response
    const messages = await openai.beta.threads.messages.list(thrdId, {
      order: 'desc',
      limit: 1
    });

    if (messages.data.length > 0 && messages.data[0].role === 'assistant') {
      const content = messages.data[0].content[0];
      if (content.type === 'text') {
        return content.text.value;
      }
    }

    return 'No response received from assistant';
  } catch (error) {
    console.error('OpenAI Assistants API error:', error);
    return `Error: ${error.message}`;
  }
}

// ============================================================================
// THREAD MANAGEMENT (for clearing history)
// ============================================================================
async function clearThread(apiKey) {
  try {
    if (threadId && openaiClient) {
      await openaiClient.beta.threads.del(threadId);
      console.log('Deleted thread:', threadId);
    }
  } catch (e) {
    console.log('Could not delete thread:', e.message);
  }
  threadId = null;
  return { success: true };
}

function getThreadInfo() {
  return { assistantId, threadId, hasActiveSession: !!threadId };
}

module.exports = { generate, clearThread, getThreadInfo };
