import { GoogleGenerativeAI } from '@google/generative-ai'

export async function generateTags(title: string, content: string, apiKey: string): Promise<string[]> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })

        const prompt = `You are a technical tag generator for a developer Q&A platform.
Generate 3-5 relevant tags for this question. Tags should be:
- Lowercase
- Single words or hyphenated (e.g., "machine-learning")
- Programming languages, frameworks, concepts, or technologies

Question Title: "${title}"
Question Content: "${content}"

Return ONLY a JSON array of tag names, nothing else.
Example: ["javascript", "react", "hooks", "async"]`

        const result = await model.generateContent(prompt)
        const response = await result.response
        const text = response.text().trim()
        
        // Parse the JSON array (remove markdown code blocks if present)
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim()
        const tags = JSON.parse(cleanText)
        
        // Validate it's an array of strings
        if (!Array.isArray(tags) || !tags.every((t: any) => typeof t === 'string')) {
            console.error('Invalid tag format received:', tags)
            return []
        }
        
        return tags.map((t: string) => t.toLowerCase().trim()).slice(0, 5)
    } catch (error) {
        console.error('Error generating tags:', error)
        return []
    }
}