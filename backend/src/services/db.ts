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

// Profile operations
export async function getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

    if (error) {
        console.error('Error fetching profile:', error)
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
        username: 'sassy_ai_assistant',
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

