import { GoogleGenerativeAI } from '@google/generative-ai'

export interface CritiqueResult {
    isLowQuality: boolean
    critique?: string
    shouldRespond: boolean
}

export async function evaluateCommentQuality(
    commentContent: string,
    apiKey: string
): Promise<CritiqueResult> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })

        const prompt = `You are evaluating a comment on a developer Q&A platform. Determine if this comment is low quality and needs critique.

A low-quality comment is one that:
- Is too short or lacks context (less than 10 words)
- Doesn't add value or ask a meaningful question
- Is just "thanks" or "works for me" without explanation
- Lacks technical details or context
- Is vague or unhelpful

Comment: "${commentContent}"

Respond with ONLY a JSON object in this exact format:
{
  "isLowQuality": true or false,
  "shouldRespond": true or false,
  "critique": "A mean, sarcastic critique telling them to add more context. Be condescending but still helpful. 1-2 sentences max. Only include if isLowQuality is true."
}

Example good comment: "This works but I'm getting an error when I try to use it with async functions. Any ideas?"
Example bad comment: "thanks"
Example bad comment: "works"
Example bad comment: "not working"`

        const result = await model.generateContent(prompt)
        const response = await result.response
        const text = response.text().trim()

        // Parse the JSON (remove markdown code blocks if present)
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim()
        const critique = JSON.parse(cleanText)

        return {
            isLowQuality: critique.isLowQuality || false,
            critique: critique.critique || undefined,
            shouldRespond: critique.shouldRespond || false
        }
    } catch (error) {
        console.error('Error evaluating comment quality:', error)
        // Default to not critiquing if there's an error
        return {
            isLowQuality: false,
            shouldRespond: false
        }
    }
}

export async function generateMeanBotResponse(
    commentContent: string,
    critique: string,
    apiKey: string
): Promise<string> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })

        const prompt = `You're a jaded developer who's annoyed by low-quality comments. Someone wrote: "${commentContent}"

Your critique: "${critique}"

Write a mean, sarcastic response (1-2 sentences) telling them their comment is terrible and they need to add more context. Be condescending but still somewhat helpful. Sound like a Stack Overflow regular who's seen this too many times.

Example tone: "Seriously? 'thanks'? That's not helpful. What specifically worked? What problem were you trying to solve? Add some context or don't bother commenting."
Example tone: "This is terrible. 'not working' tells us nothing. What error are you getting? What did you try? Give us something to work with here."

Respond with ONLY the critique message, nothing else.`

        const result = await model.generateContent(prompt)
        const response = await result.response
        return response.text().trim()
    } catch (error) {
        console.error('Error generating mean bot response:', error)
        return critique || "This comment is terrible. Add more context or don't bother."
    }
}

