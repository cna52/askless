import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createHash } from 'crypto'
import * as db from './services/db'
import { supabase } from './lib/supabase'
import { generateTags } from './services/tagGenerator'
import { findSimilarQuestions, getOrCreateTags } from './services/questionSearch'

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

// Helper to generate a deterministic UUID from a string
function generateDeterministicUUID(input: string): string {
    // Create a namespace UUID (using a fixed namespace for bots)
    const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    const hash = createHash('sha1')
    hash.update(namespace + input)
    const hex = hash.digest('hex')

    // Format as UUID v5 style
    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        '5' + hex.substring(13, 16),
        ((parseInt(hex.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex.substring(18, 20),
        hex.substring(20, 32)
    ].join('-')
}

// Bot personality definitions
interface BotPersonality {
    id: string
    name: string
    username: string
    systemInstruction: string
}

const BOT_PERSONALITIES: BotPersonality[] = [
    {
        id: generateDeterministicUUID('bot_helpful'),
        name: 'Helpful Bot',
        username: 'helpful_assistant',
        systemInstruction: `You're a helpful developer commenting on a question. Write like a real person - use casual language, contractions, and personal experiences. Sound like you're actually trying to help someone out. Give a real answer (2-4 sentences) with a concrete example. Be encouraging but natural, like "Yeah, I've run into this before..." or "This is actually pretty common, here's what I do...". Don't sound like an AI assistant - sound like a friendly coworker.`
    },
    {
        id: generateDeterministicUUID('bot_mean'),
        name: 'Mean Bot',
        username: 'sarcastic_dev',
        systemInstruction: `You're a jaded developer who's seen this question a million times. Be sarcastic and a bit condescending, but still helpful. Write like a real person who's annoyed but can't help themselves from answering. Use casual language, maybe some eye-rolling energy. Give the correct answer (2-4 sentences with an example) but with attitude. Sound like "Ugh, this again..." or "Seriously? Just do X..." - like someone who's been on Stack Overflow too long but still knows their stuff.`
    },
    {
        id: generateDeterministicUUID('bot_blunt'),
        name: 'Blunt Bot',
        username: 'blunt_engineer',
        systemInstruction: `You're a no-nonsense developer who gets straight to the point. Write like a real person who doesn't waste words. Be direct, maybe a bit terse, but helpful. Use casual language and contractions. Give the answer (2-4 sentences with example) but skip the fluff. Sound like "Just use X. Here's how..." or "This is what you need..." - like someone who's busy but still wants to help.`
    },
    {
        id: generateDeterministicUUID('bot_friendly'),
        name: 'Friendly Bot',
        username: 'friendly_helper',
        systemInstruction: `You're an enthusiastic developer who genuinely loves helping people. Write like a real person who's excited to share knowledge. Use casual, friendly language with contractions. Be warm and encouraging, maybe use an emoji occasionally if it feels natural. Give a helpful answer (2-4 sentences with example). Sound like "Oh I love this question!" or "This is so cool, here's what I do..." - like someone who's genuinely happy to help.`
    },
    {
        id: generateDeterministicUUID('bot_technical'),
        name: 'Technical Bot',
        username: 'tech_expert',
        systemInstruction: `You're a detail-oriented developer who loves the technical side. Write like a real person who gets excited about the details. Use casual language but include technical specifics. Reference best practices and edge cases naturally. Give a thorough answer (2-4 sentences with example). Sound like "Actually, there's a nuance here..." or "The thing is, X works but you should also consider Y..." - like someone who can't help but share the technical details.`
    }
]

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

// GET /api/config
app.get('/api/config', (req: Request, res: Response) => {
    if (!config) {
        return res.json({
            apiKey: '',
            hasApiKey: false
        })
    }

    res.json({
        apiKey: config.apiKey ? '***' : '',
        hasApiKey: !!config.apiKey
    })
})

// POST /api/config
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

    try {
        // For AI bots, use the simplified function that bypasses auth checks
        if (isAi) {
            const existing = await db.getProfile(userId)
            if (existing) return userId

            const fallbackUsername = username || `bot_${userId.substring(0, 8)}`
            const created = await db.upsertAIProfile({
                id: userId,
                username: fallbackUsername,
                is_ai: true,
                avatar_url: avatarUrl || undefined
            })

            if (!created) {
                console.error(`Failed to create AI bot profile for userId: ${userId}, username: ${fallbackUsername}`)
                return null
            }

            return created.id
        }

        // For regular users, use the standard upsert
        const existing = await db.getProfile(userId)
        if (existing) return userId

        const fallbackUsername = username || `user_${userId.substring(0, 8)}`
        const created = await db.upsertProfile({
            id: userId,
            username: fallbackUsername,
            is_ai: false,
            avatar_url: avatarUrl || undefined
        })

        if (!created) {
            console.error(`Failed to create profile for userId: ${userId}, username: ${fallbackUsername}`)
            return null
        }

        return created.id
    } catch (error: any) {
        console.error(`Error in ensureUserProfile for ${userId}:`, error)
        return null
    }
}

// Initialize all bot profiles at startup
async function initializeBotProfiles(): Promise<void> {
    console.log('Initializing bot profiles...')
    for (const bot of BOT_PERSONALITIES) {
        try {
            const profileId = await ensureUserProfile({
                userId: bot.id,
                username: bot.username,
                avatarUrl: null,
                isAi: true
            })
            if (profileId) {
                console.log(`✅ Bot profile initialized: ${bot.name} (${bot.id})`)
            } else {
                console.error(`❌ Failed to initialize bot profile: ${bot.name} (${bot.id})`)
            }
        } catch (error: any) {
            console.error(`❌ Error initializing bot profile ${bot.name}:`, error.message)
        }
    }
}

// Helper function to generate an answer for a specific bot personality
async function generateBotAnswer(
    bot: BotPersonality,
    question: string,
    questionId: string
): Promise<{ answer: db.Answer | null; botProfile: db.Profile | null; error?: string }> {
    if (!config || !config.apiKey) {
        return { answer: null, botProfile: null, error: 'API key not configured' }
    }

    try {
        // Get bot profile (should already exist from initialization)
        let botProfile = await db.getProfile(bot.id)

        // If profile doesn't exist, try to create it
        if (!botProfile) {
            console.log(`Bot profile not found for ${bot.name}, creating...`)
            const botProfileId = await ensureUserProfile({
                userId: bot.id,
                username: bot.username,
                avatarUrl: null,
                isAi: true
            })

            if (!botProfileId) {
                console.error(`Failed to create bot profile for ${bot.name} (${bot.id})`)
                return { answer: null, botProfile: null, error: `Failed to create bot profile for ${bot.name}` }
            }

            botProfile = await db.getProfile(botProfileId)
            if (!botProfile) {
                console.error(`Failed to retrieve bot profile for ${bot.name} (${bot.id})`)
                return { answer: null, botProfile: null, error: `Failed to get bot profile for ${bot.name}` }
            }
        }

        // Generate answer using Gemini
        const genAI = new GoogleGenerativeAI(config.apiKey)
        const prompt = `${bot.systemInstruction}\n\nQuestion: ${question.trim()}`

        const modelsToTry = [
            'gemma-3-12b-it',
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
        ]

        let answer: string | null = null
        let lastError: any = null

        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName })
                const result = await model.generateContent(prompt)
                const response = await result.response
                answer = response.text()
                break
            } catch (e: any) {
                lastError = e
                if (e.message?.includes('429') || e.message?.includes('quota') || e.message?.includes('rate limit')) {
                    console.log(`Model ${modelName} hit quota limit for ${bot.name}, trying next model...`)
                    continue
                }
                continue
            }
        }

        if (!answer) {
            return {
                answer: null,
                botProfile,
                error: `Failed to generate answer: ${lastError?.message || 'Unknown error'}`
            }
        }

        // Save answer to database
        const savedAnswer = await db.createAnswer(questionId, botProfile.id, answer)

        return { answer: savedAnswer, botProfile }
    } catch (error: any) {
        console.error(`Error generating answer for ${bot.name}:`, error)
        return { answer: null, botProfile: null, error: error.message }
    }
}

// POST /api/ask - Generate answers from multiple bots and save to database (with duplicate detection)
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
        const questionTitle = title || question.substring(0, 100)

        // 🌱 SUSTAINABLE FEATURE: Get tag names from user-provided tag IDs
        console.log('🏷️ Getting tags from user selection...')
        let tagNames: string[] = []

        if (tagIds && tagIds.length > 0) {
            const { data: selectedTags } = await supabase
                .from('tags')
                .select('name')
                .in('id', tagIds)
            
            tagNames = selectedTags?.map(t => t.name) || []
            console.log('User selected tags:', tagNames)
        } else {
            console.log('No tags selected by user, generating tags...')
            try {
                tagNames = await generateTags(questionTitle, question.trim(), config.apiKey)
                console.log('Generated tags:', tagNames)
            } catch (error: any) {
                console.warn('Tag generation failed:', error?.message || error)
                tagNames = []
            }
        }

        // 🔍 Search for similar questions
        console.log('🔍 Searching for similar questions...')
        const similarQuestions = await findSimilarQuestions(tagNames)

        // If similar questions found, return duplicate response
        if (similarQuestions.length > 0) {
            const topMatch = similarQuestions[0]

            // Increment search count
            await supabase
                .from('questions')
                .update({ search_count: topMatch.search_count + 1 })
                .eq('id', topMatch.question_id)

            // Get existing answers for the duplicate
            const existingAnswers = await db.getAnswersForQuestion(topMatch.question_id)

            console.log('✅ Found duplicate! Returning existing answers.')

            return res.json({
                isDuplicate: true,
                message: '**[DUPLICATE]** This question has been asked before. Did you even try searching? 🙄',
                originalQuestion: {
                    id: topMatch.question_id,
                    title: topMatch.title,
                    content: topMatch.content,
                    tags: topMatch.matching_tags,
                    searchCount: topMatch.search_count + 1
                },
                answers: existingAnswers,
                answerText: existingAnswers[0]?.content || 'Answer not found',
                similarQuestions: similarQuestions.slice(0, 5),
                environmentMessage: `🌱 You just saved ${(Math.random() * 0.5 + 0.1).toFixed(2)}kg of CO2 by reusing answers!`,
                tags: tagNames
            })
        }

        console.log('✨ No duplicates found. Creating new question...')

        // Create or get tags
        const tags = await getOrCreateTags(tagNames)
        const resolvedTagIds = (Array.isArray(tagIds) && tagIds.length > 0) ? tagIds : tags.map(t => t.id)

        // Save question to database
        const savedQuestion = await db.createQuestion(
            questionUserId,
            questionTitle,
            question.trim(),
            resolvedTagIds
        )

        if (!savedQuestion) {
            return res.status(500).json({ error: 'Failed to save question to database' })
        }

        // Generate answers from all bots in parallel
        const botAnswers = await Promise.allSettled(
            BOT_PERSONALITIES.map(bot => generateBotAnswer(bot, question.trim(), savedQuestion.id))
        )

        // Process results
        const answers: Array<{
            answer: db.Answer
            botProfile: db.Profile
            botName: string
            botId: string
        }> = []

        botAnswers.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.answer && result.value.botProfile) {
                answers.push({
                    answer: result.value.answer,
                    botProfile: result.value.botProfile,
                    botName: BOT_PERSONALITIES[index].name,
                    botId: BOT_PERSONALITIES[index].id
                })
            } else {
                console.error(`Failed to generate answer for ${BOT_PERSONALITIES[index].name}:`, result.status === 'rejected' ? result.reason : result.value.error)
            }
        })

        if (answers.length === 0) {
            return res.status(500).json({
                error: 'Failed to generate any answers from bots. Please check your API key and try again.'
            })
        }

        res.json({
            isDuplicate: false,
            question: savedQuestion,
            answers: answers.map(a => ({
                answer: a.answer,
                botProfile: a.botProfile,
                botName: a.botName,
                botId: a.botId,
                answerText: a.answer.content,
            })),
            totalBots: BOT_PERSONALITIES.length,
            successfulBots: answers.length,
            tags: tagNames,
            message: 'Question answered! (Though you probably should have searched first...)'
        })
    } catch (error: any) {
        console.error('Error generating answers:', error)
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
            error: 'Failed to generate answers. Please try again.',
            details: error.message
        })
    }
})

// GET /api/questions
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

// GET /api/questions/:id
app.get('/api/questions/:id', async (req: Request, res: Response) => {
    try {
        const questionId = String(req.params.id)  // ← FIX: Convert to string
        const question = await db.getQuestion(questionId)
        if (!question) {
            return res.status(404).json({ error: 'Question not found' })
        }
        res.json(question)
    } catch (error: any) {
        console.error('Error fetching question:', error)
        res.status(500).json({ error: 'Failed to fetch question' })
    }
})

// POST /api/questions
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

// GET /api/questions/:id/answers
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

        const questionId = String(req.params.id)
        const answerUserId = await ensureUserProfile({
            userId,
            username,
            avatarUrl,
            isAi: false
        })
        if (!answerUserId) {
            return res.status(401).json({ error: 'User is required to create an answer' })
        }
        const answer = await db.createAnswer(questionId, answerUserId, content)

        if (!answer) {
            return res.status(500).json({ error: 'Failed to create answer' })
        }

        res.json(answer)
    } catch (error: any) {
        console.error('Error creating answer:', error)
        res.status(500).json({ error: 'Failed to create answer' })
    }
})

// GET /api/answers/:id/comments - Get comments for an answer
app.get('/api/answers/:id/comments', async (req: Request, res: Response) => {
    try {
        const comments = await db.getCommentsForAnswer(req.params.id)
        res.json(comments)
    } catch (error: any) {
        console.error('Error fetching comments:', error)
        res.status(500).json({ error: 'Failed to fetch comments' })
    }
})

// POST /api/answers/:id/comments - Create a comment
app.post('/api/answers/:id/comments', async (req: Request, res: Response) => {
    try {
        const { userId, content, username, avatarUrl, parentId } = req.body

        if (!content) {
            return res.status(400).json({ error: 'Content is required' })
        }

        const commentUserId = await ensureUserProfile({
            userId,
            username,
            avatarUrl,
            isAi: false
        })
        if (!commentUserId) {
            return res.status(401).json({ error: 'User is required to create a comment' })
        }

        const comment = await db.createComment(req.params.id, commentUserId, content, parentId)

        if (!comment) {
            return res.status(500).json({ error: 'Failed to create comment' })
        }

        // Get the comment with profile
        const comments = await db.getCommentsForAnswer(req.params.id)
        const newComment = comments.find(c => c.id === comment.id)

        res.json(newComment || comment)
    } catch (error: any) {
        console.error('Error creating comment:', error)
        res.status(500).json({ error: 'Failed to create comment' })
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

// POST /api/tags
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

// GET /api/top-searched
app.get('/api/top-searched', async (req: Request, res: Response) => {
    try {
        const limitParam = req.query.limit
        const limit = typeof limitParam === 'string' ? parseInt(limitParam) : 20  // ← FIX: Properly handle query param

        const { data, error } = await supabase
            .from('questions')
            .select(`
                id,
                title,
                content,
                search_count,
                created_at,
                question_tags (
                    tags (
                        name
                    )
                )
            `)
            .order('search_count', { ascending: false })
            .limit(limit)

        if (error) throw error

        const formatted = data?.map(q => ({
            ...q,
            tags: q.question_tags?.map((qt: any) => qt.tags?.name).filter(Boolean) || []  // ← FIX: Use 'any' type
        })) || []

        res.json({
            topQuestions: formatted,
            message: "These questions saved the most CO2 by being reused! 🌱"
        })
    } catch (error: any) {
        console.error('Error fetching top questions:', error)
        res.status(500).json({ error: 'Failed to fetch top questions' })
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
            'POST /api/tags': 'Create a new tag',
            'GET /api/top-searched': 'Get most reused questions (sustainability feature)' // ← ADD THIS
        },
        hasApiKey: !!config?.apiKey,
        botCount: BOT_PERSONALITIES.length
    })
})

// POST /api/bots/initialize - Manually initialize bot profiles
app.post('/api/bots/initialize', async (req: Request, res: Response) => {
    try {
        await initializeBotProfiles()
        res.json({
            message: 'Bot profiles initialization completed',
            bots: BOT_PERSONALITIES.map(bot => ({ id: bot.id, name: bot.name, username: bot.username }))
        })
    } catch (error: any) {
        console.error('Error initializing bot profiles:', error)
        res.status(500).json({ error: 'Failed to initialize bot profiles', details: error.message })
    }
})

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', hasConfig: !!config })
})

app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`)
    if (config?.apiKey) {
        console.log('✅ Gemini API key configured')
    } else {
        console.log('⚠️  Gemini API key not configured')
    }

    // Test Supabase connection
    if (process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
        console.log('✅ Supabase configured')
        // Initialize bot profiles after Supabase is confirmed
        await initializeBotProfiles()
    } else {
        console.log('⚠️  Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY env variables')
        console.log('⚠️  Bot profiles will not be initialized without Supabase')
    }
})
