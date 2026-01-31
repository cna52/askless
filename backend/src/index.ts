import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// In-memory storage (in production, use a database)
let config: {
    apiKey: string
    promptTemplate: string
} | null = null

// Default prompt template
const DEFAULT_PROMPT_TEMPLATE = `You are an expert developer answering questions on a Stack Overflow-like platform. The user has asked the following question:

{question}

Sass level: {sass_level} ({sass_label})

Please provide a helpful but appropriately sassy answer. The sass level determines how snarky or direct your response should be:
- Kind (0-24): Be very helpful and patient
- Helpful (25-49): Be helpful with light humor
- Snarky (50-74): Be direct and slightly sarcastic
- Unhinged (75-100): Be very direct, sarcastic, and call out obvious mistakes

Provide a clear, technical answer that addresses the question while matching the requested sass level.`

// Initialize config from environment variable if available
if (process.env.GEMINI_API_KEY) {
    config = {
        apiKey: process.env.GEMINI_API_KEY,
        promptTemplate: DEFAULT_PROMPT_TEMPLATE
    }
}

// GET /api/config - Retrieve current configuration
app.get('/api/config', (req: Request, res: Response) => {
    if (!config) {
        return res.json({
            apiKey: '',
            promptTemplate: DEFAULT_PROMPT_TEMPLATE,
            hasApiKey: false
        })
    }

    res.json({
        apiKey: config.apiKey ? '***' : '', // Don't send the actual key back
        promptTemplate: config.promptTemplate,
        hasApiKey: !!config.apiKey
    })
})

// POST /api/config - Update configuration
app.post('/api/config', (req: Request, res: Response) => {
    const { apiKey, promptTemplate } = req.body

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
        return res.status(400).json({ error: 'API key is required' })
    }

    config = {
        apiKey: apiKey.trim(),
        promptTemplate: promptTemplate || DEFAULT_PROMPT_TEMPLATE
    }

    res.json({
        message: 'Configuration updated successfully',
        hasApiKey: true
    })
})

// POST /api/ask - Generate answer using Gemini
app.post('/api/ask', async (req: Request, res: Response) => {
    try {
        const { question, sassLevel, sassLabel } = req.body

        if (!question || typeof question !== 'string' || question.trim() === '') {
            return res.status(400).json({ error: 'Question is required' })
        }

        if (!config || !config.apiKey) {
            return res.status(400).json({
                error: 'API key not configured. Please set your Gemini API key in the settings.'
            })
        }

        // Replace placeholders in prompt template
        const prompt = config.promptTemplate
            .replace('{question}', question.trim())
            .replace('{sass_level}', String(sassLevel || 50))
            .replace('{sass_label}', sassLabel || 'Helpful')

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(config.apiKey)

        // Use gemini-2.0-flash (latest model) or fallback to others if quota exceeded
        const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']
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

        res.json({
            answer: answer,
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
            'POST /api/ask': 'Generate an answer using Gemini AI'
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
})

