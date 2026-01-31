import { useEffect, useMemo, useState } from 'react'
import './App.css'

function App() {
  const [question, setQuestion] = useState('')
  const [sass, setSass] = useState(55)
  const [answer, setAnswer] = useState('')
  const [upvotes, setUpvotes] = useState(0)
  const [isClosed, setIsClosed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

  const sassLabel = useMemo(() => {
    if (sass < 25) return 'Kind'
    if (sass < 50) return 'Helpful'
    if (sass < 75) return 'Snarky'
    return 'Unhinged'
  }, [sass])

  useEffect(() => {
    if (!answer) return
    setUpvotes(41)
    let ticks = 0
    const id = setInterval(() => {
      ticks += 1
      setUpvotes((prev) => prev + 1)
      if (ticks >= 3) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [answer])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed) return
    setIsLoading(true)
    setError('')
    setAnswer('')
    setIsClosed(false)
    setUpvotes(0)

    try {
      const response = await fetch(`${apiBase}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, sass }),
      })

      if (!response.ok) {
        throw new Error('Backend error')
      }

      const data = (await response.json()) as { answer: string; isClosed?: boolean }
      setAnswer(data.answer)
      setIsClosed(Boolean(data.isClosed))
    } catch (err) {
      setError('Backend is judging you silently. Check the server logs.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo-mark">askless.ai</div>
        <div className="tagline">Answers, but make it emotionally expensive.</div>
      </header>

      <main className="content">
        <section className="hero">
          <h1>
            ChatOverflow
            <span className="subtitle">Stack Overflow, but the AI grew up there.</span>
          </h1>
          <p>
            Instant responses, zero empathy, and the occasional polite closure. Fully unnecessary.
            Completely nostalgic.
          </p>
        </section>

        <section className="panel">
          <form className="question-form" onSubmit={handleSubmit}>
            <label className="label" htmlFor="question">
              Ask your question
            </label>
            <textarea
              id="question"
              className="question-input"
              placeholder="Why does my Docker container refuse to build when it works on my machine?"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={6}
            />

            <div className="slider-row">
              <div className="slider-label">Sass level</div>
              <div className="slider-track">
                <span>Kind</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sass}
                  onChange={(event) => setSass(Number(event.target.value))}
                />
                <span>Unhinged</span>
              </div>
              <div className="slider-pill">{sassLabel}</div>
            </div>

            <button className="submit" type="submit" disabled={isLoading}>
              {isLoading ? 'Generating…' : 'Submit (and be judged)'}
            </button>
          </form>
        </section>

        <section className="answer-wrap">
          <div className={`answer-card ${answer ? 'visible' : ''}`}>
            <div className="answer-meta">
              <div className="accepted">
                <span className="check" aria-hidden="true">
                  ✓
                </span>
                Accepted Answer
              </div>
              <div className="votes">▲ {upvotes}</div>
            </div>

            {isClosed && <div className="closed">Closed as duplicate · See: “RTFM #812”</div>}

            <div className="answer-body">
              <div className="answer-title">Answer</div>
              <p>
                {error ||
                  answer ||
                  (isLoading
                    ? 'Thinking. This might take as long as a real Stack Overflow thread.'
                    : 'Ask something first. We are waiting.')}
              </p>
            </div>

            <div className="answer-footer">
              <span>Answered by:</span>
              <strong>overengineered_dev_2009</strong>
              <span className="badge">AI upvoted itself</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
