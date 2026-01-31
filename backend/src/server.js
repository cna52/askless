import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { GoogleGenAI } from '@google/genai'

dotenv.config()

const app = express()
const port = process.env.PORT || 4000
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

app.use(
  cors({
    origin: frontendOrigin,
  })
)
app.use(express.json({ limit: '1mb' }))

if (!process.env.GEMINI_API_KEY) {
  console.warn('Missing GEMINI_API_KEY. Set it in backend/.env for local dev.')
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const buildSystemInstruction = (sass) => {
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

const needsFallback = (text) => {
  if (!text) return true
  const trimmed = text.trim()
  if (trimmed.length < 120) return true
  const sentenceCount = (trimmed.match(/[.!?]/g) || []).length
  return sentenceCount < 2
}

const fallbackAnswer = (question) =>
  `Short version: ${question} usually comes down to references versus values. ` +
  'If you see it as a way to point at data rather than copy it, you are on the right track. ' +
  'Example: in C/C++, an int* holds the memory address of an int, so you can modify the original through it. ' +
  'If you need more detail, say what language/runtime you are using.'

app.post('/api/answer', async (req, res) => {
  try {
    const question = String(req.body.question || '').trim()
    const sass = clamp(Number(req.body.sass ?? 50), 0, 100)

    if (!question) {
      return res.status(400).json({ error: 'Question is required.' })
    }

    const systemInstruction = buildSystemInstruction(sass)
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

    const response = await ai.models.generateContent({
      model,
      contents: question,
      config: {
        systemInstruction,
        temperature: 0.75,
        maxOutputTokens: 220,
      },
    })

    const text = response.text?.trim() || ''
    const finalAnswer = needsFallback(text) ? fallbackAnswer(question) : text

    const isClosed = sass >= 65 || question.length < 12

    return res.json({ answer: finalAnswer, isClosed })
  } catch (error) {
    console.error('Gemini error:', error)
    return res.status(500).json({ error: 'Failed to generate answer.' })
  }
})

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.listen(port, () => {
  console.log(`askless backend listening on http://localhost:${port}`)
})
