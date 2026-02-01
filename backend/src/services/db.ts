import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'

// Types matching your database schema
export interface Profile {
    id: string
    username: string
    is_ai: boolean
    avatar_url?: string
}

export interface Tag {
    id: number
    name: string
}

export interface Question {
    id: string
    created_at: string
    user_id: string
    title: string
    content: string
    status: string
}

export interface QuestionTag {
    question_id: string
    tag_id: number
}

export interface Answer {
    id: string
    created_at: string
    question_id: string
    user_id: string
    content: string
    is_accepted: boolean
}

export interface Comment {
    id: string
    created_at: string
    answer_id?: string
    question_id?: string
    user_id: string
    content: string
    parent_id?: string
}

export interface Vote {
    id: string
    created_at: string
    user_id: string
    question_id?: string
    answer_id?: string
    vote_type: 'upvote' | 'downvote'
}

// Profile operations
export async function getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

    if (error) {
        // Don't log error if profile simply doesn't exist (code PGRST116)
        if (error.code !== 'PGRST116') {
            console.error('Error fetching profile:', {
                userId,
                error: error.message,
                code: error.code,
                details: error.details
            })
        }
        return null
    }
    return data
}

export async function createProfile(profile: Omit<Profile, 'id'> & { id: string }): Promise<Profile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .insert(profile)
        .select()
        .single()

    if (error) {
        console.error('Error creating profile:', error)
        return null
    }
    return data
}

export async function upsertProfile(profile: Omit<Profile, 'id'> & { id: string }): Promise<Profile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .upsert(profile, { onConflict: 'id' })
        .select()
        .single()

    if (error) {
        console.error('Error upserting profile:', {
            error: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            profile: { id: profile.id, username: profile.username, is_ai: profile.is_ai }
        })
        return null
    }
    return data
}

// Simplified function for AI bot profiles
// Note: This requires bot users to exist in auth.users first due to foreign key constraint
// See the SQL migration script in the README or run the provided SQL to create bot users
export async function upsertAIProfile(profile: Omit<Profile, 'id'> & { id: string }): Promise<Profile | null> {
    // First check if profile already exists
    const existing = await getProfile(profile.id)
    if (existing) {
        return existing
    }

    // Try to create the profile
    // The foreign key constraint requires the user to exist in auth.users
    // We'll try to create it, and if it fails, provide helpful error message
    const { data, error } = await supabase
        .from('profiles')
        .insert({
            id: profile.id,
            username: profile.username,
            is_ai: true, // Force is_ai to true for AI profiles
            avatar_url: profile.avatar_url || null
        })
        .select()
        .single()

    if (error) {
        // If insert fails (e.g., profile already exists), try to get it
        if (error.code === '23505') { // Unique violation
            const existingProfile = await getProfile(profile.id)
            if (existingProfile) {
                return existingProfile
            }
        }

        // If foreign key error, provide helpful message with SQL solution
        if (error.code === '23503') {
            const botEmail = `${profile.username.replace(/[^a-z0-9]/g, '_')}@bot.askless.local`
            console.error(`\n❌ Foreign key constraint error for ${profile.id}`)
            console.error(`The bot user needs to exist in auth.users first.`)
            console.error(`\nTo fix this, run this SQL in your Supabase SQL Editor:`)
            console.error(`\nINSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, role)`)
            console.error(`VALUES ('${profile.id}', '${botEmail}', '', NOW(), NOW(), NOW(), '{"provider":"bot","providers":["bot"]}'::jsonb, '{"is_ai":true}'::jsonb, 'authenticated')`)
            console.error(`ON CONFLICT (id) DO NOTHING;\n`)
        }

        console.error('Error creating AI profile:', {
            error: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            profile: { id: profile.id, username: profile.username }
        })
        return null
    }
    return data
}

export async function getOrCreateAIProfile(): Promise<Profile | null> {
    // First, try to find an existing AI profile
    const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('is_ai', true)
        .limit(1)
        .single()

    if (existing) {
        return existing
    }

    // Create a new AI profile if none exists
    const aiProfile = {
        id: randomUUID(),
        username: 'ai_assistant',
        is_ai: true,
        avatar_url: undefined
    }

    return await createProfile(aiProfile)
}

// Question operations
export async function createQuestion(
    userId: string,
    title: string,
    content: string,
    tagIds?: number[]
): Promise<Question | null> {
    const { data: question, error: questionError } = await supabase
        .from('questions')
        .insert({
            user_id: userId,
            title,
            content,
            status: 'open'
        })
        .select()
        .single()

    if (questionError) {
        console.error('Error creating question:', questionError)
        return null
    }

    // Add tags if provided
    if (tagIds && tagIds.length > 0 && question) {
        const questionTags = tagIds.map(tagId => ({
            question_id: question.id,
            tag_id: tagId
        }))

        const { error: tagError } = await supabase
            .from('question_tags')
            .insert(questionTags)

        if (tagError) {
            console.error('Error adding tags to question:', tagError)
        }
    }

    return question
}

export async function getQuestion(questionId: string): Promise<Question | null> {
    const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('id', questionId)
        .single()

    if (error) {
        console.error('Error fetching question:', error)
        return null
    }
    return data
}

export async function getQuestions(limit = 50): Promise<Question[]> {
    const { data, error } = await supabase
        .from('questions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

    if (error) {
        console.error('Error fetching questions:', error)
        return []
    }
    return data || []
}

// Answer operations
export async function createAnswer(
    questionId: string,
    userId: string,
    content: string
): Promise<Answer | null> {
    const { data, error } = await supabase
        .from('answers')
        .insert({
            question_id: questionId,
            user_id: userId,
            content,
            is_accepted: false
        })
        .select()
        .single()

    if (error) {
        console.error('Error creating answer:', error)
        return null
    }
    return data
}

export async function getAnswersForQuestion(questionId: string): Promise<Answer[]> {
    const { data, error } = await supabase
        .from('answers')
        .select('*')
        .eq('question_id', questionId)
        .order('created_at', { ascending: true })

    if (error) {
        console.error('Error fetching answers:', error)
        return []
    }
    return data || []
}

// Tag operations
export async function getTags(): Promise<Tag[]> {
    const { data, error } = await supabase
        .from('tags')
        .select('*')
        .order('name', { ascending: true })

    if (error) {
        console.error('Error fetching tags:', error)
        return []
    }
    return data || []
}

export async function createTag(name: string): Promise<Tag | null> {
    const { data, error } = await supabase
        .from('tags')
        .insert({ name })
        .select()
        .single()

    if (error) {
        console.error('Error creating tag:', error)
        return null
    }
    return data
}

export async function getTagsForQuestion(questionId: string): Promise<Tag[]> {
    const { data, error } = await supabase
        .from('question_tags')
        .select('tags(*)')
        .eq('question_id', questionId)

    if (error) {
        console.error('Error fetching question tags:', error)
        return []
    }
    return data?.map((item: any) => item.tags).filter(Boolean) || []
}

// Comment operations
export async function createComment(
    answerId: string | undefined,
    userId: string,
    content: string,
    parentId?: string,
    questionId?: string
): Promise<Comment | null> {
    const { data, error } = await supabase
        .from('comments')
        .insert({
            answer_id: answerId || null,
            question_id: questionId || null,
            user_id: userId,
            content,
            parent_id: parentId || null
        })
        .select()
        .single()

    if (error) {
        console.error('Error creating comment:', error)
        return null
    }
    return data
}

export async function createQuestionComment(
    questionId: string,
    userId: string,
    content: string,
    parentId?: string
): Promise<Comment | null> {
    return createComment(undefined, userId, content, parentId, questionId)
}

export async function getCommentsForAnswer(answerId: string): Promise<(Comment & { profile?: Profile })[]> {
    const { data, error } = await supabase
        .from('comments')
        .select(`
            *,
            profile:profiles!comments_user_id_fkey(id, username, avatar_url)
        `)
        .eq('answer_id', answerId)
        .order('created_at', { ascending: true })

    if (error) {
        console.error('Error fetching comments:', error)
        return []
    }
    return data?.map((item: any) => ({
        ...item,
        profile: item.profile || undefined
    })) || []
}

export async function getCommentsForQuestion(questionId: string): Promise<(Comment & { profile?: Profile })[]> {
    const { data, error } = await supabase
        .from('comments')
        .select(`
            *,
            profile:profiles!comments_user_id_fkey(id, username, avatar_url)
        `)
        .eq('question_id', questionId)
        .order('created_at', { ascending: true })

    if (error) {
        console.error('Error fetching question comments:', error)
        return []
    }
    return data?.map((item: any) => ({
        ...item,
        profile: item.profile || undefined
    })) || []
}

// User activity operations
export async function getQuestionsByUser(userId: string): Promise<Question[]> {
    const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching user questions:', error)
        return []
    }
    return data || []
}

export async function getAnswersByUser(userId: string): Promise<Answer[]> {
    const { data, error } = await supabase
        .from('answers')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching user answers:', error)
        return []
    }
    return data || []
}

export async function getCommentsByUser(userId: string): Promise<(Comment & { profile?: Profile })[]> {
    const { data, error } = await supabase
        .from('comments')
        .select(`
            *,
            profile:profiles!comments_user_id_fkey(id, username, avatar_url)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching user comments:', error)
        return []
    }
    return data?.map((item: any) => ({
        ...item,
        profile: item.profile || undefined
    })) || []
}

export async function deleteComment(commentId: string, userId: string): Promise<boolean> {
    // First verify the comment belongs to the user
    const { data: comment, error: fetchError } = await supabase
        .from('comments')
        .select('user_id')
        .eq('id', commentId)
        .single()

    if (fetchError || !comment) {
        console.error('Error fetching comment:', fetchError)
        return false
    }

    if (comment.user_id !== userId) {
        console.error('User does not own this comment')
        return false
    }

    // Delete the comment
    const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId)

    if (error) {
        console.error('Error deleting comment:', error)
        return false
    }

    return true
}

// Vote operations
export async function createVote(
    userId: string,
    questionId: string | undefined,
    answerId: string | undefined,
    voteType: 'upvote' | 'downvote'
): Promise<Vote | null> {
    // Check if user already voted on this item
    const existingVote = await getUserVote(userId, questionId, answerId)

    if (existingVote) {
        // If same vote type, remove the vote (toggle off)
        if (existingVote.vote_type === voteType) {
            const { error } = await supabase
                .from('votes')
                .delete()
                .eq('id', existingVote.id)

            if (error) {
                console.error('Error removing vote:', error)
                return null
            }
            return null // Vote removed
        } else {
            // If different vote type, update the vote
            const { data, error } = await supabase
                .from('votes')
                .update({ vote_type: voteType })
                .eq('id', existingVote.id)
                .select()
                .single()

            if (error) {
                console.error('Error updating vote:', error)
                return null
            }
            return data
        }
    }

    // Create new vote
    const { data, error } = await supabase
        .from('votes')
        .insert({
            user_id: userId,
            question_id: questionId || null,
            answer_id: answerId || null,
            vote_type: voteType
        })
        .select()
        .single()

    if (error) {
        console.error('Error creating vote:', error)
        if (error.code === '42P01') {
            console.error('ERROR: votes table does not exist. Please run the migration: backend/migrations/create_votes_table.sql')
        }
        return null
    }
    return data
}

export async function getUserVote(
    userId: string,
    questionId: string | undefined,
    answerId: string | undefined
): Promise<Vote | null> {
    let query = supabase
        .from('votes')
        .select('*')
        .eq('user_id', userId)

    if (questionId) {
        query = query.eq('question_id', questionId).is('answer_id', null)
    } else if (answerId) {
        query = query.eq('answer_id', answerId).is('question_id', null)
    } else {
        return null
    }

    const { data, error } = await query.single()

    if (error) {
        if (error.code === 'PGRST116') {
            return null // No vote found
        }
        console.error('Error fetching user vote:', error)
        return null
    }
    return data
}

export async function getVoteCounts(
    questionId: string | undefined,
    answerId: string | undefined
): Promise<{ upvotes: number; downvotes: number; total: number }> {
    let query = supabase
        .from('votes')
        .select('vote_type')

    if (questionId) {
        query = query.eq('question_id', questionId).is('answer_id', null)
    } else if (answerId) {
        query = query.eq('answer_id', answerId).is('question_id', null)
    } else {
        return { upvotes: 0, downvotes: 0, total: 0 }
    }

    const { data, error } = await query

    if (error) {
        console.error('Error fetching vote counts:', error)
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
            console.error('ERROR: votes table does not exist. Please run the migration: backend/migrations/create_votes_table.sql')
        }
        return { upvotes: 0, downvotes: 0, total: 0 }
    }

    const upvotes = data?.filter(v => v.vote_type === 'upvote').length || 0
    const downvotes = data?.filter(v => v.vote_type === 'downvote').length || 0
    const total = upvotes - downvotes

    return { upvotes, downvotes, total }
}
