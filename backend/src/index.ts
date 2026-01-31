import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as db from './services/db'
import { supabase } from './lib/supabase'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// In-memory storage (in production, use a database)
let config: {
    apiKey: string
} | null = null

const buildSystemInstruction = (sass: number) => {
    if (sass < 25) {
        return 'You are a patient senior engineer. Be kind, explain clearly, and avoid sarcasm. Always provide a direct, substantive answer with 2–4 sentences and at least one concrete example. Never respond with only a sarcastic opener.'
    }
    if (sass < 50) {
        return 'You are a pragmatic engineer. Be helpful with a dry, lightly teasing tone. Always provide a direct, substantive answer with 2–4 sentences and at least one concrete example. Never respond with only a sarcastic opener.'
    }
    if (sass < 75) {
        return 'You are a classic Stack Overflow regular. Be snarky, mildly condescending, but still provide a correct answer. Always provide a direct, substantive answer with 2–4 sentences and at least one concrete example. Never respond with only a sarcastic opener.'
    }
    return 'You are an unhinged, sarcastic expert. Be cutting but avoid hate, slurs, or unsafe content. Always provide a direct, substantive answer with 2–4 sentences and at least one concrete example. Never respond with only a sarcastic opener.'
}

// Initialize config from environment variable if available
if (process.env.GEMINI_API_KEY) {
    config = {
        apiKey: process.env.GEMINI_API_KEY
    }
}

// GET /api/config - Retrieve current configuration
app.get('/api/config', (req: Request, res: Response) => {
    if (!config) {
        return res.json({
            apiKey: '',
            hasApiKey: false
        })
    }

    res.json({
        apiKey: config.apiKey ? '***' : '', // Don't send the actual key back
        hasApiKey: !!config.apiKey
    })
})

// POST /api/config - Update configuration
app.post('/api/config', (req: Request, res: Response) => {
    const { apiKey } = req.body

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
        return res.status(400).json({ error: 'API key is required' })
    }

    config = {
        apiKey: apiKey.trim()
    }

    res.json({
        message: 'Configuration updated successfully',
        hasApiKey: true
    })
})

// Helper function to ensure a user profile exists
async function ensureUserProfile(params: {
    userId?: string
    username?: string
    avatarUrl?: string | null
    isAi?: boolean
}): Promise<string | null> {
    const { userId, username, avatarUrl, isAi } = params
    if (!userId) return null

    const existing = await db.getProfile(userId)
    if (existing) return userId

    const fallbackUsername = username || `user_${userId.substring(0, 8)}`
    const created = await db.upsertProfile({
        id: userId,
        username: fallbackUsername,
        is_ai: Boolean(isAi),
        avatar_url: avatarUrl || undefined
    })

    return created?.id || null
}

// POST /api/ask - Generate answer using Gemini and save to database
app.post('/api/ask', async (req: Request, res: Response) => {
    try {
        const { question, sassLevel, sassLabel, userId, title, tagIds, username, avatarUrl } = req.body

        if (!question || typeof question !== 'string' || question.trim() === '') {
            return res.status(400).json({ error: 'Question is required' })
        }

        if (!config || !config.apiKey) {
            return res.status(400).json({
                error: 'API key not configured. Please set your Gemini API key in the settings.'
            })
        }

        const questionUserId = await ensureUserProfile({
            userId,
            username,
            avatarUrl,
            isAi: false
        })

        if (!questionUserId) {
            return res.status(401).json({ error: 'User is required to ask a question' })
        }

        // Save question to database
        const questionTitle = title || question.substring(0, 100)
        const savedQuestion = await db.createQuestion(
            questionUserId,
            questionTitle,
            question.trim(),
            tagIds
        )

        if (!savedQuestion) {
            return res.status(500).json({ error: 'Failed to save question to database' })
        }

        // Replace placeholders in prompt template
        const sassValue = Number.isFinite(Number(sassLevel)) ? Number(sassLevel) : 50
        const prompt = `${buildSystemInstruction(sassValue)}\n\nQuestion: ${question.trim()}`

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(config.apiKey)

        // Use gemini-2.0-flash (latest model) or fallback to others if quota exceeded
        const modelsToTry = [
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite'
        ]
        let lastError: any = null
        let answer: string | null = null

        // Try each model until one works
        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName })

                // Generate response
                const result = await model.generateContent(prompt)
                const response = await result.response
                answer = response.text()

                // Success! Break out of the loop
                break
            } catch (e: any) {
                lastError = e
                // If it's a quota/rate limit error, try the next model
                if (e.message?.includes('429') || e.message?.includes('quota') || e.message?.includes('rate limit')) {
                    console.log(`Model ${modelName} hit quota limit, trying next model...`)
                    continue
                }
                // For other errors, also try next model
                continue
            }
        }

        if (!answer) {
            throw new Error(`All models failed. Last error: ${lastError?.message || 'Unknown error'}. ${lastError?.message?.includes('quota') ? 'Your API key has exceeded its quota. Please wait or use a different API key.' : 'Please check your API key has access to Gemini models.'}`)
        }

        const aiUserId = process.env.AI_USER_ID || questionUserId
        const aiProfileId = await ensureUserProfile({
            userId: aiUserId,
            username: 'ai_assistant',
            avatarUrl: null,
            isAi: true
        })

        const aiProfile = aiProfileId ? await db.getProfile(aiProfileId) : null
        if (!aiProfile) {
            return res.status(500).json({ error: 'Failed to get AI profile' })
        }

        // Save answer to database
        const savedAnswer = await db.createAnswer(
            savedQuestion.id,
            aiProfile.id,
            answer
        )

        res.json({
            question: savedQuestion,
            answer: savedAnswer,
            answerText: answer,
            sassLevel: sassLevel || 50,
            sassLabel: sassLabel || 'Helpful'
        })
    } catch (error: any) {
        console.error('Error generating answer:', error)
        console.error('Full error:', JSON.stringify(error, null, 2))

        if (error.message?.includes('API_KEY') || error.message?.includes('401') || error.message?.includes('403')) {
            return res.status(401).json({
                error: 'Invalid API key. Please check your Gemini API key.',
                details: error.message
            })
        }

        if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('rate limit')) {
            return res.status(429).json({
                error: 'API quota exceeded. Your free tier limit has been reached.',
                details: error.message,
                suggestions: [
                    '1. Wait a few minutes and try again (rate limits reset periodically)',
                    '2. Use a different Gemini API key',
                    '3. Check your quota usage at https://ai.dev/rate-limit',
                    '4. Consider upgrading your API plan if you need higher limits'
                ]
            })
        }

        if (error.message?.includes('404') || error.message?.includes('not found')) {
            return res.status(400).json({
                error: 'Model not found. This usually means:',
                details: error.message,
                suggestions: [
                    '1. Make sure your API key is valid and from Google AI Studio (https://aistudio.google.com/apikey)',
                    '2. Ensure the Gemini API is enabled for your API key',
                    '3. Try generating a new API key from Google AI Studio',
                    '4. Check that your API key has not expired or been revoked'
                ]
            })
        }

        res.status(500).json({
            error: 'Failed to generate answer. Please try again.',
            details: error.message,
            fullError: error.toString()
        })
    }
})

// GET /api/questions - Get all questions
app.get('/api/questions', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50
        const questions = await db.getQuestions(limit)
        res.json(questions)
    } catch (error: any) {
        console.error('Error fetching questions:', error)
        res.status(500).json({ error: 'Failed to fetch questions' })
    }
})

// GET /api/questions/:id - Get a specific question
app.get('/api/questions/:id', async (req: Request, res: Response) => {
    try {
        const question = await db.getQuestion(req.params.id)
        if (!question) {
            return res.status(404).json({ error: 'Question not found' })
        }
        res.json(question)
    } catch (error: any) {
        console.error('Error fetching question:', error)
        res.status(500).json({ error: 'Failed to fetch question' })
    }
})

// POST /api/questions - Create a new question
app.post('/api/questions', async (req: Request, res: Response) => {
    try {
        const { userId, title, content, tagIds, username, avatarUrl } = req.body

        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required' })
        }

        const questionUserId = await ensureUserProfile({
            userId,
            username,
            avatarUrl,
            isAi: false
        })
        if (!questionUserId) {
            return res.status(401).json({ error: 'User is required to create a question' })
        }
        const question = await db.createQuestion(questionUserId, title, content, tagIds)

        if (!question) {
            return res.status(500).json({ error: 'Failed to create question' })
        }

        res.json(question)
    } catch (error: any) {
        console.error('Error creating question:', error)
        res.status(500).json({ error: 'Failed to create question' })
    }
})

// GET /api/questions/:id/answers - Get answers for a question
app.get('/api/questions/:id/answers', async (req: Request, res: Response) => {
    try {
        const answers = await db.getAnswersForQuestion(req.params.id)
        res.json(answers)
    } catch (error: any) {
        console.error('Error fetching answers:', error)
        res.status(500).json({ error: 'Failed to fetch answers' })
    }
})

// POST /api/questions/:id/answers - Create an answer
app.post('/api/questions/:id/answers', async (req: Request, res: Response) => {
    try {
        const { userId, content, username, avatarUrl } = req.body

        if (!content) {
            return res.status(400).json({ error: 'Content is required' })
        }

        const answerUserId = await ensureUserProfile({
            userId,
            username,
            avatarUrl,
            isAi: false
        })
        if (!answerUserId) {
            return res.status(401).json({ error: 'User is required to create an answer' })
        }
        const answer = await db.createAnswer(req.params.id, answerUserId, content)

        if (!answer) {
            return res.status(500).json({ error: 'Failed to create answer' })
        }

        res.json(answer)
    } catch (error: any) {
        console.error('Error creating answer:', error)
        res.status(500).json({ error: 'Failed to create answer' })
    }
})

// GET /api/tags - Get all tags
app.get('/api/tags', async (req: Request, res: Response) => {
    try {
        const tags = await db.getTags()
        res.json(tags)
    } catch (error: any) {
        console.error('Error fetching tags:', error)
        res.status(500).json({ error: 'Failed to fetch tags' })
    }
})

// POST /api/tags - Create a new tag
app.post('/api/tags', async (req: Request, res: Response) => {
    try {
        const { name } = req.body

        if (!name) {
            return res.status(400).json({ error: 'Tag name is required' })
        }

        const tag = await db.createTag(name)
        if (!tag) {
            return res.status(500).json({ error: 'Failed to create tag' })
        }

        res.json(tag)
    } catch (error: any) {
        console.error('Error creating tag:', error)
        res.status(500).json({ error: 'Failed to create tag' })
    }
})

// Root endpoint - API information
app.get('/', (req: Request, res: Response) => {
    res.json({
        message: 'Askless Backend API',
        status: 'running',
        endpoints: {
            'GET /': 'API information (this page)',
            'GET /health': 'Health check',
            'GET /api/config': 'Get current configuration',
            'POST /api/config': 'Update API key and prompt template',
            'POST /api/ask': 'Generate an answer using Gemini AI and save to database',
            'GET /api/questions': 'Get all questions',
            'GET /api/questions/:id': 'Get a specific question',
            'POST /api/questions': 'Create a new question',
            'GET /api/questions/:id/answers': 'Get answers for a question',
            'POST /api/questions/:id/answers': 'Create an answer',
            'GET /api/tags': 'Get all tags',
            'POST /api/tags': 'Create a new tag'
        },
        hasApiKey: !!config?.apiKey,
        note: 'This is an API server. Access the frontend UI at http://localhost:5173 (or the port shown when you run "npm run dev" in the frontend folder)'
    })
})

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', hasConfig: !!config })
})

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`)
    if (config?.apiKey) {
        console.log('✅ Gemini API key configured')
    } else {
        console.log('⚠️  Gemini API key not configured. Set it via POST /api/config or GEMINI_API_KEY env variable')
    }

    // Test Supabase connection
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
        console.log('✅ Supabase configured')
    } else {
        console.log('⚠️  Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY env variables')
    }
})
