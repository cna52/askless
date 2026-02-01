import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export interface Question {
  id: string
  title: string
  content: string
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

export function Questions() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch questions with related data
        const { data: questionsData, error: questionsError } = await supabase
          .from('questions')
          .select(`
            id,
            title,
            content,
            created_at,
            user_id,
            answers (id),
            question_tags (
              tag_id,
              tags (name)
            )
          `)
          .order('created_at', { ascending: false })

        if (questionsError) {
          throw questionsError
        }

        if (!questionsData) {
          setQuestions([])
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

        // Transform the data to match our Question interface
        const transformedQuestions: Question[] = questionsData.map((q: any) => {
          // Deduplicate answers by ID to prevent counting duplicates from joins
          const uniqueAnswers = q.answers
            ? Array.from(new Map(q.answers.map((a: any) => [a.id, a])).values())
            : []

          return {
            id: q.id,
            title: q.title,
            content: q.content,
            author: profileMap.get(q.user_id) || 'Anonymous',
            answers: uniqueAnswers.length,
            views: Math.floor(Math.random() * 2000) + 100, // Placeholder - not in schema
            votes: Math.floor(Math.random() * 200), // Placeholder - not in schema
            tags: q.question_tags?.map((qt: any) => qt.tags?.name).filter(Boolean) || [],
            created: formatRelativeTime(q.created_at),
          }
        })

        setQuestions(transformedQuestions)
      } catch (err) {
        console.error('Error fetching questions:', err)
        setError(err instanceof Error ? err.message : 'Failed to load questions')
      } finally {
        setLoading(false)
      }
    }

    fetchQuestions()
  }, [])

  if (loading) {
    return (
      <div className="questions-container">
        <div className="questions-header">
          <h1>Questions</h1>
          <p className="questions-subtitle">Browse all questions from the community</p>
        </div>
        <div className="questions-loading">Loading questions...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="questions-container">
        <div className="questions-header">
          <h1>Questions</h1>
          <p className="questions-subtitle">Browse all questions from the community</p>
        </div>
        <div className="questions-error">Error: {error}</div>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="questions-container">
        <div className="questions-header">
          <h1>Questions</h1>
          <p className="questions-subtitle">Browse all questions from the community</p>
        </div>
        <div className="questions-empty">No questions yet. Be the first to ask!</div>
      </div>
    )
  }

  return (
    <div className="questions-container">
      <div className="questions-header">
        <h1>Questions</h1>
        <p className="questions-subtitle">Browse all questions from the community</p>
      </div>

      <div className="questions-grid">
        {questions.map((question: Question) => (
          <div key={question.id} className="question-box">
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
              <h3 className="question-title">{question.title}</h3>
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
    </div>
  )
}
