import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './lib/supabaseClient'
import './App.css'

interface BotAnswer {
  answer: {
    id: string
    content: string
    created_at: string
  }
  botProfile: {
    id: string
    username: string
    avatar_url?: string
  }
  botName: string
  botId: string
  answerText: string
}

function App() {
  const [question, setQuestion] = useState('')
  const [sass, setSass] = useState(55)
  const [answers, setAnswers] = useState<BotAnswer[]>([])
  const [visibleAnswers, setVisibleAnswers] = useState<BotAnswer[]>([])
  const [upvotes, setUpvotes] = useState<Record<string, number>>({})
  const [isClosed, setIsClosed] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

  const sassLabel = useMemo(() => {
    if (sass < 25) return 'Kind'
    if (sass < 50) return 'Helpful'
    if (sass < 75) return 'Snarky'
    return 'Unhinged'
  }, [sass])

  // Shuffle array function
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  // Reveal answers one by one with delays
  useEffect(() => {
    if (answers.length === 0) {
      setVisibleAnswers([])
      return
    }

    // Shuffle answers for random order
    const shuffled = shuffleArray(answers)
    setVisibleAnswers([])

    // Reveal answers one by one with staggered delays (2-4 seconds between each)
    shuffled.forEach((answer, index) => {
      const delay = index === 0
        ? 1000 // First answer appears after 1 second
        : 1000 + (index * 2000) + Math.random() * 2000 // Subsequent answers: 2-4 seconds apart (staggered)

      setTimeout(() => {
        setVisibleAnswers((prev) => [...prev, answer])

        // Initialize upvote for this answer
        setUpvotes((prev) => ({
          ...prev,
          [answer.answer.id]: 41
        }))
      }, delay)
    })
  }, [answers])

  // Animate upvotes for visible answers
  useEffect(() => {
    if (visibleAnswers.length === 0) return

    let ticks = 0
    const id = setInterval(() => {
      ticks += 1
      setUpvotes((prev) => {
        const updated = { ...prev }
        visibleAnswers.forEach((a) => {
          if (updated[a.answer.id]) {
            updated[a.answer.id] = updated[a.answer.id] + 1
          }
        })
        return updated
      })
      if (ticks >= 3) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [visibleAnswers])

  useEffect(() => {
    let isMounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) setUser(data.session?.user ?? null)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const upsertProfile = async (currentUser: User) => {
      const username =
        currentUser.user_metadata?.user_name ||
        currentUser.user_metadata?.preferred_username ||
        currentUser.user_metadata?.full_name ||
        currentUser.email?.split('@')[0] ||
        `user_${currentUser.id.slice(0, 6)}`
      const avatarUrl = currentUser.user_metadata?.avatar_url || null

      const { error: upsertError } = await supabase.from('profiles').upsert(
        {
          id: currentUser.id,
          username,
          is_ai: false,
          avatar_url: avatarUrl,
        },
        { onConflict: 'id' }
      )

      if (upsertError) {
        console.warn('Profile upsert failed:', upsertError.message)
      }
    }

    if (user) {
      upsertProfile(user)
    }
  }, [user])

  const handleLogin = async () => {
    setAuthError('')
    setAuthLoading(true)
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:3000/oauth/consent',
      },
    })
    if (signInError) {
      setAuthError('Login failed. Check your Supabase Google OAuth settings.')
    }
    setAuthLoading(false)
  }

  const handleLogout = async () => {
    setAuthError('')
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setAuthError('Sign out failed. Try again.')
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed) return
    if (!user) {
      setError('Please sign in before asking a question.')
      return
    }
    setIsLoading(true)
    setError('')
    setAnswers([])
    setVisibleAnswers([])
    setIsClosed(false)
    setUpvotes({})

    try {
      const username =
        user.user_metadata?.user_name ||
        user.user_metadata?.preferred_username ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0]
      const avatarUrl = user.user_metadata?.avatar_url || null

      const response = await fetch(`${apiBase}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          sassLevel: sass,
          sassLabel,
          userId: user.id,
          username,
          avatarUrl,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Backend error')
      }

      const data = (await response.json()) as {
        answers?: BotAnswer[]
        answerText?: string
        answer?: { content?: string }
      }

      // Handle new format with multiple answers
      if (data.answers && Array.isArray(data.answers)) {
        setAnswers(data.answers)
      } else if (data.answerText || data.answer?.content) {
        // Fallback for old format (shouldn't happen but just in case)
        setAnswers([{
          answer: {
            id: 'legacy',
            content: data.answerText || data.answer?.content || '',
            created_at: new Date().toISOString()
          },
          botProfile: {
            id: 'legacy',
            username: 'ai_assistant'
          },
          botName: 'AI Assistant',
          botId: 'legacy',
          answerText: data.answerText || data.answer?.content || ''
        }])
      }

      setIsClosed(sass >= 65 || trimmed.length < 12)
    } catch (err: any) {
      setError(err.message || 'Backend is judging you silently. Check the server logs.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="top-header">
        <div className="header-left">
          <div className="logo">askless</div>
          <a href="#" className="header-link">Products</a>
        </div>
        <div className="header-search">
          <input type="search" placeholder="Q Search..." className="search-input" />
        </div>
        <div className="header-right">
          {user ? (
            <div className="auth-user">
              <span className="auth-name">
                {user.user_metadata?.full_name || user.user_metadata?.name || user.email}
              </span>
              <button type="button" className="auth-button ghost" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="auth-button"
              onClick={handleLogin}
              disabled={authLoading}
            >
              {authLoading ? 'Redirecting…' : 'Sign in with Google'}
            </button>
          )}
          {authError && <span className="auth-error">{authError}</span>}
          <div className="header-icon">
            <span className="icon-bell">🔔</span>
            <span className="badge-count">1</span>
          </div>
          <div className="header-icon">✉️</div>
          <div className="header-icon">🏆</div>
          <div className="header-icon">❓</div>
          <div className="header-icon">☰</div>
        </div>
      </header>

      <div className="main-layout">
        <aside className="left-sidebar">
          <nav className="sidebar-nav">
            <a href="#" className="nav-item active">Home</a>
            <a href="#" className="nav-item">Questions</a>
            <a href="#" className="nav-item">AI Assist</a>
            <a href="#" className="nav-item">Tags</a>
            <a href="#" className="nav-item">Saves</a>
            <div className="nav-divider"></div>
            <a href="#" className="nav-item">Challenges</a>
            <a href="#" className="nav-item">Chat</a>
            <a href="#" className="nav-item">Articles</a>
            <a href="#" className="nav-item">Users</a>
            <a href="#" className="nav-item">Companies</a>
          </nav>
        </aside>

        <main className="content-area">
          <section className="ai-assist-section">
            <h1 className="ai-assist-title">Hey there, what do you want to learn today?</h1>
            <p className="ai-assist-subtitle">
              Get instant answers from multiple AI bots with different personalities - helpful, mean, blunt, and more!
            </p>
            <form className="ai-assist-form" onSubmit={handleSubmit}>
              <div className="input-wrapper">
                <textarea
                  className="ai-assist-input"
                  placeholder="Start a chat with AI Assist..."
                  value={question}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setQuestion(event.target.value)}
                  rows={3}
                />
                <button type="submit" className="ai-assist-submit" disabled={isLoading}>
                  ↑
                </button>
              </div>
              <div className="slider-controls">
                <label className="slider-label">Sass level: {sassLabel}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sass}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSass(Number(event.target.value))}
                  className="sass-slider"
                />
              </div>
            </form>
            <p className="ai-assist-disclaimer">
              By using AI Assist, you agree to askless.ai's Terms of Service and Privacy Policy.
            </p>
          </section>

          {(isLoading || visibleAnswers.length > 0 || answers.length > 0 || error) && (
            <section className="answer-section">
              {error && (
                <div className="error-message" style={{ padding: '1rem', color: 'red', marginBottom: '1rem' }}>
                  {error}
                </div>
              )}
              {isLoading && visibleAnswers.length === 0 && (
                <div className="answer-card">
                  <div className="answer-text" style={{ fontStyle: 'italic', color: '#666' }}>
                    no one has answered.
                  </div>
                </div>
              )}
              {visibleAnswers.map((botAnswer) => (
                <div key={botAnswer.answer.id} className="answer-card" style={{ marginBottom: '1.5rem' }}>
                  <div className="answer-header">
                    <div className="answer-votes">
                      <button className="vote-button upvote">▲</button>
                      <div className="vote-count">{upvotes[botAnswer.answer.id] || 0}</div>
                      <button className="vote-button downvote">▼</button>
                    </div>
                    <div className="answer-content">
                      {isClosed && (
                        <div className="closed-banner">Closed as duplicate · See: "RTFM #812"</div>
                      )}
                      <div className="answer-text">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {botAnswer.answerText || botAnswer.answer.content}
                        </ReactMarkdown>
                      </div>
                      <div className="answer-footer">
                        <div className="answer-author">
                          <span>Answered by:</span>
                          <a href="#" className="author-link">{botAnswer.botProfile.username}</a>
                          <span className="author-badge" style={{
                            marginLeft: '0.5rem',
                            padding: '0.25rem 0.5rem',
                            backgroundColor: '#e3f2fd',
                            borderRadius: '4px',
                            fontSize: '0.75rem'
                          }}>
                            {botAnswer.botName}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="stats-section">
            <div className="stat-card">
              <div className="stat-value">
                {visibleAnswers.length > 0
                  ? Object.values(upvotes).reduce((sum, val) => sum + val, 0)
                  : 0
                }
              </div>
              <div className="stat-label">Reputation</div>
              <p className="stat-description">Earn reputation by Asking, Answering & Editing.</p>
            </div>
            <div className="stat-card">
              <div className="stat-title">Badge progress</div>
              <p className="stat-description">Take the tour to earn your first badge!</p>
              <button className="stat-button">Get started here</button>
            </div>
            <div className="stat-card">
              <div className="stat-title">
                Watched tags
                <span className="stat-icon">⚙️</span>
              </div>
              <p className="stat-description">You're not watching any tags yet!</p>
              <button className="stat-button">Customize your feed</button>
            </div>
          </section>
        </main>

        <aside className="right-sidebar">
          <button className="ask-question-btn">Ask Question</button>
          <div className="sidebar-widget">
            <h3 className="widget-title">The Overflow Blog</h3>
            <ul className="widget-list">
              <li>Are you learning with AI? We want to know about it!</li>
              <li>Wanna see a CSS magic trick?</li>
            </ul>
          </div>
          <div className="sidebar-widget">
            <h3 className="widget-title">Featured on Meta</h3>
            <ul className="widget-list">
              <li>Results of the January 2026 Community Asks Sprint: Community Badges</li>
              <li>All users on Stack Exchange can now participate in chat</li>
              <li>Policy: Generative AI (e.g., ChatGPT) is banned</li>
              <li>Stack Overflow now uses machine learning to flag spam automatically</li>
              <li>No, I do not believe this is the end</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default App
