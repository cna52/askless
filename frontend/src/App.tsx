import { useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './lib/supabaseClient'
import { Questions } from './pages/Questions'
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

interface Question {
  id: string
  title: string
  content: string
  created_at: string
  user_id: string
}

interface Comment {
  id: string
  answer_id: string
  user_id: string
  content: string
  created_at: string
  parent_id?: string
  profile?: {
    username: string
    avatar_url?: string
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState<'home' | 'questions'>('home')
  const [view, setView] = useState<'ask' | 'question'>('ask')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [answers, setAnswers] = useState<BotAnswer[]>([])
  const [visibleAnswers, setVisibleAnswers] = useState<BotAnswer[]>([])
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({})
  const [replyingTo, setReplyingTo] = useState<Record<string, string>>({})
  const [upvotes, setUpvotes] = useState<Record<string, number>>({})
  const [isClosed, setIsClosed] = useState(false)
  const [duplicateNotice, setDuplicateNotice] = useState('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'summarize': true,
    'tried': false,
    'code': false
  })
  const [user, setUser] = useState<User | null>(null)
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [availableTags, setAvailableTags] = useState<Array<{id: number, name: string}>>([])
  const [selectedTags, setSelectedTags] = useState<number[]>([])

  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

  const titleLength = title.trim().length
  const bodyLength = body.trim().length
  const isTitleValid = titleLength >= 15
  const isBodyValid = bodyLength >= 20
  const canSubmit = isTitleValid && isBodyValid && !isLoading && user

  const loadComments = useCallback(async (answerId: string) => {
    try {
      const response = await fetch(`${apiBase}/api/answers/${answerId}/comments`)
      if (response.ok) {
        const data = await response.json()
        setComments(prev => ({ ...prev, [answerId]: data }))
      }
    } catch (err) {
      console.error('Failed to load comments:', err)
    }
  }, [apiBase])

  const handleSelectQuestion = useCallback(async (questionId: string) => {
    try {
      setError('')
      setDuplicateNotice('')
      setIsClosed(false)
      setIsLoading(true)
      setCurrentPage('home')
      setView('question')
      setCurrentQuestion(null)
      setAnswers([])
      setVisibleAnswers([])
      setComments({})
      setUpvotes({})

      const [questionRes, answersRes, tagsRes] = await Promise.all([
        fetch(`${apiBase}/api/questions/${questionId}`),
        fetch(`${apiBase}/api/questions/${questionId}/answers`),
        supabase
          .from('question_tags')
          .select('tags(name)')
          .eq('question_id', questionId)
      ])

      if (!questionRes.ok) {
        throw new Error('Failed to load question')
      }

      const questionData = (await questionRes.json()) as Question
      const answersData = (await answersRes.json()) as Array<{
        id: string
        content: string
        created_at: string
        user_id: string
      }>

      const tagNames =
        (tagsRes.data || [])
          .map((item: { tags?: { name?: string } }) => item.tags?.name)
          .filter(Boolean) as string[]

      setTags(tagNames.join(', '))
      setCurrentQuestion(questionData)

      if (answersData.length > 0) {
        const userIds = [...new Set(answersData.map(answer => answer.user_id))]
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', userIds)

        const profileMap = new Map(
          (profilesData || []).map((profile: { id: string; username: string; avatar_url?: string }) => [
            profile.id,
            profile,
          ])
        )

        const mappedAnswers: BotAnswer[] = answersData.map((answer) => {
          const profile = profileMap.get(answer.user_id)
          return {
            answer: {
              id: answer.id,
              content: answer.content,
              created_at: answer.created_at,
            },
            botProfile: {
              id: profile?.id || answer.user_id,
              username: profile?.username || 'Anonymous',
              avatar_url: profile?.avatar_url,
            },
            botName: profile?.username || 'Anonymous',
            botId: profile?.id || answer.user_id,
            answerText: answer.content,
          }
        })

        setAnswers(mappedAnswers)
        mappedAnswers.forEach((a) => {
          loadComments(a.answer.id)
        })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load question.')
    } finally {
      setIsLoading(false)
    }
  }, [apiBase, loadComments])

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

        // Load comments when answer becomes visible
        loadComments(answer.answer.id)
      }, delay)
    })
  }, [answers, view])

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

  // Load comments when question view is shown
  useEffect(() => {
    if (view === 'question' && visibleAnswers.length > 0) {
      visibleAnswers.forEach(answer => {
        loadComments(answer.answer.id)
      })
    }
  }, [view, visibleAnswers, loadComments])

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

  // Fetch available tags
  useEffect(() => {
    fetch(`${apiBase}/api/tags`)
      .then(res => res.json())
      .then(tags => setAvailableTags(tags))
      .catch(err => console.error('Error fetching tags:', err))
  }, [apiBase])

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
    const trimmedTitle = title.trim()
    const trimmedBody = body.trim()

    if (!trimmedTitle || !trimmedBody) return
    if (!isTitleValid || !isBodyValid) return
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
    setDuplicateNotice('')

    try {
      const username =
        user.user_metadata?.user_name ||
        user.user_metadata?.preferred_username ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0]
      const avatarUrl = user.user_metadata?.avatar_url || null

      const normalizedTagIds =
        selectedTags.length > 0
          ? selectedTags
          : tags
              .split(',')
              .map(tag => tag.trim().toLowerCase())
              .filter(Boolean)
              .map(tagName => availableTags.find(tag => tag.name.toLowerCase() === tagName)?.id)
              .filter((id): id is number => Boolean(id))
              .slice(0, 5)

      const response = await fetch(`${apiBase}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmedBody,
          title: trimmedTitle,
          userId: user.id,
          username,
          avatarUrl,
          tagIds: normalizedTagIds,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Backend error')
      }

      const data = (await response.json()) as {
        question?: Question
        originalQuestion?: Question
        answers?: BotAnswer[]
        answerText?: string
        answer?: { content?: string }
        isDuplicate?: boolean
        message?: string
        environmentMessage?: string
      }

      // If we got a question back, navigate to question view
      if (data.isDuplicate && data.originalQuestion) {
        setCurrentQuestion(data.originalQuestion)
        if (data.answers && Array.isArray(data.answers)) {
          setAnswers(data.answers)
        }
        setView('question')
        setDuplicateNotice(
          [data.message, data.environmentMessage].filter(Boolean).join(' ')
        )
      } else if (data.question) {
        setCurrentQuestion(data.question)
        // Handle new format with multiple answers
        if (data.answers && Array.isArray(data.answers)) {
          setAnswers(data.answers)
        }
        // Clear form and switch to question view
        setTitle('')
        setBody('')
        setTags('')
        setView('question')
        // Load comments for all answers
        if (data.answers) {
          data.answers.forEach(a => {
            loadComments(a.answer.id)
          })
        }
      } else if (data.answers && Array.isArray(data.answers)) {
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
    } catch (err: any) {
      setError(err.message || 'Failed to submit question. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddComment = async (answerId: string, parentId?: string) => {
    if (!user) {
      setError('Please sign in to comment.')
      return
    }

    const commentText = parentId
      ? replyingTo[`${answerId}-${parentId}`] || ''
      : commentTexts[answerId] || ''

    if (!commentText.trim()) return

    try {
      const username =
        user.user_metadata?.user_name ||
        user.user_metadata?.preferred_username ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0]
      const avatarUrl = user.user_metadata?.avatar_url || null

      const response = await fetch(`${apiBase}/api/answers/${answerId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: commentText.trim(),
          userId: user.id,
          username,
          avatarUrl,
          parentId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to post comment')
      }

      // Clear comment text
      if (parentId) {
        setReplyingTo(prev => {
          const newReplying = { ...prev }
          delete newReplying[`${answerId}-${parentId}`]
          return newReplying
        })
      } else {
        setCommentTexts(prev => {
          const newTexts = { ...prev }
          delete newTexts[answerId]
          return newTexts
        })
      }

      // Reload comments
      await loadComments(answerId)
    } catch (err: any) {
      setError(err.message || 'Failed to post comment.')
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
            <a
              href="#"
              className={`nav-item ${currentPage === 'home' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('home')
              }}
            >
              Home
            </a>
            <a
              href="#"
              className={`nav-item ${currentPage === 'questions' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('questions')
              }}
            >
              Questions
            </a>
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
          {currentPage === 'home' ? (
            <>
              {view === 'ask' ? (
            <section className="question-form-section">
              <h1 className="question-form-title">Ask a question</h1>
              <form className="question-form" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="title" className="form-label">
                    Title <span className="required">*</span>
                  </label>
                  <p className="form-hint">
                    Be specific and imagine you're asking a question to another person. Min 15 characters.
                  </p>
                  <input
                    id="title"
                    type="text"
                    className="form-input"
                    placeholder="e.g. How do I center a div in CSS?"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={150}
                  />
                  <div className="form-counter">
                    {titleLength} / 150 {!isTitleValid && titleLength > 0 && (
                      <span className="form-error"> (minimum 15 characters)</span>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="body" className="form-label">
                    Body <span className="required">*</span>
                  </label>
                  <p className="form-hint">
                    Include all the information someone would need to answer your question. Min 20 characters.
                  </p>
                  <textarea
                    id="body"
                    className="form-textarea"
                    placeholder="Describe your question in detail..."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={10}
                  />
                  <div className="form-counter">
                    {bodyLength} characters {!isBodyValid && bodyLength > 0 && (
                      <span className="form-error"> (minimum 20 characters)</span>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="tags" className="form-label">
                    Tags
                  </label>
                  <p className="form-hint">
                    Add tags to describe what your question is about (comma-separated).
                  </p>
                  <input
                    id="tags"
                    type="text"
                    className="form-input"
                    placeholder="e.g. javascript, react, css"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </div>

                <div className="tag-selection-wrapper">
                  <label className="tag-selection-label">Select tags (up to 5):</label>
                  <div className="tag-grid">
                    {availableTags.slice(0, 30).map(tag => (
                      <label key={tag.id} className="tag-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedTags.includes(tag.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              if (selectedTags.length < 5) {
                                setSelectedTags([...selectedTags, tag.id])
                              }
                            } else {
                              setSelectedTags(selectedTags.filter(id => id !== tag.id))
                            }
                          }}
                        />
                        <span className="tag-name">{tag.name}</span>
                      </label>
                    ))}
                  </div>
                  {selectedTags.length > 0 && (
                    <div className="selected-tags">
                      <strong>Selected:</strong>
                      {selectedTags.map(id => {
                        const tag = availableTags.find(t => t.id === id)
                        return tag ? <span key={id} className="tag-badge">{tag.name}</span> : null
                      })}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="form-error-message">{error}</div>
                )}

                <div className="form-actions">
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={!canSubmit}
                  >
                    {isLoading ? 'Posting...' : 'Post your question'}
                  </button>
                  {!user && (
                    <p className="form-hint" style={{ marginTop: '0.5rem' }}>
                      Please sign in to ask a question.
                    </p>
                  )}
                </div>
              </form>
            </section>
          ) : currentQuestion ? (
            <section className="question-detail-section">
              <div className="question-header">
                <h1 className="question-title">{currentQuestion.title}</h1>
                <button
                  className="ask-question-link"
                  onClick={() => {
                    setView('ask')
                    setCurrentQuestion(null)
                    setAnswers([])
                    setVisibleAnswers([])
                    setComments({})
                  }}
                >
                  Ask Question
                </button>
              </div>
              {duplicateNotice && (
                <div className="closed-banner">{duplicateNotice}</div>
              )}

              <div className="question-content-card">
                <div className="question-votes">
                  <button className="vote-button upvote">▲</button>
                  <div className="vote-count">0</div>
                  <button className="vote-button downvote">▼</button>
                </div>
                <div className="question-body">
                  <div className="question-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentQuestion.content}
                    </ReactMarkdown>
                  </div>
                  <div className="question-footer">
                    <div className="question-tags">
                      {tags && tags.split(',').map((tag, i) => (
                        <span key={i} className="tag">{tag.trim()}</span>
                      ))}
                    </div>
                    <div className="question-author">
                      <span>Asked by:</span>
                      <a href="#" className="author-link">{user?.user_metadata?.full_name || user?.email || 'You'}</a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="answers-section">
                <h2 className="answers-title">
                  {visibleAnswers.length} {visibleAnswers.length === 1 ? 'Answer' : 'Answers'}
                </h2>

                {visibleAnswers.map((botAnswer) => {
                  const answerComments = comments[botAnswer.answer.id] || []
                  const topLevelComments = answerComments.filter(c => !c.parent_id)

                  return (
                    <div key={botAnswer.answer.id} className="answer-card" style={{ marginBottom: '1.5rem' }}>
                      <div className="answer-header">
                        <div className="answer-votes">
                          <button className="vote-button upvote">▲</button>
                          <div className="vote-count">{upvotes[botAnswer.answer.id] || 0}</div>
                          <button className="vote-button downvote">▼</button>
                        </div>
                        <div className="answer-content">
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

                          {/* Comments Section */}
                          <div className="comments-section">
                            {topLevelComments.map(comment => (
                              <div key={comment.id} className="comment-item">
                                <div className="comment-content">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {comment.content}
                                  </ReactMarkdown>
                                  <div className="comment-author">
                                    <a href="#" className="author-link">{comment.profile?.username || 'User'}</a>
                                    <button
                                      className="comment-reply-btn"
                                      onClick={() => {
                                        const key = `${botAnswer.answer.id}-${comment.id}`
                                        setReplyingTo(prev => ({
                                          ...prev,
                                          [key]: prev[key] || ''
                                        }))
                                      }}
                                    >
                                      Reply
                                    </button>
                                  </div>
                                </div>

                                {/* Reply input */}
                                {replyingTo[`${botAnswer.answer.id}-${comment.id}`] !== undefined && (
                                  <div className="comment-reply-form">
                                    <textarea
                                      className="comment-input"
                                      placeholder="Add a reply..."
                                      value={replyingTo[`${botAnswer.answer.id}-${comment.id}`] || ''}
                                      onChange={(e) => setReplyingTo(prev => ({
                                        ...prev,
                                        [`${botAnswer.answer.id}-${comment.id}`]: e.target.value
                                      }))}
                                      rows={3}
                                    />
                                    <div className="comment-actions">
                                      <button
                                        className="comment-submit-btn"
                                        onClick={() => handleAddComment(botAnswer.answer.id, comment.id)}
                                      >
                                        Add Reply
                                      </button>
                                      <button
                                        className="comment-cancel-btn"
                                        onClick={() => {
                                          setReplyingTo(prev => {
                                            const newReplying = { ...prev }
                                            delete newReplying[`${botAnswer.answer.id}-${comment.id}`]
                                            return newReplying
                                          })
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Nested replies */}
                                {answerComments
                                  .filter(c => c.parent_id === comment.id)
                                  .map(reply => (
                                    <div key={reply.id} className="comment-item nested">
                                      <div className="comment-content">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {reply.content}
                                        </ReactMarkdown>
                                        <div className="comment-author">
                                          <a href="#" className="author-link">{reply.profile?.username || 'User'}</a>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            ))}

                            {/* Add comment form */}
                            {user && (
                              <div className="comment-form">
                                <textarea
                                  className="comment-input"
                                  placeholder="Add a comment..."
                                  value={commentTexts[botAnswer.answer.id] || ''}
                                  onChange={(e) => setCommentTexts(prev => ({
                                    ...prev,
                                    [botAnswer.answer.id]: e.target.value
                                  }))}
                                  rows={3}
                                />
                                <div className="comment-actions">
                                  <button
                                    className="comment-submit-btn"
                                    onClick={() => handleAddComment(botAnswer.answer.id)}
                                    disabled={!commentTexts[botAnswer.answer.id]?.trim()}
                                  >
                                    Add Comment
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

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
                    No one has answered.
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
            </>
          ) : (
            <Questions onSelectQuestion={handleSelectQuestion} />
          )}
        </main>

        <aside className="right-sidebar">
          {view === 'ask' ? (
            <>
              <div className="sidebar-widget draft-guide">
                <h3 className="widget-title">Draft your question</h3>
                <p className="draft-intro">
                  The community is here to help you with specific coding, algorithm, or language problems.
                </p>

                <div className="draft-sections">
                  <div className="draft-section">
                    <button
                      className="draft-section-header"
                      onClick={() => setExpandedSections(prev => ({ ...prev, summarize: !prev.summarize }))}
                    >
                      <span>1. Summarize the problem</span>
                      <span className="draft-toggle">{expandedSections.summarize ? '▲' : '▼'}</span>
                    </button>
                    {expandedSections.summarize && (
                      <ul className="draft-list">
                        <li>Include details about your goal</li>
                        <li>Describe expected and actual results</li>
                        <li>Include any error messages</li>
                      </ul>
                    )}
                  </div>

                  <div className="draft-section">
                    <button
                      className="draft-section-header"
                      onClick={() => setExpandedSections(prev => ({ ...prev, tried: !prev.tried }))}
                    >
                      <span>2. Describe what you've tried</span>
                      <span className="draft-toggle">{expandedSections.tried ? '▲' : '▼'}</span>
                    </button>
                    {expandedSections.tried && (
                      <ul className="draft-list">
                        <li>Show what you've attempted so far</li>
                        <li>Explain what research you've done</li>
                        <li>Mention any solutions you've considered</li>
                      </ul>
                    )}
                  </div>

                  <div className="draft-section">
                    <button
                      className="draft-section-header"
                      onClick={() => setExpandedSections(prev => ({ ...prev, code: !prev.code }))}
                    >
                      <span>3. Show some code</span>
                      <span className="draft-toggle">{expandedSections.code ? '▲' : '▼'}</span>
                    </button>
                    {expandedSections.code && (
                      <ul className="draft-list">
                        <li>Include relevant code snippets</li>
                        <li>Use code blocks for readability</li>
                        <li>Provide minimal reproducible examples</li>
                      </ul>
                    )}
                  </div>
                </div>

                <div className="draft-links">
                  <h4 className="draft-links-title">Helpful links</h4>
                  <ul className="draft-links-list">
                    <li>
                      <a href="#" className="draft-link">Find more information about how to ask a good question here.</a>
                    </li>
                    <li>
                      <a href="#" className="draft-link">Visit the help center.</a>
                    </li>
                    <li>
                      <a href="#" className="draft-link">Ask questions about the site on meta.</a>
                    </li>
                  </ul>
                </div>

                <div className="draft-feedback">
                  <a href="#" className="draft-feedback-link">
                    Help us improve how to ask a question by providing feedback or reporting a bug
                    <span className="external-link-icon">↗</span>
                  </a>
                </div>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

export default App
