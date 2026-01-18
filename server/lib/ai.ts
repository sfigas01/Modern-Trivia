import { db } from "../db";
import { appConfig } from "@shared/schema";
import { eq } from "drizzle-orm";

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
    // 1. Fetch API Key
    const [config] = await db
        .select()
        .from(appConfig)
        .where(eq(appConfig.key, "openai_api_key"))
        .limit(1);

    if (!config || !config.value) {
        throw new Error("OpenAI API Key not configured. Please set it in Admin Settings.");
    }

    const apiKey = config.value;

    // 2. Construct Prompt
    const prompt = `
    You are a Trivia Fact Checker. Analyze this dispute:
    
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
      "suggestedFix": { // Only if needed
        "question": "Reworded question...",
        "answer": "Corrected answer...",
        "explanation": "Better explanation..."
      },
      "sources": ["List of credible sources or domains"]
    }
  `;

    // 3. Call OpenAI (Mocking implementation for now as we don't have the SDK installed yet)
    // In a real implementation, we would use 'openai' package here.

    console.log("Analyzing with key:", apiKey.substring(0, 8) + "...");

    // Mock Response for now to demonstrate UI flow
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                verdict: "CORRECT",
                confidence: 95,
                reasoning: "The user is correct. The capital of Australia is Canberra, not Sydney. Sydney is the largest city but not the capital.",
                suggestedFix: {
                    answer: "Canberra",
                    explanation: "Canberra was selected as the capital in 1908 as a compromise between rivals Sydney and Melbourne."
                },
                sources: ["australia.gov.au", "britannica.com"]
            });
        }, 1500);
    });
}
