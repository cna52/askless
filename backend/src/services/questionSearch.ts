import { supabase } from '../lib/supabase'
import * as db from './db'

interface SimilarQuestion {
    question_id: string
    title: string
    content: string
    search_count: number
    created_at: string
    matching_tags: string[]
    overlap_count: number
}

export async function findSimilarQuestions(tagNames: string[]): Promise<SimilarQuestion[]> {
    if (!tagNames || tagNames.length === 0) {
        return []
    }

    try {
        const { data, error } = await supabase
            .rpc('find_similar_questions', {
                input_tag_names: tagNames,
                min_overlap: Math.min(2, tagNames.length)
            })

        if (error) {
            console.error('Error finding similar questions:', error)
            return []
        }

        return data || []
    } catch (error) {
        console.error('Error in findSimilarQuestions:', error)
        return []
    }
}

export async function getOrCreateTags(tagNames: string[]): Promise<db.Tag[]> {
    try {
        const { data: existingTags } = await supabase
            .from('tags')
            .select('id, name')
            .in('name', tagNames)

        const existingTagNames = existingTags?.map((t: db.Tag) => t.name) || []
        const newTagNames = tagNames.filter(name => !existingTagNames.includes(name))

        if (newTagNames.length > 0) {
            const { data: newTags, error } = await supabase
                .from('tags')
                .insert(newTagNames.map(name => ({ name })))
                .select()

            if (error) {
                console.error('Error creating tags:', error)
                return existingTags || []
            }

            return [...(existingTags || []), ...(newTags || [])]
        }

        return existingTags || []
    } catch (error) {
        console.error('Error in getOrCreateTags:', error)
        return []
    }
}

export async function linkQuestionToTags(questionId: string, tagIds: number[]): Promise<void> {
    if (tagIds.length === 0) return

    const tagLinks = tagIds.map(tagId => ({
        question_id: questionId,
        tag_id: tagId
    }))

    const { error } = await supabase
        .from('question_tags')
        .insert(tagLinks)

    if (error) {
        console.error('Error linking tags to question:', error)
    }
}