import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './Tabs.css'

interface Tag {
  id: number
  name: string
  question_count: number
}

interface Question {
  id: string
  title: string
  content: string
  created_at: string
  user_id: string
  author: string
  answers: number
  views: number
  votes: number
  tags: string[]
  created: string
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export function Tabs({ onSelectQuestion }: { onSelectQuestion?: (questionId: string) => void }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTag, setSelectedTag] = useState<number | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

  useEffect(() => {
    const fetchTags = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`${apiBase}/api/tags/with-counts`)
        if (!response.ok) {
          throw new Error('Failed to fetch tags')
        }

        const tagsData = await response.json()
        setTags(tagsData)
      } catch (err) {
        console.error('Error fetching tags:', err)
        setError(err instanceof Error ? err.message : 'Failed to load tags')
      } finally {
        setLoading(false)
      }
    }

    fetchTags()
  }, [apiBase])

  const handleTagClick = async (tagId: number) => {
    setSelectedTag(tagId)
    setQuestionsLoading(true)
    setError(null)

    try {
      // Fetch questions for this tag
      const response = await fetch(`${apiBase}/api/tags/${tagId}/questions`)
      if (!response.ok) {
        throw new Error('Failed to fetch questions')
      }

      const questionsData = await response.json()

      if (!questionsData || questionsData.length === 0) {
        setQuestions([])
        setQuestionsLoading(false)
        return
      }

      // Fetch all user profiles in bulk
      const userIds = [...new Set(questionsData.map((q: any) => q.user_id))]
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds)

      if (profilesError) {
        console.warn('Error fetching profiles:', profilesError)
      }

      const profileMap = new Map(profilesData?.map((p: any) => [p.id, p.username]) || [])

      // Fetch answer counts for these questions
      const questionIds = questionsData.map((q: any) => q.id)
      const { data: answersData, error: answersError } = await supabase
        .from('answers')
        .select('question_id')
        .in('question_id', questionIds)

      if (answersError) {
        console.warn('Error fetching answers:', answersError)
      }

      const answerCountMap = new Map<string, number>()
      answersData?.forEach((answer: any) => {
        const id = answer.question_id
        answerCountMap.set(id, (answerCountMap.get(id) || 0) + 1)
      })

      // Fetch votes for these questions and compute totals
      const { data: votesData, error: votesError } = await supabase
        .from('votes')
        .select('question_id, vote_type')
        .in('question_id', questionIds)

      if (votesError) {
        console.warn('Error fetching votes:', votesError)
      }

      const voteTotalMap = new Map<string, number>()
      votesData?.forEach((vote: any) => {
        const id = vote.question_id
        if (!id) return
        const delta = vote.vote_type === 'downvote' ? -1 : 1
        voteTotalMap.set(id, (voteTotalMap.get(id) || 0) + delta)
      })

      // Fetch tags for each question
      const { data: questionTagsData, error: questionTagsError } = await supabase
        .from('question_tags')
        .select('question_id, tags(name)')
        .in('question_id', questionIds)

      if (questionTagsError) {
        console.warn('Error fetching question tags:', questionTagsError)
      }

      const tagsMap = new Map<string, string[]>()
      questionTagsData?.forEach((qt: any) => {
        const qId = qt.question_id
        const tagName = qt.tags?.name
        if (tagName) {
          const existing = tagsMap.get(qId) || []
          tagsMap.set(qId, [...existing, tagName])
        }
      })

      // Transform the data to match our Question interface
      const transformedQuestions: Question[] = questionsData.map((q: any) => ({
        id: q.id,
        title: q.title,
        content: q.content,
        created_at: q.created_at,
        user_id: q.user_id,
        author: profileMap.get(q.user_id) || 'Anonymous',
        answers: answerCountMap.get(q.id) || 0,
        views: Math.floor(Math.random() * 2000) + 100, // Placeholder - not in schema
        votes: voteTotalMap.get(q.id) || 0,
        tags: tagsMap.get(q.id) || [],
        created: formatRelativeTime(q.created_at),
      }))

      setQuestions(transformedQuestions)
    } catch (err) {
      console.error('Error fetching questions:', err)
      setError(err instanceof Error ? err.message : 'Failed to load questions')
    } finally {
      setQuestionsLoading(false)
    }
  }

  if (loading) {
    return (
      <section className="tabs-page">
        <div className="tabs-header">
          <h1>Tags</h1>
          <p className="tabs-subtitle">
            Browse all tags and topics. Click to drill in later.
          </p>
        </div>
        <div className="tabs-loading">Loading tags...</div>
      </section>
    )
  }

  if (error && !selectedTag) {
    return (
      <section className="tabs-page">
        <div className="tabs-header">
          <h1>Tags</h1>
          <p className="tabs-subtitle">
            Browse all tags and topics. Click to drill in later.
          </p>
        </div>
        <div className="tabs-error">Error: {error}</div>
      </section>
    )
  }

  if (selectedTag) {
    const selectedTagData = tags.find(t => t.id === selectedTag)
    return (
      <section className="tabs-page">
        <div className="tabs-header">
          <button
            type="button"
            onClick={() => {
              setSelectedTag(null)
              setQuestions([])
            }}
            style={{
              marginBottom: '16px',
              padding: '8px 16px',
              background: 'var(--so-blue)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            ← Back to Tags
          </button>
          <h1>Questions tagged: {selectedTagData?.name}</h1>
          <p className="tabs-subtitle">
            {selectedTagData?.question_count || 0} questions
          </p>
        </div>

        {questionsLoading ? (
          <div className="tabs-loading">Loading questions...</div>
        ) : questions.length === 0 ? (
          <div className="tabs-empty">No questions found for this tag.</div>
        ) : (
          <div className="questions-grid">
            {questions.map((question: Question) => (
              <div
                key={question.id}
                className="question-box"
                role={onSelectQuestion ? 'button' : undefined}
                tabIndex={onSelectQuestion ? 0 : undefined}
                onClick={() => onSelectQuestion?.(question.id)}
                onKeyDown={(event) => {
                  if (!onSelectQuestion) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectQuestion(question.id)
                  }
                }}
              >
                <div className="question-stats">
                  <div className="stat-item">
                    <div className="stat-number">{question.votes}</div>
                    <div className="stat-label">votes</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{question.answers}</div>
                    <div className="stat-label">answers</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{question.views}</div>
                    <div className="stat-label">views</div>
                  </div>
                </div>

                <div className="question-content">
                  <h3 className="question-title">
                    <button
                      type="button"
                      className="question-link"
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectQuestion?.(question.id)
                      }}
                    >
                      {question.title}
                    </button>
                  </h3>
                  <p className="question-excerpt">{question.content}</p>

                  <div className="question-meta">
                    <div className="question-tags">
                      {question.tags.map((tag: string) => (
                        <span key={tag} className="question-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="question-info">
                      <span className="question-author">{question.author}</span>
                      <span className="question-time">{question.created}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="tabs-page">
      <div className="tabs-header">
        <h1>Tags</h1>
        <p className="tabs-subtitle">
          Browse all tags and topics. Click to see questions.
        </p>
      </div>
      {tags.length === 0 ? (
        <div className="tabs-empty">No tags found.</div>
      ) : (
        <div className="tabs-grid">
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="tabs-card"
              onClick={() => handleTagClick(tag.id)}
            >
              <span className="tabs-chip">{tag.name}</span>
              <p className="tabs-desc">
                Discussions, questions, and best practices about {tag.name}.
              </p>
              <div className="tabs-meta">
                <span className="tabs-count">
                  {tag.question_count} {tag.question_count === 1 ? 'question' : 'questions'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
