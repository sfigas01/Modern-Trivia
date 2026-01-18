import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface AnalysisResult {
    verdict: "CORRECT" | "INCORRECT" | "AMBIGUOUS";
    confidence: number;
    reasoning: string;
    suggestedFix?: {
        question?: string;
        answer?: string;
        explanation?: string;
    };
    sources: string[];
}

export async function analyzeDispute(
    question: string,
    correctAnswer: string,
    submittedAnswer: string,
    explanation: string
): Promise<AnalysisResult> {
    const prompt = `You are a Trivia Fact Checker. Analyze this dispute:
    
    Question: "${question}"
    Game's Correct Answer: "${correctAnswer}"
    User's Claimed Answer: "${submittedAnswer}"
    User's Explanation: "${explanation}"

    Task:
    1. Verify if the User's Claimed Answer is factually correct.
    2. Verify if the Game's Correct Answer is factually correct.
    3. Determine if the question is ambiguous or flawed.

    Return JSON format:
    {
      "verdict": "CORRECT" (User is right) | "INCORRECT" (User is wrong) | "AMBIGUOUS" (Question needs fix),
      "confidence": 0-100,
      "reasoning": "Short explanation...",
      "suggestedFix": {
        "question": "Reworded question...",
        "answer": "Corrected answer...",
        "explanation": "Better explanation..."
      },
      "sources": ["List of credible sources or domains"]
    }
    
    Only include suggestedFix if there's a problem with the question or answer.`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: "You are a fact-checking assistant for a trivia game. Always respond with valid JSON." },
            { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "{}";
    
    try {
        const parsed = JSON.parse(content) as AnalysisResult;
        return {
            verdict: parsed.verdict || "AMBIGUOUS",
            confidence: parsed.confidence || 50,
            reasoning: parsed.reasoning || "Analysis could not be completed.",
            suggestedFix: parsed.suggestedFix,
            sources: parsed.sources || []
        };
    } catch {
        return {
            verdict: "AMBIGUOUS",
            confidence: 0,
            reasoning: "Failed to parse AI response.",
            sources: []
        };
    }
}
