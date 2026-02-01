import { useEffect, useState, useCallback, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './lib/supabaseClient'
import { Questions } from './pages/Questions'
import { Tabs } from './pages/Tabs'
import logoImg from './assets/logo.png'
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
  tags?: Array<{ id: string; name: string }>
  answerCount?: number
}

interface Comment {
  id: string
  answer_id?: string
  question_id?: string
  user_id: string
  content: string
  created_at: string
  parent_id?: string
  profile?: {
    username: string
    avatar_url?: string
  }
}

interface UserProfile {
  id: string
  username: string
  avatar_url?: string
  is_ai: boolean
}

interface UserActivity {
  questions: Question[]
  answers: Array<{
    id: string
    created_at: string
    question_id: string
    user_id: string
    content: string
    is_accepted: boolean
  }>
}

interface UserStats {
  questionsCount: number
  answersCount: number
}

interface CachedQuestion {
  question: Question
  answers: BotAnswer[]
  tags: string[]
  cachedAt: number
}

function App() {
  const [currentPage, setCurrentPage] = useState<'home' | 'questions' | 'question' | 'tags'>('home')
  const [view, setView] = useState<'ask' | 'question' | 'profile'>('ask')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [userActivity, setUserActivity] = useState<UserActivity | null>(null)
  const [userStats, setUserStats] = useState<UserStats | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [activeProfileTab, setActiveProfileTab] = useState<'summary' | 'questions' | 'answers'>('summary')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [answers, setAnswers] = useState<BotAnswer[]>([])
  const [visibleAnswers, setVisibleAnswers] = useState<BotAnswer[]>([])
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [questionComments, setQuestionComments] = useState<Comment[]>([])
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({})
  const [currentQuestionTags, setCurrentQuestionTags] = useState<string[]>([])
  const [currentQuestionAuthor, setCurrentQuestionAuthor] = useState<UserProfile | null>(null)
  const [questionCommentText, setQuestionCommentText] = useState('')
  const [replyingTo, setReplyingTo] = useState<Record<string, string>>({})
  const [replyingToQuestion, setReplyingToQuestion] = useState<Record<string, string>>({})
  const [upvotes, setUpvotes] = useState<Record<string, number>>({})
  const [voteCounts, setVoteCounts] = useState<Record<string, { upvotes: number; downvotes: number; total: number }>>({})
  const [userVotes, setUserVotes] = useState<Record<string, 'upvote' | 'downvote' | null>>({})
  const [duplicateNotice, setDuplicateNotice] = useState('')
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
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
  const [availableTags, setAvailableTags] = useState<Array<{ id: number, name: string }>>([])
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [markdownMode, setMarkdownMode] = useState<'write' | 'preview'>('write')
  const questionCacheRef = useRef<Map<string, CachedQuestion>>(new Map())

  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

  const QUESTION_CACHE_TTL = 5 * 60 * 1000
  const QUESTION_CACHE_MAX = 8
  const QUESTION_LS_TTL = 10 * 60 * 1000
  const COMMENT_LS_TTL = 10 * 60 * 1000

  const getLocalCachedQuestion = (questionId: string) => {
    try {
      const raw = localStorage.getItem(`askless:question:${questionId}`)
      if (!raw) return null
      const parsed = JSON.parse(raw) as CachedQuestion
      if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > QUESTION_LS_TTL) {
        localStorage.removeItem(`askless:question:${questionId}`)
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  const setLocalCachedQuestion = (questionId: string, entry: CachedQuestion) => {
    try {
      localStorage.setItem(`askless:question:${questionId}`, JSON.stringify(entry))
    } catch {
      // ignore storage errors for demo
    }
  }

  const getLocalCachedComments = (key: string) => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { data: Comment[]; cachedAt: number }
      if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > COMMENT_LS_TTL) {
        localStorage.removeItem(key)
        return null
      }
      return parsed.data
    } catch {
      return null
    }
  }

  const setLocalCachedComments = (key: string, data: Comment[]) => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ data, cachedAt: Date.now() })
      )
    } catch {
      // ignore storage errors for demo
    }
  }

  const getCachedQuestion = (questionId: string) => {
    const entry = questionCacheRef.current.get(questionId)
    if (!entry) return null
    if (Date.now() - entry.cachedAt > QUESTION_CACHE_TTL) {
      questionCacheRef.current.delete(questionId)
      return null
    }
    questionCacheRef.current.delete(questionId)
    questionCacheRef.current.set(questionId, entry)
    return entry
  }

  const setCachedQuestion = (questionId: string, entry: CachedQuestion) => {
    questionCacheRef.current.delete(questionId)
    questionCacheRef.current.set(questionId, entry)
    if (questionCacheRef.current.size > QUESTION_CACHE_MAX) {
      const oldestKey = questionCacheRef.current.keys().next().value
      if (oldestKey) questionCacheRef.current.delete(oldestKey)
    }
  }

  const titleLength = title.trim().length
  const bodyLength = body.trim().length
  const isTitleValid = titleLength >= 15
  const isBodyValid = bodyLength >= 20
  const canSubmit = isTitleValid && isBodyValid && !isLoading && user

  const loadComments = useCallback(async (answerId: string, force = false) => {
    try {
      const storageKey = `askless:comments:answer:${answerId}`
      if (!force) {
        const cached = getLocalCachedComments(storageKey)
        if (cached) {
          setComments(prev => ({ ...prev, [answerId]: cached }))
          return
        }
      }
      const response = await fetch(`${apiBase}/api/answers/${answerId}/comments`)
      if (response.ok) {
        const data = await response.json()
        // Ensure data is an array
        const commentsArray = Array.isArray(data) ? data : []
        console.log(`Loaded ${commentsArray.length} comments for answer ${answerId}`, commentsArray)
        setComments(prev => ({ ...prev, [answerId]: commentsArray }))
        setLocalCachedComments(storageKey, commentsArray)
      } else {
        console.error('Failed to load comments:', response.status, response.statusText)
      }
    } catch (err) {
      console.error('Failed to load comments:', err)
    }
  }, [apiBase])

  const loadQuestionComments = useCallback(async (questionId: string, force = false) => {
    try {
      const storageKey = `askless:comments:question:${questionId}`
      if (!force) {
        const cached = getLocalCachedComments(storageKey)
        if (cached) {
          setQuestionComments(cached)
          return
        }
      }
      const response = await fetch(`${apiBase}/api/questions/${questionId}/comments`)
      if (response.ok) {
        const data = await response.json()
        // Ensure data is an array
        const commentsArray = Array.isArray(data) ? data : []
        console.log(`Loaded ${commentsArray.length} question comments for question ${questionId}`, commentsArray)
        setQuestionComments(commentsArray)
        setLocalCachedComments(storageKey, commentsArray)
      } else {
        console.error('Failed to load question comments:', response.status, response.statusText)
      }
    } catch (err) {
      console.error('Failed to load question comments:', err)
    }
  }, [apiBase])

  const loadVoteCounts = useCallback(async (questionId?: string, answerId?: string) => {
    if (!questionId && !answerId) return

    try {
      const params = new URLSearchParams()
      if (questionId) params.append('questionId', questionId)
      if (answerId) params.append('answerId', answerId)
      if (user) params.append('userId', user.id)

      const response = await fetch(`${apiBase}/api/votes?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        const key = questionId || answerId || ''
        setVoteCounts(prev => ({
          ...prev,
          [key]: data.counts
        }))
        if (data.userVote) {
          setUserVotes(prev => ({
            ...prev,
            [key]: data.userVote.vote_type
          }))
        } else {
          setUserVotes(prev => ({
            ...prev,
            [key]: null
          }))
        }
      }
    } catch (err) {
      console.error('Failed to load vote counts:', err)
    }
  }, [apiBase, user])

  const handleVote = useCallback(async (questionId?: string, answerId?: string, voteType: 'upvote' | 'downvote' = 'upvote') => {
    if (!user) {
      setError('Please sign in to vote.')
      return
    }

    if (!questionId && !answerId) return

    try {
      const response = await fetch(`${apiBase}/api/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          questionId,
          answerId,
          voteType
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to vote')
      }

      const data = await response.json()
      const key = questionId || answerId || ''

      setVoteCounts(prev => ({
        ...prev,
        [key]: data.counts
      }))

      if (data.userVote) {
        setUserVotes(prev => ({
          ...prev,
          [key]: data.userVote.vote_type
        }))
      } else {
        setUserVotes(prev => ({
          ...prev,
          [key]: null
        }))
      }
    } catch (err: any) {
      setError(err.message || 'Failed to vote.')
    }
  }, [apiBase, user])

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

    // Only run this effect when we're in question view and answers change
    if (view !== 'question') {
      return
    }

    // Shuffle answers for random order
    const shuffled = shuffleArray(answers)
    setVisibleAnswers([])

    // Store timeout IDs to clean them up if the effect re-runs
    const timeoutIds: number[] = []

    // Reveal answers one by one with staggered delays (2-4 seconds between each)
    shuffled.forEach((answer, index) => {
      const delay = index === 0
        ? 1000 // First answer appears after 1 second
        : 1000 + (index * 2000) + Math.random() * 2000 // Subsequent answers: 2-4 seconds apart (staggered)

      const timeoutId = setTimeout(() => {
        setVisibleAnswers((prev) => {
          // Check if answer is already in the array to prevent duplicates
          const alreadyExists = prev.some(a => a.answer.id === answer.answer.id)
          if (alreadyExists) {
            return prev
          }
          return [...prev, answer]
        })

        // Initialize upvote for this answer
        setUpvotes((prev) => ({
          ...prev,
          [answer.answer.id]: 41
        }))

        // Load comments when answer becomes visible
        loadComments(answer.answer.id)
        // Load vote counts for the answer
        loadVoteCounts(undefined, answer.answer.id)
      }, delay)

      timeoutIds.push(timeoutId)
    })

    // Cleanup function to clear all timeouts if the effect re-runs
    return () => {
      timeoutIds.forEach(id => clearTimeout(id))
    }
  }, [answers, view, loadComments])

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
    if (view === 'question' && currentQuestion) {
      loadQuestionComments(currentQuestion.id)
      loadVoteCounts(currentQuestion.id)
      if (visibleAnswers.length > 0) {
        visibleAnswers.forEach(answer => {
          loadComments(answer.answer.id)
          loadVoteCounts(undefined, answer.answer.id)
        })
      }
    }
  }, [view, visibleAnswers, loadComments, currentQuestion, loadQuestionComments, loadVoteCounts])

  const loadUserProfile = useCallback(async (userId: string) => {
    setProfileLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/users/${userId}/profile`)
      if (response.ok) {
        const data = await response.json()
        setUserProfile(data.profile)
        setUserActivity(data.activity)
        setUserStats(data.stats)
      } else {
        console.error('Failed to load user profile')
      }
    } catch (err) {
      console.error('Failed to load user profile:', err)
    } finally {
      setProfileLoading(false)
    }
  }, [apiBase])

  const loadQuestionById = useCallback(async (questionId: string) => {
    setIsLoading(true)
    try {
      setError('')
      setDuplicateNotice('')
      setCurrentPage('question')
      setView('question')
      setCurrentQuestion(null)
      setCurrentQuestionAuthor(null)
      setCurrentQuestionTags([])
      setAnswers([])
      setVisibleAnswers([])
      setComments({})
      setUpvotes({})
      setVoteCounts({})
      setUserVotes({})

      const cached = getCachedQuestion(questionId)
      if (cached) {
        setCurrentQuestion(cached.question)
        setCurrentQuestionTags(cached.tags)
        setAnswers(cached.answers)
        setVisibleAnswers(cached.answers)
        setIsLoading(false)

        if (cached.question?.user_id) {
          try {
            const authorResponse = await fetch(`${apiBase}/api/users/${cached.question.user_id}/profile`)
            if (authorResponse.ok) {
              const authorData = await authorResponse.json()
              setCurrentQuestionAuthor(authorData?.profile || null)
            } else {
              setCurrentQuestionAuthor(null)
            }
          } catch (err) {
            setCurrentQuestionAuthor(null)
          }
        }

        loadQuestionComments(questionId)
        loadVoteCounts(questionId)
        cached.answers.forEach((botAnswer: BotAnswer) => {
          loadComments(botAnswer.answer.id)
          loadVoteCounts(undefined, botAnswer.answer.id)
        })
        return
      }

      const cachedLocal = getLocalCachedQuestion(questionId)
      if (cachedLocal) {
        setCurrentQuestion(cachedLocal.question)
        setCurrentQuestionTags(cachedLocal.tags)
        setAnswers(cachedLocal.answers)
        setVisibleAnswers(cachedLocal.answers)
        setIsLoading(false)

        if (cachedLocal.question?.user_id) {
          try {
            const authorResponse = await fetch(`${apiBase}/api/users/${cachedLocal.question.user_id}/profile`)
            if (authorResponse.ok) {
              const authorData = await authorResponse.json()
              setCurrentQuestionAuthor(authorData?.profile || null)
            } else {
              setCurrentQuestionAuthor(null)
            }
          } catch (err) {
            setCurrentQuestionAuthor(null)
          }
        }

        loadQuestionComments(questionId)
        loadVoteCounts(questionId)
        cachedLocal.answers.forEach((botAnswer: BotAnswer) => {
          loadComments(botAnswer.answer.id)
          loadVoteCounts(undefined, botAnswer.answer.id)
        })
        return
      }

      const [questionResponse, answersResponse] = await Promise.all([
        fetch(`${apiBase}/api/questions/${questionId}`),
        fetch(`${apiBase}/api/questions/${questionId}/answers`),
      ])

      if (!questionResponse.ok) {
        console.error('Failed to load question')
        return
      }

      const question = await questionResponse.json()
      setCurrentQuestion(question)
      setView('question')

      if (question?.user_id) {
        try {
          const authorResponse = await fetch(`${apiBase}/api/users/${question.user_id}/profile`)
          if (authorResponse.ok) {
            const authorData = await authorResponse.json()
            setCurrentQuestionAuthor(authorData?.profile || null)
          } else {
            setCurrentQuestionAuthor(null)
          }
        } catch (err) {
          setCurrentQuestionAuthor(null)
        }
      }

      const { data: tagRows, error: tagError } = await supabase
        .from('question_tags')
        .select('tags(name)')
        .eq('question_id', questionId)

      let tagNames: string[] = []
      if (tagError) {
        console.warn('Failed to load question tags:', tagError)
      } else {
        const names = (tagRows || [])
          .map((row: any) => row.tags?.name)
          .filter((name: string | undefined): name is string => Boolean(name))
        setCurrentQuestionTags(names)
        tagNames = names
      }

      const pollForAnswers = async (attempt = 0) => {
        if (attempt >= 6) return
        const response = await fetch(`${apiBase}/api/questions/${questionId}/answers`)
        if (!response.ok) return
        const answers = await response.json()
        if (!Array.isArray(answers) || answers.length === 0) {
          setTimeout(() => pollForAnswers(attempt + 1), 1500)
          return
        }

        const userIds = Array.from(new Set(answers.map((answer: any) => answer.user_id)))
        let profileMap = new Map<string, { id: string; username: string; avatar_url?: string; is_ai?: boolean }>()
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, is_ai')
            .in('id', userIds)
          profileMap = new Map(profiles?.map(profile => [profile.id, profile]) || [])
        }

        const botAnswers = answers.map((answer: any) => {
          const profile = profileMap.get(answer.user_id)
          return {
            answer: {
              id: answer.id,
              content: answer.content,
              created_at: answer.created_at,
            },
            botProfile: profile || {
              id: answer.user_id,
              username: 'Unknown',
            },
            botName: profile?.is_ai ? 'AI Assistant' : 'User',
            botId: answer.user_id,
            answerText: answer.content,
          }
        })

        setAnswers(botAnswers)
        setVisibleAnswers(botAnswers)
        loadQuestionComments(questionId)
        botAnswers.forEach((botAnswer: BotAnswer) => {
          loadComments(botAnswer.answer.id)
          loadVoteCounts(undefined, botAnswer.answer.id)
        })
        loadVoteCounts(questionId)
        setCachedQuestion(questionId, {
          question,
          answers: botAnswers,
          tags: tagNames,
          cachedAt: Date.now(),
        })
        setLocalCachedQuestion(questionId, {
          question,
          answers: botAnswers,
          tags: tagNames,
          cachedAt: Date.now(),
        })
      }

      if (answersResponse.ok) {
        const answers = await answersResponse.json()
        if (Array.isArray(answers) && answers.length === 0) {
          // No answers yet (fast mode). Poll briefly.
          setTimeout(() => {
            pollForAnswers()
          }, 1200)
          return
        }
        const userIds = Array.from(new Set(answers.map((answer: any) => answer.user_id)))

        let profileMap = new Map<string, { id: string; username: string; avatar_url?: string; is_ai?: boolean }>()
        if (userIds.length > 0) {
          const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, is_ai')
            .in('id', userIds)

          if (profilesError) {
            console.warn('Failed to load profiles for answers:', profilesError)
          } else {
            profileMap = new Map(profiles?.map(profile => [profile.id, profile]) || [])
          }
        }

        const botAnswers = answers.map((answer: any) => {
          const profile = profileMap.get(answer.user_id)
          return {
            answer: {
              id: answer.id,
              content: answer.content,
              created_at: answer.created_at,
            },
            botProfile: profile || {
              id: answer.user_id,
              username: 'Unknown',
            },
            botName: profile?.is_ai ? 'AI Assistant' : 'User',
            botId: answer.user_id,
            answerText: answer.content,
          }
        })

        setAnswers(botAnswers)

        // Load comments for the question and all answers (async follow-ups)
        loadQuestionComments(questionId)
        botAnswers.forEach((botAnswer: BotAnswer) => {
          loadComments(botAnswer.answer.id)
        })

        // Load vote counts for question and answers
        loadVoteCounts(questionId)
        botAnswers.forEach((botAnswer: BotAnswer) => {
          loadVoteCounts(undefined, botAnswer.answer.id)
        })

        setCachedQuestion(questionId, {
          question,
          answers: botAnswers,
          tags: tagNames,
          cachedAt: Date.now(),
        })
        setLocalCachedQuestion(questionId, {
          question,
          answers: botAnswers,
          tags: tagNames,
          cachedAt: Date.now(),
        })
      }

    } catch (err) {
      console.error('Failed to load question:', err)
    } finally {
      setIsLoading(false)
    }
  }, [apiBase, loadQuestionComments, loadComments, loadVoteCounts])

  const handleSelectQuestion = useCallback((questionId: string) => {
    if (!questionId) return
    window.location.hash = `#questions/${questionId}`
  }, [])

  // Check URL hash on mount and on hash change to handle profile and question links
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash
      if (hash === '#profile' && user) {
        setView('profile')
        loadUserProfile(user.id)
      } else if (hash === '#questions') {
        setCurrentPage('questions')
        setView('ask')
      } else if (hash === '#tags') {
        setCurrentPage('tags')
        setView('ask')
      } else if (hash.startsWith('#questions/')) {
        const questionId = hash.replace('#questions/', '')
        if (questionId) {
          loadQuestionById(questionId)
        }
        setCurrentPage('question')
        setView('question')
      } else if (!hash || hash === '' || hash === '#') {
        setView('ask')
        setCurrentPage('home')
      }
    }

    checkHash()
    window.addEventListener('hashchange', checkHash)

    return () => {
      window.removeEventListener('hashchange', checkHash)
    }
  }, [user, loadUserProfile, loadQuestionById])

  useEffect(() => {
    let isMounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setUser(data.session?.user ?? null)
        // If user is already logged in and we're on profile view, load profile
        if (data.session?.user && view === 'profile') {
          loadUserProfile(data.session.user.id)
        }
      }
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      // If user logs in and we're on profile view, load profile
      if (session?.user && view === 'profile') {
        loadUserProfile(session.user.id)
      }
    })
    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [view, loadUserProfile])

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
    setView('ask')
    setUserProfile(null)
    setUserActivity(null)
    setUserStats(null)
  }

  const handleProfileClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (user) {
      window.location.hash = '#profile'
    }
  }

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault()
    window.location.hash = '#'
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
          fast: true,
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

      // If we got a question back, navigate to that question's page
      if (data.isDuplicate && data.originalQuestion) {
        // Clear form and navigate to the original question page
        setTitle('')
        setBody('')
        setTags('')
        setSelectedTags([])
        setShowDuplicateModal(true)
        setCurrentPage('questions')
        window.location.hash = '#questions'
        setDuplicateNotice(
          [data.message].filter(Boolean).join(' ')
        )
      } else if (data.question) {
        // Clear form and navigate to the new question page
        setTitle('')
        setBody('')
        setTags('')
        setSelectedTags([])
        window.location.hash = `#questions/${data.question.id}`
      } else if (data.answers && Array.isArray(data.answers)) {
        // Clear form and navigate to questions page
        setTitle('')
        setBody('')
        setTags('')
        setSelectedTags([])
        setCurrentPage('questions')
        window.location.hash = '#questions'
      } else if (data.answerText || data.answer?.content) {
        // Clear form and navigate to questions page
        setTitle('')
        setBody('')
        setTags('')
        setSelectedTags([])
        setCurrentPage('questions')
        window.location.hash = '#questions'
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
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to post comment')
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

      // Reload comments after a short delay to ensure the comment is saved
      setTimeout(async () => {
        await loadComments(answerId, true)
      }, 300)
    } catch (err: any) {
      setError(err.message || 'Failed to post comment.')
    }
  }

  const handleAddQuestionComment = async (questionId: string, parentId?: string) => {
    if (!user) {
      setError('Please sign in to comment.')
      return
    }

    const commentText = parentId
      ? replyingToQuestion[parentId] || ''
      : questionCommentText || ''

    if (!commentText.trim()) return

    try {
      const username =
        user.user_metadata?.user_name ||
        user.user_metadata?.preferred_username ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0]
      const avatarUrl = user.user_metadata?.avatar_url || null

      const response = await fetch(`${apiBase}/api/questions/${questionId}/comments`, {
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
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to post comment')
      }

      // Clear comment text
      if (parentId) {
        setReplyingToQuestion(prev => {
          const newReplying = { ...prev }
          delete newReplying[parentId]
          return newReplying
        })
      } else {
        setQuestionCommentText('')
      }

      // Reload question comments after a short delay to ensure the comment is saved
      setTimeout(async () => {
        await loadQuestionComments(questionId, true)
      }, 100)
    } catch (err: any) {
      setError(err.message || 'Failed to post comment.')
    }
  }

  const handleDeleteComment = async (commentId: string, answerId?: string, questionId?: string) => {
    if (!user) {
      setError('Please sign in to delete comments.')
      return
    }

    if (!confirm('Are you sure you want to delete this comment?')) {
      return
    }

    try {
      const response = await fetch(`${apiBase}/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete comment')
      }

      // Immediately update local state for instant feedback
      if (answerId) {
        setComments(prev => {
          const updated = { ...prev }
          if (updated[answerId]) {
            // Remove the deleted comment and any nested comments
            updated[answerId] = updated[answerId].filter(c => {
              // Remove the comment itself and any comments that have this as parent
              return c.id !== commentId && c.parent_id !== commentId
            })
          }
          return updated
        })
      }

      if (questionId) {
        setQuestionComments(prev => {
          // Remove the deleted comment and any nested comments
          return prev.filter(c => {
            return c.id !== commentId && c.parent_id !== commentId
          })
        })
      }

      // Reload comments from server to ensure consistency
      if (answerId) {
        setTimeout(async () => {
          await loadComments(answerId, true)
        }, 300)
      }
      if (questionId) {
        setTimeout(async () => {
          await loadQuestionComments(questionId, true)
        }, 300)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete comment.')
    }
  }

  const handleDeleteQuestion = async (questionId: string) => {
    if (!user) {
      setError('Please sign in to delete questions.')
      return
    }

    if (!confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
      return
    }

    try {
      const response = await fetch(`${apiBase}/api/questions/${questionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete question')
      }

      // Navigate back to home or questions page
      setCurrentQuestion(null)
      setView('ask')
      setCurrentPage('home')
      window.location.hash = '#'
    } catch (err: any) {
      setError(err.message || 'Failed to delete question.')
    }
  }

  return (
    <div className="app">
      <header className="top-header">
        <div className="header-container">
          <button
            className="hamburger-menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            ☰
          </button>
          <div className="logo clickable" onClick={handleLogoClick}>
            <img src={logoImg} alt="askless logo" className="logo-image" />
            <span><span style={{ color: 'gray' }}>ask</span><strong>less</strong></span>
          </div>
          <a href="#" className="header-link">Products</a>
          <div className="header-search">
            <input type="search" placeholder="Q Search..." className="search-input" />
          </div>
          {user ? (
            <div className="auth-user">
              <span className="auth-name clickable" onClick={handleProfileClick}>
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

        </div>
      </header>

      {showDuplicateModal && (
        <div className="duplicate-modal-overlay" onClick={() => setShowDuplicateModal(false)}>
          <div className="duplicate-modal" onClick={(e) => e.stopPropagation()}>
            <div className="duplicate-modal-title">Seriously?</div>
            <div className="duplicate-modal-body">
              You’re asking a question that’s already been answered. Try reading existing posts before adding noise.
            </div>
            {duplicateNotice && (
              <div className="duplicate-modal-note">{duplicateNotice}</div>
            )}
            <div className="duplicate-modal-actions">
              <button
                type="button"
                className="duplicate-modal-button"
                onClick={() => setShowDuplicateModal(false)}
              >
                Fine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)}>
          <nav className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <a
              href="#"
              className={`mobile-nav-item ${currentPage === 'home' && view !== 'profile' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('home')
                setView('ask')
                window.location.hash = '#'
                setMobileMenuOpen(false)
              }}
            >
              Home
            </a>
            <a
              href="#"
              className={`mobile-nav-item ${currentPage === 'questions' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('questions')
                window.location.hash = '#questions'
                setMobileMenuOpen(false)
              }}
            >
              Questions
            </a>
            <a
              href="#"
              className={`mobile-nav-item ${currentPage === 'tags' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('tags')
                window.location.hash = '#tags'
                setMobileMenuOpen(false)
              }}
            >
              Tags
            </a>
            <a href="#" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false) }}>Saves</a>
            <div className="mobile-nav-divider"></div>
            <a href="#" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false) }}>Challenges</a>
            <a href="#" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false) }}>Chat</a>
            <a href="#" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false) }}>Articles</a>
            <a href="#" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false) }}>Users</a>
            <a href="#" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false) }}>Companies</a>
          </nav>
        </div>
      )}

      <div className="main-layout">
        <aside className="left-sidebar">
          <nav className="sidebar-nav">
            <a
              href="#"
              className={`nav-item ${currentPage === 'home' && view !== 'profile' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('home')
                setView('ask')
                window.location.hash = '#'
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
                window.location.hash = '#questions'
              }}
            >
              Questions
            </a>
            <a
              href="#"
              className={`nav-item ${currentPage === 'tags' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setCurrentPage('tags')
                window.location.hash = '#tags'
              }}
            >
              Tags
            </a>
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
          {view === 'profile' ? (
            <>
              <section className="profile-section">
                {profileLoading ? (
                  <div className="profile-loading">Loading profile...</div>
                ) : userProfile ? (
                  <>
                    <div className="profile-header">
                      <div className="profile-avatar">
                        {userProfile.avatar_url ? (
                          <img src={userProfile.avatar_url} alt={userProfile.username} />
                        ) : (
                          <div className="avatar-placeholder">
                            {userProfile.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="profile-info">
                        <h1 className="profile-name">{userProfile.username}</h1>
                        <div className="profile-meta">
                          <span className="profile-meta-item">
                            🎂 Member for {user ? Math.floor((Date.now() - new Date(user.created_at || Date.now()).getTime()) / (1000 * 60 * 60 * 24)) : 0} days
                          </span>
                          <span className="profile-meta-item">
                            👁️ Last seen this week
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="profile-tabs">
                      <button
                        className={`profile-tab ${activeProfileTab === 'summary' ? 'active' : ''}`}
                        onClick={() => setActiveProfileTab('summary')}
                      >
                        Profile
                      </button>
                      <button
                        className={`profile-tab ${activeProfileTab === 'questions' ? 'active' : ''}`}
                        onClick={() => setActiveProfileTab('questions')}
                      >
                        Activity
                      </button>
                      <button
                        className={`profile-tab ${activeProfileTab === 'answers' ? 'active' : ''}`}
                        onClick={() => setActiveProfileTab('answers')}
                      >
                        Answers
                      </button>
                    </div>

                    <div className="profile-content">
                      {activeProfileTab === 'summary' && (
                        <div className="profile-summary">
                          <div className="profile-stats-grid">
                            <div className="profile-stat-card">
                              <div className="profile-stat-value">{userStats?.questionsCount || 0}</div>
                              <div className="profile-stat-label">Questions</div>
                            </div>
                            <div className="profile-stat-card">
                              <div className="profile-stat-value">{userStats?.answersCount || 0}</div>
                              <div className="profile-stat-label">Answers</div>
                            </div>
                          </div>
                          <div className="profile-summary-box">
                            <div className="profile-summary-icon">📊</div>
                            <h3>Reputation is how the community thanks you</h3>
                            <p>When users upvote your helpful posts, you'll earn reputation and unlock new privileges.</p>
                            <p className="profile-summary-link">
                              Learn more about <a href="#">reputation</a> and <a href="#">privileges</a>
                            </p>
                          </div>
                        </div>
                      )}

                      {activeProfileTab === 'questions' && (
                        <div className="profile-activity">
                          <h2 className="profile-activity-title">Questions ({userActivity?.questions.length || 0})</h2>
                          {userActivity?.questions.length === 0 ? (
                            <div className="profile-empty">No questions yet.</div>
                          ) : (
                            <div className="profile-activity-list">
                              {userActivity?.questions.map(question => (
                                <div key={question.id} className="profile-activity-item">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                      <h3 className="profile-activity-item-title">
                                        <a
                                          href="#"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            window.location.hash = `#questions/${question.id}`
                                          }}
                                        >
                                          {question.title}
                                        </a>
                                      </h3>
                                      <div className="profile-activity-item-meta">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                          {question.tags && question.tags.length > 0 && (
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                              {question.tags.map((tag: any) => (
                                                <span key={tag.id || tag.name} className="tag" style={{
                                                  background: 'var(--so-blue-light)',
                                                  color: 'var(--so-blue)',
                                                  padding: '4px 8px',
                                                  borderRadius: '3px',
                                                  fontSize: '12px'
                                                }}>
                                                  {tag.name || tag}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                          <span style={{ color: 'var(--so-text-muted)', fontSize: '13px' }}>
                                            {question.answerCount || 0} {question.answerCount === 1 ? 'answer' : 'answers'}
                                          </span>
                                          <span>{new Date(question.created_at).toLocaleDateString()}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <button
                                      onClick={async (e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        if (confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
                                          try {
                                            const response = await fetch(`${apiBase}/api/questions/${question.id}`, {
                                              method: 'DELETE',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({
                                                userId: user?.id,
                                              }),
                                            })
                                            if (response.ok) {
                                              // Reload profile to refresh the list
                                              if (user) {
                                                await loadUserProfile(user.id)
                                              }
                                            } else {
                                              const errorData = await response.json().catch(() => ({}))
                                              setError(errorData.error || 'Failed to delete question')
                                            }
                                          } catch (err: any) {
                                            setError(err.message || 'Failed to delete question.')
                                          }
                                        }
                                      }}
                                      style={{
                                        background: '#d32f2f',
                                        color: 'white',
                                        border: 'none',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                        whiteSpace: 'nowrap'
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {activeProfileTab === 'answers' && (
                        <div className="profile-activity">
                          <h2 className="profile-activity-title">Answers ({userActivity?.answers.length || 0})</h2>
                          {userActivity?.answers.length === 0 ? (
                            <div className="profile-empty">No answers yet.</div>
                          ) : (
                            <div className="profile-activity-list">
                              {userActivity?.answers.map(answer => (
                                <div key={answer.id} className="profile-activity-item">
                                  <div className="profile-activity-item-content">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {answer.content.substring(0, 200) + '...'}
                                    </ReactMarkdown>
                                  </div>
                                  <div className="profile-activity-item-meta">
                                    <span>{new Date(answer.created_at).toLocaleDateString()}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="profile-error">Profile not found</div>
                )}
              </section>
            </>
          ) : currentPage === 'questions' ? (
            <Questions onSelectQuestion={handleSelectQuestion} />
          ) : currentPage === 'tags' ? (
            <Tabs onSelectQuestion={handleSelectQuestion} />
          ) : (
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <label htmlFor="body" className="form-label" style={{ marginBottom: 0 }}>
                          Description <span className="required">*</span>
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setMarkdownMode('write')}
                            style={{
                              padding: '6px 12px',
                              border: '1px solid var(--so-border)',
                              background: markdownMode === 'write' ? 'var(--so-blue-light)' : 'white',
                              color: markdownMode === 'write' ? 'var(--so-blue)' : 'var(--so-text)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: markdownMode === 'write' ? '600' : '400'
                            }}
                          >
                            Write
                          </button>
                          <button
                            type="button"
                            onClick={() => setMarkdownMode('preview')}
                            style={{
                              padding: '6px 12px',
                              border: '1px solid var(--so-border)',
                              background: markdownMode === 'preview' ? 'var(--so-blue-light)' : 'white',
                              color: markdownMode === 'preview' ? 'var(--so-blue)' : 'var(--so-text)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: markdownMode === 'preview' ? '600' : '400'
                            }}
                          >
                            Preview
                          </button>
                        </div>
                      </div>
                      <p className="form-hint">
                        Include all the information someone would need to answer your question. Min 20 characters. Markdown is supported.
                      </p>
                      <div style={{ position: 'relative' }}>
                        {markdownMode === 'write' ? (
                          <textarea
                            id="body"
                            className="form-textarea"
                            placeholder="Describe your problem, what you've tried, and any relevant details... (Markdown supported)"
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={10}
                          />
                        ) : (
                          <div
                            className="form-textarea"
                            style={{
                              minHeight: '200px',
                              padding: '12px',
                              overflow: 'auto',
                              fontSize: '14px',
                              lineHeight: '1.6',
                              whiteSpace: 'pre-wrap'
                            }}
                          >
                            {body.trim() ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {body}
                              </ReactMarkdown>
                            ) : (
                              <div style={{ color: 'var(--so-text-muted)', fontStyle: 'italic' }}>
                                Nothing to preview. Start typing to see your markdown rendered here.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="form-counter">
                        {bodyLength} {!isBodyValid && bodyLength > 0 && (
                          <span className="form-error"> (minimum 20 characters)</span>
                        )}
                      </div>
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
              ) : currentQuestion ? (() => {
                const question = currentQuestion as Question
                return (
                  <section className="question-detail-section">
                    <div className="question-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h1 className="question-title">{question.title}</h1>
                      {user && currentQuestion?.user_id === user.id && (
                        <button
                          className="question-delete-btn"
                          onClick={() => handleDeleteQuestion(question.id)}
                          style={{
                            background: '#d32f2f',
                            color: 'white',
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500'
                          }}
                        >
                          Delete Question
                        </button>
                      )}
                    </div>
                    {duplicateNotice && (
                      <div className="closed-banner">{duplicateNotice}</div>
                    )}

                    <div className="question-content-card">
                      <div className="question-votes">
                        <button
                          className={`vote-button upvote ${userVotes[question.id] === 'upvote' ? 'active' : ''}`}
                          onClick={() => handleVote(question.id, undefined, 'upvote')}
                        >
                          ▲
                        </button>
                        <div className="vote-count">{voteCounts[question.id]?.total ?? 0}</div>
                        <button
                          className={`vote-button downvote ${userVotes[question.id] === 'downvote' ? 'active' : ''}`}
                          onClick={() => handleVote(question.id, undefined, 'downvote')}
                        >
                          ▼
                        </button>
                      </div>
                      <div className="question-body">
                        <div className="question-text">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {question.content}
                          </ReactMarkdown>
                        </div>
                        <div className="question-footer">
                          <div className="question-tags">
                            {(() => {
                              const fallbackTags = Array.isArray(question.tags)
                                ? question.tags.map((tag: any) => tag?.name || tag).filter(Boolean)
                                : []
                              const displayTags = currentQuestionTags.length > 0 ? currentQuestionTags : fallbackTags
                              return displayTags.map((tag: string, i: number) => (
                                <span key={`${tag}-${i}`} className="tag">{tag}</span>
                              ))
                            })()}
                          </div>
                          <div className="question-author">
                            <span>Asked by:</span>
                            <a href="#" className="author-link">
                              {currentQuestionAuthor?.username || 'Anonymous'}
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="answers-section">
                      {(() => {
                        // Count only answers to the question: AI answers + question comments (top-level comments on questions)
                        // Comments on answers are NOT counted as answers
                        // Deduplicate visibleAnswers by answer ID to prevent counting duplicates
                        const uniqueVisibleAnswers = Array.from(
                          new Map(visibleAnswers.map(a => [a.answer.id, a])).values()
                        )
                        const totalQuestionComments = questionComments.filter(c => !c.parent_id || c.parent_id === null).length
                        const totalAnswers = uniqueVisibleAnswers.length + totalQuestionComments
                        return (
                          <h2 className="answers-title">
                            {totalAnswers} {totalAnswers === 1 ? 'Answer' : 'Answers'}
                          </h2>
                        )
                      })()}

                      {(() => {
                        // Deduplicate visibleAnswers by answer ID to prevent showing duplicates
                        const uniqueVisibleAnswers = Array.from(
                          new Map(visibleAnswers.map(a => [a.answer.id, a])).values()
                        )
                        return uniqueVisibleAnswers.map((botAnswer) => {
                          const answerComments = comments[botAnswer.answer.id] || []
                          const topLevelComments = answerComments.filter(c => !c.parent_id || c.parent_id === null)
                          const nestedComments = answerComments.filter(c => c.parent_id)

                          return (
                            <div key={botAnswer.answer.id}>
                              {/* AI Answer */}
                              <div className="answer-card" style={{ marginBottom: '1.5rem' }}>
                                <div className="answer-header">
                                  <div className="answer-votes">
                                    <button
                                      className={`vote-button upvote ${userVotes[botAnswer.answer.id] === 'upvote' ? 'active' : ''}`}
                                      onClick={() => handleVote(undefined, botAnswer.answer.id, 'upvote')}
                                    >
                                      ▲
                                    </button>
                                    <div className="vote-count">{voteCounts[botAnswer.answer.id]?.total ?? (upvotes[botAnswer.answer.id] || 0)}</div>
                                    <button
                                      className={`vote-button downvote ${userVotes[botAnswer.answer.id] === 'downvote' ? 'active' : ''}`}
                                      onClick={() => handleVote(undefined, botAnswer.answer.id, 'downvote')}
                                    >
                                      ▼
                                    </button>
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
                                      </div>
                                    </div>

                                  </div>
                                </div>
                              </div>

                              {/* Comments on AI Answer - compact format */}
                              {topLevelComments.length > 0 && (
                                <div className="comments-section" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--so-border)' }}>
                                  {topLevelComments.map(comment => (
                                    <div key={comment.id} className="comment-item" style={{ marginBottom: '8px' }}>
                                      <div className="comment-content" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {comment.content}
                                        </ReactMarkdown>
                                        <div className="comment-author" style={{ fontSize: '11px', marginTop: '2px' }}>
                                          <a href="#" className="author-link" style={{ fontSize: '11px' }}>{comment.profile?.username || 'User'}</a>
                                          <button
                                            className="comment-reply-btn"
                                            onClick={() => {
                                              const key = `${botAnswer.answer.id}-${comment.id}`
                                              setReplyingTo(prev => ({
                                                ...prev,
                                                [key]: prev[key] || ''
                                              }))
                                            }}
                                            style={{ fontSize: '11px' }}
                                          >
                                            Reply
                                          </button>
                                          {user && comment.user_id === user.id && (
                                            <button
                                              className="comment-delete-btn"
                                              onClick={() => handleDeleteComment(comment.id, botAnswer.answer.id)}
                                              style={{
                                                marginLeft: '6px',
                                                background: 'none',
                                                border: 'none',
                                                color: '#d32f2f',
                                                cursor: 'pointer',
                                                fontSize: '11px',
                                                textDecoration: 'underline'
                                              }}
                                            >
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* Reply input */}
                                      {replyingTo[`${botAnswer.answer.id}-${comment.id}`] !== undefined && (
                                        <div className="comment-reply-form" style={{ marginTop: '6px' }}>
                                          <textarea
                                            className="comment-input"
                                            placeholder="Add a reply..."
                                            value={replyingTo[`${botAnswer.answer.id}-${comment.id}`] || ''}
                                            onChange={(e) => setReplyingTo(prev => ({
                                              ...prev,
                                              [`${botAnswer.answer.id}-${comment.id}`]: e.target.value
                                            }))}
                                            rows={2}
                                            style={{ fontSize: '12px', padding: '6px', minHeight: '50px' }}
                                          />
                                          <div className="comment-actions" style={{ marginTop: '4px' }}>
                                            <button
                                              className="comment-submit-btn"
                                              onClick={() => handleAddComment(botAnswer.answer.id, comment.id)}
                                              style={{ fontSize: '11px', padding: '4px 8px' }}
                                            >
                                              Add Comment
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
                                              style={{ fontSize: '11px', padding: '4px 8px' }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      )}

                                      {/* Nested replies to comments */}
                                      {nestedComments.filter(c => c.parent_id === comment.id).length > 0 && (
                                        <div style={{ marginLeft: '24px', marginTop: '8px', paddingLeft: '12px', borderLeft: '1px solid var(--so-border)' }}>
                                          {nestedComments
                                            .filter(c => c.parent_id === comment.id)
                                            .map(reply => (
                                              <div key={reply.id} className="comment-item nested" style={{ marginBottom: '6px', paddingBottom: '6px' }}>
                                                <div className="comment-content" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {reply.content}
                                                  </ReactMarkdown>
                                                  <div className="comment-author" style={{ fontSize: '11px', marginTop: '2px' }}>
                                                    <a href="#" className="author-link" style={{ fontSize: '11px' }}>{reply.profile?.username || 'User'}</a>
                                                    <button
                                                      className="comment-reply-btn"
                                                      onClick={() => {
                                                        const key = `${botAnswer.answer.id}-${reply.id}`
                                                        setReplyingTo(prev => ({
                                                          ...prev,
                                                          [key]: prev[key] || ''
                                                        }))
                                                      }}
                                                      style={{ fontSize: '11px' }}
                                                    >
                                                      Reply
                                                    </button>
                                                    {user && reply.user_id === user.id && (
                                                      <button
                                                        className="comment-delete-btn"
                                                        onClick={() => handleDeleteComment(reply.id, botAnswer.answer.id)}
                                                        style={{
                                                          marginLeft: '6px',
                                                          background: 'none',
                                                          border: 'none',
                                                          color: '#d32f2f',
                                                          cursor: 'pointer',
                                                          fontSize: '11px',
                                                          textDecoration: 'underline'
                                                        }}
                                                      >
                                                        Delete
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>

                                                {/* Reply input for nested comments */}
                                                {replyingTo[`${botAnswer.answer.id}-${reply.id}`] !== undefined && (
                                                  <div className="comment-reply-form" style={{ marginTop: '6px' }}>
                                                    <textarea
                                                      className="comment-input"
                                                      placeholder="Add a reply..."
                                                      value={replyingTo[`${botAnswer.answer.id}-${reply.id}`] || ''}
                                                      onChange={(e) => setReplyingTo(prev => ({
                                                        ...prev,
                                                        [`${botAnswer.answer.id}-${reply.id}`]: e.target.value
                                                      }))}
                                                      rows={2}
                                                      style={{ fontSize: '12px', padding: '6px', minHeight: '50px' }}
                                                    />
                                                    <div className="comment-actions" style={{ marginTop: '4px' }}>
                                                      <button
                                                        className="comment-submit-btn"
                                                        onClick={() => handleAddComment(botAnswer.answer.id, reply.id)}
                                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                                      >
                                                        Add Comment
                                                      </button>
                                                      <button
                                                        className="comment-cancel-btn"
                                                        onClick={() => {
                                                          setReplyingTo(prev => {
                                                            const newReplying = { ...prev }
                                                            delete newReplying[`${botAnswer.answer.id}-${reply.id}`]
                                                            return newReplying
                                                          })
                                                        }}
                                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                                      >
                                                        Cancel
                                                      </button>
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add comment form for AI answer */}
                              {user && (
                                <div className="comment-form" style={{ marginTop: '12px', marginBottom: '1.5rem' }}>
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
                          )
                        })
                      })()}
                    </div>

                    {/* Question Comments Section - Displayed as Answer Cards */}
                    {questionComments.filter(c => !c.parent_id || c.parent_id === null).map(comment => {
                      const nestedQuestionComments = questionComments.filter(c => c.parent_id === comment.id)
                      return (
                        <div key={comment.id} className="answer-card" style={{ marginBottom: '1.5rem' }}>
                          <div className="answer-header">
                            <div className="answer-votes">
                              <button
                                className="vote-button upvote"
                                disabled
                                title="Voting on question comments is not yet supported"
                                style={{ opacity: 0.5, cursor: 'not-allowed' }}
                              >
                                ▲
                              </button>
                              <div className="vote-count">0</div>
                              <button
                                className="vote-button downvote"
                                disabled
                                title="Voting on question comments is not yet supported"
                                style={{ opacity: 0.5, cursor: 'not-allowed' }}
                              >
                                ▼
                              </button>
                            </div>
                            <div className="answer-content">
                              <div className="answer-text">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {comment.content}
                                </ReactMarkdown>
                              </div>
                              <div className="answer-footer">
                                <div className="answer-author">
                                  <span>Answered by:</span>
                                  <a href="#" className="author-link">{comment.profile?.username || 'User'}</a>
                                  {user && comment.user_id === user.id && (
                                    <button
                                      className="comment-delete-btn"
                                      onClick={() => handleDeleteComment(comment.id, undefined, question.id)}
                                      style={{
                                        marginLeft: '8px',
                                        background: 'none',
                                        border: 'none',
                                        color: '#d32f2f',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        textDecoration: 'underline'
                                      }}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Comments on this answer (nested replies) */}
                              {nestedQuestionComments.length > 0 && (
                                <div className="comments-section" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--so-border)' }}>
                                  {nestedQuestionComments.map(reply => (
                                    <div key={reply.id} className="comment-item nested">
                                      <div className="comment-content">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {reply.content}
                                        </ReactMarkdown>
                                        <div className="comment-author">
                                          <a href="#" className="author-link">{reply.profile?.username || 'User'}</a>
                                          <button
                                            className="comment-reply-btn"
                                            onClick={() => {
                                              setReplyingToQuestion(prev => ({
                                                ...prev,
                                                [reply.id]: prev[reply.id] || ''
                                              }))
                                            }}
                                          >
                                            Reply
                                          </button>
                                          {user && reply.user_id === user.id && (
                                            <button
                                              className="comment-delete-btn"
                                              onClick={() => handleDeleteComment(reply.id, undefined, question.id)}
                                              style={{
                                                marginLeft: '8px',
                                                background: 'none',
                                                border: 'none',
                                                color: '#d32f2f',
                                                cursor: 'pointer',
                                                fontSize: '12px',
                                                textDecoration: 'underline'
                                              }}
                                            >
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* Reply input for nested comments */}
                                      {replyingToQuestion[reply.id] !== undefined && (
                                        <div className="comment-reply-form">
                                          <textarea
                                            className="comment-input"
                                            placeholder="Add a reply..."
                                            value={replyingToQuestion[reply.id] || ''}
                                            onChange={(e) => setReplyingToQuestion(prev => ({
                                              ...prev,
                                              [reply.id]: e.target.value
                                            }))}
                                            rows={3}
                                          />
                                          <div className="comment-actions">
                                            <button
                                              className="comment-submit-btn"
                                              onClick={() => handleAddQuestionComment(question.id, reply.id)}
                                            >
                                              Add Comment
                                            </button>
                                            <button
                                              className="comment-cancel-btn"
                                              onClick={() => {
                                                setReplyingToQuestion(prev => {
                                                  const newReplying = { ...prev }
                                                  delete newReplying[reply.id]
                                                  return newReplying
                                                })
                                              }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add comment form for nested replies */}
                              {user && (
                                <div className="comment-form" style={{ marginTop: '12px' }}>
                                  <textarea
                                    className="comment-input"
                                    placeholder="Add a comment..."
                                    value={replyingToQuestion[comment.id] || ''}
                                    onChange={(e) => setReplyingToQuestion(prev => ({
                                      ...prev,
                                      [comment.id]: e.target.value
                                    }))}
                                    rows={3}
                                  />
                                  <div className="comment-actions">
                                    <button
                                      className="comment-submit-btn"
                                      onClick={() => handleAddQuestionComment(question.id, comment.id)}
                                      disabled={!replyingToQuestion[comment.id]?.trim()}
                                    >
                                      Add Comment
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* Add answer form for questions */}
                    {user && (
                      <div className="comment-form" style={{ marginTop: '12px', marginBottom: '1.5rem' }}>
                        <div className="answer-form-label">Your Answer</div>
                        <textarea
                          className="comment-input"
                          placeholder="Add an answer..."
                          value={questionCommentText}
                          onChange={(e) => setQuestionCommentText(e.target.value)}
                          rows={3}
                        />
                        <div className="comment-actions">
                          <button
                            className="comment-submit-btn"
                            onClick={() => handleAddQuestionComment(question.id)}
                            disabled={!questionCommentText.trim()}
                          >
                            Add Answer
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )
              })() : (
                <section className="question-detail-section">
                  <div className="questions-loading">Loading question...</div>
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
          )}
        </main>

        <aside className="right-sidebar">
          {currentPage === 'home' && view === 'ask' ? (
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
              <button
                className="ask-question-btn"
                onClick={(e) => {
                  e.preventDefault()
                  setCurrentPage('home')
                  setView('ask')
                  window.location.hash = '#'
                }}
              >
                Ask Question
              </button>
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
