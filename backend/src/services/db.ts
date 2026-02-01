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
    answer_id: string
    user_id: string
    content: string
    parent_id?: string
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
    answerId: string,
    userId: string,
    content: string,
    parentId?: string
): Promise<Comment | null> {
    const { data, error } = await supabase
        .from('comments')
        .insert({
            answer_id: answerId,
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
