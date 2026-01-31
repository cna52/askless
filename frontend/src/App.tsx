import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabaseClient'
import './App.css'

function App() {
  const [question, setQuestion] = useState('')
  const [sass, setSass] = useState(55)
  const [answer, setAnswer] = useState('')
  const [upvotes, setUpvotes] = useState(0)
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

  useEffect(() => {
    if (!answer) return
    setUpvotes(41)
    let ticks = 0
    const id = setInterval(() => {
      ticks += 1
      setUpvotes((prev: number) => prev + 1)
      if (ticks >= 3) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [answer])

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
    setIsLoading(true)
    setError('')
    setAnswer('')
    setIsClosed(false)
    setUpvotes(0)

    try {
      const response = await fetch(`${apiBase}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          sassLevel: sass,
          sassLabel,
        }),
      })

      if (!response.ok) {
        throw new Error('Backend error')
      }

      const data = (await response.json()) as { answer: string }
      setAnswer(data.answer)
      setIsClosed(sass >= 65 || trimmed.length < 12)
    } catch (err) {
      setError('Backend is judging you silently. Check the server logs.')
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
              Get instant answers with AI Assist, grounded in community-verified knowledge.
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

          {(answer || error || isLoading) && (
            <section className="answer-section">
              <div className="answer-card">
                <div className="answer-header">
                  <div className="answer-votes">
                    <button className="vote-button upvote">▲</button>
                    <div className="vote-count">{upvotes}</div>
                    <button className="vote-button downvote">▼</button>
                  </div>
                  <div className="answer-content">
                    {isClosed && (
                      <div className="closed-banner">Closed as duplicate · See: "RTFM #812"</div>
                    )}
                    <div className="answer-text">
                      {error ||
                        answer ||
                        'Thinking. This might take as long as a real Stack Overflow thread.'}
                    </div>
                    <div className="answer-footer">
                      <div className="answer-author">
                        <span>Answered by:</span>
                        <a href="#" className="author-link">overengineered_dev_2009</a>
                        <span className="author-badge">AI upvoted itself</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="stats-section">
            <div className="stat-card">
              <div className="stat-value">{upvotes}</div>
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
